import { Hono } from 'hono'
import type { BookImportDiagnostics, BookImportHistoryItem, BookImportPayload, BookImportPreview } from '@shared/types'
import { getDb } from '../db/pool'
import { all, first } from '../db/query'
import { requireAdmin, type AuthEnv } from '../middlewares/auth'
import { fetchHtml as fetchHtmlImpl, type FetchHtmlOptions } from '../services/scraper/fetch'
import { PgScrapeStore } from '../services/scraper/store'
import { getPo18Session } from '../services/source-account'
import {
  applyImport,
  createPreview,
  parseBookUrl,
  parseTextImportDetailed,
  parseUploadedBookDetailed,
  rollbackImport,
  type StoredImportRun,
} from '../services/book-import'
import { reviewImportHeadings } from '../services/ai/import-assist'
import { AiError } from '../services/ai/client'
import { getAiSettings } from '../services/ai/settings'
import { clientIpFromContext } from '../services/ai/audit-context'
import { idempotencyKeyFromRequest, withIdempotency } from '../services/idempotency'

export const bookImportRoutes = new Hono<AuthEnv>()

bookImportRoutes.use('*', requireAdmin())

interface BookImportRunRow extends StoredImportRun {
  actor_user_id: string
}

function safeJsonParse<T>(value: unknown, fallback: T): T {
  try {
    return JSON.parse(String(value || '')) as T
  } catch {
    return fallback
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? Array.from(new Set(value.map((item) => String(item || '').trim()).filter(Boolean))) : []
}

function isPo18twUrl(sourceUrl: string): boolean {
  try {
    const hostname = new URL(sourceUrl).hostname.toLowerCase()
    return hostname === 'po18.tw' || hostname.endsWith('.po18.tw')
  } catch {
    return false
  }
}

function withPo18Session(db: ReturnType<typeof getDb>, baseFetchHtml: typeof fetchHtmlImpl) {
  return async (url: string, opts: FetchHtmlOptions = {}) => {
    if (!isPo18twUrl(url)) return baseFetchHtml(url, opts)
    const session = await getPo18Session(db)
    const headers = new Headers(opts.headers)
    const cookie = [headers.get('Cookie'), 'po18Limit=1', session.cookie].filter(Boolean).join('; ')
    if (cookie) headers.set('Cookie', cookie)
    return baseFetchHtml(url, { ...opts, headers, scope: opts.scope || 'source-auth', allowedRedirectHosts: ['po18.tw'] })
  }
}

async function loadRun(db: ReturnType<typeof getDb>, runId: string, actorUserId: string): Promise<BookImportRunRow | null> {
  return (await first<BookImportRunRow>(db, 'SELECT * FROM book_import_runs WHERE id = $1 AND actor_user_id = $2', [runId, actorUserId])) || null
}

function runPayload(run: StoredImportRun): BookImportPayload {
  const payload = safeJsonParse<BookImportPayload>(run.payload_json, {
    title: '',
    author: '',
    chapters: [],
  })
  return payload
}

function previewPayload(run: StoredImportRun): BookImportPreview {
  return safeJsonParse<BookImportPreview>(run.preview_json, {
    runId: run.id,
    sourceType: run.source_type,
    sourceLabel: run.source_label,
    sourceUrl: run.source_url,
    book: runPayload(run),
    candidates: [],
    targetNovelId: run.target_novel_id || null,
    targetNovel: null,
    metadataDiff: [],
    chapters: [],
    summary: { newCount: 0, changedCount: 0, unchangedCount: 0, conflictCount: 0 },
    warnings: [],
  })
}

function errorStatus(message: string): 400 | 409 | 502 | 500 {
  if (/不存在|已被|重新预览|预览|目标|冲突|正在处理中|已应用|已撤回/i.test(message)) return 409
  if (/HTTP|请求超时|读取失败|登录页|源站|抓取|目录|正文/i.test(message)) return 502
  if (/文件|格式|URL|章节|书名|必须|支持|请选择/i.test(message)) return 400
  return 500
}

/** 预览：文件在这里解析，URL 在这里抓取，之后所有流程只读数据库中的统一快照。 */
bookImportRoutes.post('/preview', async (c) => {
  const db = getDb()
  try {
    const contentType = c.req.header('content-type') || ''
    let sourceType: 'file' | 'url'
    let sourceLabel = ''
    let sourceUrl = ''
    let targetNovelId: string | null = null
    let payload: BookImportPayload
    let warnings: string[] = []
    let diagnostics: BookImportDiagnostics | undefined
    /**
     * 原文快照：诊断复盘（「这一行为什么被当成标题」）与 AI 边界复核后的重切
     * 都依赖原始行序，而 payload 只保留切分结果。仅 TXT 有行序概念。
     */
    let sourceText = ''

    if (contentType.includes('multipart/form-data')) {
      const form = await c.req.formData()
      const file = form.get('file')
      if (!file || typeof (file as File).arrayBuffer !== 'function') return c.json({ error: '请选择 TXT、JSON 或 EPUB 文件' }, 400)
      const fileName = String((file as File).name || '导入文件.txt')
      const data = new Uint8Array(await (file as File).arrayBuffer())
      const detail = await parseUploadedBookDetailed(fileName, data)
      payload = detail.payload
      diagnostics = detail.diagnostics
      if (detail.diagnostics.stats.parser === 'text') sourceText = new TextDecoder('utf-8').decode(data)
      sourceType = 'file'
      sourceLabel = fileName
      sourceUrl = String(form.get('sourceUrl') || payload.sourceUrl || '').trim()
    } else {
      const body = await c.req.json<Record<string, unknown>>()
      sourceType = 'url'
      sourceUrl = String(body.sourceUrl || body.url || '').trim()
      sourceLabel = String(body.sourceLabel || sourceUrl).trim()
      targetNovelId = body.targetNovelId ? String(body.targetNovelId).trim() : null
      if (!sourceUrl) return c.json({ error: 'sourceUrl 必填' }, 400)
      const store = new PgScrapeStore(db)
      const result = await parseBookUrl(sourceUrl, { store, fetchHtml: withPo18Session(db, fetchHtmlImpl) })
      payload = result.payload
      warnings = result.warnings
      diagnostics = result.diagnostics
    }

    const preview = await createPreview(db, {
      sourceType,
      sourceLabel,
      sourceUrl,
      payload,
      targetNovelId,
      diagnostics,
    })
    preview.warnings = Array.from(new Set([...warnings, ...preview.warnings]))
    const now = Date.now()
    await db.query(
      `INSERT INTO book_import_runs
        (id, actor_user_id, source_type, source_label, source_url, target_novel_id, status, payload_json, preview_json, changes_json, source_text, created_at, applied_at, rolled_back_at)
       VALUES ($1,$2,$3,$4,$5,$6,'preview',$7,$8,'[]',$9,$10,0,0)`,
      [
        preview.runId,
        c.get('user').id,
        sourceType,
        preview.sourceLabel,
        preview.sourceUrl,
        preview.targetNovelId || '',
        JSON.stringify(payload),
        JSON.stringify(preview),
        sourceText,
        now,
      ],
    )
    return c.json(preview, 200, { 'Cache-Control': 'no-store' })
  } catch (err) {
    const message = (err as Error).message || '书籍导入预览失败'
    return c.json({ error: message }, errorStatus(message) as 400 | 409 | 502 | 500)
  }
})

/** 多个同名作品时，用户在预览页选择导入目标。 */
bookImportRoutes.post('/:runId/target', async (c) => {
  const db = getDb()
  const runId = String(c.req.param('runId') || '').trim()
  const run = await loadRun(db, runId, c.get('user').id)
  if (!run) return c.json({ error: '导入预览不存在' }, 404)
  if (run.status !== 'preview') return c.json({ error: '这次导入已经提交，不能重新选择目标' }, 409)
  try {
    const body = await c.req.json<Record<string, unknown>>()
    const targetNovelId = body.targetNovelId ? String(body.targetNovelId).trim() : null
    // 重建预览时必须带上既有诊断与复核结果：切换目标只改变比对基准，
    // 不改变原文的行级判定。丢掉它们会让诊断面板与复核入口在选完目标后消失。
    const previous = previewPayload(run)
    const preview = await createPreview(db, {
      sourceType: run.source_type,
      sourceLabel: run.source_label,
      sourceUrl: run.source_url,
      payload: runPayload(run),
      targetNovelId,
      runId,
      diagnostics: previous.diagnostics,
    })
    const next = { ...preview, aiReview: previous.aiReview || null }
    await db.query('UPDATE book_import_runs SET target_novel_id=$1, preview_json=$2 WHERE id=$3', [next.targetNovelId || '', JSON.stringify(next), runId])
    return c.json(next, 200, { 'Cache-Control': 'no-store' })
  } catch (err) {
    const message = (err as Error).message || '导入目标更新失败'
    return c.json({ error: message }, errorStatus(message) as 400 | 409 | 502 | 500)
  }
})

/** 提交预览中的选项；默认选择来自快照，客户端可以只传需要覆盖的章节和字段。 */
bookImportRoutes.post('/:runId/commit', async (c) => {
  const db = getDb()
  const runId = String(c.req.param('runId') || '').trim()
  const run = await loadRun(db, runId, c.get('user').id)
  if (!run) return c.json({ error: '导入预览不存在' }, 404)
  if (run.status !== 'preview') return c.json({ error: '这次导入已经提交，不能重复提交' }, 409)
  const body: Record<string, unknown> = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>)
  const preview = previewPayload(run)
  const selectedChapterIds = Array.isArray(body.selectedChapterIds)
    ? stringArray(body.selectedChapterIds)
    : preview.chapters.filter((chapter) => chapter.selected).map((chapter) => chapter.id)
  const metadataFields = Array.isArray(body.metadataFields)
    ? stringArray(body.metadataFields)
    : preview.metadataDiff.filter((field) => field.selected).map((field) => field.field)
  const metadataMode = body.metadataMode === 'replace' ? 'replace' : 'missing'
  const targetNovelId = body.targetNovelId ? String(body.targetNovelId).trim() : run.target_novel_id || preview.targetNovelId || null
  if ((targetNovelId || '') !== (run.target_novel_id || '')) {
    return c.json({ error: '导入目标已变化，请先回到预览页重新选择目标' }, 409)
  }
  const operationKey = idempotencyKeyFromRequest(c, body, ['operationId'])
  return withIdempotency(
    db,
    {
      scope: `book-import.commit.${c.get('user').id}.${runId}`,
      operationKey,
      payload: { runId, targetNovelId: targetNovelId || '', selectedChapterIds, metadataFields, metadataMode },
      audit: { actorUserId: c.get('user').id, action: 'book-import-commit', targetCount: selectedChapterIds.length },
    },
    async () => {
      try {
        const result = await applyImport(db, {
          run,
          targetNovelId,
          selectedChapterIds,
          metadataFields,
          metadataMode,
          actorUserId: c.get('user').id,
        })
        return c.json(result, 200, { 'Cache-Control': 'no-store' })
      } catch (err) {
        const message = (err as Error).message || '书籍导入提交失败'
        return c.json({ error: message }, errorStatus(message) as 400 | 409 | 502 | 500)
      }
    },
  )
})

