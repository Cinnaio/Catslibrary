/**
 * ScrapeStore —— 爬虫数据访问层。
 * 把 engine/jobs 里散落的 DB 操作收敛到单一接口，解耦模块直写 SQL；
 * 生产用 PgScrapeStore，测试可注入 mock。
 */
import type { Db } from '../../db/pool'
import { all, first, withTx } from '../../db/query'
import { newId } from '../auth'
import { SITE_PRESETS } from './presets'
import { legadoHost, sourceToPreset } from './legado'

export interface ScrapeLink {
  href: string
  text: string
}

export interface JobData {
  id: string
  novelId?: string
  sourceUrl?: string
  selectors?: Record<string, string>
  encoding?: string
  updateMode?: boolean
  retrySourceJobId?: string
  retryLinks?: Array<{ href?: string; chapterUrl?: string; text?: string; chapterTitle?: string; retryCount?: number }>
  status: string
  step?: string
  current?: number
  total?: number
  chapterCount?: number
  publicChapterCount?: number
  protectedChapterCount?: number
  skippedCount?: number
  progress?: number
  error?: string | null
  debug?: string
  _debug?: string
  startedAt?: number
  updatedAt?: number
  localMode?: boolean
  newCount?: number
}

export interface JobSummary {
  successCount: number
  failedCount: number
  skippedCount: number
  publicChapterCount: number
  protectedChapterCount: number
  runningCount: number
  pendingCount: number
  total: number
  speed: number
  etaSeconds: number
}

export interface ScrapeConfig {
  novelId: string
  sourceUrl: string
  selectors: Record<string, string>
  encoding: string
  updatedAt: number
}

export interface ScrapeJobItem {
  id: string
  jobId: string
  novelId: string
  chapterUrl: string
  chapterTitle: string
  order: number
  status: string
  wordCount: number
  retryCount: number
  error: string
  startedAt: number
  updatedAt: number
  finishedAt: number
}

export interface ScrapeJobLog {
  id: string
  jobId: string
  level: string
  message: string
  detail: string
  createdAt: number
}

export interface ScrapeStore {
  // job 生命周期
  saveJob(job: JobData): Promise<void>
  loadJob(jobId: string): Promise<JobData | null>
  appendJobLog(jobId: string, level: string, message: string, detail?: string): Promise<void>
  replaceJobItems(jobId: string, links: ScrapeLink[]): Promise<void>
  updateJobItem(jobId: string, chapterUrl: string, patch: Record<string, unknown>): Promise<void>
  getJobItems(jobId: string, opts?: { status?: string; limit?: number }): Promise<ScrapeJobItem[]>
  getJobLogs(jobId: string, opts?: { limit?: number }): Promise<ScrapeJobLog[]>
  getJobSummary(jobId: string): Promise<JobSummary>
  listActiveJobs(): Promise<JobData[]>
  clearCompletedJobs(): Promise<number>
  cancelJob(jobId: string): Promise<void>
  /** 抓取中的进度更新（条件写入，不覆盖 cancelled）。返回 false 表示任务已被取消或不存在。 */
  updateJobProgress(jobId: string, patch: { step: string; current: number; chapterCount: number; progress: number }): Promise<boolean>
  registerLocalJob(jobId: string, novelId: string): Promise<void>
  updateLocalJobStatus(jobId: string, patch: Record<string, unknown>): Promise<boolean>
  // 配置
  upsertScrapeConfig(cfg: { novelId: string; sourceUrl: string; selectors: Record<string, string>; encoding?: string }): Promise<void>
  getScrapeConfig(novelId: string): Promise<ScrapeConfig | null>
  listScrapeConfigs(): Promise<Array<{ novelId: string; novelTitle: string; sourceUrl: string; selectors: Record<string, string>; encoding: string; updatedAt: number }>>
  importScrapeConfigs(configs: Array<{ novelId: string; sourceUrl: string; selectors?: Record<string, string>; encoding?: string }>): Promise<number>
  // 书源
  findSourceByHost(host: string, includeDisabled?: boolean): Promise<Record<string, unknown> | null>
  importSources(rows: Array<Record<string, unknown>>): Promise<{ imported: number; updated: number }>
  listSources(): Promise<Record<string, unknown>[]>
  listAllSources(): Promise<Record<string, unknown>[]>
  sourceCounts(): Promise<{ total: number; enabledCount: number; unreachableCount: number; bySupport: Record<string, number> }>
  updateSourceConnectivity(host: string, connectivity: 'reachable' | 'unreachable' | 'unknown', error?: string): Promise<void>
  toggleSource(host: string, enabled: boolean): Promise<void>
  deleteSource(host: string): Promise<number>
  batchToggleSources(hosts: string[], enabled: boolean): Promise<number>
  batchDeleteSources(hosts: string[]): Promise<number>
  // 章节/小说
  getExistingChapterKeys(novelId: string): Promise<{ urls: Set<string>; titles: Set<string> }>
  getMaxChapterOrder(novelId: string): Promise<number>
  batchInsertChapters(novelId: string, chapters: Array<{ id: string; title: string; content: string; order: number; wordCount: number; sourceUrl: string; createdAt: number }>): Promise<void>
  getNovelSourceUrl(novelId: string): Promise<string>
  saveCheckResult(novelId: string, remoteCount: number): Promise<{ localCount: number; newCount: number } | null>
}

