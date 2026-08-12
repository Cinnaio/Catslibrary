/**
 * /api/comments —— 评论/回复/点赞/举报（由 Novel-KV comments.js + like.js + report.js 合并）。
 */
import { Hono, type Context } from 'hono'
import { getDb } from '../db/pool'
import { all, first, run } from '../db/query'
import { rowToComment } from '../db/mappers'
import { newId } from '../services/auth'
import { sha256Hex } from '../services/hash'
import { optionalUser, requireUser, type AuthEnv } from '../middlewares/auth'
import { clientIpFromContext } from '../services/ai/audit-context'

const MAX_COMMENT_LEN = 1000
const MAX_REPLY_LEN = 500
const EDIT_WINDOW = 24 * 3600000
const RATE_MINUTE = 3
const RATE_HOUR = 20
const IP_RATE_HOUR = 50
// 惰性读取：随机盐由启动时 ensureRuntimeSalts() 生成，晚于本模块求值
const thoughtHashSalt = () => process.env.THOUGHT_HASH_SALT?.trim() || 'zhi-zhou'

export const commentsRoutes = new Hono<AuthEnv>()

// ---------- 列表 ----------

commentsRoutes.get('/', optionalUser(), async (c) => {
  const db = getDb()
  const novelId = cleanText(c.req.query('novelId'), 80)
  if (!novelId) return c.json({ error: 'novelId query parameter is required' }, 400)
  const sort = cleanText(c.req.query('sort'), 20) === 'hot' ? 'hot' : 'latest'
  const limit = clampInt(c.req.query('limit'), 1, 50, 20)
  const offset = clampInt(c.req.query('offset'), 0, 100000, 0)
  const userId = c.get('user')?.id || ''

  const totalRow = await first<{ total: number }>(
    db,
    "SELECT COUNT(*)::int AS total FROM novel_comments WHERE novel_id = $1 AND parent_id IS NULL AND status = 'visible'",
    [novelId],
  )

  const order = sort === 'hot' ? 'c.like_count DESC, c.created_at DESC' : 'c.created_at DESC'
  const rows = await all<Record<string, unknown>>(
    db,
    `SELECT c.*, u.updated_at AS user_updated_at,
            CASE WHEN l.user_id IS NULL THEN 0 ELSE 1 END AS user_liked,
            CASE WHEN c.user_id = $1 THEN 1 ELSE 0 END AS can_edit
     FROM novel_comments c
     LEFT JOIN users u ON u.id = c.user_id
     LEFT JOIN novel_comment_likes l ON l.comment_id = c.id AND l.user_id = $2
     WHERE c.novel_id = $3 AND c.parent_id IS NULL AND c.status = 'visible'
     ORDER BY ${order}
     LIMIT $4 OFFSET $5`,
    [userId, userId, novelId, limit, offset],
  )
  const comments = rows.map(rowToComment).filter((c) => c !== null)
  const ids = comments.map((c) => c.id)

  if (ids.length) {
    // $1 已用于 userId（user_liked/can_edit 两个 CASE），IN 占位符从 $2 开始
    const placeholders = ids.map((_, i) => `$${i + 2}`).join(',')
    const replyRows = await all<Record<string, unknown>>(
      db,
      `SELECT c.*, u.updated_at AS user_updated_at,
              CASE WHEN l.user_id IS NULL THEN 0 ELSE 1 END AS user_liked,
              CASE WHEN c.user_id = $1 THEN 1 ELSE 0 END AS can_edit
       FROM novel_comments c
       LEFT JOIN users u ON u.id = c.user_id
       LEFT JOIN novel_comment_likes l ON l.comment_id = c.id AND l.user_id = $1
       WHERE c.parent_id IN (${placeholders}) AND c.status = 'visible'
       ORDER BY c.created_at ASC`,
      [userId, ...ids],
    )
    const byParent: Record<string, NonNullable<ReturnType<typeof rowToComment>>[]> = {}
    for (const r of replyRows) {
      const reply = rowToComment(r)
      if (!reply) continue
      ;(byParent[reply.parentId] ||= []).push(reply)
    }
    for (const comment of comments) comment.replies = byParent[comment.id] || []
  }

  return c.json({ comments, total: totalRow?.total || 0, limit, offset, sort })
})

