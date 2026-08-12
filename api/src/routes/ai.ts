/**
 * /api/ai —— AI 能力入口。
 * 读者侧：GET /status（能力探测）、POST /recap（章节前情提要，先查缓存再计配额）。
 * 管理侧：GET|PUT /settings、POST /test（连通性自检）、GET /usage（用量统计）。
 */
import { Hono, type Context } from 'hono'
import { getDb } from '../db/pool'
import { all, first, withTx } from '../db/query'
import { AiError, chat, isTextAiConfigured, providerLabel, textProvider } from '../services/ai/client'
import { getAiSettings, saveAiSettings } from '../services/ai/settings'
import { generateRecap, getCachedRecap, loadChapterForRecap } from '../services/ai/summary'
import { generateCatchup, getCachedCatchup, inspectCatchup } from '../services/ai/catchup'
import { invalidateChapter, listGenerationDetails, deleteGeneration, deleteGenerations, getGeneration, updateGenerationResult, type GenerationRow } from '../services/ai/generations'
import { escapeLike } from '../services/text'
import { generateContinuationChapters, generateWriting, generateWritingTitles, recentNovelContext } from '../services/ai/writing'
import { checkQuota, recordUsage, startOfToday, summarizeUsage } from '../services/ai/usage'
import { optionalUser, requireAdmin, requireUser, type AuthEnv } from '../middlewares/auth'
import { cancelAiTask, createAiTask, getAiTask, listAiTasks, updateAiTask } from '../services/ai/tasks'
import { clientIpFromContext } from '../services/ai/audit-context'

export const aiRoutes = new Hono<AuthEnv>()

async function auditRequestContext(c: Context<AuthEnv>, db: ReturnType<typeof getDb>): Promise<{ ipAddress?: string; userAgent?: string }> {
  const settings = await getAiSettings(db)
  return {
    ipAddress: settings.logIpAddress ? clientIpFromContext(c) : undefined,
    userAgent: settings.logUserAgent ? c.req.header('User-Agent') || '' : undefined,
  }
}

// ---------- 能力探测（匿名可用，前端据此决定是否渲染 AI 入口） ----------

aiRoutes.get('/status', optionalUser(), async (c) => {
  const configured = isTextAiConfigured()
  const settings = await getAiSettings(getDb())
  const user = c.get('user')
  const isAdmin = user?.role === 'admin'

  let quota: { used: number; limit: number; resetAt: number } | null = null
  if (user) {
    const state = await checkQuota(getDb(), user.id, settings.dailyQuota, isAdmin)
    quota = { used: state.used, limit: state.limit, resetAt: state.resetAt }
  }

  return c.json(
    {
      configured,
      // 未登录用户不给 AI 能力：调用要记账到具体用户头上
      features: { recap: configured && settings.recapEnabled && !!user, catchup: configured && settings.catchupEnabled && !!user },
      model: configured ? textProvider().model : '',
      quota,
    },
    200,
    { 'Cache-Control': 'no-store' },
  )
})

// ---------- 章节前情提要 ----------

/** 只查缓存，不触发生成、不计配额：阅读器进章时静默预取。 */
aiRoutes.get('/recap', requireUser(), async (c) => {
  const db = getDb()
  const chapterId = String(c.req.query('chapterId') || '').trim()
  if (!chapterId) return c.json({ error: 'chapterId is required' }, 400)

  const settings = await getAiSettings(db)
  if (!settings.recapEnabled || !isTextAiConfigured()) return c.json({ recap: '', cached: false }, 200, { 'Cache-Control': 'no-store' })

  const cached = await getCachedRecap(db, chapterId, textProvider().model)
  return c.json(
    cached ? { recap: cached.result, cached: true, model: cached.model, id: cached.id } : { recap: '', cached: false },
    200,
    { 'Cache-Control': 'no-store' },
  )
})