/** 撤回已经应用的导入；服务端只恢复仍保持导入后快照的记录。 */
bookImportRoutes.post('/:runId/rollback', async (c) => {
  const db = getDb()
  const runId = String(c.req.param('runId') || '').trim()
  const run = await loadRun(db, runId, c.get('user').id)
  if (!run) return c.json({ error: '导入记录不存在' }, 404)
  const body: Record<string, unknown> = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>)
  const operationKey = idempotencyKeyFromRequest(c, body, ['operationId'])
  return withIdempotency(
    db,
    {
      scope: `book-import.rollback.${c.get('user').id}.${runId}`,
      operationKey,
      payload: { runId },
      audit: { actorUserId: c.get('user').id, action: 'book-import-rollback', targetCount: 1 },
    },
    async () => {
      try {
        if (!['applied', 'partial'].includes(run.status)) return c.json({ error: '这次导入当前不可撤回' }, 409)
        return c.json(await rollbackImport(db, run), 200, { 'Cache-Control': 'no-store' })
      } catch (err) {
        const message = (err as Error).message || '书籍导入撤回失败'
        return c.json({ error: message }, errorStatus(message) as 400 | 409 | 502 | 500)
      }
    },
  )
})

/**
 * AI 边界复核。
 *
 * 只读诊断里的候选行（启发式判定证据不足的那些），产出建议落进快照，
 * 不改变已落库的 payload —— 采纳与否由管理员决定。这是刻意的：
 * 复核是可选增强，不是导入主链路的必经环节。
 */
