import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { requireUser, type AuthEnv } from '../middlewares/auth'
import { getDb } from '../db/pool'
import { contentPolicyHeaders, resolveContentAccess } from '../services/content-access'
import { aggregateReading, type StatEvent } from '../services/reading-stats'
import { checkContentRate } from '../services/content-rate-limit'
import type { ReadingEvent } from '@shared/reading-stats'

export const readingStatsRoutes = new Hono<AuthEnv>()
readingStatsRoutes.use('*', requireUser(), bodyLimit({ maxSize: 32 * 1024 }))
readingStatsRoutes.use('*', async (c, next) => {
  const limited = await checkContentRate(c, 'reading-stats')
  if (limited) return limited
  return next()
})
readingStatsRoutes.post('/events', async (c) => {
  const body = await c.req.json().catch(() => null)
  const events: ReadingEvent[] = body?.events
  const now = Date.now()
  if (
    !Array.isArray(events) ||
    events.length < 1 ||
    events.length > 60 ||
    events.some(
      (e) =>
        !e ||
        ![e.id, e.sessionId, e.novelId, e.chapterId].every((v) => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(v)) ||
        !Number.isSafeInteger(e.start) ||
        !Number.isSafeInteger(e.end) ||
        e.end <= e.start ||
        e.end - e.start > 35000 ||
        e.start < now - 7 * 86400000 ||
        e.end > now + 5000,
    )
  )
    return c.json({ error: '阅读记录无效或已过期' }, 400)
  const userId = c.get('user').id
  if (body.userId !== userId) return c.json({ error: '账号已变化' }, 409)
  const access = await resolveContentAccess(c)
  const allowRestricted = access.canViewRestricted && c.req.query('contentMode') !== 'safe'
  const db = getDb()
  const chapterIds = [...new Set(events.map((e) => e.chapterId))]
  const { rows } = await db.query<{ id: string; novel_id: string; content_rating: string }>(
    `SELECT ch.id,ch.novel_id,n.content_rating FROM chapters ch JOIN novels n ON n.id=ch.novel_id
     WHERE ch.id=ANY($1::text[]) AND ($2 OR COALESCE(n.content_rating,'unknown')<>'restricted')`,
    [chapterIds, allowRestricted],
  )
  const valid = new Map(rows.map((r) => [r.id, r]))
  // Inaccessible/deleted records are acknowledged but never persisted, so a stale offline queue can drain.
  const accepted = events
    .filter((e) => valid.get(e.chapterId)?.novel_id === e.novelId)
    .map((e) => ({ ...e, contentRating: valid.get(e.chapterId)!.content_rating }))
  if (accepted.length) {
    await db.query(
      `INSERT INTO reading_stat_events(user_id,id,session_id,novel_id,chapter_id,started_at,ended_at,created_at,content_rating)
       SELECT $1, e->>'id', e->>'sessionId', e->>'novelId', e->>'chapterId',
              (e->>'start')::bigint,(e->>'end')::bigint,$3,e->>'contentRating'
       FROM jsonb_array_elements($2::jsonb) e ON CONFLICT(user_id,id) DO NOTHING`,
      [userId, JSON.stringify(accepted), now],
    )
  }
  return c.json({ success: true }, 200, contentPolicyHeaders())
})
readingStatsRoutes.get('/', async (c) => {
  const now = Date.now()
  const start = Number(c.req.query('start') || 0),
    end = Math.min(Number(c.req.query('end') || now), now)
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || start > now)
    return c.json({ error: '请选择有效的日期范围' }, 400)
  const access = await resolveContentAccess(c)
  const allowed = access.canViewRestricted && c.req.query('contentMode') !== 'safe'
  const db = getDb(),
    userId = c.get('user').id
  const first = await db.query<{ first: string | null }>(
    `SELECT MIN(e.started_at) AS first FROM reading_stat_events e LEFT JOIN novels n ON n.id=e.novel_id
     WHERE e.user_id=$1 AND ($2 OR COALESCE(n.content_rating,e.content_rating,'unknown')<>'restricted')`,
    [userId, allowed],
  )
  const recordedSince = first.rows[0]?.first == null ? null : Number(first.rows[0].first)
  // Include full matching sessions for the 30s qualification, even at calendar boundaries.
  const { rows } = await db.query<StatEvent>(
    `SELECT e.id,e.session_id AS "sessionId",e.novel_id AS "novelId",e.chapter_id AS "chapterId",
      e.started_at AS start,e.ended_at AS end,COALESCE(n.title,'已删除作品') AS title,(n.id IS NOT NULL) AS available FROM reading_stat_events e LEFT JOIN novels n ON n.id=e.novel_id
     WHERE e.user_id=$1 AND ($4 OR COALESCE(n.content_rating,e.content_rating,'unknown')<>'restricted')
       AND e.session_id IN (SELECT session_id FROM reading_stat_events WHERE user_id=$1 AND ended_at>$2 AND started_at<$3)
     ORDER BY e.started_at`,
    [userId, start, end, allowed],
  )
  const events = rows.map((e) => ({ ...e, start: Number(e.start), end: Number(e.end) }))
  return c.json(aggregateReading(events, start || recordedSince || now, end, recordedSince), 200, contentPolicyHeaders())
})
