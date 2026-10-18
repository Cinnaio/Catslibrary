import { createHash, randomUUID } from 'node:crypto'
import { Hono, type Context } from 'hono'
import type { BookImportBoundaryOverride, BookImportDiagnostics, BookImportHistoryItem, BookImportPayload, BookImportPreview } from '@shared/types'
import { getDb } from '../db/pool'
import { all, first } from '../db/query'
import { requireAdmin, type AuthEnv } from '../middlewares/auth'
import { fetchHtml as fetchHtmlImpl, type FetchHtmlOptions } from '../services/scraper/fetch'
import { PgScrapeStore } from '../services/scraper/store'
import { getPo18Session } from '../services/source-account'
import {
  applyImport,
  createPreview,
  IMPORT_HEURISTIC_VERSION,
  parseBookUrl,
  parseUploadedBookDetailed,
  rollbackImport,
  type StoredImportRun,
} from '../services/book-import'
import { reviewImportHeadings } from '../services/ai/import-assist'
import { AiError } from '../services/ai/client'
import { boundSupplementaryFile } from '../services/supplementary-source'
import { assertBookBytes, downloadLanzouFile, identityKey, LanzouError } from '../services/lanzou'
import { getAiSettings } from '../services/ai/settings'
import { resolveImportChapter } from '../services/book-import-resolution'
import { clientIpFromContext } from '../services/ai/audit-context'
import { idempotencyKeyFromRequest, withIdempotency } from '../services/idempotency'
import {
  boundaryImpacts,
  checkImportRevision,
  importHistorySummary,
  IMPORT_PREVIEW_RETENTION_MS,
  IMPORT_REVIEW_LEASE_MS,
  mergeBoundaryOverrides,
  resplitImport,
} from '../services/book-import-state'

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
  const preview = safeJsonParse<BookImportPreview>(run.preview_json, {
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
  return {
    ...preview,
    revision: Number(run.revision || 0),
    sourceHash: run.source_hash || (run.source_text ? createHash('sha256').update(run.source_text).digest('hex') : ''),
    sourceExpiresAt: Number(run.source_expires_at) || 0,
    canResplit: !!run.source_text && (!Number(run.source_expires_at) || Number(run.source_expires_at) > Date.now()),
  }
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
    let supplementary: BookImportPreview['supplementary']

    if (contentType.includes('multipart/form-data')) {
      const form = await c.req.formData()
      const file = form.get('file')
      if (!file || typeof (file as File).arrayBuffer !== 'function') return c.json({ error: '请选择 TXT、JSON 或 EPUB 文件' }, 400)
      const fileName = String((file as File).name || '导入文件.txt')
      const data = new Uint8Array(await (file as File).arrayBuffer())
      if (form.get('supplementaryBindingId')) assertBookBytes(data,fileName)
      const detail = await parseUploadedBookDetailed(fileName, data)
      payload = detail.payload
      diagnostics = detail.diagnostics
      if (detail.diagnostics.stats.parser === 'text') sourceText = new TextDecoder('utf-8').decode(data)
      sourceType = 'file'
      sourceLabel = fileName
      sourceUrl = String(form.get('sourceUrl') || payload.sourceUrl || '').trim()
      const bindingId = String(form.get('supplementaryBindingId') || '').trim()
      if (bindingId) {
        const context = await boundSupplementaryFile(db,bindingId,String(form.get('fileKey') || ''))
        // 手动接续必须上传所选文件，允许浏览器追加的「 (1)」重名后缀。
        if (identityKey(fileName.replace(/\s*\(\d+\)(?=\.[^.]+$)/,'')) !== identityKey(context.file.name)) throw new LanzouError('上传文件名与所选网盘版本不一致，请上传对应文件','invalid')
        assertBookBytes(data,fileName)
        if (payload.author && context.file.author && identityKey(payload.author) !== identityKey(context.file.author)) throw new LanzouError('正文作者与绑定来源不一致，请核对文件','invalid')
        targetNovelId = context.binding.novelId
        sourceUrl = context.file.url
        sourceLabel = context.file.name
        supplementary = {bindingId,fileKey:context.file.key}
      }
    } else {
      const body = await c.req.json<Record<string, unknown>>()
      sourceType = 'url'
      sourceUrl = String(body.sourceUrl || body.url || '').trim()
      sourceLabel = String(body.sourceLabel || sourceUrl).trim()
      targetNovelId = body.targetNovelId ? String(body.targetNovelId).trim() : null
      const bindingId = String(body.supplementaryBindingId || '').trim()
      if (bindingId) {
        const context = await boundSupplementaryFile(db,bindingId,String(body.fileKey || ''))
        const data = await downloadLanzouFile(context.file)
        const detail = await parseUploadedBookDetailed(context.file.name,data)
        payload = detail.payload
        diagnostics = detail.diagnostics
        if (payload.author && context.file.author && identityKey(payload.author) !== identityKey(context.file.author)) throw new LanzouError('正文作者与绑定来源不一致，请核对文件','invalid')
        sourceText = detail.diagnostics.stats.parser === 'text' ? new TextDecoder('utf-8').decode(data) : ''
        sourceType = 'file'
        sourceUrl = context.file.url
        sourceLabel = context.file.name
        targetNovelId = context.binding.novelId
        supplementary = {bindingId,fileKey:context.file.key}
      } else {
      if (!sourceUrl) return c.json({ error: 'sourceUrl 必填' }, 400)
      const store = new PgScrapeStore(db)
      const result = await parseBookUrl(sourceUrl, { store, fetchHtml: withPo18Session(db, fetchHtmlImpl) })
      payload = result.payload
      warnings = result.warnings
      diagnostics = result.diagnostics
      }
    }

    if (supplementary) payload.chapters = payload.chapters.map(chapter=>({...chapter,sourceUrl:`${sourceUrl}#chapter=${chapter.order}`}))

    const preview = await createPreview(db, {
      sourceType,
      sourceLabel,
      sourceUrl,
      payload,
      targetNovelId: targetNovelId || undefined,
      diagnostics,
      preserveLocalOrder: !!supplementary,
    })
    preview.warnings = Array.from(new Set([...warnings, ...preview.warnings]))
    const now = Date.now()
    preview.revision = 0
    preview.boundaryOverrides = []
    preview.reviewedLines = []
    preview.sourceHash = sourceText ? createHash('sha256').update(sourceText).digest('hex') : ''
    preview.sourceExpiresAt = now + IMPORT_PREVIEW_RETENTION_MS
    preview.canResplit = !!sourceText
    if (supplementary) {
      preview.supplementary = supplementary
      preview.metadataDiff = preview.metadataDiff.map(field=>({...field,selected:false}))
      preview.warnings.push('附加源只更新你确认的章节，不修改作品信息；已有正文变化默认不勾选。')
    }
    await db.query(
      `INSERT INTO book_import_runs
        (id, actor_user_id, source_type, source_label, source_url, target_novel_id, status, payload_json, preview_json, changes_json, source_text, created_at, applied_at, rolled_back_at, source_hash, source_expires_at, history_summary, supplementary_binding_id, supplementary_file_key)
       VALUES ($1,$2,$3,$4,$5,$6,'preview',$7,$8,'[]',$9,$10,0,0,$11,$12,$13,$14,$15)`,
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
        preview.sourceHash,
        preview.sourceExpiresAt,
        importHistorySummary(preview),
        supplementary?.bindingId || '',
        supplementary?.fileKey || '',
      ],
    )
    return c.json(preview, 200, { 'Cache-Control': 'no-store' })
  } catch (err) {
    if (err instanceof LanzouError) return c.json({error:err.message,code:err.code},err.code==='invalid'?400:502)
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
    checkImportRevision(run, body.revision)
    const targetNovelId = body.targetNovelId ? String(body.targetNovelId).trim() : null
    if (run.supplementary_binding_id && targetNovelId !== run.target_novel_id) return c.json({error:'附加源预览已绑定作品，不能切换导入目标'},409)
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
      preserveLocalOrder: !!run.supplementary_binding_id,
    })
    const next = { ...previous, ...preview, revision: Number(run.revision || 0) + 1, aiReview: previous.aiReview || null }
    if (next.aiReview) next.aiReview = { ...next.aiReview, revision: next.revision }
    const updated = await db.query(
      "UPDATE book_import_runs SET target_novel_id=$1, preview_json=$2, revision=revision+1, history_summary=$5 WHERE id=$3 AND revision=$4 AND status='preview'",
      [next.targetNovelId || '', JSON.stringify(next), runId, run.revision || 0, importHistorySummary(next)],
    )
    if (!updated.rowCount) throw new Error('预览版本已变化，请重新预览')
    return c.json(next, 200, { 'Cache-Control': 'no-store' })
  } catch (err) {
    const message = (err as Error).message || '导入目标更新失败'
    return c.json({ error: message }, errorStatus(message) as 400 | 409 | 502 | 500)
  }
})

