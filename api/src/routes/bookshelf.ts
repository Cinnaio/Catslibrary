/**
 * /api/bookshelf —— 书架/最近阅读/我的段评 汇总（由 Novel-KV bookshelf.js 平移）。
 */
import { Hono } from 'hono'
import { getDb } from '../db/pool'
import { all, run } from '../db/query'
import { rowToThoughtAdmin } from '../db/mappers'
import { requireUser, type AuthEnv } from '../middlewares/auth'
import { contentPolicyHeaders, restrictedContentResponse, resolveContentAccess } from '../services/content-access'

export const bookshelfRoutes = new Hono<AuthEnv>()

bookshelfRoutes.get('/', requireUser(), async (c) => {
  const db = getDb()
  const userId = c.get('user').id
  const access = await resolveContentAccess(c)
  const ratingFilter = access.canViewRestricted ? '' : " AND COALESCE(n.content_rating, 'unknown') <> 'restricted'"

  const [favRows, recentRows, thoughtRows] = await Promise.all([
    all<Record<string, unknown>>(
      db,
      `SELECT b.novel_id, b.created_at, b.updated_at,
              n.title, n.author, n.description, n.status, n.chapter_count, n.remote_chapter_count,
              n.updated_at AS novel_updated_at,
              rp.chapter_id, rp.scroll_percent, rp.updated_at AS progress_updated_at,
              c.title AS chapter_title, c.sort_order AS chapter_order
       FROM user_bookshelf b
       JOIN novels n ON n.id = b.novel_id
       LEFT JOIN reading_progress rp ON rp.user_id = b.user_id AND rp.novel_id = b.novel_id AND COALESCE(rp.deleted_at, 0) = 0
       LEFT JOIN chapters c ON c.id = rp.chapter_id
       WHERE b.user_id = $1${ratingFilter}
       ORDER BY b.updated_at DESC
       LIMIT 50`,
      [userId],
    ),
    all<Record<string, unknown>>(
      db,
      `SELECT rp.novel_id, rp.chapter_id, rp.scroll_percent, rp.updated_at,
              n.title AS novel_title, c.title AS chapter_title, c.sort_order AS chapter_order
       FROM reading_progress rp
       LEFT JOIN novels n ON n.id = rp.novel_id
       LEFT JOIN chapters c ON c.id = rp.chapter_id
       WHERE rp.user_id = $1 AND COALESCE(rp.deleted_at, 0) = 0${ratingFilter}
       ORDER BY rp.updated_at DESC
       LIMIT 10`,
      [userId],
    ),
    all<Record<string, unknown>>(
      db,
      `SELECT t.*, n.title AS novel_title, c.title AS chapter_title,
              u.username AS user_username, u.display_name AS user_display_name
       FROM thoughts t
       LEFT JOIN novels n ON n.id = t.novel_id
       LEFT JOIN chapters c ON c.id = t.chapter_id
       LEFT JOIN users u ON u.id = t.user_id
       WHERE t.user_id = $1 AND t.status = 'visible'${ratingFilter}
       ORDER BY t.created_at DESC
       LIMIT 20`,
      [userId],
    ),
  ])

  return c.json({
    favorites: favRows.map(rowToFavorite).filter(Boolean),
    recent: recentRows.map(rowToRecent).filter(Boolean),
    thoughts: thoughtRows.map(rowToThoughtAdmin).filter(Boolean),
  }, 200, contentPolicyHeaders())
})

bookshelfRoutes.post('/', requireUser(), async (c) => {
  const db = getDb()
  const userId = c.get('user').id
  const body = await c.req.json().catch(() => ({}))
  const novelId = cleanId(body.novelId)
  if (!novelId) return c.json({ error: 'novelId is required' }, 400)
  const novel = await all<{ id: string; content_rating: string }>(db, 'SELECT id, content_rating FROM novels WHERE id = $1', [novelId])
  if (!novel.length) return c.json({ error: '小说不存在' }, 404)
  if (novel[0]!.content_rating === 'restricted') {
    const access = await resolveContentAccess(c)
    if (!access.canViewRestricted) return restrictedContentResponse(c, access.reason)
  }
  const now = Date.now()
  await db.query(
    `INSERT INTO user_bookshelf (user_id, novel_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, novel_id) DO UPDATE SET updated_at = EXCLUDED.updated_at`,
    [userId, novelId, now, now],
  )
  return c.json({ success: true, novelId })
})

bookshelfRoutes.delete('/', requireUser(), async (c) => {
  const db = getDb()
  const userId = c.get('user').id
  const novelId = cleanId(c.req.query('novelId'))
  if (!novelId) return c.json({ error: 'novelId is required' }, 400)
  await run(db, 'DELETE FROM user_bookshelf WHERE user_id = $1 AND novel_id = $2', [userId, novelId])
  return c.json({ success: true, novelId })
})

function rowToFavorite(row: Record<string, unknown>) {
  return {
    novelId: String(row.novel_id),
    title: String(row.title || ''),
    author: String(row.author || ''),
    description: String(row.description || ''),
    status: String(row.status || 'ongoing'),
    chapterCount: Number(row.chapter_count) || 0,
    remoteChapterCount: Number(row.remote_chapter_count) || 0,
    updatedAt: Number(row.updated_at) || 0,
    novelUpdatedAt: Number(row.novel_updated_at) || 0,
    chapterId: String(row.chapter_id || ''),
    chapterTitle: String(row.chapter_title || ''),
    chapterOrder: Number(row.chapter_order) || 0,
    scrollPercent: Number(row.scroll_percent) || 0,
    progressUpdatedAt: Number(row.progress_updated_at) || 0,
  }
}

function rowToRecent(row: Record<string, unknown>) {
  return {
    novelId: String(row.novel_id),
    novelTitle: String(row.novel_title || ''),
    chapterId: String(row.chapter_id),
    chapterTitle: String(row.chapter_title || ''),
    chapterOrder: Number(row.chapter_order) || 0,
    scrollPercent: Number(row.scroll_percent) || 0,
    timestamp: Number(row.updated_at) || 0,
    updatedAt: Number(row.updated_at) || 0,
  }
}

function cleanId(value: unknown): string {
  return String(value || '').trim().slice(0, 80)
}