bookImportRoutes.post('/:runId/ai-review', async (c) => {
  const db = getDb()
  const runId = String(c.req.param('runId') || '').trim()
  const run = await loadRun(db, runId, c.get('user').id)
  if (!run) return c.json({ error: '导入预览不存在' }, 404)
  if (run.status !== 'preview') return c.json({ error: '这次导入已经提交，不能重新复核' }, 409)
  const preview = previewPayload(run)
  if (!preview.diagnostics) return c.json({ error: '这次导入没有解析诊断，无法复核' }, 409)
  const settings = await getAiSettings(db)
  if (!settings.importAiReviewEnabled) return c.json({ error: '导入 AI 复核未开启，请先在 AI 设置中启用' }, 403)
  try {
    const outcome = await reviewImportHeadings(db, {
      userId: c.get('user').id,
      diagnostics: preview.diagnostics,
      ipAddress: settings.logIpAddress ? clientIpFromContext(c) : undefined,
      userAgent: settings.logUserAgent ? c.req.header('User-Agent') || '' : undefined,
    })
    // 预计章节数：用建议重跑一次确定性切分，让管理员在采纳前看到影响面。
    let projectedChapterCount = preview.book.chapters.length
    if (run.source_text && preview.diagnostics.stats.parser === 'text') {
      const projected = parseTextImportDetailed(run.source_text, run.source_label, {
        forceHeadings: outcome.forceHeadings,
        denyHeadings: outcome.denyHeadings,
      })
      projectedChapterCount = projected.payload.chapters.length
    }
    const review = { ...outcome.review, projectedChapterCount }
    await db.query('UPDATE book_import_runs SET preview_json=$1 WHERE id=$2', [JSON.stringify({ ...preview, aiReview: review }), runId])
    return c.json(review, 200, { 'Cache-Control': 'no-store' })
  } catch (err) {
    const message = (err as Error).message || 'AI 复核失败'
    const status = err instanceof AiError ? err.status : errorStatus(message)
    return c.json({ error: message }, status as 400 | 409 | 502 | 500 | 503)
  }
})

