/** /api/bookmarks —— 用户书签同步（全量替换模式，由 Novel-KV bookmarks.js 平移）。 */
import { Hono } from 'hono'
import { getDb } from '../db/pool'
import { all, withTx } from '../db/query'
import { requireUser, type AuthEnv } from '../middlewares/auth'

export const bookmarksRoutes = new Hono<AuthEnv>()

bookmarksRoutes.get('/', requireUser(), async (c) => {
  const db = getDb()
  const userId = c.get('user').id
  const rows = await all<Record<string, unknown>>(db, 'SELECT * FROM user_bookmarks WHERE user_id = $1 ORDER BY updated_at DESC', [userId])
  return c.json({ bookmarks: rows.map(rowToBookmark).filter(Boolean) })
})

bookmarksRoutes.put('/', requireUser(), async (c) => {
  const db = getDb()
  const userId = c.get('user').id
  const body = await c.req.json().catch(() => ({}))
  const bookmarks: unknown[] = Array.isArray(body.bookmarks) ? body.bookmarks.slice(0, 500) : []
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
      id: userId + '_' + (cleanId(b.id) || 'bm_' + now + '_' + i),
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
