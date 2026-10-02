/** /api/bookmarks —— 用户书签同步（全量替换模式，由 Novel-KV bookmarks.js 平移）。 */
import { Hono } from 'hono'
import { getDb } from '../db/pool'
import { all, withTx } from '../db/query'
import { requireUser, type AuthEnv } from '../middlewares/auth'
import { contentPolicyHeaders, resolveContentAccess } from '../services/content-access'

export const bookmarksRoutes = new Hono<AuthEnv>()

bookmarksRoutes.get('/', requireUser(), async (c) => {
  const db = getDb()
  const userId = c.get('user').id
  const access = await resolveContentAccess(c)
  const ratingFilter = access.canViewRestricted ? '' : " AND COALESCE(n.content_rating, 'general') <> 'restricted'"
  const rows = await all<Record<string, unknown>>(
    db,
    `SELECT b.*
     FROM user_bookmarks b
     LEFT JOIN novels n ON n.id = b.novel_id
     WHERE b.user_id = $1${ratingFilter}
     ORDER BY b.updated_at DESC`,
    [userId],
  )
  return c.json({ bookmarks: rows.map(rowToBookmark).filter(Boolean) }, 200, contentPolicyHeaders())
})

bookmarksRoutes.put('/', requireUser(), async (c) => {
  const db = getDb()
  const userId = c.get('user').id
  const body = await c.req.json().catch(() => null)
  if (!body || !Array.isArray(body.bookmarks) || body.bookmarks.length > 500 || !body.bookmarks.every(validBookmark)) {
    return c.json({ error: '书签载荷无效，必须提供不超过 500 条的完整书签数组' }, 400)
  }
  const bookmarks: unknown[] = body.bookmarks
  const now = Date.now()

  // 载荷内去重：表上有 UNIQUE(user_id, novel_id, chapter_id) 与主键 id，
  // 客户端重复项会让整个事务回滚变 500。按 (novelId, chapterId) 保留时间戳最新的一条，id 冲突同理。
  const byChapter = new Map<string, { id: string; novelId: string; novelTitle: string; chapterId: string; chapterTitle: string; chapterOrder: number; note: string; ts: number }>()
  bookmarks.forEach((raw, i) => {
    const b = raw as Record<string, unknown> | null
    if (!b || !b.novelId || !b.chapterId) return
    const novelId = clean(b.novelId, 80)
    const chapterId = clean(b.chapterId, 80)
    if (!novelId || !chapterId) return
    const ts = Number(b.timestamp) || now
    const key = novelId + '\u0000' + chapterId
    const existing = byChapter.get(key)
    if (existing && existing.ts >= ts) return
    byChapter.set(key, {
      id: bookmarkId(userId, b.id, 'bm_' + now + '_' + i),
      novelId,
      novelTitle: clean(b.novelTitle, 200),
      chapterId,
      chapterTitle: clean(b.chapterTitle, 200),
      chapterOrder: Number(b.chapterOrder) || 0,
      note: clean(b.note, 300),
      ts,
    })
  })
  const deduped = [...byChapter.values()]
  const usedIds = new Set<string>()
  const inserts: Array<[string, unknown[]]> = deduped.map((b, i) => {
    let id = b.id
    if (usedIds.has(id)) id = userId + '_bm_' + now + '_' + i
    usedIds.add(id)
    return [
      `INSERT INTO user_bookmarks (id, user_id, novel_id, novel_title, chapter_id, chapter_title, chapter_order, note, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [id, userId, b.novelId, b.novelTitle, b.chapterId, b.chapterTitle, b.chapterOrder, b.note, b.ts, b.ts],
    ]
  })

  await withTx(db, async (q) => {
    await q('DELETE FROM user_bookmarks WHERE user_id = $1', [userId])
    for (const [sql, p] of inserts) await q(sql, p)
  })
  return c.json({ success: true, count: inserts.length })
})

// 阅读器只修改目标书签，不能用设备上的局部缓存覆盖其它设备的书签。
bookmarksRoutes.post('/', requireUser(), async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!validBookmark(body)) return c.json({ error: '书签参数无效' }, 400)
  const userId = c.get('user').id
  const db = getDb()
  const access = await resolveContentAccess(c)
  const result = await db.query(
    `INSERT INTO user_bookmarks (id, user_id, novel_id, novel_title, chapter_id, chapter_title, chapter_order, note, created_at, updated_at)
     SELECT $1, $2, n.id, n.title, ch.id, ch.title, ch.sort_order, $5, $6, $6
     FROM chapters ch JOIN novels n ON n.id = ch.novel_id
     WHERE n.id = $3 AND ch.id = $4 AND ($7 OR COALESCE(n.content_rating, 'general') <> 'restricted')
     ON CONFLICT (user_id, novel_id, chapter_id) DO UPDATE SET
       note = EXCLUDED.note, updated_at = EXCLUDED.updated_at,
       novel_title = EXCLUDED.novel_title, chapter_title = EXCLUDED.chapter_title, chapter_order = EXCLUDED.chapter_order
     RETURNING *`,
    [bookmarkId(userId, body.id, 'bm_' + crypto.randomUUID()), userId, body.novelId, body.chapterId, clean(body.note, 300), Date.now(), access.canViewRestricted],
  )
  if (!result.rows.length) return c.json({ error: '章节不存在或无权访问' }, 404)
  return c.json({ bookmark: rowToBookmark(result.rows[0] as Record<string, unknown>) })
})

bookmarksRoutes.delete('/', requireUser(), async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!validBookmark(body)) return c.json({ error: '书签参数无效' }, 400)
  await getDb().query('DELETE FROM user_bookmarks WHERE user_id = $1 AND novel_id = $2 AND chapter_id = $3', [c.get('user').id, body.novelId, body.chapterId])
  return c.json({ success: true })
})

function validBookmark(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const b = value as Record<string, unknown>
  return ['novelId', 'chapterId'].every(key => typeof b[key] === 'string' && !!b[key] && b[key] === clean(b[key], 80))
    && ['novelTitle', 'chapterTitle', 'note', 'id'].every(key => b[key] === undefined || typeof b[key] === 'string')
    && ['timestamp', 'chapterOrder'].every(key => b[key] === undefined || (typeof b[key] === 'number' && Number.isFinite(b[key]) && Number(b[key]) >= 0))
}

function bookmarkId(userId: string, value: unknown, fallback: string): string {
  const prefix = userId + '_'
  const raw = typeof value === 'string' && value.startsWith(prefix) ? value.slice(prefix.length) : value
  return prefix + (cleanId(raw) || fallback)
}

function rowToBookmark(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    novelId: String(row.novel_id),
    novelTitle: String(row.novel_title || ''),
    chapterId: String(row.chapter_id),
    chapterTitle: String(row.chapter_title || ''),
    chapterOrder: Number(row.chapter_order) || 0,
    note: String(row.note || ''),
    timestamp: Number(row.updated_at),
  }
}

function clean(value: unknown, max: number): string {
  return String(value || '').replace(/[\x00-\x1F\x7F]/g, '').trim().slice(0, max)
}

function cleanId(value: unknown): string {
  return clean(value, 80).replace(/[^a-zA-Z0-9_-]/g, '')
}
