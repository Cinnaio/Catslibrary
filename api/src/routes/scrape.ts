/**
 * /api/scrape —— 爬虫动作分发（由 Novel-KV api/scrape.js 平移为 Hono 路由）。
 * 核心动作完整；discover/po18-search/jjwxc-titles 等富化动作暂标记 501（后续补）。
 */
import { Hono, type Context } from 'hono'
import { loadConfig } from '../config'
import { getDb } from '../db/pool'
import { first } from '../db/query'
import { requireAdmin } from '../middlewares/auth'
import { newId } from '../services/auth'
import { fetchHtml as fetchHtmlImpl, type FetchHtmlOptions, type FetchResult } from '../services/scraper/fetch'
import { runScrapeJob, testSelectors, type ScrapeDeps } from '../services/scraper/engine'
import { detectMeta } from '../services/scraper/meta'
import { getPresetForUrl, PgScrapeStore, type JobData, type ScrapeStore } from '../services/scraper/store'
import { parseLegadoJsonStream, normalizeSource, legadoHost, buildSourceRow, sourceToPreset } from '../services/scraper/legado'
import { SITE_PRESETS, buildCoverUrl } from '../services/scraper/presets'
import { discoverList, extractJjwxcTitles, extractPo18twTitles, proxyCover, searchPo18, searchTitleSources } from '../services/scraper/enrich'
import { cacheCoverForNovel, getStoredCover, coverDataToBody } from '../services/covers'
import { safeFetch } from '../services/safe-fetch'

export const scrapeRoutes = new Hono()

function makeDeps(db: ReturnType<typeof getDb>): ScrapeDeps {
  const config = loadConfig()
  const store = new PgScrapeStore(db)
  return {
    store,
    fetchHtml: (url: string, opts?: FetchHtmlOptions) =>
      fetchHtmlImpl(url, { ...opts, proxyBase: config.proxyBase, proxyDomains: config.proxyDomains }),
    log: (job, message, level) => {
      const id = job?.id || 'unknown'
      const novel = job?.novelId ? ` ${job.novelId}` : ''
      if (level === 'error') console.error(`[scrape] ${id}${novel} ${message}`)
      else if (level === 'warn') console.warn(`[scrape] ${id}${novel} ${message}`)
      else console.log(`[scrape] ${id}${novel} ${message}`)
    },
  }
}

function fireJob(jobId: string, deps: ScrapeDeps): void {
  // fire-and-forget：与 waitUntil 语义一致；进程重启后 running 任务由启动重置逻辑接管
  void runScrapeJob(jobId, deps).catch(async (err) => {
    const store = deps.store
    const j = await store.loadJob(jobId)
    if (j) {
      j.status = 'failed'
      j.error = (err as Error).message
      await store.saveJob(j)
    }
  })
}

scrapeRoutes.use('*', requireAdmin())

// ---------- GET：任务/日志/配置 ----------

scrapeRoutes.get('/', async (c) => {
  const db = getDb()
  const store = new PgScrapeStore(db)
  const action = c.req.query('action') || ''
  const jobId = c.req.query('jobId') || ''
  const novelId = c.req.query('novelId') || ''

  if (action === 'jobs') {
    const jobs = await store.listActiveJobs()
    const summaries = await Promise.all(
      jobs.map(async (job) => {
        const summary = await store.getJobSummary(job.id)
        // 汇总计数同时 merge 进顶层（与原项目行为一致，前端两处都可读）
        return { ...job, ...summary, summary }
      }),
    )
    return c.json({ jobs: summaries })
  }
  if (action === 'job-status' && jobId) {
    const job = await store.loadJob(jobId)
    if (!job) return c.json({ error: 'Job not found or expired' }, 404)
    const summary = await store.getJobSummary(jobId)
    return c.json({ ...job, ...summary, summary, recentLogs: await store.getJobLogs(jobId, { limit: 30 }), failedItems: await store.getJobItems(jobId, { status: 'failed', limit: 12 }) })
  }
  if (action === 'items' && jobId) {
    return c.json({ items: await store.getJobItems(jobId, { status: c.req.query('status') || '', limit: Number(c.req.query('limit')) || 80 }) })
  }
  if (action === 'logs' && jobId) {
    return c.json({ logs: await store.getJobLogs(jobId, { limit: Number(c.req.query('limit')) || 80 }) })
  }
  if (action === 'config' && novelId) {
    return c.json({ config: await store.getScrapeConfig(novelId) })
  }
  return c.json({ error: 'Unknown action or missing param' }, 400)
})