// ---------- 行映射 ----------

function jobToRow(job: JobData): Record<string, unknown> {
  return {
    id: job.id,
    novel_id: job.novelId || null,
    status: job.status,
    step: job.step || '',
    current: job.current || 0,
    total: job.total || 0,
    chapter_count: job.chapterCount || 0,
    public_chapter_count: job.publicChapterCount || 0,
    protected_chapter_count: job.protectedChapterCount || 0,
    progress: job.progress || 0,
    error: job.error || null,
    debug: job._debug || job.debug || '',
    started_at: job.startedAt,
    updated_at: job.updatedAt || Date.now(),
    local_mode: job.localMode ? 1 : 0,
    update_mode: job.updateMode ? 1 : 0,
    retry_source_job_id: job.retrySourceJobId || '',
    retry_links: JSON.stringify(Array.isArray(job.retryLinks) ? job.retryLinks : []),
  }
}

function rowToJob(row: Record<string, unknown>): JobData {
  return {
    id: String(row.id),
    novelId: row.novel_id ? String(row.novel_id) : undefined,
    status: String(row.status),
    step: String(row.step || ''),
    current: Number(row.current) || 0,
    total: Number(row.total) || 0,
    chapterCount: Number(row.chapter_count) || 0,
    publicChapterCount: Number(row.public_chapter_count) || 0,
    protectedChapterCount: Number(row.protected_chapter_count) || 0,
    progress: Number(row.progress) || 0,
    error: row.error ? String(row.error) : null,
    debug: String(row.debug || ''),
    startedAt: Number(row.started_at),
    updatedAt: Number(row.updated_at),
    localMode: row.local_mode === 1,
    updateMode: row.update_mode === 1,
    retrySourceJobId: String(row.retry_source_job_id || ''),
    retryLinks: safeJsonParse(String(row.retry_links || '[]'), []),
  }
}

function rowToScrapeJobItem(row: Record<string, unknown>): ScrapeJobItem {
  return {
    id: String(row.id),
    jobId: String(row.job_id),
    novelId: String(row.novel_id || ''),
    chapterUrl: String(row.chapter_url || ''),
    chapterTitle: String(row.chapter_title || ''),
    order: Number(row.sort_order) || 0,
    status: String(row.status || 'pending'),
    wordCount: Number(row.word_count) || 0,
    retryCount: Number(row.retry_count) || 0,
    error: String(row.error || ''),
    startedAt: Number(row.started_at) || 0,
    updatedAt: Number(row.updated_at) || 0,
    finishedAt: Number(row.finished_at) || 0,
  }
}