/**
 * 采纳 AI 建议：按行号覆盖重切并刷新快照。
 *
 * 覆盖只回答「哪几行是边界」，切分、去重与幂等键生成仍走确定性代码，
 * 因此结果可复现、可审计，也能随时撤回（run 快照仍在）。
 */
bookImportRoutes.post('/:runId/ai-review/apply', async (c) => {
  const db = getDb()
  const runId = String(c.req.param('runId') || '').trim()
  const run = await loadRun(db, runId, c.get('user').id)
  if (!run) return c.json({ error: '导入预览不存在' }, 404)
  if (run.status !== 'preview') return c.json({ error: '这次导入已经提交，不能重新切分' }, 409)
  const preview = previewPayload(run)
  const review = preview.aiReview
  if (!review || !review.suggestions.length) return c.json({ error: '没有可采纳的复核建议，请先运行 AI 复核' }, 409)
  if (!run.source_text) return c.json({ error: '这次导入没有原文快照，无法重新切分' }, 409)
  try {
    const result = parseTextImportDetailed(run.source_text, run.source_label, {
      forceHeadings: review.suggestions.filter((item) => item.verdict === 'heading').map((item) => item.line),
      denyHeadings: review.suggestions.filter((item) => item.verdict === 'prose').map((item) => item.line),
    })
    const next = await createPreview(db, {
      sourceType: run.source_type,
      sourceLabel: run.source_label,
      sourceUrl: run.source_url,
      payload: result.payload,
      targetNovelId: run.target_novel_id || null,
      runId,
      diagnostics: result.diagnostics,
    })
    // 并发保护：提交后不再改写快照。
    const updated = await db.query("UPDATE book_import_runs SET payload_json=$1, preview_json=$2 WHERE id=$3 AND status='preview'", [
      JSON.stringify(result.payload),
      JSON.stringify(next),
      runId,
    ])
    if (!updated.rowCount) return c.json({ error: '这次导入已经提交，不能重新切分' }, 409)
    return c.json(next, 200, { 'Cache-Control': 'no-store' })
  } catch (err) {
    const message = (err as Error).message || 'AI 建议采纳失败'
    return c.json({ error: message }, errorStatus(message) as 400 | 409 | 502 | 500)
  }
})