// ---------- POST：动作分发 ----------

scrapeRoutes.post('/', async (c) => {
  const db = getDb()
  const deps = makeDeps(db)
  const body = await c.req.json().catch(() => ({}))
  const action = body.action
  if (!action) return c.json({ error: 'action is required' }, 400)

  switch (action) {
    case 'detect': {
      const { sourceUrl } = body
      if (!sourceUrl) return c.json({ error: 'sourceUrl required' }, 400)
      const preset = await getPresetForUrl(sourceUrl, deps.store)
      if (preset) {
        return c.json({
          detected: true,
          source: preset.source === 'legado' ? 'legado' : 'preset',
          preset: { name: preset.name, encoding: preset.encoding, selectors: preset.selectors, meta: preset.meta },
        })
      }
      return c.json({ detected: false })
    }
    case 'detect-meta': {
      const { sourceUrl } = body
      if (!sourceUrl) return c.json({ error: 'sourceUrl required' }, 400)
      try {
        const result = await detectMeta(sourceUrl, { store: deps.store, fetchHtml: deps.fetchHtml })
        return c.json(result)
      } catch (err) {
        return c.json({ error: `分析失败: ${(err as Error).message}` }, 502)
      }
    }
    case 'test': {
      const { sourceUrl, selectors, encoding } = body
      try {
        return c.json(await testSelectors(sourceUrl, selectors || {}, encoding, deps))
      } catch (err) {
        return c.json({ error: `Fetch failed: ${(err as Error).message}` }, 502)
      }
    }
    case 'start': {
      const { novelId, sourceUrl, selectors, encoding } = body
      if (!novelId || !sourceUrl || !selectors?.chapterList || !selectors?.chapterContent) {
        return c.json({ error: 'novelId, sourceUrl, selectors.chapterList, and selectors.chapterContent are required' }, 400)
      }
      await deps.store.upsertScrapeConfig({ novelId, sourceUrl, selectors, encoding })
      const jobId = 'job_' + Date.now().toString(36)
      const job: JobData = { id: jobId, novelId, status: 'starting', progress: 0, current: 0, total: 0, chapterCount: 0, error: null, startedAt: Date.now(), updatedAt: Date.now() }
      await deps.store.saveJob(job)
      fireJob(jobId, deps)
      return c.json({ jobId, message: 'Scrape job started' }, 202)
    }
    case 'update': {
      const { novelId } = body
      if (!novelId) return c.json({ error: 'novelId required' }, 400)
      const cfg = await deps.store.getScrapeConfig(novelId)
      if (!cfg) return c.json({ error: '未找到该小说的爬虫配置。请先通过智能分析配置爬虫。' }, 404)
      const jobId = 'upd_' + Date.now().toString(36)
      const job: JobData = { id: jobId, novelId, updateMode: true, status: 'starting', progress: 0, current: 0, total: 0, chapterCount: 0, error: null, startedAt: Date.now(), updatedAt: Date.now() }
      await deps.store.saveJob(job)
      fireJob(jobId, deps)
      return c.json({ jobId, message: 'Update scrape started', updateMode: true }, 202)
    }
    case 'retry': {
      const { jobId } = body
      if (!jobId) return c.json({ error: 'jobId required' }, 400)
      const oldJob = await deps.store.loadJob(jobId)
      if (!oldJob) return c.json({ error: 'Job not found' }, 404)
      if (!oldJob.novelId) return c.json({ error: '该任务没有关联小说，无法重试' }, 400)
      const cfg = await deps.store.getScrapeConfig(oldJob.novelId)
      if (!cfg) return c.json({ error: '未找到该小说的爬虫配置，请重新配置' }, 404)
      const newJobId = 'job_' + Date.now().toString(36)
      const job: JobData = { id: newJobId, novelId: oldJob.novelId, status: 'starting', progress: 0, current: 0, total: 0, chapterCount: 0, error: null, startedAt: Date.now(), updatedAt: Date.now() }
      await deps.store.saveJob(job)
      fireJob(newJobId, deps)
      return c.json({ jobId: newJobId, message: 'Retry started' }, 202)
    }
    case 'retry-failed': {
      const { jobId } = body
      if (!jobId) return c.json({ error: 'jobId required' }, 400)
      const oldJob = await deps.store.loadJob(jobId)
      if (!oldJob?.novelId) return c.json({ error: '任务不存在或缺少小说信息' }, 404)
      const failedItems = await deps.store.getJobItems(jobId, { status: 'failed', limit: 500 })
      if (!failedItems.length) return c.json({ error: '没有可重试的失败章节' }, 400)
      const cfg = await deps.store.getScrapeConfig(oldJob.novelId)
      if (!cfg) return c.json({ error: '未找到该小说的爬虫配置，请重新配置' }, 404)
      const retryJobId = 'retry_' + Date.now().toString(36)
      const job: JobData = {
        id: retryJobId,
        novelId: oldJob.novelId,
        retrySourceJobId: jobId,
        retryLinks: failedItems.map((item) => ({ href: item.chapterUrl, text: item.chapterTitle, retryCount: item.retryCount })),
        status: 'starting',
        progress: 0,
        current: 0,
        total: failedItems.length,
        chapterCount: 0,
        error: null,
        startedAt: Date.now(),
        updatedAt: Date.now(),
      }
      await deps.store.saveJob(job)
      await deps.store.replaceJobItems(retryJobId, job.retryLinks!.map((l) => ({ href: l.href!, text: l.text || '' })))
      await deps.store.appendJobLog(retryJobId, 'info', '开始重试失败章节，共 ' + failedItems.length + ' 章')
      fireJob(retryJobId, deps)
      return c.json({ jobId: retryJobId, message: 'Retry failed chapters started', total: failedItems.length }, 202)
    }
    case 'cancel': {
      const { jobId } = body
      if (!jobId) return c.json({ error: 'jobId required' }, 400)
      await deps.store.cancelJob(jobId)
      return c.json({ success: true, jobId })
    }
    case 'clear-completed':
      return c.json({ success: true, deleted: await deps.store.clearCompletedJobs() })
    case 'save-check': {
      const { novelId, remoteCount } = body
      if (!novelId || typeof remoteCount !== 'number') return c.json({ error: 'novelId and numeric remoteCount are required' }, 400)
      const result = await deps.store.saveCheckResult(novelId, remoteCount)
      if (!result) return c.json({ error: 'Novel not found' }, 404)
      return c.json({ ok: true, remoteCount, ...result, checkedAt: Date.now() })
    }
    case 'proxy': {
      const { sourceUrl, encoding } = body
      if (!sourceUrl) return c.json({ error: 'sourceUrl required' }, 400)
      try {
        const { html, encoding: enc } = await deps.fetchHtml(sourceUrl, { forceEncoding: encoding })
        return c.json({ html, encoding: enc, length: html.length })
      } catch (err) {
        return c.json({ error: (err as Error).message }, 502)
      }
    }
    case 'list-configs':
      return c.json({ configs: await deps.store.listScrapeConfigs() })
    case 'import-configs': {
      const { configs } = body
      if (!Array.isArray(configs) || configs.length === 0) return c.json({ error: 'configs array is required' }, 400)
      return c.json({ success: true, imported: await deps.store.importScrapeConfigs(configs) })
    }
    case 'register': {
      const { jobId, novelId } = body
      if (!jobId || !novelId) return c.json({ error: 'jobId and novelId required' }, 400)
      await deps.store.registerLocalJob(jobId, novelId)
      return c.json({ success: true, jobId })
    }
    case 'update-status': {
      const { jobId } = body
      if (!jobId) return c.json({ error: 'jobId required' }, 400)
      const { status, step, current, total, chapterCount, progress, error } = body
      const ok = await deps.store.updateLocalJobStatus(jobId, { status, step, current, total, chapterCount, progress, error })
      if (!ok) return c.json({ error: 'Job not found' }, 404)
      return c.json({ success: true })
    }
    case 'log': {
      const { jobId, level, message, detail } = body
      if (!jobId || !message) return c.json({ error: 'jobId and message required' }, 400)
      await deps.store.appendJobLog(jobId, level || 'info', message, detail || '')
      return c.json({ success: true })
    }
    case 'item-update': {
      const { jobId, chapterUrl, patch } = body
      if (!jobId || !chapterUrl || !patch) return c.json({ error: 'jobId, chapterUrl and patch required' }, 400)
      await deps.store.updateJobItem(jobId, chapterUrl, patch)
      return c.json({ success: true })
    }
    case 'cache-cover':
      return handleCacheCover(c, body)
    case 'fix-cover':
      return handleFixCover(c, body)
    case 'import-legado':
      return handleImportLegado(c, body)
    case 'list-sources':
      return handleListSources(c, body)
    case 'toggle-source': {
      const { host, enabled } = body
      if (!host || enabled === undefined) return c.json({ error: 'host 和 enabled 必填' }, 400)
      await deps.store.toggleSource(host, !!enabled)
      return c.json({ success: true, host, enabled: !!enabled })
    }
    case 'delete-source': {
      const { host } = body
      if (!host) return c.json({ error: 'host 必填' }, 400)
      return c.json({ success: true, host, deleted: await deps.store.deleteSource(host) })
    }
    case 'batch-toggle-sources': {
      const { hosts, enabled } = body
      if (!Array.isArray(hosts) || hosts.length === 0 || enabled === undefined) return c.json({ error: 'hosts 和 enabled 必填' }, 400)
      const normalizedHosts = Array.from(new Set(hosts.map((host: unknown) => String(host || '').trim()).filter(Boolean)))
      if (!normalizedHosts.length) return c.json({ error: 'hosts 不能为空' }, 400)
      return c.json({ success: true, hosts: normalizedHosts, enabled: !!enabled, updated: await deps.store.batchToggleSources(normalizedHosts, !!enabled) })
    }
    case 'batch-delete-sources': {
      const { hosts } = body
      if (!Array.isArray(hosts) || hosts.length === 0) return c.json({ error: 'hosts 必填' }, 400)
      const normalizedHosts = Array.from(new Set(hosts.map((host: unknown) => String(host || '').trim()).filter(Boolean)))
      if (!normalizedHosts.length) return c.json({ error: 'hosts 不能为空' }, 400)
      return c.json({ success: true, hosts: normalizedHosts, deleted: await deps.store.batchDeleteSources(normalizedHosts) })
    }
    case 'check-source-connectivity': {
      const requestedHosts = Array.isArray(body.hosts) ? Array.from(new Set(body.hosts.map((host: unknown) => String(host || '').trim()).filter(Boolean))) : []
      const rows = requestedHosts.length ? (await deps.store.listAllSources()).filter((row) => requestedHosts.includes(String(row.host || ''))) : await deps.store.listAllSources()
      if (body.preview === true) return c.json({ success: true, hosts: rows.map((row) => String(row.host || '')).filter(Boolean) })
      const results: Array<{ host: string; connectivity: 'reachable' | 'unreachable'; error?: string }> = []
      let cursor = 0
      const worker = async () => {
        while (cursor < rows.length) {
          const row = rows[cursor++]!
          const host = String(row.host || '')
          try {
            if (!row.source_url) throw new Error('缺少站点 URL')
            await deps.fetchHtml(String(row.source_url), { timeoutMs: 8000 })
            await deps.store.updateSourceConnectivity(host, 'reachable')
            results.push({ host, connectivity: 'reachable' })
          } catch (err) {
            const error = (err as Error).message || '连接失败'
            await deps.store.updateSourceConnectivity(host, 'unreachable', error)
            results.push({ host, connectivity: 'unreachable', error })
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(12, Math.max(1, rows.length)) }, () => worker()))
      return c.json({ success: true, checked: results.length, reachable: results.filter((result) => result.connectivity === 'reachable').length, unreachable: results.filter((result) => result.connectivity === 'unreachable').length, results })
    }
    case 'delete-unreachable-sources': {
      const deleted = await deps.store.batchDeleteSources((await deps.store.listAllSources()).filter((row) => row.connectivity === 'unreachable').map((row) => String(row.host || '')))
      return c.json({ success: true, deleted })
    }
    case 'test-source': {
      const { host } = body
      if (!host) return c.json({ error: 'host 必填' }, 400)
      const row = await deps.store.findSourceByHost(host, true)
      const preset = sourceToPreset(row)
      if (!preset?.selectors?.chapterList || !preset?.selectors?.chapterContent) return c.json({ error: '该书源缺少 chapterList/chapterContent 规则' }, 400)
      const url = String(row?.source_url || '')
      try {
        return c.json(await testSelectors(url, preset.selectors, preset.encoding, deps))
      } catch (err) {
        return c.json({ error: `测试失败: ${(err as Error).message}` }, 502)
      }
    }
    case 'discover': {
      const { listUrl } = body
      if (!listUrl) return c.json({ error: 'listUrl required' }, 400)
      try {
        const result = await discoverList(String(listUrl), { db, fetchHtml: deps.fetchHtml, getPreset: (url) => getPresetForUrl(url, deps.store) })
        return c.json(result)
      } catch (err) {
        return c.json({ error: `获取列表失败: ${(err as Error).message}` }, 502)
      }
    }
    case 'po18-search': {
      const { query, searchType, page } = body
      if (!query) return c.json({ error: 'query required' }, 400)
      try {
        return c.json(await searchPo18(String(query), String(searchType || 'articlename'), Number(page) || 1, db))
      } catch (err) {
        return c.json({ error: `搜索失败: ${(err as Error).message}` }, 502)
      }
    }
    case 'title-source-search': {
      const { title, author } = body
      if (!title && !author) return c.json({ error: 'title or author required' }, 400)
      return c.json(await searchTitleSources(String(title || '').trim(), String(author || '').trim()))
    }
    case 'jjwxc-titles': {
      const { sourceUrl } = body
      if (!sourceUrl) return c.json({ error: 'sourceUrl required' }, 400)
      try {
        return c.json(await extractJjwxcTitles(String(sourceUrl)))
      } catch (err) {
        return c.json({ error: (err as Error).message }, 400)
      }
    }
    case 'po18tw-titles': {
      const { sourceUrl } = body
      if (!sourceUrl) return c.json({ error: 'sourceUrl required' }, 400)
      try {
        return c.json(await extractPo18twTitles(String(sourceUrl)))
      } catch (err) {
        return c.json({ error: (err as Error).message }, 502)
      }
    }
    case 'cover': {
      const { url } = body
      if (!url) return c.json({ error: 'url required' }, 400)
      try {
        const { body: buf, contentType } = await proxyCover(String(url))
        return new Response(buf, { headers: { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=86400' } })
      } catch (err) {
        return c.json({ error: (err as Error).message }, 502)
      }
    }
    default:
      return c.json({ error: `Unknown action: ${action}` }, 400)
  }
})

// ---------- 封面 ----------

async function handleCacheCover(c: Context, body: any) {
  const db = getDb()
  const { novelId } = body
  if (!novelId) return c.json({ error: 'novelId required' }, 400)
  if (body.data) {
    const buf = Buffer.from(String(body.data), 'base64')
    if (!buf.byteLength || buf.byteLength > 5 * 1024 * 1024) return c.json({ error: '封面数据为空或超过 5MB' }, 400)
    const contentType = body.contentType || 'image/jpeg'
    if (!/^image\//i.test(contentType)) return c.json({ error: '封面数据不是图片' }, 400)
    await db.query(
      `INSERT INTO novel_covers (novel_id, data, content_type, source, updated_at) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (novel_id) DO UPDATE SET data=EXCLUDED.data, content_type=EXCLUDED.content_type, source=EXCLUDED.source, updated_at=EXCLUDED.updated_at`,
      [novelId, buf, contentType, body.source || 'local', Date.now()],
    )
    return c.json({ ok: true, source: body.source || 'local', bytes: buf.byteLength })
  }
  if (body.skipExisting) {
    const existing = await getStoredCover(db, novelId)
    if (existing) return c.json({ ok: true, skipped: true, source: existing.source || '' })
  }
  const r = await cacheCoverForNovel(db, novelId)
  if (!r.ok) return c.json({ error: r.error || '封面缓存失败' }, (r.status || 502) as 502)
  return c.json({ ok: true, source: r.source, bytes: r.bytes, isDefault: r.isDefault })
}

async function handleFixCover(c: Context, body: any) {
  const db = getDb()
  const { novelId, sourceUrl } = body
  if (!novelId) return c.json({ error: 'novelId required' }, 400)
  let srcUrl = sourceUrl || (await new PgScrapeStore(db).getNovelSourceUrl(novelId))
  if (!srcUrl) return c.json({ error: '无法确定源站 URL' }, 400)
  let preset = null
  try {
    const host = new URL(srcUrl).hostname
    for (const [domain, p] of Object.entries(SITE_PRESETS)) {
      if (host.includes(domain)) {
        preset = p
        break
      }
    }
  } catch {
    /* ignore */
  }
  const coverUrl = buildCoverUrl(srcUrl, preset)
  if (!coverUrl) return c.json({ error: `${preset?.name || '该站点'} 尚未配置封面规则` }, 400)
  const row = await first<{ cover_url: string }>(db, 'SELECT cover_url FROM novels WHERE id = $1', [novelId])
  if (row && row.cover_url === coverUrl) return c.json({ coverUrl, skipped: true, fixed: false })
  let valid = false
  try {
    const check = await safeFetch(coverUrl, { method: 'HEAD', headers: { 'User-Agent': 'Mozilla/5.0' } })
    valid = check.ok
  } catch {
    /* keep false */
  }
  if (!valid) return c.json({ error: '封面不存在，源站可能已删除' }, 404)
  await db.query('UPDATE novels SET cover_url = $1, updated_at = $2 WHERE id = $3', [coverUrl, Date.now(), novelId])
  cacheCoverForNovel(db, novelId).catch((e) => console.warn('[cover] cache after fix failed:', (e as Error).message))
  return c.json({ coverUrl, fixed: true })
}

// ---------- Legado 书源 ----------

async function handleImportLegado(c: Context, body: any) {
  const db = getDb()
  const store = new PgScrapeStore(db)
  const { url, text, hostFilter } = body || {}
  let sources: unknown[] = []
  let parseErrors: Array<{ error: string; preview: string }> = []
  if (text) {
    const r = parseLegadoJsonStream(String(text))
    sources = r.sources
    parseErrors = r.errors
  } else if (url) {
    try {
      const res = await safeFetch(String(url), { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } })
      if (!res.ok) return c.json({ error: `拉取书源池失败: HTTP ${res.status}` }, 502)
      const r = parseLegadoJsonStream(await res.text())
      sources = r.sources
      parseErrors = r.errors
    } catch (e) {
      return c.json({ error: `拉取书源池失败: ${(e as Error).message}` }, 502)
    }
  } else {
    return c.json({ error: 'url 或 text 至少提供一个' }, 400)
  }

  const stats = { imported: 0, updated: 0, skipped: 0, unsupported: 0, bySupport: { full: 0, partial: 0, unsupported: 0 } }
  const seenHosts = new Set<string>()
  const rows: Array<Record<string, unknown>> = []
  const filter = hostFilter ? String(hostFilter).toLowerCase() : ''
  for (const raw of sources) {
    const n = normalizeSource(raw)
    if (!n) {
      stats.skipped++
      continue
    }
    const host = legadoHost(n.sourceUrl)
    if (!host || seenHosts.has(host)) {
      stats.skipped++
      continue
    }
    seenHosts.add(host)
    if (filter && !host.includes(filter)) {
      stats.skipped++
      continue
    }
    const row = buildSourceRow(n, host)
    rows.push(row as unknown as Record<string, unknown>)
    stats.bySupport[row.support]++
    if (row.support === 'unsupported') stats.unsupported++
  }
  const { imported, updated } = await store.importSources(rows)
  stats.imported = imported
  stats.updated = updated
  return c.json({ success: true, ...stats, parseErrors: parseErrors.slice(0, 20), parseErrorCount: parseErrors.length })
}

async function handleListSources(c: Context, body: any) {
  const db = getDb()
  const store = new PgScrapeStore(db)
  const { enabled, support, host, connectivity, detail } = body || {}
  const pageSize = Math.min(100, Math.max(1, Number(body?.pageSize) || 50))
  const requestedPage = Math.max(1, Number(body?.page) || 1)
  let rows = await store.listSources()
  if (enabled !== undefined && enabled !== '') rows = rows.filter((r) => r.enabled === (enabled ? 1 : 0))
  if (support) rows = rows.filter((r) => r.support === support)
  if (connectivity) rows = rows.filter((r) => String(r.connectivity || 'unknown') === connectivity)
  if (host) {
    const query = String(host).toLowerCase()
    rows = rows.filter((r) => String(r.host).toLowerCase().includes(query) || String(r.name).toLowerCase().includes(query))
  }
  const matchedTotal = rows.length
  const totalPages = Math.max(1, Math.ceil(matchedTotal / pageSize))
  const page = Math.min(requestedPage, totalPages)
  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize)
  const sources = pageRows.map((row) => {
    let selectors: Record<string, string> = {}
    let warnings: string[] = []
    try {
      selectors = JSON.parse(String(row.selectors || '{}'))
    } catch {
      /* ignore */
    }
    try {
      warnings = JSON.parse(String(row.warnings || '[]'))
    } catch {
      /* ignore */
    }
    const item: Record<string, unknown> = {
      host: row.host,
      name: row.name,
      sourceUrl: row.source_url,
      encoding: row.encoding,
      support: row.support,
      confidence: row.confidence,
      warnings,
      enabled: row.enabled === 1,
      connectivity: row.connectivity || 'unknown',
      connectivityError: row.connectivity_error || '',
      connectivityCheckedAt: row.connectivity_checked_at || 0,
      chapterList: selectors.chapterList || '',
      chapterContent: selectors.chapterContent || '',
      lastTestedAt: row.last_tested_at || 0,
      updatedAt: row.updated_at || 0,
    }
    if (detail) item.sourceJson = row.source_json
    return item
  })
  const counts = await store.sourceCounts()
  return c.json({ ...counts, sources, matchedTotal, page, pageSize, totalPages })
}