function rowToScrapeJobLog(row: Record<string, unknown>): ScrapeJobLog {
  return {
    id: String(row.id),
    jobId: String(row.job_id),
    level: String(row.level || 'info'),
    message: String(row.message || ''),
    detail: String(row.detail || ''),
    createdAt: Number(row.created_at) || 0,
  }
}

function safeJsonParse<T>(str: string, fallback: T): T {
  try {
    return JSON.parse(str) as T
  } catch {
    return fallback
  }
}

function summarizeItems(counts: Record<string, number>, startedAt?: number, publicChapterCount = 0, protectedChapterCount = 0): JobSummary {
  const summary: JobSummary = {
    successCount: 0,
    failedCount: 0,
    skippedCount: 0,
    publicChapterCount,
    protectedChapterCount,
    runningCount: 0,
    pendingCount: 0,
    total: 0,
    speed: 0,
    etaSeconds: 0,
  }
  summary.successCount = counts.saved || 0
  summary.failedCount = counts.failed || 0
  summary.skippedCount = counts.skipped || 0
  summary.runningCount = counts.running || 0
  summary.pendingCount = counts.pending || 0
  summary.total = summary.successCount + summary.failedCount + summary.skippedCount + summary.runningCount + summary.pendingCount
  if (startedAt) {
    const done = summary.successCount + summary.failedCount + summary.skippedCount
    const elapsedMin = Math.max((Date.now() - startedAt) / 60000, 0.016)
    summary.speed = done > 0 ? Math.round((done / elapsedMin) * 10) / 10 : 0
    const remain = Math.max(0, summary.total - done)
    summary.etaSeconds = summary.speed > 0 ? Math.round((remain / summary.speed) * 60) : 0
  }
  return summary
}

export const JOB_MAX_AGE = 7 * 86400000

export class PgScrapeStore implements ScrapeStore {
  constructor(private db: Db) {}

  async saveJob(job: JobData): Promise<void> {
    const row = jobToRow(job)
    await this.db.query(
      `INSERT INTO scrape_jobs (id, novel_id, status, step, current, total, chapter_count, public_chapter_count, protected_chapter_count, progress, error, debug, started_at, updated_at, local_mode, update_mode, retry_source_job_id, retry_links)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
       ON CONFLICT (id) DO UPDATE SET
         novel_id = EXCLUDED.novel_id, status = EXCLUDED.status, step = EXCLUDED.step,
         current = EXCLUDED.current, total = EXCLUDED.total, chapter_count = EXCLUDED.chapter_count,
         public_chapter_count = EXCLUDED.public_chapter_count, protected_chapter_count = EXCLUDED.protected_chapter_count,
         progress = EXCLUDED.progress, error = EXCLUDED.error, debug = EXCLUDED.debug,
         started_at = EXCLUDED.started_at, updated_at = EXCLUDED.updated_at,
         local_mode = EXCLUDED.local_mode, update_mode = EXCLUDED.update_mode,
         retry_source_job_id = EXCLUDED.retry_source_job_id, retry_links = EXCLUDED.retry_links`,
      [
        row.id,
        row.novel_id,
        row.status,
        row.step,
        row.current,
        row.total,
        row.chapter_count,
        row.public_chapter_count,
        row.protected_chapter_count,
        row.progress,
        row.error,
        row.debug,
        row.started_at,
        row.updated_at,
        row.local_mode,
        row.update_mode,
        row.retry_source_job_id,
        row.retry_links,
      ],
    )
  }

  async loadJob(jobId: string): Promise<JobData | null> {
    const row = await first<Record<string, unknown>>(this.db, 'SELECT * FROM scrape_jobs WHERE id = $1', [jobId])
    return row ? rowToJob(row) : null
  }