aiRoutes.post('/recap', requireUser(), async (c) => {
  const db = getDb()
  const user = c.get('user')
  const isAdmin = user.role === 'admin'
  const body = (await c.req.json().catch(() => ({}))) as { chapterId?: unknown; force?: unknown }
  const chapterId = String(body.chapterId || '').trim()
  if (!chapterId) return c.json({ error: 'chapterId is required' }, 400)

  const settings = await getAiSettings(db)
  if (!settings.recapEnabled) return c.json({ error: 'AI 前情提要已关闭', code: 'disabled' }, 403)
  if (!isTextAiConfigured()) return c.json({ error: 'AI 文本服务未配置', code: 'disabled' }, 503)

  const force = !!body.force && isAdmin
  const model = textProvider().model

  if (!force) {
    const cached = await getCachedRecap(db, chapterId, model)
    // 命中缓存不计配额、不记账——这是控制成本的关键路径
    if (cached) return c.json({ recap: cached.result, cached: true, model: cached.model, id: cached.id }, 200, { 'Cache-Control': 'no-store' })
  }

  const quota = await checkQuota(db, user.id, settings.dailyQuota, isAdmin)
  if (!quota.ok) {
    return c.json({ error: '今日 AI 生成次数已用完', code: 'quota_exceeded', used: quota.used, limit: quota.limit, resetAt: quota.resetAt }, 429)
  }

  const chapter = await loadChapterForRecap(db, chapterId)
  if (!chapter) return c.json({ error: '章节不存在' }, 404)

  const novel = await first<{ title: string }>(db, 'SELECT title FROM novels WHERE id = $1', [chapter.novel_id])

  try {
    if (force) await invalidateChapter(db, 'summary', chapterId)
    const result = await generateRecap(db, {
      chapter,
      novelTitle: novel?.title || '',
      maxChapterChars: settings.maxChapterChars,
      userId: user.id,
      ...(await auditRequestContext(c, db)),
    })
    return c.json(
      { recap: result.generation.result, cached: false, model: result.generation.model, id: result.generation.id },
      200,
      { 'Cache-Control': 'no-store' },
    )
  } catch (err) {
    return aiErrorResponse(c, err)
  }
})

// ---------- 回来接着读（进度感知的连贯回顾） ----------

aiRoutes.post('/catchup', requireUser(), async (c) => {
  const db = getDb()
  const user = c.get('user')
  const isAdmin = user.role === 'admin'
  const body = (await c.req.json().catch(() => ({}))) as { novelId?: unknown }
  const novelId = String(body.novelId || '').trim()
  if (!novelId) return c.json({ error: 'novelId is required' }, 400)

  const settings = await getAiSettings(db)
  if (!settings.catchupEnabled) return c.json({ error: 'AI 回顾总结已关闭', code: 'disabled' }, 403)
  if (!isTextAiConfigured()) return c.json({ error: 'AI 文本服务未配置', code: 'disabled' }, 503)

  const model = textProvider().model
  const inspection = await inspectCatchup(db, user.id, novelId, model)
  if (!inspection.source) {
    return c.json({ recap: null, cached: false, reason: inspection.reason }, 200, { 'Cache-Control': 'no-store' })
  }

  // 命中缓存不计配额、不记账；素材检查与缓存键使用同一份 inspection
  const cached = await getCachedCatchup(db, user.id, novelId, model, inspection)
  if (cached) return c.json({ recap: cached.result, cached: true, model: cached.model, id: cached.id }, 200, { 'Cache-Control': 'no-store' })

  const quota = await checkQuota(db, user.id, settings.dailyQuota, isAdmin)
  if (!quota.ok) {
    return c.json({ error: '今日 AI 生成次数已用完', code: 'quota_exceeded', used: quota.used, limit: quota.limit, resetAt: quota.resetAt }, 429)
  }

  try {
    const result = await generateCatchup(db, { userId: user.id, novelId, source: inspection.source, ...(await auditRequestContext(c, db)) })
    return c.json(
      { recap: result.generation?.result || null, cached: false, model: result.generation?.model, id: result.generation?.id, chapterIds: result.chapterIds },
      200,
      { 'Cache-Control': 'no-store' },
    )
  } catch (err) {
    return aiErrorResponse(c, err)
  }
})

// ---------- 管理端 ----------

