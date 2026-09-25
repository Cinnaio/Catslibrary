import { Hono } from 'hono'
import { getDb } from '../db/pool'
import { withTx } from '../db/query'
import { requireAdmin, type AuthEnv } from '../middlewares/auth'
import { clampInt } from '../services/text'
import { isTextAiConfigured } from '../services/ai/client'
import { getAiTask } from '../services/ai/tasks'
import {
  listContentRatingAiSuggestions,
  reviewContentRatingAiSuggestion,
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
    const result = await startContentRatingAiReview(getDb(), {
      novelIds,
      limit: clampInt(body.limit, 1, 100, 20),
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
