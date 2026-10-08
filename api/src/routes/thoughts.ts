/**
 * /api/thoughts —— 段评（公开列表 + 创建 + 管理员/本人隐藏 + 审核），由 Novel-KV thoughts.js 平移。
 */
import { Hono, Context } from 'hono'
import { getDb } from '../db/pool'
import { all, first, run, withTx } from '../db/query'
import { rowToThought, rowToThoughtAdmin } from '../db/mappers'
import { newId } from '../services/auth'
import { sha256Hex } from '../services/hash'
import { optionalUser, requireAdmin, requireUser, type AuthEnv } from '../middlewares/auth'
import { clientIpFromContext } from '../services/ai/audit-context'
import { cleanText, clampInt, escapeLike, looksLikeSpam } from '../services/text'
import { contentPolicyHeaders, restrictedContentResponse, resolveContentAccess } from '../services/content-access'
import sharp from 'sharp'
import { AiError } from '../services/ai/client'
import { generateImage, imageProvider, imageProviderLabel, isImageAiConfigured } from '../services/ai/image'
import { getAiSettings } from '../services/ai/settings'
import { createAiTask, getAiTask, startAiTaskHeartbeat, updateAiTask, type AiTask } from '../services/ai/tasks'
import { recordUsage, startOfToday } from '../services/ai/usage'
import { usageAuditFields } from '../services/ai/upstream-usage'
import { chapterContainsSelection, selectionImagePrompt, selectionImageRevision } from '../services/ai/selection-image'
import { idempotencyKeyFromRequest, withIdempotency } from '../services/idempotency'
import { coverDataToBody } from '../services/covers'

const MAX_THOUGHT_LEN = 300
const MAX_SELECTED_LEN = 200
const MAX_NAME_LEN = 20
const RATE_MINUTE = 5
const RATE_HOUR = 30
const IP_RATE_HOUR = 60
// 惰性读取：随机盐由启动时 ensureRuntimeSalts() 生成，晚于本模块求值
const thoughtHashSalt = () => process.env.THOUGHT_HASH_SALT?.trim() || 'zhi-zhou'

export const thoughtsRoutes = new Hono<AuthEnv>()

thoughtsRoutes.get('/image-capabilities', optionalUser(), async (c) => {
  const settings = await getAiSettings(getDb())
  const user = c.get('user')
  return c.json({
    allowed: Boolean(user && settings.selectionImageRoles.includes(user.role) && settings.selectionImageDailyQuota > 0 && isImageAiConfigured()),
    dailyQuota: settings.selectionImageDailyQuota,
  }, 200, contentPolicyHeaders())
})