aiRoutes.get('/settings', requireAdmin(), async (c) => {
  const settings = await getAiSettings(getDb())
  const provider = textProvider()
  return c.json(
    {
      settings,
      provider: { configured: isTextAiConfigured(), host: providerLabel(provider.baseUrl), model: provider.model, hasKey: !!provider.apiKey },
    },
    200,
    { 'Cache-Control': 'no-store' },
  )
})

aiRoutes.put('/settings', requireAdmin(), async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const settings = await saveAiSettings(getDb(), body)
  return c.json({ settings })
})

/** 连通性自检：发一条最小请求，确认 baseUrl/key/model 三件套可用。 */
aiRoutes.post('/test', requireAdmin(), async (c) => {
  if (!isTextAiConfigured()) return c.json({ ok: false, error: 'AI 文本服务未配置（AI_TEXT_BASE_URL / AI_TEXT_API_KEY）', code: 'disabled' }, 503)
  const provider = textProvider()
  const startedAt = Date.now()
  try {
    const res = await chat({
      messages: [{ role: 'user', content: '回复两个字：可用' }],
      // 推理模型的思考 token 也吃这个预算，给太小会拿到空 content
      maxTokens: 256,
      temperature: 0,
      timeoutMs: 20_000,
    })
    await recordUsage(getDb(), {
      userId: c.get('user').id,
      model: res.model,
      provider: providerLabel(provider.baseUrl),
      promptTokens: res.promptTokens,
      completionTokens: res.completionTokens,
      costMillicents: Math.round(res.cost * 100_000),
      // 连通性测试单独打 tag，审计里与读者真实调用区分开
      generationType: 'test',
      ...(await auditRequestContext(c, getDb())),
    })
    return c.json({ ok: true, model: res.model, reply: res.text.slice(0, 100), elapsedMs: Date.now() - startedAt })
  } catch (err) {
    const aiErr = err instanceof AiError ? err : new AiError('upstream', 'AI 请求失败')
    return c.json({ ok: false, error: aiErr.message, code: aiErr.code, elapsedMs: Date.now() - startedAt }, 200)
  }
})

// ---------- 管理端 AI 创作：先生成草稿，发布时才写入正式章节 ----------

aiRoutes.post('/writing/outline', requireAdmin(), async (c) => {
  const db = getDb()
  const body = await c.req.json().catch(() => ({}))
  const user = c.get('user')
  const title = String(body.title || '').trim()
  const novelId = String(body.novelId || '').trim()
  if (!title) return c.json({ error: 'title 必填' }, 400)
  try {
    const result = await generateWriting(db, { userId: user.id, novelId, kind: 'write_outline', title, instruction: String(body.instruction || '').trim(), maxTokens: body.maxTokens, temperature: body.temperature, ...writingOptions(body), ...(await auditRequestContext(c, db)) })
    return c.json({ draft: result.generation, usage: result.usage })
  } catch (err) { return aiErrorResponse(c, err) }
})

function writingOptions(body: Record<string, any>) {
  return {
    targetWords: body.targetWords,
    chapterCount: body.chapterCount,
  }
}

aiRoutes.post('/writing/chapter', requireAdmin(), async (c) => {
  const db = getDb()
  const body = await c.req.json().catch(() => ({}))
  const user = c.get('user')
  const novelId = String(body.novelId || '').trim()
  const title = String(body.title || '').trim()
  if (!novelId || !title) return c.json({ error: 'novelId 和 title 必填' }, 400)
  const novel = await first<{ title: string }>(db, 'SELECT title FROM novels WHERE id = $1', [novelId])
  if (!novel) return c.json({ error: '小说不存在' }, 404)
  try {
    const result = await generateWriting(db, { userId: user.id, novelId, kind: 'write_chapter', title: novel.title, instruction: String(body.instruction || '').trim(), outline: String(body.outline || '').trim(), context: String(body.context || '').trim(), maxTokens: body.maxTokens, temperature: body.temperature, ...writingOptions(body), ...(await auditRequestContext(c, db)) })
    return c.json({ draft: result.generation, usage: result.usage })
  } catch (err) { return aiErrorResponse(c, err) }
})

