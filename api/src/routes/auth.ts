/**
 * /api/auth/* —— 用户账户（由 Novel-KV server/functions/api/auth.js 平移）。
 */
import { Hono, type Context } from 'hono'
import { loadConfig } from '../config'
import { getDb } from '../db/pool'
import { first, run } from '../db/query'
import { requireUser, type AuthEnv } from '../middlewares/auth'
import {
  bearerToken,
  cleanBio,
  cleanDisplayName,
  cleanUsername,
  hashPassword,
  hashToken,
  newId,
  newSalt,
  publicUser,
  validUsername,
  verifyPassword,
  type UserRow,
} from '../services/auth'
import { createSession, deleteSessionByToken, getUserByToken } from '../services/sessions'
import { cleanReaderSettings, cleanUpdatedAt, mergeReaderSettings, parseSettingsState } from '../services/reader-settings'
import { clientIpFromContext } from '../services/ai/audit-context'

const PUBLIC_USER_COLUMNS = 'id, username, display_name, bio, role, status, created_at, updated_at, last_login_at'
const LOGIN_USER_COLUMNS = PUBLIC_USER_COLUMNS + ', password_hash, password_salt, password_iterations'

export const authRoutes = new Hono<AuthEnv>()

// ---------- 公开 ----------

authRoutes.get('/register-status', async (c) => {
  const value = await setting('invite_required', '1')
  const mode = value === 'closed' ? 'closed' : value === '0' ? 'open' : 'invite'
  return c.json({ mode })
})

authRoutes.get('/bootstrap-admin', async (c) => {
  return c.json({ needsBootstrap: !(await adminExists()) })
})

authRoutes.post('/register', async (c) => {
  const db = getDb()
  const body = await c.req.json().catch(() => ({}))
  const username = cleanUsername(body.username)
  const password = String(body.password || '')
  const displayName = cleanDisplayName(body.displayName || username)
  const invite = String(body.invite || '').trim()

  const invalid = validateCredentials(username, password)
  if (invalid) return c.json({ error: invalid }, 400)

  const mode = await setting('invite_required', '1')
  if (mode === 'closed') return c.json({ error: '注册已关闭' }, 403)

  const now = Date.now()
  const id = newId('user')
  if (mode === '1') {
    if (!invite) return c.json({ error: '邀请码必填' }, 400)
    // 先原子认领再建号，避免并发注册都通过"检查后消费"的竞态
    const claimed = await run(
      db,
      'UPDATE invites SET used_at = $1, used_by = $2 WHERE code = $3 AND used_at = 0 AND disabled_at = 0',
      [now, id, invite],
    )
    if (!claimed) return c.json({ error: '邀请码无效或已使用' }, 400)
  }

  try {
    const salt = newSalt()
    const hash = await hashPassword(password, salt)
    await run(
      db,
      `INSERT INTO users (id, username, display_name, role, password_hash, password_salt, password_iterations, status, created_at, updated_at, last_login_at)
       VALUES ($1, $2, $3, 'reader', $4, $5, 120000, 'active', $6, $6, $6)`,
      [id, username, displayName, hash, salt, now],
    )
    const user = await publicUserById(db, id)
    const token = await createSession(db, id, c.req.header('User-Agent') || '', loadConfig().sessionHashSalt)
    return c.json({ user, token }, 201)
  } catch (err) {
    if (mode === '1') {
      await run(db, "UPDATE invites SET used_at = 0, used_by = '' WHERE code = $1 AND used_by = $2", [invite, id])
    }
    if (err instanceof Error && /unique/i.test(err.message)) return c.json({ error: '用户名已存在' }, 409)
    throw err
  }
})

