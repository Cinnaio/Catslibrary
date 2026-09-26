import { Hono } from 'hono'
import { getDb } from '../db/pool'
import { withTx } from '../db/query'
import { requireAdmin, type AuthEnv } from '../middlewares/auth'
import { clampInt } from '../services/text'
import { isTextAiConfigured } from '../services/ai/client'
import { getAiTask } from '../services/ai/tasks'
import {
  listContentRatingAiSuggestions,
  parseContentRatingAiTaskParams,
  resumeContentRatingAiReview,
  reviewContentRatingAiSuggestion,
  selectContentRatingAiResumeTargets,
  startContentRatingAiReview,
  ContentRatingAiConflictError,
  ContentRatingAiNotFoundError,
  ContentRatingAiValidationError,
} from '../services/content-rating-ai'

export const contentRatingAiRoutes = new Hono<AuthEnv>()

contentRatingAiRoutes.use('*', requireAdmin())

contentRatingAiRoutes.get('/', async (c) => {
  const result = await listContentRatingAiSuggestions(getDb(), {
    status: String(c.req.query('status') || '').trim(),
    search: String(c.req.query('search') || '').trim(),
    limit: clampInt(c.req.query('limit'), 1, 100, 20),
    offset: clampInt(c.req.query('offset'), 0, 1_000_000, 0),
  })
  return c.json(result, 200, { 'Cache-Control': 'no-store' })
})

contentRatingAiRoutes.post('/scan', async (c) => {
  if (!isTextAiConfigured()) return c.json({ error: 'AI 文本服务未配置', code: 'disabled' }, 503)
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const novelIds = Array.isArray(body.novelIds)
    ? body.novelIds
        .map((id) => String(id || '').trim())
        .filter(Boolean)
        .slice(0, 100)
    : undefined
  try {
    // body.limit 来自 JSON，可能是 number 也可能是 string；clampInt 只收字符串，
    // 直接传 unknown 会在类型层失败，传 number 又会被静默忽略，故先归一为字符串。
    const rawLimit = body.limit
    const limit = clampInt(rawLimit === undefined || rawLimit === null ? undefined : String(rawLimit), 1, 100, 20)
    const result = await startContentRatingAiReview(getDb(), {
      novelIds,
      limit,
      actorUserId: c.get('user').id,
    })
    if (!result.taskId)
      return c.json({ ok: true, taskId: '', selected: 0, total: 0, message: '没有可分析的 unknown 作品' }, 200, { 'Cache-Control': 'no-store' })
    const task = await getAiTask(getDb(), result.taskId)
    return c.json({ ok: true, ...result, task }, 202, { 'Cache-Control': 'no-store' })
  } catch (error) {
    if (error instanceof ContentRatingAiValidationError) return c.json({ error: error.message, code: error.code }, 422)
    throw error
  }
})

/**
 * 批次进度：按任务 params 里的全量目标统计「已处理 / 剩余缺口」。
 * 前端据此渲染进度条，并在任务中断后决定「断点恢复」按钮是否可用。
 */
contentRatingAiRoutes.get('/tasks/:id/progress', async (c) => {
  const taskId = String(c.req.param('id') || '').trim()
  if (!taskId || taskId.includes('/')) return c.json({ error: 'Invalid task ID' }, 400)
  const db = getDb()
  const task = await getAiTask(db, taskId)
  if (!task) return c.json({ error: '任务不存在' }, 404)
  const params = parseContentRatingAiTaskParams(task.params)
  if (!params) return c.json({ error: '任务未记录目标列表', code: 'content_rating_ai_invalid' }, 422)
  const remaining = await selectContentRatingAiResumeTargets(db, params)
  const done = Math.max(0, params.novelIds.length - remaining.length)
  const active = task.status === 'queued' || task.status === 'running'
  return c.json(
    {
      task,
      total: params.novelIds.length,
      done,
      remaining: remaining.length,
      // 只有任务已经停下（失败/取消）却仍有缺口时，恢复才是有意义的动作。
      canResume: !active && remaining.length > 0,
      resumable: remaining.length > 0,
      promptVersion: params.promptVersion,
    },
    200,
    { 'Cache-Control': 'no-store' },
  )
})

/**
 * 断点恢复：跳过已有终态建议的作品，只补未分析/失败的部分。
 * 原任务记录保留为 failed/cancelled，新任务带 resumedFrom 指向它。
 */
contentRatingAiRoutes.post('/tasks/:id/resume', async (c) => {
  const taskId = String(c.req.param('id') || '').trim()
  if (!taskId || taskId.includes('/')) return c.json({ error: 'Invalid task ID' }, 400)
  try {
    const result = await resumeContentRatingAiReview(getDb(), { sourceTaskId: taskId, actorUserId: c.get('user').id })
    if (!result.taskId) {
      return c.json({ ok: true, taskId: '', selected: 0, total: 0, skipped: result.skipped, message: '没有需要补跑的作品，批次已完成' }, 200, {
        'Cache-Control': 'no-store',
      })
    }
    const task = await getAiTask(getDb(), result.taskId)
    return c.json({ ok: true, ...result, task }, 202, { 'Cache-Control': 'no-store' })
  } catch (error) {
    if (error instanceof ContentRatingAiNotFoundError) return c.json({ error: error.message, code: error.code }, 404)
    if (error instanceof ContentRatingAiValidationError) return c.json({ error: error.message, code: error.code }, 422)
    throw error
  }
})

contentRatingAiRoutes.post('/:id/review', async (c) => {
  const suggestionId = String(c.req.param('id') || '').trim()
  if (!suggestionId || suggestionId.includes('/')) return c.json({ error: 'Invalid suggestion ID' }, 400)
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  try {
    const result = await withTx(getDb(), (query) =>
      reviewContentRatingAiSuggestion(query, {
        suggestionId,
        decision: body.decision as 'approve' | 'reject',
        expectedRevision: Number(body.expectedRevision),
        reason: String(body.reason || ''),
        actorUserId: c.get('user').id,
      }),
    )
    return c.json({ ok: true, ...result }, 200, { 'Cache-Control': 'no-store' })
  } catch (error) {
    if (error instanceof ContentRatingAiNotFoundError) return c.json({ error: error.message, code: error.code }, 404)
    if (error instanceof ContentRatingAiValidationError) return c.json({ error: error.message, code: error.code }, 422)
    if (error instanceof ContentRatingAiConflictError) return c.json({ error: error.message, code: error.code }, 409)
    throw error
  }
})