// ---------- 创建 / 编辑 / 删除 ----------

commentsRoutes.post('/', requireUser(), async (c) => {
  const db = getDb()
  const user = c.get('user')
  const body = await c.req.json().catch(() => ({}))
  const novelId = cleanText(body.novelId, 80)
  const parentId = cleanText(body.parentId, 80) || null
  const maxLen = parentId ? MAX_REPLY_LEN : MAX_COMMENT_LEN
  const text = cleanText(body.text || body.commentText, maxLen)
  const hasSpoiler = body.hasSpoiler ? 1 : 0
  if (!novelId) return c.json({ error: 'novelId is required' }, 400)
  if (text.length < 2) return c.json({ error: '评论内容至少需要 2 个字符' }, 400)
  if (looksLikeSpam(text)) return c.json({ error: '评论内容看起来像垃圾信息' }, 400)

  const novel = await first<{ id: string }>(db, 'SELECT id FROM novels WHERE id = $1', [novelId])
  if (!novel) return c.json({ error: 'Novel not found' }, 404)

  if (parentId) {
    const parent = await first<{ id: string; novel_id: string; parent_id: string | null; status: string }>(
      db,
      'SELECT id, novel_id, parent_id, status FROM novel_comments WHERE id = $1',
      [parentId],
    )
    if (!parent || parent.status !== 'visible') return c.json({ error: '父评论不存在' }, 404)
    if (parent.novel_id !== novelId) return c.json({ error: '父评论不属于当前小说' }, 400)
    if (parent.parent_id) return c.json({ error: '暂不支持多层回复' }, 400)
  }

  const clientHash = await sha256Hex(thoughtHashSalt(), user.id)
  const clientIp = clientIpFromContext(c)
  const ipHash = clientIp ? await sha256Hex(thoughtHashSalt(), clientIp) : ''
  const rate = await checkRateLimit(db, clientHash, ipHash)
  if (rate) return c.json({ error: rate }, 429)

  const id = newId('comment')
  const now = Date.now()
  const displayName = user.display_name || user.username || '读者'
  await run(
    db,
    `INSERT INTO novel_comments (
      id, novel_id, user_id, parent_id, comment_text, display_name, has_spoiler,
      status, like_count, report_count, client_id_hash, ip_hash, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'visible', 0, 0, $8, $9, $10, $10)`,
    [id, novelId, user.id, parentId, text, displayName, hasSpoiler, clientHash, ipHash, now],
  )

  const row = await first<Record<string, unknown>>(
    db,
    `SELECT c.*, u.updated_at AS user_updated_at, 0 AS user_liked, 1 AS can_edit
     FROM novel_comments c LEFT JOIN users u ON u.id = c.user_id WHERE c.id = $1`,
    [id],
  )
  return c.json({ comment: rowToComment(row) }, 201)
})

