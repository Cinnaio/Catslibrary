import { Hono } from 'hono'
import { getDb } from '../db/pool'
import { withTx } from '../db/query'
import { requireAdmin, type AuthEnv } from '../middlewares/auth'
import { clampInt } from '../services/text'
import {
  CONTENT_RATING_RULE_CANDIDATE_KINDS,
  createContentRatingRuleCandidate,
  isContentRatingRuleCandidateKind,
  listContentRatingRuleCandidates,
  previewContentRatingRuleCandidate,
  reviewContentRatingRuleCandidate,
  ContentRatingRuleCandidateConflictError,
  ContentRatingRuleCandidateNotFoundError,
  ContentRatingRuleCandidateSourceError,
  ContentRatingRuleCandidateValidationError,
  type ContentRatingRuleCandidateKind,
} from '../services/content-rating-rule-candidates'

export const contentRatingRuleCandidateRoutes = new Hono<AuthEnv>()

contentRatingRuleCandidateRoutes.use('*', requireAdmin())

contentRatingRuleCandidateRoutes.get('/', async (c) => {
  const limit = clampInt(c.req.query('limit'), 1, 100, 20)
  const offset = clampInt(c.req.query('offset'), 0, 1_000_000, 0)
  const result = await listContentRatingRuleCandidates(getDb(), {
    status: String(c.req.query('status') || '').trim(),
    kind: String(c.req.query('kind') || '').trim(),
    search: String(c.req.query('search') || '').trim(),
    limit,
    offset,
  })
  return c.json(
    {
      items: result.rows,
      total: result.total,
      limit,
      offset,
      counts: result.counts,
      kinds: [...CONTENT_RATING_RULE_CANDIDATE_KINDS],
      activeRuleVersion: result.activeRuleVersion,
    },
    200,
    { 'Cache-Control': 'no-store' },
  )
})

contentRatingRuleCandidateRoutes.get('/:id/preview', async (c) => {
  const id = String(c.req.param('id') || '').trim()
  if (!id || id.includes('/')) return c.json({ error: 'Invalid rule candidate ID' }, 400)
  try {
    const result = await previewContentRatingRuleCandidate(getDb(), id, {
      limit: clampInt(c.req.query('limit'), 1, 100, 20),
      offset: clampInt(c.req.query('offset'), 0, 1_000_000, 0),
    })
    return c.json(result, 200, { 'Cache-Control': 'no-store' })
  } catch (error) {
    if (error instanceof ContentRatingRuleCandidateNotFoundError) return c.json({ error: error.message, code: error.code }, 404)
    throw error
  }
})

contentRatingRuleCandidateRoutes.post('/:id/review', async (c) => {
  const candidateId = String(c.req.param('id') || '').trim()
  if (!candidateId || candidateId.includes('/')) return c.json({ error: 'Invalid rule candidate ID' }, 400)
  const body = await c.req.json().catch(() => ({}))
  try {
    const result = await withTx(getDb(), (query) =>
      reviewContentRatingRuleCandidate(query, {
        candidateId,
        decision: body.decision,
        expectedRevision: Number(body.expectedRevision),
        reason: String(body.reason || ''),
        actorUserId: c.get('user').id,
      }),
    )
    return c.json({ ok: true, ...result }, 200, { 'Cache-Control': 'no-store' })
  } catch (error) {
    if (error instanceof ContentRatingRuleCandidateNotFoundError) return c.json({ error: error.message, code: error.code }, 404)
    if (error instanceof ContentRatingRuleCandidateValidationError) return c.json({ error: error.message, code: error.code }, 422)
    if (error instanceof ContentRatingRuleCandidateConflictError) return c.json({ error: error.message, code: error.code }, 409)
    throw error
  }
})

contentRatingRuleCandidateRoutes.post('/', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const kind = body.kind as ContentRatingRuleCandidateKind
  if (!isContentRatingRuleCandidateKind(kind)) {
    return c.json({ error: 'kind must be category or phrase', code: 'rule_candidate_invalid' }, 422)
  }

  try {
    const result = await withTx(getDb(), (query) =>
      createContentRatingRuleCandidate(query, {
        novelId: String(body.novelId || ''),
        kind,
        value: String(body.value || ''),
        reason: String(body.reason || ''),
        actorUserId: c.get('user').id,
      }),
    )
    return c.json({ ok: true, ...result }, result.created ? 201 : 200, { 'Cache-Control': 'no-store' })
  } catch (error) {
    if (error instanceof ContentRatingRuleCandidateValidationError || error instanceof ContentRatingRuleCandidateSourceError) {
      return c.json({ error: error.message, code: error.code }, 422)
    }
    if (error instanceof ContentRatingRuleCandidateConflictError) {
      return c.json({ error: error.message, code: error.code }, 409)
    }
    throw error
  }
})
