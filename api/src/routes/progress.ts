/**
 * /api/progress —— 阅读进度同步（由 Novel-KV progress.js 平移）。
 * 匿名用户 POST/DELETE 返回 success:true 但不落库；登录用户按 userId 记录。
 */
import { Hono, type Context } from 'hono'
import { getDb } from '../db/pool'
import { first } from '../db/query'
import { optionalUser, type AuthEnv } from '../middlewares/auth'

export const progressRoutes = new Hono<AuthEnv>()

interface ProgressRow {
  novel_id: string
  chapter_id: string
  scroll_percent: number
  updated_at: number
  deleted_at: number
}

interface ProgressState {
  progress: { novelId: string; chapterId: string; scrollPercent: number; updatedAt: number } | null
  tombstone: { novelId: string; deletedAt: number; updatedAt: number } | null
}

function stateResponse(row: ProgressRow | undefined): ProgressState {
  if (!row) return { progress: null, tombstone: null }
  if (Number(row.deleted_at) > 0) {
    return { progress: null, tombstone: { novelId: row.novel_id, deletedAt: row.deleted_at, updatedAt: row.updated_at || row.deleted_at } }
  }
  return {
    progress: { novelId: row.novel_id, chapterId: row.chapter_id, scrollPercent: row.scroll_percent, updatedAt: row.updated_at },
    tombstone: null,
  }
}

function normalizeTimestamp(value: string | undefined): number {
  const now = Date.now()
  let ts = Number(value)
  if (!Number.isFinite(ts) || ts <= 0) ts = now
  if (ts > now) ts = now
  return Math.floor(ts)
}

const PROGRESS_COLUMNS = 'novel_id, chapter_id, scroll_percent, updated_at, deleted_at'

/** reading_progress.novel_id 有 FK：书被删/ID 不存在时应回 404 而非 500。 */
function isForeignKeyViolation(err: unknown): boolean {
  const code = String((err as { code?: string })?.code || '')
  if (code === '23503') return true
  return /foreign key/i.test(String((err as Error)?.message || ''))
}

progressRoutes.post('/', optionalUser(), async (c) => {
  const db = getDb()
  const body = await c.req.json().catch(() => ({}))
  const { novelId, chapterId } = body
  let scrollPercent = Number(body.scrollPercent)

  if (!novelId || !chapterId) return c.json({ error: 'novelId and chapterId are required' }, 400)
  if (!Number.isFinite(scrollPercent)) scrollPercent = 0
  scrollPercent = Math.min(1, Math.max(0, scrollPercent))

  const userId = c.get('user')?.id
  if (!userId) return c.json({ success: true })

  const updatedAt = Date.now()
  try {
    await db.query(
      `INSERT INTO reading_progress (id, user_id, novel_id, chapter_id, scroll_percent, updated_at, deleted_at)
       VALUES ($1, $2, $3, $4, $5, $6, 0)
       ON CONFLICT (user_id, novel_id) DO UPDATE SET
         chapter_id = EXCLUDED.chapter_id,
         scroll_percent = EXCLUDED.scroll_percent,
         updated_at = EXCLUDED.updated_at,
         deleted_at = 0`,
      ['prog_' + userId + '_' + novelId, userId, novelId, chapterId, scrollPercent, updatedAt],
    )
  } catch (err) {
    if (isForeignKeyViolation(err)) return c.json({ error: 'Novel not found' }, 404)
    throw err
  }

  return c.json({ success: true, progress: { novelId, chapterId, scrollPercent, updatedAt }, tombstone: null })
})

progressRoutes.get('/', optionalUser(), async (c) => {
  const db = getDb()
  const novelId = c.req.query('novelId')
  if (c.req.query('recent') === '1') return listRecent(c)
  if (!novelId) return c.json({ error: 'novelId is required' }, 400)

  const userId = c.get('user')?.id
  if (!userId) return c.json({ progress: null, tombstone: null })

  const row = await first<ProgressRow>(
    db,
    `SELECT ${PROGRESS_COLUMNS} FROM reading_progress WHERE user_id = $1 AND novel_id = $2`,
    [userId, novelId],
  )
  return c.json(stateResponse(row))
})