commentsRoutes.put('/', requireUser(), async (c) => {
  const db = getDb()
  const user = c.get('user')
  const body = await c.req.json().catch(() => ({}))
  const id = cleanText(body.id, 80)
  const status = cleanText(body.status, 20)
  const hasSpoiler = body.hasSpoiler ? 1 : 0
  if (!id) return c.json({ error: 'id is required' }, 400)

  const row = await first<Record<string, unknown>>(db, 'SELECT * FROM novel_comments WHERE id = $1', [id])
  if (!row) return c.json({ error: 'Comment not found' }, 404)
  const isAdmin = user.role === 'admin'
  const now = Date.now()

  if (isAdmin && status) {
    if (status !== 'visible' && status !== 'hidden') return c.json({ error: 'status must be visible or hidden' }, 400)
    await run(db, 'UPDATE novel_comments SET status = $1, updated_at = $2 WHERE id = $3', [status, now, id])
    return c.json({ success: true, id, status })
  }

  if (row.user_id !== user.id) return c.json({ error: '只能编辑自己的评论' }, 403)
  if (now - Number(row.created_at) > EDIT_WINDOW) return c.json({ error: '评论已超过可编辑时间' }, 403)
  const maxLen = row.parent_id ? MAX_REPLY_LEN : MAX_COMMENT_LEN
  const nextText = cleanText(body.text || body.commentText, maxLen)
  if (nextText.length < 2) return c.json({ error: '评论内容至少需要 2 个字符' }, 400)
  if (looksLikeSpam(nextText)) return c.json({ error: '评论内容看起来像垃圾信息' }, 400)

  await run(db, 'UPDATE novel_comments SET comment_text = $1, has_spoiler = $2, updated_at = $3 WHERE id = $4', [nextText, hasSpoiler, now, id])
  return c.json({ success: true, id })
})

commentsRoutes.delete('/', requireUser(), async (c) => {
  const db = getDb()
  const user = c.get('user')
  const id = cleanText(c.req.query('id'), 80)
  if (!id) return c.json({ error: 'id query parameter is required' }, 400)

  if (c.req.query('hard') === '1') {
    if (user.role !== 'admin') return c.json({ error: '需要管理员权限' }, 403)
    await run(db, 'DELETE FROM novel_comments WHERE id = $1', [id])
    return c.json({ success: true, id, deleted: true })
  }

  const row = await first<{ user_id: string }>(db, 'SELECT user_id FROM novel_comments WHERE id = $1', [id])
  if (!row) return c.json({ error: 'Comment not found' }, 404)
  if (row.user_id !== user.id && user.role !== 'admin') return c.json({ error: '只能删除自己的评论' }, 403)
  await run(db, "UPDATE novel_comments SET status = 'hidden', updated_at = $1 WHERE id = $2", [Date.now(), id])
  return c.json({ success: true, id, status: 'hidden' })
})

// ---------- 点赞 / 举报 ----------

commentsRoutes.post('/:id/like', requireUser(), async (c) => {
  const db = getDb()
  const user = c.get('user')
  const commentId = cleanText(c.req.param('id'), 80)
  if (!commentId) return c.json({ error: 'comment id is required' }, 400)

  const comment = await first<{ id: string; status: string }>(db, "SELECT id, status FROM novel_comments WHERE id = $1", [commentId])
  if (!comment || comment.status !== 'visible') return c.json({ error: 'Comment not found' }, 404)

  const existing = await first<{ id: string }>(db, 'SELECT id FROM novel_comment_likes WHERE comment_id = $1 AND user_id = $2', [commentId, user.id])
  if (!existing) {
    await run(db, 'INSERT INTO novel_comment_likes (id, comment_id, user_id, created_at) VALUES ($1, $2, $3, $4)', [newId('like'), commentId, user.id, Date.now()])
    await run(db, 'UPDATE novel_comments SET like_count = like_count + 1 WHERE id = $1', [commentId])
  }
  return likeResponse(db, user.id, commentId, c)
})

commentsRoutes.delete('/:id/like', requireUser(), async (c) => {
  const db = getDb()
  const user = c.get('user')
  const commentId = cleanText(c.req.param('id'), 80)
  if (!commentId) return c.json({ error: 'comment id is required' }, 400)

  const deleted = await run(db, 'DELETE FROM novel_comment_likes WHERE comment_id = $1 AND user_id = $2', [commentId, user.id])
  if (deleted) {
    await run(db, 'UPDATE novel_comments SET like_count = CASE WHEN like_count > 0 THEN like_count - 1 ELSE 0 END WHERE id = $1', [commentId])
  }
  return likeResponse(db, user.id, commentId, c)
})

