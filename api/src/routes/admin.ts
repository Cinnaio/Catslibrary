/**
 * /api/admin —— 管理后台路由：总览统计、紧凑书目索引、评论审核、举报处理。
 * 由 Novel-KV server/functions/api/admin/* 平移。
 */
import { Hono } from 'hono'
import { getDb } from '../db/pool'
import { all, first, run } from '../db/query'
import { rowToCommentAdmin, rowToCommentReport } from '../db/mappers'
import { cleanText, clampInt, escapeLike } from '../services/text'
import { requireAdmin, type AuthEnv } from '../middlewares/auth'

export const adminRoutes = new Hono<AuthEnv>()

adminRoutes.use('*', requireAdmin())

// ---------- 总览统计 ----------

adminRoutes.get('/stats', async (c) => {
  const db = getDb()
  const now = Date.now()
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const todayStart = start.getTime()

  const [novels, chapters, users, covers, failedJobs, todayChapters, running, completed, recentJobsRows, recentNovelsRows] = await Promise.all([
    count(db, 'SELECT COUNT(*)::int AS total FROM novels'),
    count(db, 'SELECT COUNT(*)::int AS total FROM chapters'),
    count(db, 'SELECT COUNT(*)::int AS total FROM users'),
    count(db, 'SELECT COUNT(*)::int AS total FROM novel_covers'),
    count(db, "SELECT COUNT(*)::int AS total FROM scrape_jobs WHERE status = 'failed'"),
    count(db, 'SELECT COUNT(*)::int AS total FROM chapters WHERE created_at >= $1', [todayStart]),
    count(db, "SELECT COUNT(*)::int AS total FROM scrape_jobs WHERE status IN ('starting', 'running')"),
    count(db, "SELECT COUNT(*)::int AS total FROM scrape_jobs WHERE status = 'completed'"),
    all<Record<string, unknown>>(
      db,
      `SELECT j.id, j.novel_id, j.status, j.step, j.current, j.total, j.chapter_count, j.progress, j.error, j.started_at, j.updated_at,
              n.title AS novel_title
       FROM scrape_jobs j
       LEFT JOIN novels n ON n.id = j.novel_id
       ORDER BY j.updated_at DESC
       LIMIT 6`,
    ),
    all<Record<string, unknown>>(
      db,
      `SELECT id, title, author, chapter_count, updated_at
       FROM novels
       ORDER BY updated_at DESC
       LIMIT 6`,
    ),
  ])

  return c.json(
    {
      totals: {
        novels,
        chapters,
        users,
        covers,
        failedJobs,
        todayChapters,
        dbSize: null,
      },
      jobStatus: { running, completed, failed: failedJobs },
      recentJobs: recentJobsRows.map(rowToJobSummary),
      recentNovels: recentNovelsRows.map((row) => ({
        id: String(row.id),
        title: String(row.title || ''),
        author: String(row.author || ''),
        chapterCount: Number(row.chapter_count) || 0,
        updatedAt: Number(row.updated_at) || 0,
      })),
    },
    200,
    { 'Cache-Control': 'no-store' },
  )
})

function rowToJobSummary(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    novelId: String(row.novel_id || ''),
    novelTitle: String(row.novel_title || ''),
    status: String(row.status || ''),
    step: String(row.step || ''),
    current: Number(row.current) || 0,
    total: Number(row.total) || 0,
    chapterCount: Number(row.chapter_count) || 0,
    progress: Number(row.progress) || 0,
    error: String(row.error || ''),
    startedAt: Number(row.started_at) || 0,
    updatedAt: Number(row.updated_at) || 0,
  }
}

// ---------- 紧凑书目索引 ----------

const NOVEL_INDEX_DEFAULT = 2000
const NOVEL_INDEX_MAX = 5000
const NOVEL_INDEX_SEARCH = 50

