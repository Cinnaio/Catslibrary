import { Hono } from 'hono'
import { getDb } from '../db/pool'
import { all, first, withTx } from '../db/query'
import { requireAdmin, type AuthEnv } from '../middlewares/auth'
import {
  applyContentRatingChange,
  CONTENT_RATING_SOURCES,
  ContentRatingConflictError,
  isContentRatingSource,
  parseContentRatingEvidence,
} from '../services/content-rating-governance'
import { toContentRating } from '../db/mappers'
import { clampInt, escapeLike } from '../services/text'
import { newId } from '../services/auth'

export const contentRatingRoutes = new Hono<AuthEnv>()

contentRatingRoutes.use('*', requireAdmin())

interface ContentRatingListRow {
  id: string
  title: string
  author: string
  content_rating: string
  content_rating_revision: number
  content_rating_source: string
  content_rating_reason: string
  content_rating_evidence: string
  content_rating_rule_version: string
  content_rating_updated_by: string
  content_rating_updated_at: number
  content_rating_operation_id: string
  chapter_count: number
  updated_at: number
  actor_username?: string
  actor_display_name?: string
}

interface ContentRatingAuditRow {
  id: string
  novel_id: string
  from_rating: string
  to_rating: string
  source: string
  reason: string
  evidence: string
  rule_version: string
  operation_id: string
  actor_user_id: string
  created_at: number
  actor_username?: string
  actor_display_name?: string
}

function ratingItem(row: ContentRatingListRow) {
  return {
    id: String(row.id),
    title: String(row.title || ''),
    author: String(row.author || ''),
    contentRating: toContentRating(row.content_rating),
    revision: Number(row.content_rating_revision) || 0,
    source: isContentRatingSource(row.content_rating_source) ? row.content_rating_source : 'legacy',
    reason: String(row.content_rating_reason || ''),
    evidence: parseContentRatingEvidence(row.content_rating_evidence),
    ruleVersion: String(row.content_rating_rule_version || ''),
    updatedBy: String(row.content_rating_updated_by || ''),
    updatedByName: String(row.actor_display_name || row.actor_username || row.content_rating_updated_by || '系统'),
    contentRatingUpdatedAt: Number(row.content_rating_updated_at) || 0,
    operationId: String(row.content_rating_operation_id || ''),
    chapterCount: Number(row.chapter_count) || 0,
    updatedAt: Number(row.updated_at) || 0,
  }
}

function auditItem(row: ContentRatingAuditRow) {
  return {
    id: String(row.id),
    novelId: String(row.novel_id),
    fromRating: toContentRating(row.from_rating),
    toRating: toContentRating(row.to_rating),
    source: isContentRatingSource(row.source) ? row.source : 'system',
    reason: String(row.reason || ''),
    evidence: parseContentRatingEvidence(row.evidence),
    ruleVersion: String(row.rule_version || ''),
    operationId: String(row.operation_id || ''),
    actorUserId: String(row.actor_user_id || ''),
    actorName: String(row.actor_display_name || row.actor_username || row.actor_user_id || '系统'),
    createdAt: Number(row.created_at) || 0,
  }
}