authRoutes.post('/login', async (c) => {
  const db = getDb()
  const body = await c.req.json().catch(() => ({}))
  const username = cleanUsername(body.username)
  const password = String(body.password || '')
  const salt = loadConfig().sessionHashSalt
  const failKey = await hashToken('login:' + (username || 'unknown'), salt)
  // IP 维度：防止轮换用户名绕过按用户名的限流。IP 不可得时（测试等）跳过。
  const clientIp = clientIpFromContext(c)
  const ipKey = clientIp ? await hashToken('login-ip:' + clientIp, salt) : ''

  const limited =
    (await checkLoginLimit(db, failKey, LOGIN_LIMIT_PER_USERNAME)) ||
    (ipKey ? await checkLoginLimit(db, ipKey, LOGIN_LIMIT_PER_IP) : null)
  if (limited) {
    await recordLoginAudit(db, c, { username, status: 'limited', reason: 'rate_limited' })
    return c.json({ error: limited }, 429)
  }

  const user = await first<UserRow>(db, `SELECT ${LOGIN_USER_COLUMNS} FROM users WHERE username = $1 AND status = 'active'`, [username])
  if (!user || !(await verifyPassword(password, user))) {
    await recordLoginFailure(db, failKey)
    if (ipKey) await recordLoginFailure(db, ipKey)
    await recordLoginAudit(db, c, { username, status: 'failure', reason: 'invalid_credentials' })
    return c.json({ error: '用户名或密码错误' }, 401)
  }
  // 只清除用户名维度：成功登录不应重置 IP 维度的计数，
  // 否则攻击者可用自己的账号周期性登录来解除 IP 封锁
  await clearLoginFailures(db, failKey)
  const now = Date.now()
  await run(db, 'UPDATE users SET last_login_at = $1, updated_at = $1 WHERE id = $2', [now, user.id])
  user.last_login_at = now
  user.updated_at = now
  const token = await createSession(db, user.id, c.req.header('User-Agent') || '', salt)
  await recordLoginAudit(db, c, { userId: user.id, username: user.username, status: 'success', reason: 'login' })
  return c.json({ user: publicUser(user), token })
})

authRoutes.post('/bootstrap-admin', async (c) => {
  return createBootstrapAdmin(c)
})

// ---------- 登录用户 ----------

authRoutes.get('/me', requireUser(), async (c) => {
  return c.json({ user: publicUser(c.get('user')) })
})

authRoutes.put('/me', requireUser(), async (c) => {
  const db = getDb()
  const user = c.get('user')
  const body = await c.req.json().catch(() => ({}))
  const displayName = cleanDisplayName(body.displayName || user.display_name || user.username)
  const bio = cleanBio(body.bio || '')
  const now = Date.now()
  await run(db, 'UPDATE users SET display_name = $1, bio = $2, updated_at = $3 WHERE id = $4', [displayName, bio, now, user.id])
  const fresh = await publicUserById(db, user.id)
  return c.json({ user: fresh })
})

authRoutes.get('/reader-settings', requireUser(), async (c) => {
  const state = parseSettingsState(c.get('user').reader_settings ?? '')
  return c.json({ settings: state.values, updatedAt: state.updatedAt })
})

authRoutes.put('/reader-settings', requireUser(), async (c) => {
  const db = getDb()
  const user = c.get('user')
  const body = await c.req.json().catch(() => ({}))
  const current = parseSettingsState(user.reader_settings ?? '')
  const incoming = {
    values: cleanReaderSettings(body.settings || {}),
    updatedAt: cleanUpdatedAt(body.updatedAt || {}),
  }
  const merged = mergeReaderSettings(current, incoming)
  const now = Date.now()
  await run(db, 'UPDATE users SET reader_settings = $1, updated_at = $2 WHERE id = $3', [JSON.stringify(merged), now, user.id])
  return c.json({ success: true, settings: merged.values, updatedAt: merged.updatedAt })
})

authRoutes.post('/logout', requireUser(), async (c) => {
  const token = bearerToken(c.req.header('Authorization') || '')
  await deleteSessionByToken(getDb(), token, loadConfig().sessionHashSalt)
  return c.json({ success: true })
})

authRoutes.post('/logout-all', requireUser(), async (c) => {
  await run(getDb(), 'DELETE FROM user_sessions WHERE user_id = $1', [c.get('user').id])
  return c.json({ success: true })
})