  async appendJobLog(jobId: string, level: string, message: string, detail = ''): Promise<void> {
    if (!jobId || !message) return
    const now = Date.now()
    const normalizedLevel = ['info', 'success', 'warn', 'error'].includes(level) ? level : 'info'
    const safeMessage = String(message || '').slice(0, 800)
    const safeDetail = typeof detail === 'string' ? detail.slice(0, 4000) : JSON.stringify(detail || {}).slice(0, 4000)
    try {
      await this.db.query(
        'INSERT INTO scrape_job_logs (id, job_id, level, message, detail, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
        [newId('log'), jobId, normalizedLevel, safeMessage, safeDetail, now],
      )
      const row = await first<{ debug: string }>(this.db, 'SELECT debug FROM scrape_jobs WHERE id = $1', [jobId])
      const line = '[' + new Date(now).toISOString().slice(11, 19) + '] ' + safeMessage
      const prev = row && row.debug ? String(row.debug).split('\n') : []
      const next = prev.concat(line).slice(-80).join('\n')
      await this.db.query('UPDATE scrape_jobs SET debug = $1, updated_at = $2 WHERE id = $3', [next, now, jobId])
    } catch {
      /* 日志失败不应中断抓取 */
    }
  }

  async replaceJobItems(jobId: string, links: ScrapeLink[]): Promise<void> {
    if (!jobId || !Array.isArray(links)) return
    const now = Date.now()
    await withTx(this.db, async (q) => {
      await q('DELETE FROM scrape_job_items WHERE job_id = $1', [jobId])
      for (let i = 0; i < links.length; i++) {
        const link = links[i]!
        await q(
          `INSERT INTO scrape_job_items (id, job_id, novel_id, chapter_url, chapter_title, sort_order, status, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)`,
          [newId('item'), jobId, '', link.href || '', link.text || '', i + 1, now],
        )
      }
    })
  }

  async updateJobItem(jobId: string, chapterUrl: string, patch: Record<string, unknown>): Promise<void> {
    if (!jobId || !chapterUrl) return
    const allowed: Record<string, string> = {
      chapterTitle: 'chapter_title',
      status: 'status',
      wordCount: 'word_count',
      retryCount: 'retry_count',
      error: 'error',
      startedAt: 'started_at',
      updatedAt: 'updated_at',
      finishedAt: 'finished_at',
    }
    const parts: string[] = []
    const values: unknown[] = []
    for (const key of Object.keys(allowed)) {
      if (patch[key] !== undefined) {
        parts.push(allowed[key] + ' = $' + (parts.length + 1))
        values.push(patch[key])
      }
    }
    parts.push('updated_at = $' + (parts.length + 1))
    values.push(Date.now(), jobId, chapterUrl)
    await this.db.query(`UPDATE scrape_job_items SET ${parts.join(', ')} WHERE job_id = $${values.length - 1} AND chapter_url = $${values.length}`, values)
  }

  async getJobItems(jobId: string, opts: { status?: string; limit?: number } = {}): Promise<ScrapeJobItem[]> {
    if (!jobId) return []
    const limit = Math.min(opts.limit || 80, 300)
    let where = 'WHERE job_id = $1'
    const params: unknown[] = [jobId]
    if (opts.status) {
      where += ' AND status = $2'
      params.push(opts.status)
    }
    const rows = await all<Record<string, unknown>>(
      this.db,
      `SELECT * FROM scrape_job_items ${where} ORDER BY sort_order ASC LIMIT $${params.length + 1}`,
      [...params, limit],
    )
    return rows.map(rowToScrapeJobItem)
  }

  async getJobLogs(jobId: string, opts: { limit?: number } = {}): Promise<ScrapeJobLog[]> {
    if (!jobId) return []
    const limit = Math.min(opts.limit || 80, 300)
    const rows = await all<Record<string, unknown>>(
      this.db,
      'SELECT * FROM scrape_job_logs WHERE job_id = $1 ORDER BY created_at DESC LIMIT $2',
      [jobId, limit],
    )
    return rows.map(rowToScrapeJobLog).reverse()
  }

