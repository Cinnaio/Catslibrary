/**
 * /api/admin-users —— 用户管理 + 邀请码 + 注册设置（由 Novel-KV admin-users.js 平移）。
 */
import { Hono, type Context } from 'hono'
import { randomInt } from 'node:crypto'
import { getDb } from '../db/pool'
import { all, first, run, withTx } from '../db/query'
import { hashPassword, newSalt, newToken, newId, PASSWORD_ITERATIONS, publicUser, userAvatarUrl, type UserRow } from '../services/auth'
import { escapeLike } from '../services/text'
import { requireAdmin, type AuthEnv } from '../middlewares/auth'
import { idempotencyKeyFromRequest, withIdempotency } from '../services/idempotency'

export const adminUsersRoutes = new Hono<AuthEnv>()

type Ctx = Context<AuthEnv>

adminUsersRoutes.use('*', requireAdmin())

adminUsersRoutes.get('/login-audit', async (c) => {
  const db = getDb()
  const status = c.req.query('status')
  const username = c.req.query('username')?.trim()
  const requestedLimit = Number.parseInt(c.req.query('limit') || '50', 10)
  const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 50, 10), 100)
  const offset = Math.max(Number.parseInt(c.req.query('offset') || '0', 10) || 0, 0)
  const conditions: string[] = []
  const params: unknown[] = []

  if (status && ['success', 'failure', 'limited'].includes(status)) {
    params.push(status)
    conditions.push(`a.status = $${params.length}`)
  }
  if (username) {
    params.push(`%${escapeLike(username)}%`)
    conditions.push(`a.username ILIKE $${params.length}`)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const rows = await all<Record<string, unknown>>(
    db,
    `SELECT a.id, a.user_id, a.username, a.status, a.reason, a.ip_address, a.user_agent, a.created_at,
            u.display_name, u.id AS current_user_id, u.updated_at AS user_updated_at
     FROM login_audit a
     LEFT JOIN users u ON u.id = a.user_id
     ${where}
     ORDER BY a.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  )
  const total = await first<{ total: number }>(db, `SELECT COUNT(*)::int AS total FROM login_audit a ${where}`, params)

  return c.json({
    audits: rows.map((row) => ({
      id: String(row.id),
      userId: String(row.user_id || ''),
      username: String(row.username || ''),
      displayName: String(row.display_name || ''),
      avatarUrl: userAvatarUrl(String(row.current_user_id || ''), Number(row.user_updated_at) || 0),
      status: String(row.status || ''),
      reason: String(row.reason || ''),
      ipAddress: String(row.ip_address || ''),
      userAgent: String(row.user_agent || ''),
      createdAt: Number(row.created_at) || 0,
    })),
    total: Number(total?.total) || 0,
    limit,
    offset,
  })
})

// 独立目录接口保留原账户设置接口的兼容性，并支持完整用户集合。
adminUsersRoutes.get('/users', async (c) => {
  const db = getDb()
  const role = c.req.query('role')
  const status = c.req.query('status')
  if (role && !['admin', 'reader'].includes(role)) return c.json({ error: '角色筛选无效' }, 400)
  if (status && !['active', 'disabled'].includes(status)) return c.json({ error: '状态筛选无效' }, 400)
  const requestedLimit = Number(c.req.query('limit') || 15)
  const requestedOffset = Number(c.req.query('offset') || 0)
  const limit = Math.min(100, Math.max(1, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 15))
  const offset = Math.max(0, Number.isFinite(requestedOffset) ? Math.floor(requestedOffset) : 0)
  const params: unknown[] = []
  const conditions: string[] = []
  const search = c.req.query('search')?.trim()
  if (search) {
    params.push(`%${escapeLike(search)}%`)
    conditions.push(`(u.username ILIKE $${params.length} OR u.display_name ILIKE $${params.length})`)
  }
  if (role) {
    params.push(role)
    conditions.push(`u.role = $${params.length}`)
  }
  if (status) {
    params.push(status)
    conditions.push(`u.status = $${params.length}`)
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const total = await first<{ total: number }>(db, `SELECT COUNT(*)::int AS total FROM users u ${where}`, params)
  const users = await all<Record<string, unknown>>(
    db,
    `
    SELECT u.id, u.username, u.display_name, u.role, u.status, u.created_at, u.updated_at, u.last_login_at,
      (SELECT COUNT(*)::int FROM thoughts t WHERE t.user_id = u.id) AS thought_count
    FROM users u ${where} ORDER BY u.created_at DESC, u.id DESC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  )
  c.header('Cache-Control', 'no-store')
  return c.json({
    users: users.map((row) => ({ ...publicUser(row as unknown as UserRow)!, thoughtCount: Number(row.thought_count) || 0 })),
    total: total?.total || 0,
    limit,
    offset,
  })
})

