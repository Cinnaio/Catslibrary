import { Hono } from 'hono'
import type { BookImportHistoryItem, BookImportPayload, BookImportPreview } from '@shared/types'
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
  parseUploadedBook,
  rollbackImport,
  type StoredImportRun,
} from '../services/book-import'
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

    if (contentType.includes('multipart/form-data')) {
      const form = await c.req.formData()
      const file = form.get('file')
      if (!file || typeof (file as File).arrayBuffer !== 'function') return c.json({ error: '请选择 TXT、JSON 或 EPUB 文件' }, 400)
      const fileName = String((file as File).name || '导入文件.txt')
      const data = new Uint8Array(await (file as File).arrayBuffer())
      payload = await parseUploadedBook(fileName, data)
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
    }

    const preview = await createPreview(db, {
      sourceType,
      sourceLabel,
      sourceUrl,
      payload,
      targetNovelId,
    })
    preview.warnings = Array.from(new Set([...warnings, ...preview.warnings]))
    const now = Date.now()
    await db.query(
      `INSERT INTO book_import_runs
        (id, actor_user_id, source_type, source_label, source_url, target_novel_id, status, payload_json, preview_json, changes_json, created_at, applied_at, rolled_back_at)
       VALUES ($1,$2,$3,$4,$5,$6,'preview',$7,$8,'[]',$9,0,0)`,
      [preview.runId, c.get('user').id, sourceType, preview.sourceLabel, preview.sourceUrl, preview.targetNovelId || '', JSON.stringify(payload), JSON.stringify(preview), now],
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
    const preview = await createPreview(db, {
      sourceType: run.source_type,
      sourceLabel: run.source_label,
      sourceUrl: run.source_url,
      payload: runPayload(run),
      targetNovelId,
      runId,
    })
    await db.query('UPDATE book_import_runs SET target_novel_id=$1, preview_json=$2 WHERE id=$3', [preview.targetNovelId || '', JSON.stringify(preview), runId])
    return c.json(preview, 200, { 'Cache-Control': 'no-store' })
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
  const body: Record<string, unknown> = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>))
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
  const body: Record<string, unknown> = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>))
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

bookImportRoutes.get('/history', async (c) => {
  const db = getDb()
  const limit = Math.min(50, Math.max(1, Math.floor(Number(c.req.query('limit')) || 20)))
  const offset = Math.min(100000, Math.max(0, Math.floor(Number(c.req.query('offset')) || 0)))
  const rows = await all<
    StoredImportRun & { novel_title: string; changes_json: string }
  >(
    db,
    `SELECT r.*, COALESCE(n.title, '') AS novel_title
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