thoughtsRoutes.post('/image', requireUser(), async (c) => {
  const db = getDb()
  const user = c.get('user')
  const settings = await getAiSettings(db)
  if (!settings.selectionImageRoles.includes(user.role)) return c.json({ error: '当前角色无权使用划选生成图片' }, 403)
  if (!settings.selectionImageDailyQuota) return c.json({ error: '划选生成图片已关闭' }, 403)
  if (!isImageAiConfigured()) return c.json({ error: 'AI 图像服务未配置' }, 503)
  const raw = await c.req.json().catch(() => ({}))
  const body = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const input = {
    novelId: cleanText(body.novelId, 80), chapterId: cleanText(body.chapterId, 80),
    paragraphIndex: Number(body.paragraphIndex), paragraphHash: cleanText(body.paragraphHash, 64),
    selectedText: typeof body.selectedText === 'string' ? body.selectedText.replace(/\s+/g, ' ').trim() : '',
    thoughtText: cleanText(body.thoughtText, MAX_THOUGHT_LEN) || '根据这段文字生成的插画',
    displayName: cleanText(body.displayName, MAX_NAME_LEN),
  }
  if (!input.novelId || !input.chapterId || !input.paragraphHash || !Number.isInteger(input.paragraphIndex) || input.paragraphIndex < 0 || input.paragraphIndex > 5000) {
    return c.json({ error: '请选择有效的正文段落' }, 400)
  }
  if (!input.selectedText || input.selectedText.length > MAX_SELECTED_LEN) return c.json({ error: '划选文字需为 1–200 字' }, 400)
  if (looksLikeSpam(input.thoughtText)) return c.json({ error: '想法内容看起来像垃圾信息' }, 400)
  const chapter = await first<{ novel_id: string; content: string; content_rating: string }>(db,
    'SELECT c.novel_id, c.content, n.content_rating FROM chapters c JOIN novels n ON n.id = c.novel_id WHERE c.id = $1', [input.chapterId])
  if (!chapter) return c.json({ error: '章节不存在' }, 404)
  if (chapter.content_rating === 'restricted') {
    const access = await resolveContentAccess(c)
    if (!access.canViewRestricted) return restrictedContentResponse(c, access.reason)
  }
  if (chapter.novel_id !== input.novelId || !chapterContainsSelection(chapter.content, input.selectedText, input.paragraphIndex, input.paragraphHash)) return c.json({ error: '划选文字与当前章节段落不匹配，请重新划选' }, 409)
  const rate = await checkRateLimit(db, await hashValue(user.id), await hashValue(clientIpFromContext(c)))
  if (rate) return c.json({ error: rate }, 429)
  let newTask: AiTask | undefined
  const response = await withIdempotency(db, {
    scope: `thought-image:${user.id}`, operationKey: idempotencyKeyFromRequest(c, body), payload: input,
  }, async () => withTx(db, async (query) => {
    // 同一用户的配额检查与任务创建串行化，重复点击/多窗口不能绕过上限。
    await query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [user.id])
    const active = await query<{ id: string }>("SELECT id FROM ai_tasks WHERE user_id = $1 AND kind = 'selection_image' AND status IN ('queued','running') LIMIT 1", [user.id])
    if (active.rows.length) return c.json({ error: '已有图片正在生成，请等待完成', taskId: active.rows[0]!.id }, 409)
    const count = await query<{ total: number }>("SELECT COUNT(*)::int AS total FROM ai_tasks WHERE user_id = $1 AND kind = 'selection_image' AND created_at >= $2", [user.id, startOfToday()])
    if ((count.rows[0]?.total || 0) >= settings.selectionImageDailyQuota) return c.json({ error: `今日图片生成已达 ${settings.selectionImageDailyQuota} 次上限` }, 429)
    // createAiTask 只用 query；传入当前事务的查询器，避免锁等待另一个连接。
    newTask = await createAiTask({ ...db, query }, { userId: user.id, novelId: input.novelId, kind: 'selection_image',
      prompt: selectionImagePrompt(input.selectedText), params: JSON.stringify(input) })
    return c.json({ taskId: newTask.id }, 202, contentPolicyHeaders())
  }))
  if (newTask) {
    // 后台访问检查会刷新成人模式 Cookie，不能修改已经发出并被客户端读取的 202 响应。
    // 冻结认证头与用户信息，使用不包含正文/响应流的独立上下文；IP 单独保留。
    const background = new Context<AuthEnv>(new Request(c.req.url, { headers: new Headers(c.req.raw.headers) }))
    background.set('user', { ...user })
    void runThoughtImage(background, input, newTask, selectionImageRevision(chapter.content), clientIpFromContext(c)).catch((err) => console.error('[thought-image]', err))
  }
  return response
})

thoughtsRoutes.get('/image-task', requireUser(), async (c) => {
  const db = getDb()
  const user = c.get('user')
  const chapterId = cleanText(c.req.query('chapterId'), 80)
  const taskId = cleanText(c.req.query('taskId'), 80)
  const row = taskId ? undefined : await first<{ id: string }>(db,
    "SELECT id FROM ai_tasks WHERE user_id = $1 AND kind = 'selection_image' AND params::jsonb->>'chapterId' = $2 ORDER BY created_at DESC LIMIT 1", [user.id, chapterId])
  const task = await getAiTask(db, taskId || row?.id || '')
  if (!task || task.userId !== user.id || task.kind !== 'selection_image') return c.json({ task: null }, 200, contentPolicyHeaders())
  const params = JSON.parse(task.params)
  const chapter = await first<{ content_rating: string }>(db, 'SELECT n.content_rating FROM chapters c JOIN novels n ON n.id = c.novel_id WHERE c.id = $1', [params.chapterId])
  if (!chapter) return c.json({ task: null }, 200, contentPolicyHeaders())
  if (chapter.content_rating === 'restricted') {
    const access = await resolveContentAccess(c)
    if (!access.canViewRestricted) return restrictedContentResponse(c, access.reason)
  }
  const thoughtId = task.result ? JSON.parse(task.result).thoughtId : ''
  const thought = thoughtId ? await first<Record<string, unknown>>(db, "SELECT * FROM thoughts WHERE id = $1 AND status = 'visible'", [thoughtId]) : undefined
  return c.json({ task: { id: task.id, status: task.status, error: task.error,
    paragraphIndex: params.paragraphIndex, selectedText: params.selectedText, thought: rowToThought(thought) || undefined } }, 200, contentPolicyHeaders())
})