adminRoutes.get('/novel-index', async (c) => {
  const db = getDb()
  const q = (c.req.query('q') || '').trim()
  const limit = Math.min(Number.parseInt(c.req.query('limit') || String(NOVEL_INDEX_DEFAULT), 10) || NOVEL_INDEX_DEFAULT, NOVEL_INDEX_MAX)

  let rows: Array<Record<string, unknown>>
  if (q) {
    const like = `%${escapeLike(q.toLowerCase())}%`
    rows = await all<Record<string, unknown>>(
      db,
      `SELECT id, title, author, chapter_count, updated_at
       FROM novels
       WHERE LOWER(title) LIKE $1 OR LOWER(author) LIKE $2
       ORDER BY updated_at DESC
       LIMIT $3`,
      [like, like, NOVEL_INDEX_SEARCH],
    )
  } else {
    rows = await all<Record<string, unknown>>(
      db,
      `SELECT id, title, author, chapter_count, updated_at
       FROM novels
       ORDER BY updated_at DESC
       LIMIT $1`,
      [limit],
    )
  }

  return c.json(
    {
      novels: rows.map((r) => ({
        id: String(r.id),
        title: String(r.title || ''),
        author: String(r.author || ''),
        chapterCount: Number(r.chapter_count) || 0,
        updatedAt: Number(r.updated_at) || 0,
      })),
      capped: !q && rows.length >= limit,
    },
    200,
    { 'Cache-Control': 'no-store' },
  )
})

// ---------- 评论审核 ----------

adminRoutes.get('/comments', async (c) => {
  const db = getDb()
  const status = cleanText(c.req.query('status'), 20) || 'all'
  const search = cleanText(c.req.query('search'), 80)
  const novelId = cleanText(c.req.query('novelId'), 80)
  const userId = cleanText(c.req.query('userId'), 80)
  const limit = clampInt(c.req.query('limit'), 1, 100, 50)
  const offset = clampInt(c.req.query('offset'), 0, 100000, 0)

  const conditions: string[] = []
  const params: unknown[] = []
  if (status !== 'all') {
    params.push(status === 'hidden' ? 'hidden' : 'visible')
    conditions.push(`c.status = $${params.length}`)
  }
  if (search) {
    const like = `%${escapeLike(search)}%`
    params.push(like, like, like, like, like)
    conditions.push(
      `(c.comment_text LIKE $${params.length - 4} OR c.display_name LIKE $${params.length - 3} OR n.title LIKE $${params.length - 2} OR u.username LIKE $${params.length - 1} OR u.display_name LIKE $${params.length})`,
    )
  }
  if (novelId) {
    params.push(novelId)
    conditions.push(`c.novel_id = $${params.length}`)
  }
  if (userId) {
    params.push(userId)
    conditions.push(`c.user_id = $${params.length}`)
  }
  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''

  const totalRow = await first<{ total: number }>(
    db,
    `SELECT COUNT(*)::int AS total FROM novel_comments c
     LEFT JOIN novels n ON n.id = c.novel_id
     LEFT JOIN users u ON u.id = c.user_id
     ${where}`,
    params,
  )
  const rows = await all<Record<string, unknown>>(
    db,
    `SELECT c.*, n.title AS novel_title, u.username AS user_username,
            u.display_name AS user_display_name, u.updated_at AS user_updated_at
     FROM novel_comments c
     LEFT JOIN novels n ON n.id = c.novel_id
     LEFT JOIN users u ON u.id = c.user_id
     ${where}
     ORDER BY c.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  )
  return c.json({ comments: rows.map(rowToCommentAdmin).filter((x) => x !== null), total: totalRow?.total || 0, limit, offset })
})

adminRoutes.put('/comments', async (c) => {
  const db = getDb()
  const body = await c.req.json().catch(() => ({}))
  const id = cleanText(body.id, 80)
  const status = cleanText(body.status, 20)
  if (!id) return c.json({ error: 'id is required' }, 400)
  if (status !== 'visible' && status !== 'hidden') return c.json({ error: 'status must be visible or hidden' }, 400)
  const changed = await run(db, 'UPDATE novel_comments SET status = $1, updated_at = $2 WHERE id = $3', [status, Date.now(), id])
  if (!changed) return c.json({ error: 'Comment not found' }, 404)
  return c.json({ success: true, id, status })
})

adminRoutes.delete('/comments', async (c) => {
  const db = getDb()
  const id = cleanText(c.req.query('id'), 80)
  if (!id) return c.json({ error: 'id query parameter is required' }, 400)
  const changed = await run(db, 'DELETE FROM novel_comments WHERE id = $1', [id])
  if (!changed) return c.json({ error: 'Comment not found' }, 404)
  return c.json({ success: true, id, deleted: true })
})

// ---------- 评论举报 ----------

adminRoutes.get('/comment-reports', async (c) => {
  const db = getDb()
  const status = cleanText(c.req.query('status'), 20) || 'open'
  const reason = cleanText(c.req.query('reason'), 20)
  const limit = clampInt(c.req.query('limit'), 1, 100, 50)
  const offset = clampInt(c.req.query('offset'), 0, 100000, 0)

  const conditions: string[] = []
  const params: unknown[] = []
  if (status !== 'all') {
    params.push(status)
    conditions.push(`r.status = $${params.length}`)
  }
  if (reason && reason !== 'all') {
    params.push(reason)
    conditions.push(`r.reason = $${params.length}`)
  }
  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''

  const totalRow = await first<{ total: number }>(db, `SELECT COUNT(*)::int AS total FROM novel_comment_reports r ${where}`, params)
  const rows = await all<Record<string, unknown>>(
    db,
    `SELECT r.*, c.comment_text, c.status AS comment_status, c.novel_id AS comment_novel_id,
            c.display_name AS comment_author, n.title AS novel_title,
            ru.username AS reporter_username, ru.display_name AS reporter_display_name,
            au.username AS resolver_username
     FROM novel_comment_reports r
     LEFT JOIN novel_comments c ON c.id = r.comment_id
     LEFT JOIN novels n ON n.id = c.novel_id
     LEFT JOIN users ru ON ru.id = r.reported_by
     LEFT JOIN users au ON au.id = r.resolved_by
     ${where}
     ORDER BY r.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  )
  return c.json({ reports: rows.map(rowToCommentReport).filter((x) => x !== null), total: totalRow?.total || 0, limit, offset })
})