/**
 * 多章续写：后台任务模式。串行生成最长可达数十分钟，同步 HTTP 连接会被
 * 反向代理超时掐断，因此这里立即返回 taskId，生成在进程内异步执行；
 * 前端轮询 GET /tasks/:id 看进度，完成后草稿在「已生成内容」按 batchId 归组。
 */
aiRoutes.post('/writing/continue', requireAdmin(), async (c) => {
  const db = getDb()
  const body = await c.req.json().catch(() => ({}))
  const user = c.get('user')
  const novelId = String(body.novelId || '').trim()
  const chapterTitle = String(body.title || '').trim()
  if (!novelId) return c.json({ error: 'novelId 必填' }, 400)
  const novel = await first<{ title: string }>(db, 'SELECT title FROM novels WHERE id = $1', [novelId])
  if (!novel) return c.json({ error: '小说不存在' }, 404)
  if (!isTextAiConfigured()) return c.json({ error: 'AI 文本服务未配置', code: 'disabled' }, 503)

  const count = Math.max(1, Math.min(20, Math.trunc(Number(body.chapterCount) || 1)))
  const instruction = String(body.instruction || chapterTitle || '自然推进剧情，完成一个有悬念的章节段落').trim()
  // 上下文与审计信息在请求内取好：后台执行时请求上下文已不可用
  const context = await recentNovelContext(db, novelId, body.afterChapterId ? String(body.afterChapterId) : undefined)
  const audit = await auditRequestContext(c, db)
  const batchId = `continue_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  const task = await createAiTask(db, { userId: user.id, novelId, kind: 'continue', total: count, batchId, prompt: instruction })

  void generateContinuationChapters(db, { userId: user.id, novelId, title: novel.title, instruction, context, maxTokens: body.maxTokens, temperature: body.temperature, ...writingOptions(body), batchId, taskId: task.id, ...audit })
    .catch(async (err) => {
      console.error('[ai] 续写后台任务失败', err)
      const message = err instanceof AiError ? err.message : 'AI 生成失败'
      await updateAiTask(db, task.id, { status: 'failed', error: message }).catch(() => {})
    })

  return c.json({ ok: true, taskId: task.id, batchId, total: count, contextUsed: context.length }, 202)
})

aiRoutes.post('/writing/titles', requireAdmin(), async (c) => {
  const db = getDb()
  const body = await c.req.json().catch(() => ({}))
  const content = String(body.content || '').trim()
  if (!content) return c.json({ error: 'content 必填' }, 400)
  if (content.length < 20) return c.json({ error: '正文太短，无法生成合适的标题' }, 422)
  try {
    const result = await generateWritingTitles(db, {
      userId: c.get('user').id,
      novelId: String(body.novelId || '').trim(),
      content,
      contextTitle: String(body.contextTitle || '').trim(),
      ...(await auditRequestContext(c, db)),
    })
    return c.json({ titles: result.titles, usage: result.usage })
  } catch (err) { return aiErrorResponse(c, err) }
})

aiRoutes.put('/writing/drafts/:id', requireAdmin(), async (c) => {
  const id = String(c.req.param('id') || '')
  const body = await c.req.json().catch(() => ({}))
  const row = await getGeneration(getDb(), id)
  if (!row || row.status !== 'draft' || !['write_chapter', 'continue', 'write_outline'].includes(row.kind)) return c.json({ error: '草稿不存在或不可编辑' }, 404)
  const result = String(body.result ?? '').trim()
  if (!result) return c.json({ error: '内容不能为空' }, 400)
  await updateGenerationResult(getDb(), id, result)
  return c.json({ ok: true, id, result })
})

/** 事务内的业务性失败：回滚后由路由层转成对应的 4xx。 */
class PublishError extends Error {
  constructor(
    readonly httpStatus: 404 | 409,
    message: string,
  ) {
    super(message)
    this.name = 'PublishError'
  }
}

aiRoutes.post('/writing/drafts/:id/publish', requireAdmin(), async (c) => {
  const db = getDb()
  const id = String(c.req.param('id') || '')
  const body = await c.req.json().catch(() => ({}))
  const row = await getGeneration(db, id)
  if (!row || row.status !== 'draft' || !['write_chapter', 'continue'].includes(row.kind)) return c.json({ error: '可发布的章节草稿不存在' }, 404)
  const novelId = String(body.novelId || row.novel_id || '').trim()
  const title = String(body.title || '').trim()
  if (!novelId || !title || !row.result.trim()) return c.json({ error: 'novelId、title 和内容必填' }, 400)
  const chapterId = 'ch_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
  const now = Date.now()
  try {
    // 插章节、刷计数、改草稿状态放同一事务，任一步失败整体回滚，不留半成品
    const order = await withTx(db, async (q) => {
      // 锁小说行：同一本书的并发发布被串行化，MAX+1 取号不会重复
      const novel = await q('SELECT id FROM novels WHERE id = $1 FOR UPDATE', [novelId])
      if (!novel.rows.length) throw new PublishError(404, '小说不存在')
      // 带条件更新原子占用草稿：同一草稿并发发布时只有一个请求能成功
      const claimed = await q("UPDATE ai_generations SET status = 'published', chapter_id = $1 WHERE id = $2 AND status = 'draft'", [chapterId, id])
      if (!claimed.rowCount) throw new PublishError(409, '草稿已被发布或不可发布')
      const max = await q<{ max_order: number }>('SELECT COALESCE(MAX(sort_order), 0)::int AS max_order FROM chapters WHERE novel_id = $1', [novelId])
      const nextOrder = Number(max.rows[0]?.max_order || 0) + 1
      await q('INSERT INTO chapters (id, novel_id, title, content, sort_order, word_count, source_url, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [chapterId, novelId, title, row.result, nextOrder, row.result.replace(/<[^>]*>/g, '').length, '', now])
      await q('UPDATE novels SET chapter_count = (SELECT COUNT(*) FROM chapters WHERE novel_id = $1), updated_at = $2 WHERE id = $1', [novelId, now])
      return nextOrder
    })
    return c.json({ ok: true, chapter: { id: chapterId, novelId, title, order } })
  } catch (err) {
    if (err instanceof PublishError) return c.json({ error: err.message }, err.httpStatus)
    throw err
  }
})

/** 从 params_json 取批次字段（batchId / batchIndex），解析失败按无批次处理。 */
function draftBatchParams(paramsJson: string): { batchId: string; batchIndex: number } {
  try {
    const params = JSON.parse(paramsJson) as Record<string, unknown>
    return { batchId: typeof params.batchId === 'string' ? params.batchId : '', batchIndex: Number(params.batchIndex) || 0 }
  } catch {
    return { batchId: '', batchIndex: 0 }
  }
}

/**
 * 整批发布：把一个续写批次的全部草稿按 batchIndex 顺序发布为正式章节。
 * 标题自动使用「第 N 章」（沿现有章节序号递增），发布后可在章节管理里改名。
 */
aiRoutes.post('/writing/batches/:batchId/publish', requireAdmin(), async (c) => {
  const db = getDb()
  const batchId = String(c.req.param('batchId') || '').trim()
  if (!batchId) return c.json({ error: 'batchId 必填' }, 400)
  const body = await c.req.json().catch(() => ({}))

  // LIKE 先粗筛（batchId 由服务端生成，转义只为防御异常输入），再解析 params_json 精确匹配
  const candidates = await all<GenerationRow>(
    db,
    `SELECT * FROM ai_generations WHERE kind = 'continue' AND status = 'draft' AND params_json LIKE $1 ORDER BY created_at ASC`,
    [`%"batchId":"${escapeLike(batchId)}"%`],
  )
  const drafts = candidates
    .map((row) => ({ row, batch: draftBatchParams(row.params_json) }))
    .filter((d) => d.batch.batchId === batchId && d.row.result.trim())
    .sort((a, b) => a.batch.batchIndex - b.batch.batchIndex)
  if (!drafts.length) return c.json({ error: '该批次没有可发布的草稿' }, 404)

  const novelId = String(body.novelId || drafts[0]!.row.novel_id || '').trim()
  if (!novelId) return c.json({ error: 'novelId 必填' }, 400)

  const now = Date.now()
  try {
    const published = await withTx(db, async (q) => {
      const novel = await q('SELECT id FROM novels WHERE id = $1 FOR UPDATE', [novelId])
      if (!novel.rows.length) throw new PublishError(404, '小说不存在')
      const max = await q<{ max_order: number }>('SELECT COALESCE(MAX(sort_order), 0)::int AS max_order FROM chapters WHERE novel_id = $1', [novelId])
      let order = Number(max.rows[0]?.max_order || 0)
      const results: Array<{ id: string; title: string; order: number; generationId: string }> = []
      for (const { row } of drafts) {
        const chapterId = 'ch_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
        // 原子占用：并发下已被单独发布的草稿跳过，不打断整批
        const claimed = await q("UPDATE ai_generations SET status = 'published', chapter_id = $1 WHERE id = $2 AND status = 'draft'", [chapterId, row.id])
        if (!claimed.rowCount) continue
        order += 1
        const title = `第 ${order} 章`
        await q('INSERT INTO chapters (id, novel_id, title, content, sort_order, word_count, source_url, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [chapterId, novelId, title, row.result, order, row.result.replace(/<[^>]*>/g, '').length, '', now])
        results.push({ id: chapterId, title, order, generationId: row.id })
      }
      if (!results.length) throw new PublishError(409, '草稿已被发布或不可发布')
      await q('UPDATE novels SET chapter_count = (SELECT COUNT(*) FROM chapters WHERE novel_id = $1), updated_at = $2 WHERE id = $1', [novelId, now])
      return results
    })
    return c.json({ ok: true, published, novelId })
  } catch (err) {
    if (err instanceof PublishError) return c.json({ error: err.message }, err.httpStatus)
    throw err
  }
})

aiRoutes.get('/usage', requireAdmin(), async (c) => {
  const db = getDb()
  const today = startOfToday()
  const [todayUsage, last30d] = await Promise.all([summarizeUsage(db, today), summarizeUsage(db, today - 29 * 86_400_000)])
  return c.json({ today: todayUsage, last30d }, 200, { 'Cache-Control': 'no-store' })
})

aiRoutes.get('/tasks', requireAdmin(), async (c) => {
  const limit = Number.parseInt(c.req.query('limit') || '50', 10) || 50
  const offset = Number.parseInt(c.req.query('offset') || '0', 10) || 0
  const result = await listAiTasks(getDb(), { limit, offset })
  return c.json({ ...result, limit, offset }, 200, { 'Cache-Control': 'no-store' })
})

/** 单任务查询：后台续写等长任务由前端轮询此接口看进度。 */
aiRoutes.get('/tasks/:id', requireAdmin(), async (c) => {
  const task = await getAiTask(getDb(), String(c.req.param('id') || '').trim())
  if (!task) return c.json({ error: '任务不存在' }, 404)
  return c.json({ task }, 200, { 'Cache-Control': 'no-store' })
})

aiRoutes.post('/tasks/:id/cancel', requireAdmin(), async (c) => {
  const ok = await cancelAiTask(getDb(), String(c.req.param('id') || '').trim())
  if (!ok) return c.json({ error: '任务不存在或已经结束' }, 404)
  return c.json({ ok: true })
})

// ---------- 审计接口 ----------

/** 用户级 AI 用量审计：按用户聚合统计 */
aiRoutes.get('/audit/users', requireAdmin(), async (c) => {
  const db = getDb()
  const limit = Math.min(Number.parseInt(c.req.query('limit') || '50', 10) || 50, 200)
  const offset = Number.parseInt(c.req.query('offset') || '0', 10) || 0

  const rows = await all<Record<string, unknown>>(
    db,
    `SELECT
      u.id, u.username, u.display_name,
      COUNT(g.id)::int AS call_count,
      SUM(g.prompt_tokens)::int AS total_prompt_tokens,
      SUM(g.completion_tokens)::int AS total_completion_tokens,
      SUM(g.cost_millicents)::int AS total_cost_millicents,
      MAX(g.created_at) AS last_call_at
    FROM users u
    INNER JOIN ai_usage g ON g.user_id = u.id
    GROUP BY u.id, u.username, u.display_name
    HAVING COUNT(g.id) > 0
    ORDER BY total_cost_millicents DESC
    LIMIT $1 OFFSET $2`,
    [limit, offset],
  )

  const totalRow = await first<{ total: number }>(db, 'SELECT COUNT(DISTINCT user_id)::int AS total FROM ai_usage')

  return c.json(
    {
      users: rows.map((r) => ({
        id: String(r.id),
        username: String(r.username || ''),
        displayName: String(r.display_name || ''),
        callCount: Number(r.call_count) || 0,
        totalPromptTokens: Number(r.total_prompt_tokens) || 0,
        totalCompletionTokens: Number(r.total_completion_tokens) || 0,
        totalCostMillicents: Number(r.total_cost_millicents) || 0,
        lastCallAt: Number(r.last_call_at) || 0,
      })),
      total: totalRow?.total || 0,
      limit,
      offset,
    },
    200,
    { 'Cache-Control': 'no-store' },
  )
})

/** 详细调用记录：支持用户、类型、时间筛选 */
aiRoutes.get('/audit/calls', requireAdmin(), async (c) => {
  const db = getDb()
  const userId = c.req.query('userId')
  const type = c.req.query('type')
  const from = Number.parseInt(c.req.query('from') || '0', 10) || 0
  const to = Number.parseInt(c.req.query('to') || String(Date.now()), 10) || Date.now()
  const requestedLimit = Number.parseInt(c.req.query('limit') || '50', 10)
  const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 50, 10), 100)
  const offset = Number.parseInt(c.req.query('offset') || '0', 10) || 0

  const conditions = ['u.created_at >= $1', 'u.created_at <= $2']
  const params: unknown[] = [from, to]

  if (userId) {
    params.push(userId)
    conditions.push(`u.user_id = $${params.length}`)
  }

  if (type) {
    params.push(type)
    conditions.push(`u.generation_type = $${params.length}`)
  }

  const where = conditions.join(' AND ')

  const rows = await all<Record<string, unknown>>(
    db,
    `SELECT
      u.id, u.generation_type, u.model, u.prompt_tokens, u.completion_tokens, u.ip_address, u.user_agent,
      u.cost_millicents, u.created_at, u.user_id, u.novel_id, u.chapter_id,
      usr.username, usr.display_name,
      n.title AS novel_title,
      c.title AS chapter_title
    FROM ai_usage u
    LEFT JOIN users usr ON usr.id = u.user_id
    LEFT JOIN novels n ON n.id = u.novel_id
    LEFT JOIN chapters c ON c.id = u.chapter_id
    WHERE ${where}
    ORDER BY u.created_at DESC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  )

  const totalRow = await first<{ total: number }>(db, `SELECT COUNT(*)::int AS total FROM ai_usage u WHERE ${where}`, params)

  return c.json(
    {
      calls: rows.map((r) => ({
        id: String(r.id),
        type: String(r.generation_type || ''),
        model: String(r.model || ''),
        promptTokens: Number(r.prompt_tokens) || 0,
        completionTokens: Number(r.completion_tokens) || 0,
        costMillicents: Number(r.cost_millicents) || 0,
        createdAt: Number(r.created_at) || 0,
        userId: String(r.user_id || ''),
        username: String(r.username || ''),
        displayName: String(r.display_name || ''),
        novelId: String(r.novel_id || ''),
        novelTitle: String(r.novel_title || ''),
        chapterId: String(r.chapter_id || ''),
        chapterTitle: String(r.chapter_title || ''),
        ipAddress: String(r.ip_address || ''),
        userAgent: String(r.user_agent || ''),
      })),
      total: totalRow?.total || 0,
      limit,
      offset,
    },
    200,
    { 'Cache-Control': 'no-store' },
  )
})

