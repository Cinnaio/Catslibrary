/**
 * /api/thoughts —— 段评（公开列表 + 创建 + 管理员/本人隐藏 + 审核），由 Novel-KV thoughts.js 平移。
 */
import { Hono, type Context } from 'hono'
import { getDb } from '../db/pool'
import { all, first, run } from '../db/query'
import { rowToThought, rowToThoughtAdmin } from '../db/mappers'
import { newId } from '../services/auth'
import { sha256Hex } from '../services/hash'
import { optionalUser, requireAdmin, type AuthEnv } from '../middlewares/auth'
import { clientIpFromContext } from '../services/ai/audit-context'
import { cleanText, clampInt, escapeLike, looksLikeSpam } from '../services/text'

const MAX_THOUGHT_LEN = 300
const MAX_SELECTED_LEN = 200
const MAX_NAME_LEN = 20
const RATE_MINUTE = 5
const RATE_HOUR = 30
const IP_RATE_HOUR = 60
// 惰性读取：随机盐由启动时 ensureRuntimeSalts() 生成，晚于本模块求值
const thoughtHashSalt = () => process.env.THOUGHT_HASH_SALT?.trim() || 'zhi-zhou'

export const thoughtsRoutes = new Hono<AuthEnv>()

thoughtsRoutes.get('/', optionalUser(), async (c) => {
  const db = getDb()
  if (c.req.query('admin') === '1') return listThoughtsAdmin(c, db)
  if (c.req.query('mine') === '1') return listMyThoughts(c, db)
  return listThoughtsPublic(c, db)
})

thoughtsRoutes.post('/', optionalUser(), async (c) => {
  const body = await c.req.json().catch(() => ({}))
  return createThought(c, body)
})

thoughtsRoutes.put('/', requireAdmin(), async (c) => {
  const db = getDb()
  const body = await c.req.json().catch(() => ({}))
  const id = cleanText(body.id, 80)
  const status = cleanText(body.status, 20)
  if (!id) return c.json({ error: 'id is required' }, 400)
  if (status !== 'visible' && status !== 'hidden') return c.json({ error: 'status must be visible or hidden' }, 400)
  const changed = await run(db, 'UPDATE thoughts SET status = $1, updated_at = $2 WHERE id = $3', [status, Date.now(), id])
  if (!changed) return c.json({ error: 'Thought not found' }, 404)
  return c.json({ success: true, id, status })
})

thoughtsRoutes.delete('/', optionalUser(), async (c) => {
  const db = getDb()
  const id = cleanText(c.req.query('id'), 80)
  if (!id) return c.json({ error: 'id query parameter is required' }, 400)
  if (c.req.query('hard') === '1') {
    // 管理员硬删
    const admin = c.get('user')
    if (!admin || admin.role !== 'admin') return c.json({ error: '需要管理员权限' }, 403)
    const changed = await run(db, 'DELETE FROM thoughts WHERE id = $1', [id])
    if (!changed) return c.json({ error: 'Thought not found' }, 404)
    return c.json({ success: true, id, deleted: true })
  }
  // 管理员可隐藏任意，本人可隐藏自己的。
  // 必须要求登录：匿名段评的 user_id 为空串，若放行未登录请求（user_id 同为空串），
  // 任何人都能隐藏任意匿名段评。
  const user = c.get('user')
  if (!user) return c.json({ error: '需要登录' }, 401)
  const isAdmin = user.role === 'admin'
  const changed = isAdmin
    ? await run(db, 'UPDATE thoughts SET status = $1, updated_at = $2 WHERE id = $3', ['hidden', Date.now(), id])
    : await run(db, "UPDATE thoughts SET status = 'hidden', updated_at = $1 WHERE id = $2 AND user_id = $3 AND user_id <> ''", [Date.now(), id, user.id])
  if (!changed) return c.json({ error: 'Thought not found' }, 404)
  return c.json({ success: true, id, status: 'hidden' })
})

// ---------- 列表 ----------