authRoutes.post('/change-password', requireUser(), async (c) => {
  const db = getDb()
  const user = c.get('user')
  const body = await c.req.json().catch(() => ({}))
  const currentPassword = String(body.currentPassword || '')
  const newPassword = String(body.newPassword || '')
  if (!(await verifyPassword(currentPassword, user))) return c.json({ error: '当前密码不正确' }, 401)
  if (newPassword.length < 8) return c.json({ error: '密码至少 8 位' }, 400)

  const now = Date.now()
  const salt = newSalt()
  const hash = await hashPassword(newPassword, salt)
  await run(db, 'UPDATE users SET password_hash = $1, password_salt = $2, password_iterations = 120000, updated_at = $3 WHERE id = $4', [hash, salt, now, user.id])
  await run(db, 'DELETE FROM user_sessions WHERE user_id = $1', [user.id])
  const token = await createSession(db, user.id, c.req.header('User-Agent') || '', loadConfig().sessionHashSalt)
  const fresh = await publicUserById(db, user.id)
  return c.json({ user: fresh, token })
})

authRoutes.get('/sessions', requireUser(), async (c) => {
  const db = getDb()
  const user = c.get('user')
  const salt = loadConfig().sessionHashSalt
  const currentHash = await hashToken(bearerToken(c.req.header('Authorization') || ''), salt)
  const { rows } = await db.query<{ token_hash: string; created_at: number; expires_at: number; device_name: string }>(
    'SELECT token_hash, created_at, expires_at, device_name FROM user_sessions WHERE user_id = $1 AND expires_at > $2 ORDER BY created_at DESC',
    [user.id, Date.now()],
  )
  return c.json({
    sessions: rows.map((row) => ({
      id: row.token_hash,
      deviceName: row.device_name || '未知设备',
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      current: row.token_hash === currentHash,
    })),
  })
})

authRoutes.delete('/sessions', requireUser(), async (c) => {
  const db = getDb()
  const user = c.get('user')
  const target = c.req.query('id') || ''
  if (!target) return c.json({ error: 'id is required' }, 400)
  await run(db, 'DELETE FROM user_sessions WHERE user_id = $1 AND token_hash = $2', [user.id, target])
  const salt = loadConfig().sessionHashSalt
  const currentHash = await hashToken(bearerToken(c.req.header('Authorization') || ''), salt)
  return c.json({ success: true, current: target === currentHash })
})

authRoutes.put('/avatar', requireUser(), async (c) => {
  const db = getDb()
  const user = c.get('user')
  const form = await c.req.formData().catch(() => null)
  const file = form?.get('avatar')
  if (!file || typeof (file as File).arrayBuffer !== 'function') return c.json({ error: 'avatar file is required' }, 400)
  const type = String((file as File).type || '')
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(type)) {
    return c.json({ error: '头像必须是 JPG/PNG/WebP/GIF' }, 400)
  }
  const data = Buffer.from(await (file as File).arrayBuffer())
  if (!data.byteLength || data.byteLength > 1024 * 1024) return c.json({ error: '头像不能超过 1MB' }, 400)
  const now = Date.now()
  await db.query(
    `INSERT INTO user_avatars (user_id, data, content_type, updated_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data, content_type = EXCLUDED.content_type, updated_at = EXCLUDED.updated_at`,
    [user.id, data, type, now],
  )
  await run(db, 'UPDATE users SET updated_at = $1 WHERE id = $2', [now, user.id])
  const fresh = await publicUserById(db, user.id)
  return c.json({ user: fresh })
})

authRoutes.delete('/avatar', requireUser(), async (c) => {
  const db = getDb()
  const user = c.get('user')
  const now = Date.now()
  await run(db, 'DELETE FROM user_avatars WHERE user_id = $1', [user.id])
  await run(db, 'UPDATE users SET updated_at = $1 WHERE id = $2', [now, user.id])
  const fresh = await publicUserById(db, user.id)
  return c.json({ user: fresh })
})