async function listRecent(c: Context<AuthEnv>) {
  const db = getDb()
  const userId = c.get('user')?.id
  if (!userId) return c.json({ progress: [], tombstones: [] })

  let limit = Number.parseInt(c.req.query('limit') || '5', 10)
  if (!Number.isFinite(limit) || limit < 1) limit = 5
  if (limit > 50) limit = 50

  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT rp.novel_id, rp.chapter_id, rp.scroll_percent, rp.updated_at,
            n.title AS novel_title, c.title AS chapter_title, c.sort_order AS chapter_order
     FROM reading_progress rp
     LEFT JOIN novels n ON n.id = rp.novel_id
     LEFT JOIN chapters c ON c.id = rp.chapter_id
     WHERE rp.user_id = $1 AND COALESCE(rp.deleted_at, 0) = 0
     ORDER BY rp.updated_at DESC
     LIMIT $2`,
    [userId, limit],
  )
  const progress = rows.map((row) => ({
    novelId: String(row.novel_id),
    novelTitle: String(row.novel_title || ''),
    chapterId: String(row.chapter_id),
    chapterTitle: String(row.chapter_title || ''),
    chapterOrder: Number(row.chapter_order) || 0,
    scrollPercent: Number(row.scroll_percent) || 0,
    timestamp: Number(row.updated_at) || 0,
    updatedAt: Number(row.updated_at) || 0,
  }))

  const { rows: tombRows } = await db.query<{ novel_id: string; deleted_at: number; updated_at: number }>(
    `SELECT novel_id, deleted_at, updated_at FROM reading_progress
     WHERE user_id = $1 AND COALESCE(deleted_at, 0) > 0
     ORDER BY deleted_at DESC LIMIT 50`,
    [userId],
  )

  return c.json({
    progress,
    tombstones: tombRows.map((r) => ({ novelId: r.novel_id, deletedAt: r.deleted_at, updatedAt: r.updated_at || r.deleted_at })),
  })
}

progressRoutes.delete('/', optionalUser(), async (c) => {
  const db = getDb()
  const novelId = c.req.query('novelId')
  if (!novelId) return c.json({ error: 'novelId is required' }, 400)

  const userId = c.get('user')?.id
  if (!userId) return c.json({ success: true })

  const deletedAt = normalizeTimestamp(c.req.query('clientUpdatedAt'))
  const existing = await first<ProgressRow>(
    db,
    `SELECT ${PROGRESS_COLUMNS} FROM reading_progress WHERE user_id = $1 AND novel_id = $2`,
    [userId, novelId],
  )
  if (existing && Number(existing.updated_at) > deletedAt) {
    return c.json({ success: true, skipped: true, ...stateResponse(existing) })
  }

  try {
    await db.query(
      `INSERT INTO reading_progress (id, user_id, novel_id, chapter_id, scroll_percent, updated_at, deleted_at)
       VALUES ($1, $2, $3, '', 0, $4, $4)
       ON CONFLICT (user_id, novel_id) DO UPDATE SET
         chapter_id = '', scroll_percent = 0,
         updated_at = EXCLUDED.updated_at, deleted_at = EXCLUDED.deleted_at`,
      ['prog_' + userId + '_' + novelId, userId, novelId, deletedAt],
    )
  } catch (err) {
    // 目标书不存在时无进度可删，按幂等成功返回（客户端只关心墓碑生效）
    if (isForeignKeyViolation(err)) return c.json({ success: true, progress: null, tombstone: null })
    throw err
  }

  return c.json({ success: true, progress: null, tombstone: { novelId, deletedAt, updatedAt: deletedAt } })
})