async function listThoughtsPublic(c: Context<AuthEnv>, db: ReturnType<typeof getDb>) {
  const chapterId = (c.req.query('chapterId') || '').trim()
  if (!chapterId) return c.json({ error: 'chapterId query parameter is required' }, 400)
  const rows = await all<Record<string, unknown>>(
    db,
    `SELECT t.*, u.updated_at AS user_updated_at
     FROM thoughts t
     LEFT JOIN users u ON u.id = t.user_id
     WHERE t.chapter_id = $1 AND t.status = 'visible'
     ORDER BY t.paragraph_index ASC, t.created_at ASC
     LIMIT 500`,
    [chapterId],
  )
  const thoughts = rows.map(rowToThought).filter((t) => t !== null)
  const counts: Record<string, number> = {}
  for (const t of thoughts) {
    const key = String(t.paragraphIndex)
    counts[key] = (counts[key] || 0) + 1
  }
  return c.json({ thoughts, counts, chapterId, total: thoughts.length })
}

async function listMyThoughts(c: Context<AuthEnv>, db: ReturnType<typeof getDb>) {
  const user = c.get('user')
  if (!user) return c.json({ error: '需要登录' }, 401)
  const limit = clampInt(c.req.query('limit'), 1, 100, 50)
  const rows = await all<Record<string, unknown>>(
    db,
    `SELECT t.*, n.title AS novel_title, c.title AS chapter_title,
            u.username AS user_username, u.display_name AS user_display_name, u.updated_at AS user_updated_at
     FROM thoughts t
     LEFT JOIN novels n ON n.id = t.novel_id
     LEFT JOIN chapters c ON c.id = t.chapter_id
     LEFT JOIN users u ON u.id = t.user_id
     WHERE t.user_id = $1
     ORDER BY t.created_at DESC
     LIMIT $2`,
    [user.id, limit],
  )
  return c.json({ thoughts: rows.map(rowToThoughtAdmin).filter((t) => t !== null), total: rows.length })
}