/** 成本趋势：按天聚合，用于图表展示 */
aiRoutes.get('/audit/trend', requireAdmin(), async (c) => {
  const db = getDb()
  const days = Math.min(Number.parseInt(c.req.query('days') || '30', 10) || 30, 365)
  const from = Date.now() - days * 86_400_000

  const rows = await all<Record<string, unknown>>(
    db,
    `SELECT
      TO_CHAR(TO_TIMESTAMP(created_at / 1000), 'YYYY-MM-DD') AS date,
      COUNT(*)::int AS calls,
      SUM(prompt_tokens)::int AS prompt_tokens,
      SUM(completion_tokens)::int AS completion_tokens,
      SUM(cost_millicents)::int AS cost_millicents
    FROM ai_usage
    WHERE created_at >= $1
    GROUP BY date
    ORDER BY date ASC`,
    [from],
  )

  return c.json(
    {
      trend: rows.map((r) => ({
        date: String(r.date),
        calls: Number(r.calls) || 0,
        promptTokens: Number(r.prompt_tokens) || 0,
        completionTokens: Number(r.completion_tokens) || 0,
        costMillicents: Number(r.cost_millicents) || 0,
      })),
      days,
    },
    200,
    { 'Cache-Control': 'no-store' },
  )
})

// ---------- 已生成内容管理 ----------

