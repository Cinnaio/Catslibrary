/**
 * /api/ratings —— 小说星级评分（由 Novel-KV ratings.js 平移）。
 */
import { Hono, type Context } from 'hono'
import { getDb } from '../db/pool'
import { all, first, run } from '../db/query'
import { newId } from '../services/auth'
import { cleanText } from '../services/text'
import { optionalUser, requireUser, type AuthEnv } from '../middlewares/auth'

export const ratingsRoutes = new Hono<AuthEnv>()

ratingsRoutes.get('/', optionalUser(), async (c) => {
  const db = getDb()
  const novelId = cleanText(c.req.query('novelId'), 80)
  if (!novelId) return c.json({ error: 'novelId query parameter is required' }, 400)
  const exists = await first<{ id: string }>(db, 'SELECT id FROM novels WHERE id = $1', [novelId])
  if (!exists) return c.json({ error: 'Novel not found' }, 404)
  return ratingSummary(c, novelId, c.get('user')?.id)
})

ratingsRoutes.post('/', requireUser(), async (c) => {
  const db = getDb()
  const user = c.get('user')
  const body = await c.req.json().catch(() => ({}))
  const novelId = cleanText(body.novelId, 80)
  const rating = Number(body.rating)
  if (!novelId) return c.json({ error: 'novelId is required' }, 400)
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return c.json({ error: '评分必须是 1 到 5 星' }, 400)

  const exists = await first<{ id: string }>(db, 'SELECT id FROM novels WHERE id = $1', [novelId])
  if (!exists) return c.json({ error: 'Novel not found' }, 404)

  const now = Date.now()
  const existing = await first<{ id: string; created_at: number }>(
    db,
    'SELECT id, created_at FROM novel_ratings WHERE novel_id = $1 AND user_id = $2',
    [novelId, user.id],
  )
  if (existing) {
    await run(db, 'UPDATE novel_ratings SET rating = $1, updated_at = $2 WHERE id = $3', [rating, now, existing.id])
  } else {
    await run(db, 'INSERT INTO novel_ratings (id, novel_id, user_id, rating, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)', [newId('rating'), novelId, user.id, rating, now, now])
  }
  return ratingSummary(c, novelId, user.id)
})

ratingsRoutes.delete('/', requireUser(), async (c) => {
  const db = getDb()
  const user = c.get('user')
  const novelId = cleanText(c.req.query('novelId'), 80)
  if (!novelId) return c.json({ error: 'novelId query parameter is required' }, 400)
  await run(db, 'DELETE FROM novel_ratings WHERE novel_id = $1 AND user_id = $2', [novelId, user.id])
  return ratingSummary(c, novelId, undefined)
})

async function ratingSummary(c: Context<AuthEnv>, novelId: string, userId: string | undefined) {
  const db = getDb()
  const rows = await all<{ rating: number; total: number }>(
    db,
    'SELECT rating, COUNT(*)::int AS total FROM novel_ratings WHERE novel_id = $1 GROUP BY rating',
    [novelId],
  )
  const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  let count = 0
  let sum = 0
  for (const row of rows) {
    const rating = Number(row.rating)
    const total = Number(row.total || 0)
    if (rating >= 1 && rating <= 5) {
      distribution[rating] = total
      count += total
      sum += rating * total
    }
  }

  let myRating: number | null = null
  if (userId) {
    const mine = await first<{ rating: number }>(db, 'SELECT rating FROM novel_ratings WHERE novel_id = $1 AND user_id = $2', [novelId, userId])
    myRating = mine ? mine.rating : null
  }

  return c.json({ novelId, average: count ? Math.round((sum / count) * 10) / 10 : 0, count, distribution, myRating })
}