adminUsersRoutes.get('/', async (c) => {
  const db = getDb()
  const [settings, invites, users, schemaHealth] = await Promise.all([
    first<{ value: string }>(db, "SELECT value FROM app_settings WHERE key = 'invite_required'"),
    all<Record<string, unknown>>(
      db,
      `SELECT i.*, u.username AS used_username, u.display_name AS used_display_name
       FROM invites i
       LEFT JOIN users u ON u.id = i.used_by
       ORDER BY i.created_at DESC, i.code DESC`,
    ),
    all<Record<string, unknown>>(
      db,
      `SELECT u.id, u.username, u.display_name, u.role, u.status, u.created_at, u.updated_at, u.last_login_at, COUNT(t.id) AS thought_count
       FROM users u
       LEFT JOIN thoughts t ON t.user_id = u.id
       GROUP BY u.id
       ORDER BY u.created_at DESC LIMIT 100`,
    ),
    schemaHealthCheck(db),
  ])
  return c.json({
    settings: { registerMode: registerModeFromSetting(settings?.value ?? '1') },
    schemaHealth,
    invites: invites.map((row) => ({
      code: String(row.code),
      createdAt: Number(row.created_at),
      usedAt: Number(row.used_at) || 0,
      usedBy: String(row.used_by || ''),
      usedByName: String(row.used_display_name || row.used_username || row.used_by || ''),
      disabledAt: Number(row.disabled_at) || 0,
    })),
    users: users.map((row) => Object.assign(publicUser(row as unknown as UserRow) || {}, { thoughtCount: Number(row.thought_count) || 0 })),
  })
})

adminUsersRoutes.post('/', async (c) => {
  const db = getDb()
  const self = c.get('user')
  const body = await c.req.json().catch(() => ({}))
  const action = body.action
  switch (action) {
    case 'invite':
      return createInvite(c, db, body.count)
    case 'disable-invite':
      return disableInvite(c, db, body.code)
    case 'clear-invites':
      return clearInvites(c, db, body)
    case 'settings':
      return updateSettings(c, db, body.registerMode)
    case 'user-status':
      return updateUserStatus(c, db, body, self)
    case 'user-role':
      return updateUserRole(c, db, body, self)
    case 'set-password':
      return setPassword(c, db, body, self)
    case 'reset-password':
      return resetPassword(c, db, body, self)
    case 'delete-user':
      return deleteUser(c, db, body, self)
    default:
      return c.json({ error: 'Method not allowed' }, 405)
  }
})

// ---------- 内部辅助 ----------

function registerModeFromSetting(value: string): 'closed' | 'open' | 'invite' {
  return value === 'closed' ? 'closed' : value === '0' ? 'open' : 'invite'
}

async function schemaHealthCheck(db: ReturnType<typeof getDb>) {
  const required: Record<string, string[]> = {
    users: ['display_name', 'bio', 'status', 'last_login_at'],
    user_sessions: ['token_hash', 'user_id', 'expires_at', 'created_at'],
    login_audit: ['username', 'status', 'ip_address', 'user_agent', 'created_at'],
    reading_progress: ['user_id', 'deleted_at'],
    user_bookmarks: ['user_id', 'novel_id', 'chapter_id', 'updated_at'],
    thoughts: ['user_id'],
  }
  const missing: string[] = []
  for (const [table, columns] of Object.entries(required)) {
    let names = new Set<string>()
    try {
      const rows = await all<{ name: string }>(
        db,
        'SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1',
        [table],
      )
      names = new Set(rows.map((r) => r.name))
    } catch {
      /* ignore */
    }
    if (!names.size) {
      missing.push(table + ' 表')
      continue
    }
    columns.forEach((column) => {
      if (!names.has(column)) missing.push(table + '.' + column)
    })
  }
  return { ok: missing.length === 0, missing }
}