/** 已生成内容列表：默认只看已发布（读者可见）的，支持按类型/状态筛选。 */
aiRoutes.get('/generations', requireAdmin(), async (c) => {
  const db = getDb()
  const allowedKinds = new Set(['summary', 'catchup', 'continue', 'write_outline', 'write_chapter'])
  const kind = allowedKinds.has(c.req.query('kind') || '') ? c.req.query('kind') : undefined
  // 统一的“已生成内容”默认仍保持读者范围；需要查看全部内容时显式传 all。
  const scope = c.req.query('scope')
  const scopedKinds = scope === 'writing'
    ? ['continue', 'write_outline', 'write_chapter']
    : scope === 'reader'
      ? ['summary', 'catchup']
      : undefined
  const requestedStatus = c.req.query('status')
  const status = requestedStatus === 'all'
    ? undefined
    : requestedStatus === 'published' || requestedStatus === 'draft' || requestedStatus === 'rejected'
      ? requestedStatus
      : 'published'
  const requestedLimit = Number.parseInt(c.req.query('limit') || '50', 10)
  const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 50, 10), 100)
  const offset = Number.parseInt(c.req.query('offset') || '0', 10) || 0

  const { items, total } = await listGenerationDetails(db, { kind, kinds: scopedKinds, status, limit, offset })
  return c.json({ items, total, limit, offset }, 200, { 'Cache-Control': 'no-store' })
})