bookImportRoutes.post('/:runId/resolve-chapter', async c => {
  try {
    const body = await c.req.json<Record<string, unknown>>()
    const preview = await resolveImportChapter(getDb(), { runId: c.req.param('runId'), actorUserId: c.get('user').id,
      revision: body.revision, chapterId: body.chapterId, action: body.action, localChapterId: body.localChapterId, afterChapterId: body.afterChapterId })
    return c.json(preview, 200, { 'Cache-Control': 'no-store' })
  } catch (error) {
    const message = (error as Error).message || '章节确认失败'
    return c.json({ error: message }, errorStatus(message))
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
  try {
    checkImportRevision(run, body.revision)
  } catch (err) {
    return c.json({ error: (err as Error).message }, 409)
  }
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
      payload: { runId, revision: body.revision, targetNovelId: targetNovelId || '', selectedChapterIds, metadataFields, metadataMode },
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
  if (run.status !== 'preview') return c.json({ error: '这次导入已提交或过期，不能重新复核' }, 409)
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>)
  try {
    checkImportRevision(run, body.revision)
  } catch (err) {
    return c.json({ error: (err as Error).message }, 409)
  }
  const preview = previewPayload(run)
  if (!preview.diagnostics || !preview.canResplit) return c.json({ error: '原文快照不可用，请重新上传生成预览' }, 409)
  const settings = await getAiSettings(db)
  if (!settings.importAiReviewEnabled) return c.json({ error: '导入 AI 复核未开启，请先在 AI 设置中启用' }, 403)
  const token = randomUUID()
  const now = Date.now()
  // 数据库租约阻止重复点击、多标签页和多进程重复调用模型。异常退出最多占用十分钟。
  const lease = await db.query(
    `UPDATE book_import_runs SET review_token=$1, review_started_at=$2
    WHERE id=$3 AND status='preview' AND revision=$4 AND (review_token='' OR review_started_at < $5)`,
    [token, now, runId, run.revision || 0, now - IMPORT_REVIEW_LEASE_MS],
  )
  if (!lease.rowCount) return c.json({ error: '预览已变化或复核正在处理中，请稍后重新预览' }, 409)
  try {
    await db.query('INSERT INTO book_import_review_attempts (id, run_id, revision, created_at) VALUES ($1,$2,$3,$4)', [token, runId, run.revision || 0, now])
    const overrides = preview.boundaryOverrides || []
    const current = resplitImport(run, overrides, preview.diagnostics.heuristicVersion === IMPORT_HEURISTIC_VERSION ? preview.reviewedLines || [] : [])
    const outcome = await reviewImportHeadings(db, {
      userId: c.get('user').id,
      usageId: token,
      diagnostics: current.diagnostics,
      ipAddress: settings.logIpAddress ? clientIpFromContext(c) : undefined,
      userAgent: settings.logUserAgent ? c.req.header('User-Agent') || '' : undefined,
    })
    const reviewedLines = [
      ...new Set([
        ...(preview.diagnostics.heuristicVersion === IMPORT_HEURISTIC_VERSION ? preview.reviewedLines || [] : []),
        ...(outcome.review.reviewedLines || []),
      ]),
    ]
    const suggestionMap = new Map(
      (preview.aiReview?.heuristicVersion === IMPORT_HEURISTIC_VERSION && preview.aiReview.sourceHash === preview.sourceHash
        ? preview.aiReview.suggestions
        : []
      ).map((item) => [item.line, item]),
    )
    for (const item of outcome.review.suggestions) suggestionMap.set(item.line, item)
    const suggestions = [...suggestionMap.values()].sort((a, b) => a.line - b.line)
    const changes: BookImportBoundaryOverride[] = suggestions.map((item) => ({ line: item.line, verdict: item.verdict, source: 'ai', updatedAt: now }))
    const projected = resplitImport(run, mergeBoundaryOverrides(overrides, changes), reviewedLines)
    const diagnostics = resplitImport(run, overrides, reviewedLines).diagnostics
    const revision = Number(run.revision || 0) + 1
    const review = {
      ...outcome.review,
      sourceHash: preview.sourceHash,
      suggestions,
      revision,
      reviewedLines,
      diagnostics,
      remainingCount: diagnostics.pendingCount || 0,
      impacts: boundaryImpacts(run, overrides, changes),
      projectedChapterCount: projected.payload.chapters.length,
    }
    const next = { ...preview, revision, reviewedLines, diagnostics, aiReview: review }
    const updated = await db.query(
      `UPDATE book_import_runs SET preview_json=$1, revision=revision+1
      WHERE id=$2 AND status='preview' AND revision=$3 AND review_token=$4`,
      [JSON.stringify(next), runId, run.revision || 0, token],
    )
    if (!updated.rowCount) throw new AiError('conflict', '预览版本已变化，本次复核结果未写入，请重新预览', 409)
    await db.query("UPDATE book_import_review_attempts SET status='completed', model=$1, completed_at=$2 WHERE id=$3", [review.model, Date.now(), token])
    return c.json(review, 200, { 'Cache-Control': 'no-store' })
  } catch (err) {
    const message = (err as Error).message || 'AI 复核失败'
    await db.query("UPDATE book_import_review_attempts SET status='failed', error=$1, completed_at=$2, model=COALESCE((SELECT model FROM ai_usage WHERE id=$3),'') WHERE id=$3", [message.slice(0, 1000), Date.now(), token])
    const status = err instanceof AiError ? err.status : errorStatus(message)
    return c.json({ error: message }, status as 400 | 409 | 502 | 500 | 503)
  } finally {
    await db.query("UPDATE book_import_runs SET review_token='', review_started_at=0 WHERE id=$1 AND review_token=$2", [runId, token])
  }
})