async function createInvite(c: Ctx, db: ReturnType<typeof getDb>, count: unknown) {
  const n = Math.min(50, Math.max(1, Number.parseInt(String(count), 10) || 1))
  const now = Date.now()
  const year = new Date(now).getUTCFullYear()
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const codes = await withTx(db, async (query) => {
    const generated: string[] = []
    for (let i = 0; i < n; i++) {
      let inserted = false
      for (let attempt = 0; attempt < 20; attempt++) {
        const segment = () => Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join('')
        const code = `${segment()}-${segment()}-${year}`
        const result = await query(
          'INSERT INTO invites (code, created_at, used_at, used_by, disabled_at) VALUES ($1, $2, 0, $3, 0) ON CONFLICT (code) DO NOTHING',
          [code, now, ''],
        )
        if (result.rowCount) {
          generated.push(code)
          inserted = true
          break
        }
      }
      if (!inserted) throw new Error('邀请码生成失败，请重试')
    }
    return generated
  })
  return c.json({ code: codes[0], codes }, 201)
}

async function disableInvite(c: Ctx, db: ReturnType<typeof getDb>, code: unknown) {
  code = String(code || '').trim()
  if (!code) return c.json({ error: 'code is required' }, 400)
  await run(db, 'UPDATE invites SET disabled_at = $1 WHERE code = $2 AND used_at = 0', [Date.now(), code])
  return c.json({ success: true })
}

async function clearInvites(c: Ctx, db: ReturnType<typeof getDb>, body: Record<string, any>) {
  const operationKey = idempotencyKeyFromRequest(c, body, ['operationId'])
  const hasSnapshot = Array.isArray(body.codes)
  const codes = hasSnapshot ? Array.from(new Set(body.codes.map((code: unknown) => String(code || '').trim()).filter(Boolean))) : []
  if (operationKey && !hasSnapshot) {
    return c.json({ error: '批量清理邀请码必须携带确认时的 codes 快照', code: 'confirmation_snapshot_required' }, 409)
  }

  return withIdempotency(
    db,
    {
      scope: `admin-users.clear-invites.${c.get('user').id}`,
      operationKey,
      payload: { action: 'clear-invites', codes },
      audit: { actorUserId: c.get('user').id, action: 'clear-invites', targetCount: codes.length },
    },
    async () => {
      const removed = hasSnapshot
        ? await run(db, 'DELETE FROM invites WHERE code = ANY($1) AND (used_at > 0 OR disabled_at > 0)', [codes])
        : await run(db, 'DELETE FROM invites WHERE used_at > 0 OR disabled_at > 0')
      return c.json({ success: true, removed, codes })
    },
  )
}