/** 删除单条已生成内容：物理删除，读者再访问该章/该回顾时会重新生成（计配额）。 */
aiRoutes.delete('/generations/:id', requireAdmin(), async (c) => {
  const id = String(c.req.param('id') || '').trim()
  if (!id) return c.json({ error: 'id is required' }, 400)

  const removed = await deleteGeneration(getDb(), id)
  if (!removed) return c.json({ error: '内容不存在或已删除' }, 404)
  return c.json({ ok: true }, 200, { 'Cache-Control': 'no-store' })
})

aiRoutes.post('/generations/batch-delete', requireAdmin(), async (c) => {
  const body = await c.req.json().catch(() => ({})) as { ids?: unknown }
  const ids = Array.isArray(body.ids) ? body.ids.map((id) => String(id)) : []
  if (!ids.length) return c.json({ error: '请选择要删除的内容' }, 400)
  const deleted = await deleteGenerations(getDb(), ids)
  return c.json({ ok: true, deleted }, 200, { 'Cache-Control': 'no-store' })
})

/** AiError → HTTP：客户端只拿到 code 与可展示文案，上游细节留在服务端日志。 */
function aiErrorResponse(c: Context, err: unknown) {
  if (err instanceof AiError) {
    const status = err.code === 'disabled' ? 503 : err.code === 'invalid' ? 422 : err.code === 'timeout' ? 504 : 502
    return c.json({ error: err.message, code: err.code }, status)
  }
  console.error('[ai]', err)
  return c.json({ error: 'AI 服务异常', code: 'upstream' }, 502)
}