thoughtsRoutes.get('/image/:id', optionalUser(), async (c) => {
  const row = await first<{ data: Uint8Array; content_type: string; content_rating: string; status: string }>(getDb(),
    'SELECT i.data, i.content_type, t.status, n.content_rating FROM thought_images i JOIN thoughts t ON t.id = i.thought_id JOIN novels n ON n.id = t.novel_id WHERE t.id = $1', [c.req.param('id')])
  if (!row || (row.status !== 'visible' && c.get('user')?.role !== 'admin')) return c.json({ error: '图片不存在' }, 404)
  if (row.content_rating === 'restricted') {
    const access = await resolveContentAccess(c)
    if (!access.canViewRestricted) return restrictedContentResponse(c, access.reason)
  }
  const bytes = coverDataToBody(row.data)
  if (!bytes) return c.json({ error: '图片不存在' }, 404)
  return c.body(new Uint8Array(bytes), 200, { ...contentPolicyHeaders(), 'Content-Type': row.content_type, 'X-Content-Type-Options': 'nosniff' })
})

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
  const chapter = await first<{ id: string; novel_id: string; content_rating: string }>(
    db,
    `SELECT c.id, c.novel_id, n.content_rating
     FROM chapters c
     JOIN novels n ON n.id = c.novel_id
     WHERE c.id = $1`,
    [chapterId],
  )
  if (!chapter) return c.json({ error: 'Chapter not found' }, 404)
  if (chapter.content_rating === 'restricted') {
    const access = await resolveContentAccess(c)
    if (!access.canViewRestricted) return restrictedContentResponse(c, access.reason)
  }
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
  return c.json({ thoughts, counts, chapterId, total: thoughts.length }, 200, contentPolicyHeaders())
}

