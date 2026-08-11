/**
 * 爬虫引擎 —— 由 Novel-KV _scrape-engine.js 平移。
 * 签名改为 runScrapeJob(jobId, deps)，通过 deps.store/fetchHtml/log 解耦
 * DB、网络与日志，不再依赖 env / Response / context.waitUntil。
 */
import { sleep } from './utils'
import type { FetchHtmlOptions, FetchResult } from './fetch'
import { cleanHtml, cleanText, cleanTitle, extractContent, extractLinkHref, extractLinks, extractText } from './parse'
import type { JobData, ScrapeLink, ScrapeStore } from './store'
import { simplifyChapterForSource } from '../zh-convert'

export interface ScrapeDeps {
  store: ScrapeStore
  fetchHtml: (url: string, opts?: FetchHtmlOptions) => Promise<FetchResult>
  log: (job: JobData, message: string, level?: 'log' | 'warn' | 'error') => void
}

// ---------- 运行参数（可配置化；默认与自托管 Node 场景一致） ----------
export const SCRAPE_CONCURRENCY = Number(process.env.SCRAPE_CONCURRENCY || 3)
export const SCRAPE_MAX_RETRIES = Number(process.env.SCRAPE_MAX_RETRIES || 3)
export const SCRAPE_FETCH_TIMEOUT = Number(process.env.SCRAPE_FETCH_TIMEOUT || 12000)
export const SCRAPE_CHAPTER_DELAY = Number(process.env.SCRAPE_CHAPTER_DELAY || 300)
export const SCRAPE_MAX_CONSECUTIVE_FAILURES = 10
export const BATCH_SIZE = 10

function newChapterId(index: number): string {
  return 'ch_' + Date.now().toString(36) + '_' + index
}

// ============================================================
// 选择器测试
// ============================================================
export async function testSelectors(
  sourceUrl: string,
  selectors: Record<string, string>,
  forceEncoding: string | undefined,
  deps: ScrapeDeps,
): Promise<Record<string, unknown>> {
  if (!sourceUrl || !selectors?.chapterList) {
    throw new Error('sourceUrl and selectors.chapterList are required')
  }

  const _t = { t0: Date.now(), fetchList: 0, pages: 0, total: 0 }
  const { html, encoding } = await deps.fetchHtml(sourceUrl, { forceEncoding })
  _t.fetchList = Date.now() - _t.t0

  let allLinks = extractLinks(html, selectors.chapterList, sourceUrl)
  if (selectors.nextPage && allLinks.length > 0) {
    let nextUrl = extractLinkHref(html, selectors.nextPage, sourceUrl)
    const seenPages = new Set([sourceUrl])
    while (nextUrl && nextUrl !== sourceUrl && !seenPages.has(nextUrl)) {
      seenPages.add(nextUrl)
      _t.pages++
      try {
        const next = await deps.fetchHtml(nextUrl, { forceEncoding: encoding })
        const moreLinks = extractLinks(next.html, selectors.chapterList, nextUrl)
        if (moreLinks.length === 0) break
        allLinks = allLinks.concat(moreLinks)
        nextUrl = extractLinkHref(next.html, selectors.nextPage, nextUrl)
      } catch {
        break
      }
    }
  }
  _t.total = Date.now() - _t.t0

  const hrefSeen = new Set<string>()
  let duplicateCount = 0
  let emptyTitleCount = 0
  const uniqueLinks: ScrapeLink[] = []
  for (const link of allLinks) {
    if (hrefSeen.has(link.href)) {
      duplicateCount++
      continue
    }
    hrefSeen.add(link.href)
    if (!String(link.text || '').trim()) emptyTitleCount++
    uniqueLinks.push(link)
  }

  const sampleChapters: unknown[] = []
  if (selectors.chapterTitle && selectors.chapterContent) {
    for (const link of uniqueLinks.slice(0, 3)) {
      try {
        const chapter = await deps.fetchHtml(link.href, { forceEncoding: encoding, timeoutMs: 8000 })
        const title = extractText(chapter.html, selectors.chapterTitle) || link.text || ''
        const rawContent = extractContent(chapter.html, selectors.chapterContent)
        const cleanContent = cleanText(cleanHtml(rawContent || '').trim())
        sampleChapters.push({
          title,
          url: link.href,
          rawLength: rawContent ? rawContent.length : 0,
          cleanLength: cleanContent ? cleanContent.length : 0,
          ok: cleanContent.replace(/\s/g, '').length >= 20,
        })
      } catch (err) {
        sampleChapters.push({ title: link.text || '', url: link.href, error: (err as Error).message, ok: false })
      }
    }
  }

  return {
    timing: _t,
    links: uniqueLinks,
    totalLinks: uniqueLinks.length,
    encoding,
    diagnostics: {
      duplicateCount,
      emptyTitleCount,
      sampleLinks: uniqueLinks.slice(0, 20),
      htmlLength: html.length,
      nextPageCount: _t.pages,
    },
    sampleChapters,
  }
}