  async getJobSummary(jobId: string): Promise<JobSummary> {
    if (!jobId) return summarizeItems({}, 0)
    const rows = await all<{ status: string; count: number }>(
      this.db,
      'SELECT status, COUNT(*)::int AS count FROM scrape_job_items WHERE job_id = $1 GROUP BY status',
      [jobId],
    )
    const counts: Record<string, number> = {}
    for (const row of rows) counts[row.status] = Number(row.count || 0)
    const job = await this.loadJob(jobId)
    return summarizeItems(counts, job?.startedAt, job?.publicChapterCount, job?.protectedChapterCount)
  }

  async listActiveJobs(): Promise<JobData[]> {
    const cutoff = Date.now() - JOB_MAX_AGE
    await this.db.query('DELETE FROM scrape_jobs WHERE started_at < $1', [cutoff])
    const recentCutoff = Date.now() - 3600000
    const rows = await all<Record<string, unknown>>(
      this.db,
      `SELECT * FROM scrape_jobs
       WHERE status IN ('starting','fetching_list','extracting_links','preflight','scraping_chapters','saving')
          OR started_at > $1
       ORDER BY
         CASE WHEN status IN ('starting','fetching_list','extracting_links','preflight','scraping_chapters','saving') THEN 0 ELSE 1 END,
         started_at DESC
       LIMIT 50`,
      [recentCutoff],
    )
    return rows.map(rowToJob)
  }

  async clearCompletedJobs(): Promise<number> {
    const res = await this.db.query("DELETE FROM scrape_jobs WHERE status IN ('completed', 'partial', 'cancelled')")
    return res.rowCount ?? 0
  }

  async cancelJob(jobId: string): Promise<void> {
    // 已结束的任务不再改写为 cancelled（避免误伤 completed/partial 的最终状态）
    await this.db.query(
      "UPDATE scrape_jobs SET status='cancelled', step='任务已终止', updated_at=$1 WHERE id=$2 AND status NOT IN ('completed','partial','failed')",
      [Date.now(), jobId],
    )
  }

  async updateJobProgress(jobId: string, patch: { step: string; current: number; chapterCount: number; progress: number }): Promise<boolean> {
    // 只更新进度字段且排除 cancelled：saveJob 是整行 upsert，抓取中用它写进度
    // 会把外部 cancelJob 写入的取消标记冲掉，导致取消丢失、任务继续跑完
    const res = await this.db.query(
      `UPDATE scrape_jobs
       SET status='scraping_chapters', step=$1, current=$2, chapter_count=$3, progress=$4, updated_at=$5
       WHERE id=$6 AND status <> 'cancelled'`,
      [patch.step, patch.current, patch.chapterCount, patch.progress, Date.now(), jobId],
    )
    return (res.rowCount ?? 0) > 0
  }

  async registerLocalJob(jobId: string, novelId: string): Promise<void> {
    const now = Date.now()
    await this.db.query(
      "INSERT INTO scrape_jobs (id, novel_id, status, step, current, total, chapter_count, progress, started_at, updated_at, local_mode) VALUES ($1, $2, 'starting', '', 0, 0, 0, 0, $3, $4, 1)",
      [jobId, novelId, now, now],
    )
  }

  async updateLocalJobStatus(jobId: string, patch: Record<string, unknown>): Promise<boolean> {
    const allowed: Record<string, string> = {
      status: 'status',
      step: 'step',
      current: 'current',
      total: 'total',
      chapterCount: 'chapter_count',
      publicChapterCount: 'public_chapter_count',
      protectedChapterCount: 'protected_chapter_count',
      progress: 'progress',
      error: 'error',
    }
    const parts: string[] = []
    const vals: unknown[] = []
    for (const key of Object.keys(allowed)) {
      if (patch[key] !== undefined) {
        parts.push(allowed[key] + '=$' + (parts.length + 1))
        vals.push(patch[key])
      }
    }
    if (!parts.length) return false
    parts.push('updated_at=$' + (parts.length + 1))
    vals.push(Date.now(), jobId)
    const { rowCount } = await this.db.query(`UPDATE scrape_jobs SET ${parts.join(', ')} WHERE id=$${vals.length}`, vals)
    return (rowCount ?? 0) > 0
  }