adminRoutes.put('/comment-reports', async (c) => {
  const db = getDb()
  const body = await c.req.json().catch(() => ({}))
  const user = c.get('user')
  const id = cleanText(body.id, 80)
  const status = cleanText(body.status, 20)
  const action = cleanText(body.action, 20) || 'none'
  if (!id) return c.json({ error: 'id is required' }, 400)
  if (status !== 'resolved' && status !== 'dismissed') return c.json({ error: 'status must be resolved or dismissed' }, 400)

  const report = await first<{ id: string; comment_id: string }>(db, 'SELECT id, comment_id FROM novel_comment_reports WHERE id = $1', [id])
  if (!report) return c.json({ error: 'Report not found' }, 404)

  if (action === 'hide') {
    await run(db, "UPDATE novel_comments SET status = 'hidden', updated_at = $1 WHERE id = $2", [Date.now(), report.comment_id])
  } else if (action === 'restore') {
    await run(db, "UPDATE novel_comments SET status = 'visible', updated_at = $1 WHERE id = $2", [Date.now(), report.comment_id])
  }
  await run(db, 'UPDATE novel_comment_reports SET status = $1, resolved_by = $2, resolved_at = $3 WHERE id = $4', [status, user.id, Date.now(), id])
  return c.json({ success: true, id, status, action })
})

// ---------- 内部辅助 ----------

async function count(db: ReturnType<typeof getDb>, sql: string, params: unknown[] = []): Promise<number> {
  const row = await first<{ total: number }>(db, sql, params)
  return Number(row?.total || 0)
}