async function listThoughtsAdmin(c: Context<AuthEnv>, db: ReturnType<typeof getDb>) {
  const user = c.get('user')
  if (!user || user.role !== 'admin') return c.json({ error: '需要管理员权限' }, 403)
  const status = (c.req.query('status') || 'all').trim()
  const search = (c.req.query('search') || '').trim()
  const userId = (c.req.query('userId') || '').trim()
  const limit = clampInt(c.req.query('limit'), 1, 100, 50)
  const offset = clampInt(c.req.query('offset'), 0, 100000, 0)

  const conditions: string[] = []
  const params: unknown[] = []
  if (status !== 'all') {
    conditions.push(`t.status = $${params.length + 1}`)
    params.push(status === 'hidden' ? 'hidden' : 'visible')
  }
  if (search) {
    conditions.push(`(t.thought_text LIKE $${params.length + 1} OR t.selected_text LIKE $${params.length + 1} OR t.display_name LIKE $${params.length + 1} OR n.title LIKE $${params.length + 1} OR c.title LIKE $${params.length + 1})`)
    params.push(`%${escapeLike(search)}%`)
  }
  if (userId) {
    conditions.push(`t.user_id = $${params.length + 1}`)
    params.push(userId)
  }
  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''

  const totalRow = await first<{ total: number }>(
    db,
    `SELECT COUNT(*)::int AS total FROM thoughts t
     LEFT JOIN novels n ON n.id = t.novel_id
     LEFT JOIN chapters c ON c.id = t.chapter_id
     ${where}`,
    params,
  )

  const rows = await all<Record<string, unknown>>(
    db,
    `SELECT t.*, n.title AS novel_title, c.title AS chapter_title,
            u.username AS user_username, u.display_name AS user_display_name, u.updated_at AS user_updated_at
     FROM thoughts t
     LEFT JOIN novels n ON n.id = t.novel_id
     LEFT JOIN chapters c ON c.id = t.chapter_id
     LEFT JOIN users u ON u.id = t.user_id
     ${where}
     ORDER BY t.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  )

  return c.json({ thoughts: rows.map(rowToThoughtAdmin).filter((t) => t !== null), total: totalRow?.total || 0, limit, offset })
}

// ---------- 创建 ----------

async function createThought(c: Context<AuthEnv>, body: any) {
  const db = getDb()
  const novelId = cleanText(body.novelId, 80)
  const chapterId = cleanText(body.chapterId, 80)
  const paragraphIndex = Number(body.paragraphIndex)
  const paragraphHash = cleanText(body.paragraphHash, 64)
  const selectedText = cleanText(body.selectedText, MAX_SELECTED_LEN)
  const thoughtText = cleanText(body.thoughtText, MAX_THOUGHT_LEN)
  const displayName = cleanText(body.displayName, MAX_NAME_LEN)

  if (!novelId || !chapterId) return c.json({ error: 'novelId and chapterId are required' }, 400)
  if (!Number.isInteger(paragraphIndex) || paragraphIndex < 0 || paragraphIndex > 5000) {
    return c.json({ error: 'paragraphIndex is invalid' }, 400)
  }
  if (!thoughtText) return c.json({ error: '想法内容不能为空' }, 400)
  if (looksLikeSpam(thoughtText)) return c.json({ error: '想法内容看起来像垃圾信息' }, 400)

  const chapter = await first<{ id: string; novel_id: string }>(db, 'SELECT id, novel_id FROM chapters WHERE id = $1', [chapterId])
  if (!chapter) return c.json({ error: 'Chapter not found' }, 404)
  if (chapter.novel_id !== novelId) return c.json({ error: 'chapterId does not belong to novelId' }, 400)

  const user = c.get('user')
  if ((c.req.header('Authorization') || '').trim() && !user) return c.json({ error: '需要登录' }, 401)
  const clientHash = await hashValue(user?.id || c.req.header('X-Reader-Id') || '')
  const ipHash = await hashValue(clientIpFromContext(c))
  const uaHash = await hashValue(c.req.header('User-Agent') || '')
  const rate = await checkRateLimit(db, clientHash, ipHash)
  if (rate) return c.json({ error: rate }, 429)

  const id = newId('thought')
  const now = Date.now()
  const shownName = displayName || user?.display_name || user?.username || ''
  await run(
    db,
    `INSERT INTO thoughts (
      id, novel_id, chapter_id, paragraph_index, paragraph_hash, selected_text,
      thought_text, display_name, client_id_hash, ip_hash, user_agent_hash,
      status, report_count, created_at, updated_at, user_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'visible', 0, $12, $12, $13)`,
    [id, novelId, chapterId, paragraphIndex, paragraphHash, selectedText, thoughtText, shownName, clientHash, ipHash, uaHash, now, user?.id || ''],
  )

  const row = await first<Record<string, unknown>>(db, 'SELECT * FROM thoughts WHERE id = $1', [id])
  return c.json({ thought: rowToThought(row) }, 201)
}

async function checkRateLimit(db: ReturnType<typeof getDb>, clientHash: string, ipHash: string): Promise<string | null> {
  const now = Date.now()
  const minuteAgo = now - 60000
  const hourAgo = now - 3600000
  if (clientHash) {
    const m = await first<{ total: number }>(db, 'SELECT COUNT(*)::int AS total FROM thoughts WHERE client_id_hash = $1 AND created_at > $2', [clientHash, minuteAgo])
    if ((m?.total || 0) >= RATE_MINUTE) return '提交太频繁，请稍后再试'
    const h = await first<{ total: number }>(db, 'SELECT COUNT(*)::int AS total FROM thoughts WHERE client_id_hash = $1 AND created_at > $2', [clientHash, hourAgo])
    if ((h?.total || 0) >= RATE_HOUR) return '提交太频繁，请稍后再试'
  }
  if (ipHash) {
    const h = await first<{ total: number }>(db, 'SELECT COUNT(*)::int AS total FROM thoughts WHERE ip_hash = $1 AND created_at > $2', [ipHash, hourAgo])
    if ((h?.total || 0) >= IP_RATE_HOUR) return '提交太频繁，请稍后再试'
  }
  return null
}

async function hashValue(value: string): Promise<string> {
  value = String(value || '').trim()
  if (!value) return ''
  return sha256Hex(thoughtHashSalt(), value)
}