  async upsertScrapeConfig(cfg: { novelId: string; sourceUrl: string; selectors: Record<string, string>; encoding?: string }): Promise<void> {
    await this.db.query(
      `INSERT INTO scrape_configs (novel_id, source_url, selectors, encoding, updated_at) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (novel_id) DO UPDATE SET source_url = EXCLUDED.source_url, selectors = EXCLUDED.selectors, encoding = EXCLUDED.encoding, updated_at = EXCLUDED.updated_at`,
      [cfg.novelId, cfg.sourceUrl, JSON.stringify(cfg.selectors || {}), cfg.encoding || 'utf-8', Date.now()],
    )
  }

  async getScrapeConfig(novelId: string): Promise<ScrapeConfig | null> {
    const row = await first<Record<string, unknown>>(this.db, 'SELECT * FROM scrape_configs WHERE novel_id = $1', [novelId])
    if (!row) return null
    return {
      novelId: String(row.novel_id),
      sourceUrl: String(row.source_url),
      selectors: safeJsonParse(String(row.selectors || '{}'), {}),
      encoding: String(row.encoding || 'utf-8'),
      updatedAt: Number(row.updated_at),
    }
  }

  async listScrapeConfigs(): Promise<Array<{ novelId: string; novelTitle: string; sourceUrl: string; selectors: Record<string, string>; encoding: string; updatedAt: number }>> {
    const rows = await all<Record<string, unknown>>(
      this.db,
      'SELECT sc.*, n.title as novel_title FROM scrape_configs sc LEFT JOIN novels n ON sc.novel_id = n.id ORDER BY sc.updated_at DESC',
    )
    return rows.map((row) => ({
      novelId: String(row.novel_id),
      novelTitle: String(row.novel_title || ''),
      sourceUrl: String(row.source_url),
      selectors: safeJsonParse(String(row.selectors || '{}'), {}),
      encoding: String(row.encoding || 'utf-8'),
      updatedAt: Number(row.updated_at),
    }))
  }

  async importScrapeConfigs(configs: Array<{ novelId: string; sourceUrl: string; selectors?: Record<string, string>; encoding?: string }>): Promise<number> {
    let imported = 0
    for (const cfg of configs) {
      if (!cfg.novelId || !cfg.sourceUrl) continue
      try {
        await this.upsertScrapeConfig({ novelId: cfg.novelId, sourceUrl: cfg.sourceUrl, selectors: cfg.selectors || {}, encoding: cfg.encoding })
        imported++
      } catch {
        /* skip invalid */
      }
    }
    return imported
  }

  async findSourceByHost(host: string, includeDisabled = false): Promise<Record<string, unknown> | null> {
    if (!host) return null
    const sql = includeDisabled
      ? 'SELECT * FROM scrape_sources WHERE host = $1'
      : 'SELECT * FROM scrape_sources WHERE host = $1 AND enabled = 1'
    return (await first<Record<string, unknown>>(this.db, sql, [host])) || null
  }