// ============================================================
// 抓取主流程
// ============================================================
export async function runScrapeJob(jobId: string, deps: ScrapeDeps): Promise<void> {
  const { store, log } = deps
  let job = await store.loadJob(jobId)
  if (!job) {
    try {
      await store.saveJob({
        id: jobId,
        status: 'failed',
        step: '无法加载任务数据',
        updatedAt: Date.now(),
      })
    } catch {
      /* ignore */
    }
    return
  }

  if (!job.updateMode && job.id.startsWith('upd_')) {
    job.updateMode = true
  }

  // 从 scrape_configs 补充 sourceUrl/selectors/encoding
  if (job.novelId) {
    const cfg = await store.getScrapeConfig(job.novelId)
    if (cfg) {
      job.sourceUrl = cfg.sourceUrl
      job.selectors = cfg.selectors
      job.encoding = cfg.encoding
    }
  }

  if (!job.sourceUrl) {
    log(job, '失败: 未找到源站 URL', 'warn')
    await updateStatus('failed', { step: '未找到源站 URL，请重新配置爬虫' })
    return
  }

  async function updateStatus(status: string, extra: Record<string, unknown> = {}): Promise<void> {
    Object.assign(job!, extra, { status, updatedAt: Date.now() })
    await store.saveJob(job!)
  }

  try {
    log(job, `开始${job.updateMode ? '增量更新' : '抓取'}: ${job.sourceUrl}`)
    await updateStatus('fetching_list', {
      step: '正在连接源站获取章节目录…',
      _debug: `请求: ${job.sourceUrl}\n编码预设: ${job.encoding || '自动检测'}`,
    })

    let html: string
    let encoding: string
    try {
      const result = await deps.fetchHtml(job.sourceUrl, { forceEncoding: job.encoding })
      html = result.html
      encoding = result.encoding
      job.encoding = encoding
    } catch (err) {
      log(job, `连接源站失败: ${(err as Error).message}`, 'warn')
      await updateStatus('failed', {
        step: `无法连接源站: ${(err as Error).message}`,
        _debug: `请求: ${job.sourceUrl}\n错误: ${(err as Error).message}`,
      })
      return
    }

    log(job, `目录获取成功: 编码=${encoding} 页面=${html.length}字符`)
    await updateStatus('extracting_links', {
      step: '正在解析章节链接…',
      _debug: `获取成功\n编码: ${encoding}\n页面长度: ${html.length} 字符\n选择器: "${job.selectors?.chapterList}"`,
    })

    let links: ScrapeLink[]
    let extractMs = 0
    const extractStart = Date.now()
    if (job.retryLinks && Array.isArray(job.retryLinks) && job.retryLinks.length) {
      links = job.retryLinks.map((item) => ({ href: item.href || item.chapterUrl || '', text: item.text || item.chapterTitle || '' }))
      await store.appendJobLog(jobId, 'info', '重试失败章节模式：' + links.length + ' 章')
    } else {
      links = extractLinks(html, job.selectors?.chapterList || '', job.sourceUrl)
      extractMs = Date.now() - extractStart

      if (links.length === 0) {
        log(job, `未找到章节链接: selector="${job.selectors?.chapterList}" (${extractMs}ms)`, 'warn')
        await updateStatus('failed', {
          step: '未找到任何章节链接，请检查章节列表选择器是否正确',
          hint: `选择器: "${job.selectors?.chapterList}" | 页面: ${html.length}字符 | 解析耗时: ${extractMs}ms`,
          _debug: `选择器: ${job.selectors?.chapterList}\n页面长度: ${html.length}\n解析耗时: ${extractMs}ms\n\n页面预览(前500字):\n${html.slice(0, 500)}`,
        })
        return
      }

      let pageCount = 0
      if (job.selectors?.nextPage && links.length > 0) {
        let nextUrl = extractLinkHref(html, job.selectors.nextPage, job.sourceUrl)
        const seenPages = new Set([job.sourceUrl])
        while (nextUrl && nextUrl !== job.sourceUrl && !seenPages.has(nextUrl)) {
          seenPages.add(nextUrl)
          pageCount++
          try {
            log(job, `读取目录分页 ${pageCount}: ${nextUrl}`)
            await sleep(800)
            const next = await deps.fetchHtml(nextUrl, { forceEncoding: encoding })
            const moreLinks = extractLinks(next.html, job.selectors.chapterList || '', nextUrl)
            if (moreLinks.length === 0) break
            links = links.concat(moreLinks)
            nextUrl = extractLinkHref(next.html, job.selectors.nextPage, nextUrl)
          } catch (e) {
            log(job, `目录分页 ${pageCount} 读取失败: ${(e as Error).message}`, 'warn')
            break
          }
        }
        if (pageCount) log(job, `目录分页完成: 额外读取 ${pageCount} 页`)
      }
    }

    const originalLinkCount = links.length
    const seen = new Set<string>()
    links = links.filter((l) => {
      if (seen.has(l.href)) return false
      seen.add(l.href)
      return true
    })
    const duplicateCount = originalLinkCount - links.length

    if (job.retryLinks && Array.isArray(job.retryLinks) && job.retryLinks.length) {
      await store.appendJobLog(jobId, 'info', '重试章节去重完成：' + links.length + ' 章')
    } else {
      await store.appendJobLog(jobId, 'info', '目录解析完成：发现 ' + originalLinkCount + ' 条，去重 ' + duplicateCount + ' 条')
    }

    let newLinks = links
    if (!(job.retryLinks && Array.isArray(job.retryLinks) && job.retryLinks.length) && job.updateMode && job.novelId) {
      const existing = await store.getExistingChapterKeys(job.novelId)
      newLinks = links.filter((l) => {
        if (existing.urls.has(l.href)) return false
        if (existing.titles.has(l.text.trim())) return false
        return true
      })
      job.skippedCount = links.length - newLinks.length
    }

    job.total = newLinks.length
    await store.replaceJobItems(job.id, newLinks)
    const label = job.updateMode
      ? `发现 ${links.length} 章，其中 ${newLinks.length} 章为新章节 (${extractMs}ms)`
      : `共发现 ${links.length} 章 (${extractMs}ms)`
    log(job, label)
    await updateStatus('preflight', {
      step: '抓取前检查完成，准备抓取章节…',
      total: newLinks.length,
      current: 0,
      progress: 0.01,
      skippedCount: job.skippedCount || 0,
    })
    await store.appendJobLog(jobId, 'success', label)

    await updateStatus('scraping_chapters', {
      step: label,
      total: newLinks.length,
      current: 0,
      progress: 0.01,
      skippedCount: job.skippedCount || 0,
    })

    let count = 0
    const MAX_DEBUG = 50

    function addDebug(msg: string): void {
      const line = `[${new Date().toISOString().slice(11, 19)}] ${msg}`
      const prev = job!._debug ? job!._debug.split('\n') : []
      const next = prev.length >= MAX_DEBUG ? [...prev.slice(1 - MAX_DEBUG), line] : [...prev, line]
      job!._debug = next.join('\n')
    }

    let baseOrder = 0
    if (job.updateMode && job.novelId) {
      baseOrder = await store.getMaxChapterOrder(job.novelId)
    }

    const chapterBatch: Array<{ id: string; title: string; content: string; order: number; wordCount: number; sourceUrl: string; createdAt: number }> = []

    async function flushBatch(): Promise<void> {
      if (chapterBatch.length === 0) return
      const batch = chapterBatch.splice(0)
      try {
        await store.batchInsertChapters(job!.novelId!, batch)
        addDebug(`批量保存 ${batch.length} 章`)
        log(job!, `批量保存 ${batch.length} 章，累计成功 ${count} 章`)
      } catch (err) {
        addDebug(`批量保存失败: ${(err as Error).message}`)
        log(job!, `批量保存失败: ${(err as Error).message}`, 'warn')
      }
    }

    const scrapeLinks = newLinks
    const displayTotal = scrapeLinks.length
    const isCF = !job.localMode
    const queue = scrapeLinks.map((link, i) => ({ link, i }))
    let completedCount = 0
    let cancelled = false
    let consecutiveFailures = 0

    async function chapterWorker(): Promise<void> {
      while (queue.length > 0 && !cancelled) {
        if (!isCF || (completedCount > 0 && completedCount % 10 === 0)) {
          try {
            const current = await store.loadJob(jobId)
            if (current && current.status === 'cancelled') {
              cancelled = true
              break
            }
          } catch {
            /* ignore */
          }
        }

        if (cancelled) break

        const { link, i } = queue.shift()!

        await store.updateJobItem(jobId, link.href, { status: 'running', startedAt: Date.now(), retryCount: 0 })
        addDebug(`Ch${i + 1}: 请求 ${link.href}`)

        let chHtml = ''
        let fetchEncoding = ''
        const maxAttempts = isCF ? SCRAPE_MAX_RETRIES : 1
        let lastErr: Error | null = null

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          try {
            const timeout = isCF ? SCRAPE_FETCH_TIMEOUT : 28000
            const result = await deps.fetchHtml(link.href, { forceEncoding: encoding, timeoutMs: timeout })
            chHtml = result.html
            fetchEncoding = result.encoding
            lastErr = null
            break
          } catch (ferr) {
            lastErr = ferr as Error
            if (attempt < maxAttempts - 1) {
              const backoff = Math.pow(2, attempt) * 1000
              const errMsg = (ferr as Error).message
              await store.updateJobItem(jobId, link.href, { retryCount: attempt + 1, error: errMsg })
              await store.appendJobLog(jobId, 'warn', `Ch${i + 1}: 第${attempt + 1}次失败，${backoff / 1000}s 后重试`, errMsg)
              addDebug(`Ch${i + 1}: 第${attempt + 1}次失败，${backoff / 1000}s 后重试`)
              log(job!, `Ch${i + 1} 第${attempt + 1}次失败，${backoff / 1000}s 后重试: ${errMsg}`, 'warn')
              await sleep(backoff)
            }
          }
        }

        if (lastErr) {
          await store.updateJobItem(jobId, link.href, { status: 'failed', error: lastErr.message, finishedAt: Date.now(), retryCount: maxAttempts })
          await store.appendJobLog(jobId, 'error', `Ch${i + 1}: 获取失败`, lastErr.message)
          addDebug(`Ch${i + 1}: 获取失败 (${SCRAPE_MAX_RETRIES}次重试后) - ${lastErr.message}`)
          log(job!, `Ch${i + 1} 获取失败: ${lastErr.message}`, 'warn')
          consecutiveFailures++
          if (isCF && consecutiveFailures >= SCRAPE_MAX_CONSECUTIVE_FAILURES) {
            addDebug(`连续 ${SCRAPE_MAX_CONSECUTIVE_FAILURES} 章失败，终止抓取（源站可能已限流或离线）`)
            log(job!, `连续 ${SCRAPE_MAX_CONSECUTIVE_FAILURES} 章失败，终止抓取`, 'error')
            cancelled = true
            break
          }
          completedCount++
          continue
        }
        consecutiveFailures = 0

        try {
          const title = extractText(chHtml, job!.selectors?.chapterTitle || '') || link.text || `第${i + 1}章`
          const rawContent = extractContent(chHtml, job!.selectors?.chapterContent || '')
          const contentLen = rawContent ? rawContent.trim().length : 0

          addDebug(`Ch${i + 1}: 标题="${title.slice(0, 30)}" 内容长度=${contentLen} 编码=${fetchEncoding}`)

          if (rawContent && contentLen > 50) {
            const cleanContentResult = cleanText(cleanHtml(rawContent).trim())
            if (cleanContentResult.replace(/\s/g, '').length < 20) {
              await store.updateJobItem(jobId, link.href, { status: 'skipped', chapterTitle: cleanTitle(title).trim(), error: '清洗后仅剩广告文本', finishedAt: Date.now() })
              addDebug(`Ch${i + 1}: 清洗后仅剩广告文本，跳过`)
              completedCount++
              continue
            }
            const wordCount = cleanContentResult.replace(/\s/g, '').length
            addDebug(`Ch${i + 1}: 清洗后字数=${wordCount}，加入批量队列`)

            const chapterOrder = baseOrder + i + 1
            const chapter = simplifyChapterForSource(
              {
                id: newChapterId(i),
                novelId: job!.novelId || '',
                title: cleanTitle(title).trim(),
                content: cleanContentResult,
                order: chapterOrder,
                wordCount,
                sourceUrl: link.href,
                createdAt: Date.now(),
              },
              link.href,
            ) as { id: string; title: string; content: string; order: number; wordCount: number; sourceUrl: string; createdAt: number; novelId: string }
            chapterBatch.push({ id: chapter.id, title: chapter.title, content: chapter.content, order: chapter.order, wordCount: chapter.wordCount, sourceUrl: chapter.sourceUrl, createdAt: chapter.createdAt })
            count++
            await store.updateJobItem(jobId, link.href, { status: 'saved', chapterTitle: chapter.title, wordCount, finishedAt: Date.now(), error: '' })
          } else {
            await store.updateJobItem(jobId, link.href, { status: 'failed', error: `内容太短 (${contentLen}字)`, finishedAt: Date.now() })
            addDebug(`Ch${i + 1}: 内容太短 (${contentLen}字)，跳过`)
          }
        } catch (err) {
          await store.updateJobItem(jobId, link.href, { status: 'failed', error: (err as Error).message, finishedAt: Date.now() })
          await store.appendJobLog(jobId, 'error', `Ch${i + 1}: 异常`, (err as Error).message)
          addDebug(`Ch${i + 1}: 异常 - ${(err as Error).message}`)
        }

        completedCount++

        if (chapterBatch.length >= BATCH_SIZE) {
          await flushBatch()
        }

        if (completedCount % 5 === 0 || completedCount === displayTotal) {
          job!.current = completedCount
          job!.progress = displayTotal ? completedCount / displayTotal : 1
          job!.chapterCount = count
          log(job!, `进度 ${completedCount}/${displayTotal}，成功 ${count} 章`)
          await updateStatus('scraping_chapters', {
            step: `第${completedCount}/${displayTotal}章 | 成功${count}章`,
          })
        }

        if (isCF && queue.length > 0) {
          await sleep(SCRAPE_CHAPTER_DELAY)
        }
      }
    }

    const workers = Array.from({ length: SCRAPE_CONCURRENCY }, () => chapterWorker())
    await Promise.all(workers)

    await flushBatch()

    if (cancelled) {
      log(job, `任务已终止，成功 ${count} 章`, 'warn')
      await updateStatus('cancelled', { step: '任务已终止', chapterCount: count })
      return
    }

    log(job, `抓取完成，成功 ${count} 章`)
    const summary = await store.getJobSummary(jobId)
    const finalStatus = summary.failedCount > 0 && summary.successCount > 0 ? 'partial' : summary.failedCount > 0 && summary.successCount === 0 ? 'failed' : 'completed'
    const finalStep =
      finalStatus === 'partial'
        ? `部分完成：成功 ${summary.successCount}，失败 ${summary.failedCount}，跳过 ${summary.skippedCount}`
        : finalStatus === 'failed'
          ? `抓取失败：失败 ${summary.failedCount}，跳过 ${summary.skippedCount}`
          : '抓取完成'
    await store.appendJobLog(jobId, finalStatus === 'completed' ? 'success' : finalStatus === 'partial' ? 'warn' : 'error', finalStep)
    await updateStatus(finalStatus, { progress: 1, chapterCount: count, step: finalStep })
  } catch (err) {
    log(job, `发生错误: ${(err as Error).message}`, 'error')
    await updateStatus('failed', { error: (err as Error).message, step: `发生错误: ${(err as Error).message}` })
  }
}