async function listMyThoughts(c: Context<AuthEnv>, db: ReturnType<typeof getDb>) {
  const user = c.get('user')
  if (!user) return c.json({ error: '需要登录' }, 401)
  const access = await resolveContentAccess(c)
  const ratingFilter = access.canViewRestricted ? '' : " AND COALESCE(n.content_rating, 'general') <> 'restricted'"
  const limit = clampInt(c.req.query('limit'), 1, 100, 50)
  const rows = await all<Record<string, unknown>>(
    db,
    `SELECT t.*, n.title AS novel_title, c.title AS chapter_title,
            u.username AS user_username, u.display_name AS user_display_name, u.updated_at AS user_updated_at
     FROM thoughts t
     LEFT JOIN novels n ON n.id = t.novel_id
     LEFT JOIN chapters c ON c.id = t.chapter_id
     LEFT JOIN users u ON u.id = t.user_id
     WHERE t.user_id = $1${ratingFilter}
     ORDER BY t.created_at DESC
     LIMIT $2`,
    [user.id, limit],
  )
  return c.json({ thoughts: rows.map(rowToThoughtAdmin).filter((t) => t !== null), total: rows.length }, 200, contentPolicyHeaders())
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

async function createThought(c: Context<AuthEnv>, body: any, image?: { data: Uint8Array; taskId: string; revision: string; clientIp: string }) {
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

  const chapter = await first<{ id: string; novel_id: string; content: string; content_rating: string }>(
    db,
    `SELECT c.id, c.novel_id, c.content, n.content_rating
     FROM chapters c
     JOIN novels n ON n.id = c.novel_id
     WHERE c.id = $1`,
    [chapterId],
  )
  if (!chapter) return c.json({ error: 'Chapter not found' }, 404)
  if (chapter.novel_id !== novelId) return c.json({ error: 'chapterId does not belong to novelId' }, 400)
  if (image && selectionImageRevision(chapter.content) !== image.revision) return c.json({ error: '生成期间章节已变更，请重新划选' }, 409)
  if (chapter.content_rating === 'restricted') {
    const access = await resolveContentAccess(c)
    if (!access.canViewRestricted) return restrictedContentResponse(c, access.reason)
  }

  const user = c.get('user')
  if ((c.req.header('Authorization') || '').trim() && !user) return c.json({ error: '需要登录' }, 401)
  const clientHash = await hashValue(user?.id || c.req.header('X-Reader-Id') || '')
  const ipHash = await hashValue(image?.clientIp ?? clientIpFromContext(c))
  const uaHash = await hashValue(c.req.header('User-Agent') || '')
  const rate = await checkRateLimit(db, clientHash, ipHash)
  if (rate) return c.json({ error: rate }, 429)

  const id = newId('thought')
  const now = Date.now()
  const shownName = displayName || user?.display_name || user?.username || ''
  await withTx(db, async (query) => {
    if (image) {
      const task = await query<{ status: string }>('SELECT status FROM ai_tasks WHERE id = $1 FOR UPDATE', [image.taskId])
      if (!task.rows[0] || !['queued', 'running'].includes(task.rows[0].status)) throw new Error('图片任务已结束或取消')
      const current = await query<{ content: string }>('SELECT content FROM chapters WHERE id = $1 FOR SHARE', [chapterId])
      if (!current.rows[0] || selectionImageRevision(current.rows[0].content) !== image.revision) throw new Error('生成期间章节已变更，请重新划选')
    }
    await query(
      `INSERT INTO thoughts (
        id, novel_id, chapter_id, paragraph_index, paragraph_hash, selected_text,
        thought_text, display_name, client_id_hash, ip_hash, user_agent_hash,
        status, report_count, created_at, updated_at, user_id, has_image
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'visible', 0, $12, $12, $13, $14)`,
      [id, novelId, chapterId, paragraphIndex, paragraphHash, selectedText, thoughtText, shownName, clientHash, ipHash, uaHash, now, user?.id || '', Boolean(image)],
    )
    if (image) {
      await query('INSERT INTO thought_images (thought_id, data, content_type, created_at) VALUES ($1, $2, $3, $4)', [id, image.data, 'image/webp', now])
      await query("UPDATE ai_tasks SET status = 'completed', current = 1, step = '图片想法已发布', result = $1, updated_at = $2, finished_at = $2 WHERE id = $3", [JSON.stringify({ thoughtId: id }), now, image.taskId])
    }
  })

  const row = await first<Record<string, unknown>>(db, 'SELECT * FROM thoughts WHERE id = $1', [id])
  return c.json({ thought: rowToThought(row) }, 201, contentPolicyHeaders())
}

async function runThoughtImage(c: Context<AuthEnv>, input: Record<string, unknown>, task: AiTask, revision: string, clientIp: string) {
  const db = getDb()
  const stopHeartbeat = startAiTaskHeartbeat(db, task.id)
  try {
    if (!await updateAiTask(db, task.id, { status: 'running', step: '正在根据划选文字生成插画' })) return
    const settings = await getAiSettings(db)
    const provider = imageProvider()
    const result = await generateImage({ prompt: task.prompt, size: settings.imageSize, quality: settings.imageQuality, responseFormat: settings.imageResponseFormat })
    await recordUsage(db, { userId: task.userId, novelId: task.novelId, chapterId: String(input.chapterId),
      model: result.model, provider: imageProviderLabel(provider.baseUrl),
      promptTokens: result.promptTokens || 0, completionTokens: result.completionTokens || 0, imageCount: 1,
      costMillicents: result.cost * 100000, ...usageAuditFields(result), generationType: 'selection_image',
      ipAddress: settings.logIpAddress ? clientIp : '', userAgent: settings.logUserAgent ? c.req.header('User-Agent') : '' })
    if (result.data.byteLength > 20 * 1024 * 1024) throw new Error('生成图片过大，请重试')
    const data = await sharp(result.data, { limitInputPixels: 25_000_000 }).rotate().resize({ width: 1536, height: 1536, fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer()
    const currentSettings = await getAiSettings(db)
    const currentUser = await first<{ role: string; status: string }>(db, 'SELECT role, status FROM users WHERE id = $1', [task.userId])
    if (!currentUser || currentUser.status !== 'active' || !currentSettings.selectionImageRoles.includes(currentUser.role) || !currentSettings.selectionImageDailyQuota) throw new Error('生成权限已变更，图片未发布')
    c.set('user', { ...c.get('user'), role: currentUser.role })
    const response = await createThought(c, input, { data, taskId: task.id, revision, clientIp })
    if (!response.ok) {
      const body = await response.json() as { error?: string }
      throw new Error(body.error || '图片想法发布失败')
    }
  } catch (err) {
    await updateAiTask(db, task.id, { status: 'failed', step: '图片生成失败', error: err instanceof AiError ? err.message : (err as Error)?.message || '图片生成失败' })
  } finally {
    stopHeartbeat()
  }
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