  async importSources(rows: Array<Record<string, unknown>>): Promise<{ imported: number; updated: number }> {
    let imported = 0
    let updated = 0
    for (const row of rows) {
      const host = String(row.host || '')
      if (!host) continue
      const existing = await first<{ host: string }>(this.db, 'SELECT host FROM scrape_sources WHERE host = $1', [host])
      if (existing) updated++
      else imported++
      await this.db.query(
        `INSERT INTO scrape_sources (host, name, source_url, selectors, meta_selectors, source_json, encoding, encoding_hint, support, confidence, warnings, enabled, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (host) DO UPDATE SET
           name = EXCLUDED.name, source_url = EXCLUDED.source_url, selectors = EXCLUDED.selectors,
           meta_selectors = EXCLUDED.meta_selectors, source_json = EXCLUDED.source_json,
           encoding = EXCLUDED.encoding, encoding_hint = EXCLUDED.encoding_hint,
           support = EXCLUDED.support, confidence = EXCLUDED.confidence, warnings = EXCLUDED.warnings,
           enabled = EXCLUDED.enabled, updated_at = EXCLUDED.updated_at`,
        [host, row.name || host, row.sourceUrl || '', JSON.stringify(row.selectors || {}), JSON.stringify(row.metaSelectors || {}), JSON.stringify(row.sourceJson || {}), row.encoding || 'utf-8', Number(row.encodingHint) || 0, row.support || 'partial', Number(row.confidence) || 0, JSON.stringify(row.warnings || []), row.enabled ? 1 : 0, Date.now(), Date.now()],
      )
    }
    return { imported, updated }
  }

  async listSources(): Promise<Record<string, unknown>[]> {
    return all<Record<string, unknown>>(
      this.db,
      `SELECT * FROM scrape_sources ORDER BY (support = 'unsupported') ASC, confidence DESC, updated_at DESC LIMIT 500`,
    )
  }

  async listAllSources(): Promise<Record<string, unknown>[]> {
    return all<Record<string, unknown>>(this.db, 'SELECT * FROM scrape_sources ORDER BY updated_at DESC')
  }

  async sourceCounts(): Promise<{ total: number; enabledCount: number; unreachableCount: number; bySupport: Record<string, number> }> {
    const totalRow = await first<{ c: number }>(this.db, 'SELECT COUNT(*)::int AS c FROM scrape_sources')
    const enabledRow = await first<{ c: number }>(this.db, 'SELECT COUNT(*)::int AS c FROM scrape_sources WHERE enabled = 1')
    const unreachableRow = await first<{ c: number }>(this.db, "SELECT COUNT(*)::int AS c FROM scrape_sources WHERE connectivity = 'unreachable'")
    const bySupport: Record<string, number> = { full: 0, partial: 0, unsupported: 0 }
    const rows = await all<{ support: string; c: number }>(this.db, 'SELECT support, COUNT(*)::int AS c FROM scrape_sources GROUP BY support')
    for (const r of rows) bySupport[r.support] = Number(r.c || 0)
    return { total: totalRow?.c || 0, enabledCount: enabledRow?.c || 0, unreachableCount: unreachableRow?.c || 0, bySupport }
  }

  async updateSourceConnectivity(host: string, connectivity: 'reachable' | 'unreachable' | 'unknown', error = ''): Promise<void> {
    await this.db.query('UPDATE scrape_sources SET connectivity = $1, connectivity_checked_at = $2, connectivity_error = $3, updated_at = $2 WHERE host = $4', [connectivity, Date.now(), error.slice(0, 500), host])
  }

  async toggleSource(host: string, enabled: boolean): Promise<void> {
    await this.db.query('UPDATE scrape_sources SET enabled = $1, updated_at = $2 WHERE host = $3', [enabled ? 1 : 0, Date.now(), host])
  }

  async deleteSource(host: string): Promise<number> {
    const { rowCount } = await this.db.query('DELETE FROM scrape_sources WHERE host = $1', [host])
    return rowCount ?? 0
  }

  async batchToggleSources(hosts: string[], enabled: boolean): Promise<number> {
    const uniqueHosts = Array.from(new Set(hosts.map((host) => String(host || '').trim()).filter(Boolean)))
    if (!uniqueHosts.length) return 0
    const { rowCount } = await this.db.query('UPDATE scrape_sources SET enabled = $1, updated_at = $2 WHERE host = ANY($3)', [enabled ? 1 : 0, Date.now(), uniqueHosts])
    return rowCount ?? 0
  }

  async batchDeleteSources(hosts: string[]): Promise<number> {
    const uniqueHosts = Array.from(new Set(hosts.map((host) => String(host || '').trim()).filter(Boolean)))
    if (!uniqueHosts.length) return 0
    const { rowCount } = await this.db.query('DELETE FROM scrape_sources WHERE host = ANY($1)', [uniqueHosts])
    return rowCount ?? 0
  }