// ---------- 内部辅助 ----------

async function createBootstrapAdmin(c: Context<AuthEnv>) {
  if (await adminExists()) return c.json({ error: '管理员已存在' }, 409)
  const db = getDb()
  const body = await c.req.json().catch(() => ({}))
  const username = cleanUsername(body.username)
  const password = String(body.password || '')
  const displayName = cleanDisplayName(body.displayName || username)
  const invalid = validateCredentials(username, password)
  if (invalid) return c.json({ error: invalid }, 400)

  try {
    if (await adminExists()) return c.json({ error: '管理员已存在' }, 409)
    const now = Date.now()
    const salt = newSalt()
    const hash = await hashPassword(password, salt)
    const id = newId('user')
    await run(
      db,
      `INSERT INTO users (id, username, display_name, role, password_hash, password_salt, password_iterations, status, created_at, updated_at, last_login_at)
       VALUES ($1, $2, $3, 'admin', $4, $5, 120000, 'active', $6, $6, 0)`,
      [id, username, displayName, hash, salt, now],
    )
    const user = await publicUserById(db, id)
    const token = await createSession(db, id, c.req.header('User-Agent') || '', loadConfig().sessionHashSalt)
    return c.json({ user, token }, 201)
  } catch (err) {
    if (err instanceof Error && /unique/i.test(err.message)) return c.json({ error: '用户名已存在' }, 409)
    throw err
  }
}

async function adminExists(): Promise<boolean> {
  return Boolean(await first(getDb(), "SELECT 1 FROM users WHERE role = 'admin' LIMIT 1"))
}

async function publicUserById(db: ReturnType<typeof getDb>, id: string) {
  const user = await first<UserRow>(db, `SELECT ${PUBLIC_USER_COLUMNS} FROM users WHERE id = $1`, [id])
  return publicUser(user)
}

function validateCredentials(username: string, password: string): string | null {
  if (!validUsername(username)) return '用户名需为 3-32 位字母、数字、下划线或短横线'
  if (password.length < 8) return '密码至少 8 位'
  return null
}

async function setting(key: string, fallback: string): Promise<string> {
  const row = await first<{ value: string }>(getDb(), 'SELECT value FROM app_settings WHERE key = $1', [key])
  return row ? row.value : fallback
}

const LOGIN_LIMIT_PER_USERNAME = 10
// 高于用户名维度：共享出口 IP（公司/校园 NAT）下多个真实用户可能同时登录
const LOGIN_LIMIT_PER_IP = 30

async function checkLoginLimit(db: ReturnType<typeof getDb>, keyHash: string, max: number): Promise<string | null> {
  const since = Date.now() - 15 * 60000
  const row = await first<{ total: number }>(
    db,
    'SELECT COUNT(*)::int AS total FROM login_failures WHERE key_hash = $1 AND created_at > $2',
    [keyHash, since],
  )
  if ((row?.total || 0) >= max) return '登录失败次数过多，请稍后再试'
  return null
}

async function recordLoginFailure(db: ReturnType<typeof getDb>, keyHash: string): Promise<void> {
  await run(db, 'INSERT INTO login_failures (key_hash, created_at) VALUES ($1, $2)', [keyHash, Date.now()])
}

async function clearLoginFailures(db: ReturnType<typeof getDb>, keyHash: string): Promise<void> {
  await run(db, 'DELETE FROM login_failures WHERE key_hash = $1 OR created_at <= $2', [keyHash, Date.now() - 86400000])
}

async function recordLoginAudit(
  db: ReturnType<typeof getDb>,
  c: Context<AuthEnv>,
  input: { userId?: string; username: string; status: 'success' | 'failure' | 'limited'; reason: string },
): Promise<void> {
  const ipAddress = clientIpFromContext(c)
  await run(
    db,
    `INSERT INTO login_audit (id, user_id, username, status, reason, ip_address, user_agent, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [newId('login'), input.userId || '', input.username, input.status, input.reason, ipAddress, c.req.header('User-Agent') || '', Date.now()],
  )
}