contentRatingRoutes.get('/', async (c) => {
  const db = getDb()
  const rawRating = String(c.req.query('rating') || '').trim()
  const rating = rawRating === 'general' || rawRating === 'restricted' || rawRating === 'unknown' ? rawRating : ''
  const rawSource = String(c.req.query('source') || '').trim()
  const source = isContentRatingSource(rawSource) ? rawSource : ''
  const search = String(c.req.query('search') || '')
    .trim()
    .slice(0, 120)
  const limit = clampInt(c.req.query('limit'), 1, 100, 25)
  const offset = clampInt(c.req.query('offset'), 0, 1_000_000, 0)

  const conditions: string[] = []
  const params: unknown[] = []
  if (rating) {
    params.push(rating)
    conditions.push(`n.content_rating = $${params.length}`)
  }
  if (source) {
    params.push(source)
    conditions.push(`n.content_rating_source = $${params.length}`)
  }
  if (search) {
    const like = `%${escapeLike(search.toLowerCase())}%`
    params.push(like, like, like)
    conditions.push(
      `(LOWER(n.title) LIKE $${params.length - 2} OR LOWER(n.author) LIKE $${params.length - 1} OR LOWER(n.content_rating_reason) LIKE $${params.length})`,
    )
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const totalRow = await first<{ total: number }>(db, `SELECT COUNT(*)::int AS total FROM novels n ${where}`, params)
  const rows = await all<ContentRatingListRow>(
    db,
    `SELECT n.id, n.title, n.author, n.content_rating, n.content_rating_revision,
            n.content_rating_source, n.content_rating_reason, n.content_rating_evidence,
            n.content_rating_rule_version, n.content_rating_updated_by, n.content_rating_updated_at,
            n.content_rating_operation_id, n.chapter_count, n.updated_at,
            u.username AS actor_username, u.display_name AS actor_display_name
       FROM novels n
       LEFT JOIN users u ON u.id = n.content_rating_updated_by
       ${where}
      ORDER BY n.content_rating_updated_at DESC NULLS LAST, n.updated_at DESC, n.title ASC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  )
  const countRows = await all<{ content_rating: string; count: number }>(
    db,
    'SELECT content_rating, COUNT(*)::int AS count FROM novels GROUP BY content_rating',
  )
  const counts = { general: 0, restricted: 0, unknown: 0 }
  for (const row of countRows) counts[toContentRating(row.content_rating)] += Number(row.count) || 0

  return c.json(
    {
      items: rows.map(ratingItem),
      total: Number(totalRow?.total) || 0,
      limit,
      offset,
      counts,
      sources: [...CONTENT_RATING_SOURCES],
    },
    200,
    { 'Cache-Control': 'no-store' },
  )
})

contentRatingRoutes.get('/:id/history', async (c) => {
  const id = String(c.req.param('id') || '').trim()
  if (!id || id.includes('/')) return c.json({ error: 'Invalid novel ID' }, 400)
  const exists = await first<{ id: string }>(getDb(), 'SELECT id FROM novels WHERE id = $1', [id])
  if (!exists) return c.json({ error: 'Novel not found' }, 404)
  const rows = await all<ContentRatingAuditRow>(
    getDb(),
    `SELECT a.id, a.novel_id, a.from_rating, a.to_rating, a.source, a.reason, a.evidence,
            a.rule_version, a.operation_id, a.actor_user_id, a.created_at,
            u.username AS actor_username, u.display_name AS actor_display_name
       FROM novel_content_rating_audit a
       LEFT JOIN users u ON u.id = a.actor_user_id
      WHERE a.novel_id = $1
      ORDER BY a.created_at DESC
      LIMIT 100`,
    [id],
  )
  return c.json({ history: rows.map(auditItem) }, 200, { 'Cache-Control': 'no-store' })
})

contentRatingRoutes.put('/:id', async (c) => {
  const db = getDb()
  const id = String(c.req.param('id') || '').trim()
  if (!id || id.includes('/')) return c.json({ error: 'Invalid novel ID' }, 400)
  const body = await c.req.json().catch(() => ({}))
  const rating = body.contentRating
  if (rating !== 'general' && rating !== 'restricted' && rating !== 'unknown') {
    return c.json({ error: 'contentRating must be general, restricted, or unknown' }, 422)
  }
  const reason = String(body.reason || '')
    .replace(/[\x00-\x1F\x7F]/g, '')
    .trim()
    .slice(0, 500)
  if (!reason) return c.json({ error: '修改分级必须填写理由' }, 422)
  const expectedRevision = Number(body.expectedRevision)
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    return c.json({ error: 'expectedRevision is required' }, 422)
  }

  try {
    const result = await withTx(db, async (query) => {
      await applyContentRatingChange(query, {
        novelId: id,
        rating,
        source: 'manual',
        actorUserId: c.get('user').id,
        reason,
        evidence: body.evidence,
        ruleVersion: '',
        operationId: newId('rating-manual'),
        expectedRevision,
      })
      const row = await query<ContentRatingListRow>(
        `SELECT n.id, n.title, n.author, n.content_rating, n.content_rating_revision,
                n.content_rating_source, n.content_rating_reason, n.content_rating_evidence,
                n.content_rating_rule_version, n.content_rating_updated_by, n.content_rating_updated_at,
                n.content_rating_operation_id, n.chapter_count, n.updated_at,
                u.username AS actor_username, u.display_name AS actor_display_name
           FROM novels n LEFT JOIN users u ON u.id = n.content_rating_updated_by
          WHERE n.id = $1`,
        [id],
      )
      return row.rows[0]
    })
    if (!result) return c.json({ error: 'Novel not found' }, 404)
    return c.json({ item: ratingItem(result) })
  } catch (err) {
    if (err instanceof ContentRatingConflictError) {
      return c.json({ error: err.message, code: 'content_rating_conflict', currentRevision: err.currentRevision, currentRating: err.currentRating }, 409)
    }
    if ((err as Error).message === 'Novel not found') return c.json({ error: 'Novel not found' }, 404)
    throw err
  }
})