  async getExistingChapterKeys(novelId: string): Promise<{ urls: Set<string>; titles: Set<string> }> {
    const urls = new Set<string>()
    const titles = new Set<string>()
    const rows = await all<{ source_url: string; title: string }>(this.db, 'SELECT source_url, title FROM chapters WHERE novel_id = $1', [novelId])
    for (const row of rows) {
      if (row.source_url) urls.add(row.source_url)
      else titles.add(row.title.trim())
    }
    return { urls, titles }
  }

  async getMaxChapterOrder(novelId: string): Promise<number> {
    // 别名保持全小写：PostgreSQL 会把未加引号的 maxOrder 折叠为 maxorder，驼峰读取恒为 undefined
    const row = await first<{ max_order: number }>(this.db, 'SELECT COALESCE(MAX(sort_order), 0) AS max_order FROM chapters WHERE novel_id = $1', [novelId])
    return Number(row?.max_order) || 0
  }

  async batchInsertChapters(novelId: string, chapters: Array<{ id: string; title: string; content: string; order: number; wordCount: number; sourceUrl: string; createdAt: number }>): Promise<void> {
    if (!chapters.length) return
    await withTx(this.db, async (q) => {
      for (const ch of chapters) {
        await q(
          `INSERT INTO chapters (id, novel_id, title, content, sort_order, word_count, source_url, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [ch.id, novelId, ch.title, ch.content, ch.order, ch.wordCount, ch.sourceUrl || '', ch.createdAt],
        )
      }
      await q(
        'UPDATE novels SET chapter_count = (SELECT COUNT(*) FROM chapters WHERE novel_id = $1), updated_at = $2 WHERE id = $1',
        [novelId, Date.now()],
      )
    })
  }

  async getNovelSourceUrl(novelId: string): Promise<string> {
    const row = await first<{ source_url: string }>(this.db, 'SELECT source_url FROM novels WHERE id = $1', [novelId])
    return row?.source_url || ''
  }

  async saveCheckResult(novelId: string, remoteCount: number): Promise<{ localCount: number; newCount: number } | null> {
    const { rowCount } = await this.db.query('UPDATE novels SET remote_chapter_count = $1, update_checked_at = $2 WHERE id = $3', [remoteCount, Date.now(), novelId])
    if (!rowCount) return null
    const row = await first<{ chapter_count: number }>(this.db, 'SELECT chapter_count FROM novels WHERE id = $1', [novelId])
    const localCount = row?.chapter_count || 0
    return { localCount, newCount: Math.max(0, remoteCount - localCount) }
  }
}

/** 运行时统一入口：先 SITE_PRESETS 子串匹配，未命中再查 scrape_sources（含 m./www. 前缀兜底）。 */
export async function getPresetForUrl(sourceUrl: string, store: ScrapeStore | null): Promise<Record<string, unknown> | null> {
  if (!sourceUrl) return null
  try {
    const host = new URL(sourceUrl).hostname
    for (const [domain, p] of Object.entries(SITE_PRESETS)) {
      if (host.includes(domain)) return { ...p, source: 'preset' }
    }
  } catch {
    /* ignore */
  }
  if (!store) return null
  const host = legadoHost(sourceUrl)
  if (!host) return null
  const row = await store.findSourceByHost(host)
  if (row) {
    const preset = sourceToPreset(row)
    if (preset) return { ...preset, source: 'legado' }
  }
  const alternates = [host.replace(/^m\./, ''), 'm.' + host.replace(/^www\./, ''), host.replace(/^www\./, '')]
  for (const alt of alternates) {
    if (!alt || alt === host) continue
    const altRow = await store.findSourceByHost(alt)
    if (altRow) {
      const preset = sourceToPreset(altRow)
      if (preset) return { ...preset, source: 'legado' }
    }
  }
  return null
}