/** 统一的边界编辑：AI 逐条采纳、人工裁决、撤销与恢复原始解析都走累计覆盖。 */
async function editBoundaries(c: Context<AuthEnv>, aiOnly = false) {
  const db = getDb()
  const runId = String(c.req.param('runId') || '').trim()
  const run = await loadRun(db, runId, c.get('user').id)
  if (!run) return c.json({ error: '导入预览不存在' }, 404)
  if (run.status !== 'preview') return c.json({ error: '这次导入已提交或过期，不能重新切分' }, 409)
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>)
  try {
    checkImportRevision(run, body.revision)
    const preview = previewPayload(run)
    if (!preview.canResplit) throw new Error('原文快照不可用，请重新上传生成预览')
    let changes: BookImportBoundaryOverride[] = []
    const now = Date.now()
    if (aiOnly) {
      if (!preview.aiReview?.suggestions.length) throw new Error('没有可采纳的复核建议，请先运行 AI 复核')
      if (preview.aiReview.heuristicVersion !== IMPORT_HEURISTIC_VERSION || preview.aiReview.sourceHash !== preview.sourceHash)
        throw new Error('预览复核基线已变化，请重新运行 AI 复核')
      const selected = Array.isArray(body.lines) ? new Set(body.lines) : new Set(preview.aiReview.suggestions.map((item) => item.line))
      if (!selected.size || [...selected].some((line) => !preview.aiReview!.suggestions.some((item) => item.line === line)))
        throw new Error('请选择有效的复核建议')
      changes = preview.aiReview.suggestions
        .filter((item) => selected.has(item.line))
        .map((item) => ({ line: item.line, verdict: item.verdict, source: 'ai', updatedAt: now }))
    } else if (Array.isArray(body.changes)) {
      if (body.changes.length > 300) throw new Error('单次最多修改 300 行')
      changes = body.changes.map((raw: unknown) => {
        const item = raw as { line?: unknown; verdict?: unknown }
        if (!item || !Number.isSafeInteger(item.line) || (item.verdict !== 'heading' && item.verdict !== 'prose')) throw new Error('行号与判定格式无效')
        return { line: item.line as number, verdict: item.verdict, source: 'manual', updatedAt: now }
      })
    }
    const sourceLines = run.source_text
      .replace(/^\uFEFF/, '')
      .replace(/\r\n?/g, '\n')
      .split('\n')
    if (changes.some((item) => item.line < 1 || item.line > sourceLines.length || !sourceLines[item.line - 1]!.trim()))
      throw new Error('请选择原文中的非空行作为章节边界')
    const remove = new Set(Array.isArray(body.removeLines) ? body.removeLines : [])
    if (!changes.length && !remove.size && body.reset !== true) throw new Error('请选择需要修正的边界')
    if ([...remove].some((line) => typeof line !== 'number' || !Number.isSafeInteger(line) || !preview.boundaryOverrides?.some((item) => item.line === line)))
      throw new Error('请选择有效的已修正行')
    let overrides = body.reset === true ? [] : (preview.boundaryOverrides || []).filter((item) => !remove.has(item.line))
    overrides = mergeBoundaryOverrides(overrides, changes)
    const reviewedLines = body.reset === true ? [] : (preview.reviewedLines || []).filter((line) => !remove.has(line))
    const result = resplitImport(run, overrides, reviewedLines)
    const impacts = boundaryImpacts(run, preview.boundaryOverrides || [], changes)
    if (body.dryRun === true)
      return c.json({ chapterCount: result.payload.chapters.length, impacts, revision: run.revision || 0 }, 200, { 'Cache-Control': 'no-store' })
    const next = await createPreview(db, {
      sourceType: run.source_type,
      sourceLabel: run.source_label,
      sourceUrl: run.source_url,
      payload: result.payload,
      targetNovelId: run.target_novel_id || null,
      runId,
      diagnostics: result.diagnostics,
      preserveLocalOrder: !!run.supplementary_binding_id,
    })
    Object.assign(next, {
      revision: Number(run.revision || 0) + 1,
      boundaryOverrides: overrides,
      reviewedLines,
      sourceHash: preview.sourceHash,
      sourceExpiresAt: preview.sourceExpiresAt,
      canResplit: true,
    })
    const handled = new Set([...changes.map((item) => item.line), ...remove])
    const remaining = body.reset === true ? [] : (preview.aiReview?.suggestions || []).filter((item) => !handled.has(item.line))
    if (preview.aiReview && remaining.length) {
      const pending: BookImportBoundaryOverride[] = remaining.map((item) => ({ line: item.line, verdict: item.verdict, source: 'ai', updatedAt: now }))
      next.aiReview = {
        ...preview.aiReview,
        revision: next.revision,
        suggestions: remaining,
        diagnostics: result.diagnostics,
        impacts: boundaryImpacts(run, overrides, pending),
        projectedChapterCount: resplitImport(run, mergeBoundaryOverrides(overrides, pending)).payload.chapters.length,
      }
    }
    const updated = await db.query(
      `UPDATE book_import_runs SET payload_json=$1, preview_json=$2, revision=revision+1, history_summary=$5
      WHERE id=$3 AND status='preview' AND revision=$4`,
      [JSON.stringify(result.payload), JSON.stringify(next), runId, run.revision || 0, importHistorySummary(next)],
    )
    if (!updated.rowCount) throw new Error('预览版本已变化，请重新预览')
    return c.json(next, 200, { 'Cache-Control': 'no-store' })
  } catch (err) {
    const message = (err as Error).message || '边界修正失败'
    return c.json({ error: message }, /格式|行号|非空|最多|有效|请选择/.test(message) ? 400 : 409)
  }
}