commentsRoutes.post('/:id/report', requireUser(), async (c) => {
  const db = getDb()
  const user = c.get('user')
  const commentId = cleanText(c.req.param('id'), 80)
  if (!commentId) return c.json({ error: 'comment id is required' }, 400)
  const body = await c.req.json().catch(() => ({}))

  const reason = REASONS.has(cleanText(body.reason, 20)) ? cleanText(body.reason, 20) : 'other'
  const note = cleanText(body.note, 200)

  const comment = await first<{ id: string; status: string }>(db, 'SELECT id, status FROM novel_comments WHERE id = $1', [commentId])
  if (!comment) return c.json({ error: 'Comment not found' }, 404)

  const existing = await first<{ id: string }>(db, "SELECT id FROM novel_comment_reports WHERE comment_id = $1 AND reported_by = $2 AND status = 'open'", [commentId, user.id])
  if (existing) return c.json({ error: '你已经举报过这条评论' }, 409)

  await run(
    db,
    `INSERT INTO novel_comment_reports (id, comment_id, reported_by, reason, note, status, resolved_by, resolved_at, created_at)
     VALUES ($1, $2, $3, $4, $5, 'open', '', 0, $6)`,
    [newId('report'), commentId, user.id, reason, note, Date.now()],
  )
  await run(db, 'UPDATE novel_comments SET report_count = report_count + 1 WHERE id = $1', [commentId])
  return c.json({ success: true, commentId, reason }, 201)
})

// ---------- 内部辅助 ----------

const REASONS = new Set(['spam', 'offensive', 'spoiler', 'other'])

async function likeResponse(
  db: ReturnType<typeof getDb>,
  userId: string,
  commentId: string,
  c: Context,
) {
  const row = await first<{ like_count: number; user_liked: number }>(
    db,
    `SELECT c.like_count, CASE WHEN l.user_id IS NULL THEN 0 ELSE 1 END AS user_liked
     FROM novel_comments c
     LEFT JOIN novel_comment_likes l ON l.comment_id = c.id AND l.user_id = $1
     WHERE c.id = $2`,
    [userId, commentId],
  )
  if (!row) return c.json({ error: 'Comment not found' }, 404)
  return c.json({ id: commentId, likeCount: row.like_count || 0, userLiked: row.user_liked === 1 })
}

async function checkRateLimit(db: ReturnType<typeof getDb>, clientHash: string, ipHash: string): Promise<string | null> {
  const now = Date.now()
  const minuteAgo = now - 60000
  const hourAgo = now - 3600000
  if (clientHash) {
    const m = await first<{ total: number }>(db, 'SELECT COUNT(*)::int AS total FROM novel_comments WHERE client_id_hash = $1 AND created_at > $2', [clientHash, minuteAgo])
    if ((m?.total || 0) >= RATE_MINUTE) return '提交太频繁，请稍后再试'
    const h = await first<{ total: number }>(db, 'SELECT COUNT(*)::int AS total FROM novel_comments WHERE client_id_hash = $1 AND created_at > $2', [clientHash, hourAgo])
    if ((h?.total || 0) >= RATE_HOUR) return '提交太频繁，请稍后再试'
  }
  if (ipHash) {
    const h = await first<{ total: number }>(db, 'SELECT COUNT(*)::int AS total FROM novel_comments WHERE ip_hash = $1 AND created_at > $2', [ipHash, hourAgo])
    if ((h?.total || 0) >= IP_RATE_HOUR) return '提交太频繁，请稍后再试'
  }
  return null
}

function cleanText(value: unknown, max: number): string {
  return String(value || '').replace(/[\x00-\x1F\x7F]/g, '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function clampInt(value: string | undefined, min: number, max: number, fallback: number): number {
  const n = Number.parseInt(value || '', 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function looksLikeSpam(text: string): boolean {
  const links = (text.match(/https?:\/\//gi) || []).length
  if (links > 3) return true
  if (/(.)\1{12,}/.test(text)) return true
  return false
}