async function updateSettings(c: Ctx, db: ReturnType<typeof getDb>, modeValue: unknown) {
  const mode = String(modeValue || '')
  if (!['open', 'invite', 'closed'].includes(mode)) return c.json({ error: 'registerMode 必须是 open、invite 或 closed' }, 400)
  const value = mode === 'closed' ? 'closed' : mode === 'open' ? '0' : '1'
  await run(
    db,
    `INSERT INTO app_settings (key, value, updated_at) VALUES ('invite_required', $1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
    [value, Date.now()],
  )
  return c.json({ settings: { registerMode: mode } })
}

async function loadTargetUser(
  db: ReturnType<typeof getDb>,
  id: unknown,
  selfId: string,
  forbidSelf: string,
): Promise<{ target?: UserRow; error?: { message: string; status: number } }> {
  id = String(id || '').trim()
  if (!id) return { error: { message: 'id is required', status: 400 } }
  const target = await first<UserRow>(db, 'SELECT * FROM users WHERE id = $1', [id])
  if (!target) return { error: { message: '用户不存在', status: 404 } }
  if (forbidSelf && target.id === selfId) return { error: { message: forbidSelf, status: 400 } }
  return { target }
}

async function updateUserStatus(c: Ctx, db: ReturnType<typeof getDb>, body: any, self: UserRow) {
  const status = body.status === 'disabled' ? 'disabled' : 'active'
  const { target, error } = await loadTargetUser(db, body.id, self.id, status === 'disabled' ? '不能禁用自己的账号' : '')
  if (error) return c.json({ error: error.message }, error.status as 400)
  await run(db, 'UPDATE users SET status = $1, updated_at = $2 WHERE id = $3', [status, Date.now(), target!.id])
  if (status === 'disabled') await run(db, 'DELETE FROM user_sessions WHERE user_id = $1', [target!.id])
  return c.json({ success: true })
}

async function updateUserRole(c: Ctx, db: ReturnType<typeof getDb>, body: any, self: UserRow) {
  const role = String(body.role || '')
  if (!['admin', 'reader'].includes(role)) return c.json({ error: 'role 必须是 admin 或 reader' }, 400)
  const { target, error } = await loadTargetUser(db, body.id, self.id, role !== 'admin' ? '不能降级自己的账号' : '')
  if (error) return c.json({ error: error.message }, error.status as 400)
  await run(db, 'UPDATE users SET role = $1, updated_at = $2 WHERE id = $3', [role, Date.now(), target!.id])
  return c.json({ success: true, role })
}

async function setPassword(c: Ctx, db: ReturnType<typeof getDb>, body: Record<string, unknown>, self: UserRow) {
  if (typeof body.newPassword !== 'string' || body.newPassword.length < 8) return c.json({ error: '新密码至少需要 8 位' }, 400)
  const { target, error } = await loadTargetUser(db, body.id, self.id, '修改本人密码需要验证当前密码')
  if (error) return c.json({ error: error.message }, error.status as 400)
  const salt = newSalt()
  const hash = await hashPassword(body.newPassword, salt)
  const now = Date.now()
  // 密码、会话和审计一起提交，失败时旧密码与会话均保留。
  const updated = await withTx(db, async (q) => {
    const locked = await q('SELECT id FROM users WHERE id = $1 FOR UPDATE', [target!.id])
    if (!locked.rows.length) return false
    await q('UPDATE users SET password_hash = $1, password_salt = $2, password_iterations = $3, updated_at = $4 WHERE id = $5', [
      hash,
      salt,
      PASSWORD_ITERATIONS,
      now,
      target!.id,
    ])
    await q('DELETE FROM user_sessions WHERE user_id = $1', [target!.id])
    // 审计仅记录操作元数据；不保存密码、盐、请求正文或其摘要。
    await q(
      `INSERT INTO admin_operation_audit
      (id, operation_id, scope, actor_user_id, action, target_count, request_hash, status, response_status, created_at, updated_at, finished_at)
      VALUES ($1, $2, $3, $4, 'set-password', 1, '', 'completed', 200, $5, $5, $5)`,
      [newId('adminop'), newId('passwordop'), `admin-users.set-password.${self.id}.${target!.id}`, self.id, now],
    )
    return true
  })
  c.header('Cache-Control', 'no-store')
  return updated ? c.json({ success: true }) : c.json({ error: '用户不存在' }, 404)
}

async function resetPassword(c: Ctx, db: ReturnType<typeof getDb>, body: any, self: UserRow) {
  const { target, error } = await loadTargetUser(db, body.id, self.id, '')
  if (error) return c.json({ error: error.message }, error.status as 400)
  const tempPassword = newToken().slice(0, 12)
  const now = Date.now()
  const salt = newSalt()
  const hash = await hashPassword(tempPassword, salt)
  await run(db, 'UPDATE users SET password_hash = $1, password_salt = $2, password_iterations = 120000, updated_at = $3 WHERE id = $4', [
    hash,
    salt,
    now,
    target!.id,
  ])
  await run(db, 'DELETE FROM user_sessions WHERE user_id = $1', [target!.id])
  return c.json({ success: true, username: target!.username, tempPassword })
}

async function deleteUser(c: Ctx, db: ReturnType<typeof getDb>, body: any, self: UserRow) {
  const { target, error } = await loadTargetUser(db, body.id, self.id, '不能删除自己的账号')
  if (error) return c.json({ error: error.message }, error.status as 400)
  if (
    String(body.confirmUsername || '')
      .trim()
      .toLowerCase() !== target!.username
  ) {
    return c.json({ error: '用户名确认不匹配' }, 400)
  }
  // 无 FK 的表显式清理（thoughts/reading_progress 的 user_id 是裸文本列）；
  // 其余 user 相关的评论/点赞/举报/评分/书签/书架经 FK 级联。
  await withTx(db, async (q) => {
    await q(
      'DELETE FROM novel_comment_reports WHERE reported_by = $1 OR resolved_by = $1 OR comment_id IN (SELECT id FROM novel_comments WHERE user_id = $1)',
      [target!.id],
    )
    await q('DELETE FROM novel_comment_likes WHERE user_id = $1 OR comment_id IN (SELECT id FROM novel_comments WHERE user_id = $1)', [target!.id])
    await q('DELETE FROM novel_comments WHERE user_id = $1', [target!.id])
    await q('DELETE FROM novel_ratings WHERE user_id = $1', [target!.id])
    await q('DELETE FROM thoughts WHERE user_id = $1', [target!.id])
    await q('DELETE FROM reading_progress WHERE user_id = $1', [target!.id])
    await q('DELETE FROM users WHERE id = $1', [target!.id])
  })
  return c.json({ success: true })
}