bookImportRoutes.get('/history', async (c) => {
  const db = getDb()
  const limit = Math.min(50, Math.max(1, Math.floor(Number(c.req.query('limit')) || 20)))
  const offset = Math.min(100000, Math.max(0, Math.floor(Number(c.req.query('offset')) || 0)))
  const rows = await all<StoredImportRun & { novel_title: string; changes_json: string }>(
    db,
    // 显式列名：source_text 可能是整份 25 MB 原文，绝不能跟着列表响应一起拉出来。
    `SELECT r.id, r.actor_user_id, r.source_type, r.source_label, r.source_url, r.target_novel_id,
            r.status, r.payload_json, r.preview_json, r.changes_json,
            r.created_at, r.applied_at, r.rolled_back_at,
            COALESCE(n.title, '') AS novel_title
       FROM book_import_runs r
       LEFT JOIN novels n ON n.id = NULLIF(r.target_novel_id, '')
      WHERE r.actor_user_id = $1
      ORDER BY r.created_at DESC, r.id
      LIMIT $2 OFFSET $3`,
    [c.get('user').id, limit, offset],
  )
  const items: BookImportHistoryItem[] = rows.map((row) => {
    const changes = safeJsonParse<Array<{ kind?: string }>>(row.changes_json, [])
    const preview = safeJsonParse<BookImportPreview>(row.preview_json, { summary: { conflictCount: 0 } } as BookImportPreview)
    return {
      runId: row.id,
      batchId: row.id,
      sourceType: row.source_type,
      sourceLabel: row.source_label,
      sourceUrl: row.source_url,
      novelId: row.target_novel_id,
      novelTitle: row.novel_title || preview.targetNovel?.title || preview.book?.title || '未命名作品',
      status: row.status as BookImportHistoryItem['status'],
      createdAt: Number(row.created_at) || 0,
      appliedAt: Number(row.applied_at) || 0,
      rolledBackAt: Number(row.rolled_back_at) || 0,
      created: changes.filter((change) => change.kind === 'create-chapter').length,
      updated: changes.filter((change) => change.kind === 'update-chapter').length,
      conflicts: Number(preview.summary?.conflictCount || 0),
      canRollback: row.status === 'applied' || row.status === 'partial',
    }
  })
  const count = await first<{ total: number }>(db, 'SELECT COUNT(*) AS total FROM book_import_runs WHERE actor_user_id=$1', [c.get('user').id])
  return c.json({ items, total: Number(count?.total) || 0, limit, offset }, 200, { 'Cache-Control': 'no-store' })
})
