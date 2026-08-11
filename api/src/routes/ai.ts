/**
 * /api/ai —— AI 能力入口。
 * 读者侧：GET /status（能力探测）、POST /recap（章节前情提要，先查缓存再计配额）。
 * 管理侧：GET|PUT /settings、POST /test（连通性自检）、GET /usage（用量统计）。
 */
import { Hono, type Context } from 'hono'
import { getDb } from '../db/pool'
import { first } from '../db/query'
import { AiError, chat, isTextAiConfigured, providerLabel, textProvider } from '../services/ai/client'
import { getAiSettings, saveAiSettings } from '../services/ai/settings'
import { generateRecap, getCachedRecap, loadChapterForRecap } from '../services/ai/summary'
import { generateCatchup, getCachedCatchup, inspectCatchup } from '../services/ai/catchup'
import { invalidateChapter } from '../services/ai/generations'
import { checkQuota, recordUsage, startOfToday, summarizeUsage } from '../services/ai/usage'
import { optionalUser, requireAdmin, requireUser, type AuthEnv } from '../middlewares/auth'

export const aiRoutes = new Hono<AuthEnv>()

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
      features: { recap: configured && settings.recapEnabled && !!user, catchup: configured && settings.recapEnabled && !!user },
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
  if (!settings.recapEnabled) return c.json({ error: 'AI 前情提要已关闭', code: 'disabled' }, 403)
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
    const result = await generateCatchup(db, { userId: user.id, novelId, source: inspection.source })
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
    })
    return c.json({ ok: true, model: res.model, reply: res.text.slice(0, 100), elapsedMs: Date.now() - startedAt })
  } catch (err) {
    const aiErr = err instanceof AiError ? err : new AiError('upstream', 'AI 请求失败')
    return c.json({ ok: false, error: aiErr.message, code: aiErr.code, elapsedMs: Date.now() - startedAt }, 200)
  }
})

aiRoutes.get('/usage', requireAdmin(), async (c) => {
  const db = getDb()
  const today = startOfToday()
  const [todayUsage, last30d] = await Promise.all([summarizeUsage(db, today), summarizeUsage(db, today - 29 * 86_400_000)])
  return c.json({ today: todayUsage, last30d }, 200, { 'Cache-Control': 'no-store' })
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