bookImportRoutes.post('/:runId/ai-review/apply', (c) => editBoundaries(c, true))
bookImportRoutes.post('/:runId/boundaries', (c) => editBoundaries(c))

bookImportRoutes.get('/:runId/lines', async (c) => {
  const run = await loadRun(getDb(), c.req.param('runId'), c.get('user').id)
  if (!run) return c.json({ error: '导入预览不存在' }, 404)
  if (!run.source_text || !previewPayload(run).canResplit) return c.json({ error: '原文快照不可用，请重新上传生成预览' }, 409)
  const lines = run.source_text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
  const line = Number(c.req.query('line'))
  if (!Number.isSafeInteger(line) || line < 1 || line > lines.length) return c.json({ error: '行号不在原文范围内' }, 400)
  const start = Math.max(0, line - 4)
  return c.json({ revision: run.revision || 0, lines: lines.slice(start, line + 3).map((raw, i) => ({ line: start + i + 1, raw: raw.slice(0, 1000) })) }, 200, {
    'Cache-Control': 'no-store',
  })
})

bookImportRoutes.get('/history', async (c) => {
  const db = getDb()
  const limit = Math.min(50, Math.max(1, Math.floor(Number(c.req.query('limit')) || 20)))
  const offset = Math.min(100000, Math.max(0, Math.floor(Number(c.req.query('offset')) || 0)))
  const rows = await all<StoredImportRun & { novel_title: string; history_summary: string }>(
    db,
    // 列表只读取轻量摘要，不加载原文、解析正文和回滚正文。
    `SELECT r.id, r.actor_user_id, r.source_type, r.source_label, r.source_url, r.target_novel_id,
            r.status, r.history_summary,
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
    const summary = safeJsonParse<{ title?: string; created?: number; updated?: number; conflicts?: number }>(row.history_summary, {})
    return {
      runId: row.id,
      batchId: row.id,
      sourceType: row.source_type,
      sourceLabel: row.source_label,
      sourceUrl: row.source_url,
      novelId: row.target_novel_id,
      novelTitle: row.novel_title || summary.title || '未命名作品',
      status: row.status as BookImportHistoryItem['status'],
      createdAt: Number(row.created_at) || 0,
      appliedAt: Number(row.applied_at) || 0,
      rolledBackAt: Number(row.rolled_back_at) || 0,
      created: Number(summary.created) || 0,
      updated: Number(summary.updated) || 0,
      conflicts: Number(summary.conflicts) || 0,
      canRollback: row.status === 'applied' || row.status === 'partial',
    }
  })
  const count = await first<{ total: number }>(db, 'SELECT COUNT(*) AS total FROM book_import_runs WHERE actor_user_id=$1', [c.get('user').id])
  return c.json({ items, total: Number(count?.total) || 0, limit, offset }, 200, { 'Cache-Control': 'no-store' })
})

bookImportRoutes.get('/:runId', async (c) => {
  const run = await loadRun(getDb(), c.req.param('runId'), c.get('user').id)
  if (!run) return c.json({ error: '导入预览不存在' }, 404)
  if (run.status !== 'preview') return c.json({ error: '这次预览已提交或过期，请重新生成预览' }, 409)
  return c.json(previewPayload(run), 200, { 'Cache-Control': 'no-store' })
})
