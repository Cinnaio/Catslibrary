import { isUserRole } from '@shared/roles'
import { AccountError, withManagedAccount, protectLastSuper, accountSnapshot, auditAccount } from '../services/account-security'
import { issueAccountEmail, limitEmailRequest } from '../services/account-email'
/**
 * /api/admin-users —— 用户管理 + 邀请码 + 注册设置（由 Novel-KV admin-users.js 平移）。
 */
import { Hono, type Context } from 'hono'
import { randomInt } from 'node:crypto'
import { getDb } from '../db/pool'
import { all, first, run, withTx } from '../db/query'
import { publicUser, userAvatarUrl, type UserRow } from '../services/auth'
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
    `SELECT a.id, a.user_id, a.username, a.status, a.reason, a.ip_address, a.user_agent, a.created_at, a.auth_method,
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
      authMethod: String(row.auth_method || 'password'),
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
  if (role && !isUserRole(role)) return c.json({ error: '角色筛选无效' }, 400)
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
    SELECT u.id, u.username, u.display_name, u.role, u.status, u.email, u.email_verified_at, u.created_at, u.updated_at, u.last_login_at,
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
      `SELECT u.id, u.username, u.display_name, u.role, u.status, u.email, u.email_verified_at, u.created_at, u.updated_at, u.last_login_at, COUNT(t.id) AS thought_count
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
      if (self.role !== 'super_admin') return c.json({ error: '需要超级管理员权限' }, 403)
      return updateSettings(c, db, body.registerMode)
    case 'set-password':
      return c.json({ error: '请使用邮件重置密码；本人改密请到个人中心' }, 410)
    case 'user-status':
    case 'user-role':
    case 'reset-password':
    case 'revoke-sessions':
    case 'delete-user':
      return mutateAccount(c, db, body, self)
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

async function mutateAccount(c: Ctx, db: ReturnType<typeof getDb>, body: Record<string, unknown>, self: UserRow) {
  try {
    const id = String(body.id || '').trim()
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : ''
    if (!id || !reason) return c.json({ error: '请选择目标账号并填写操作原因' }, 400)
    const result = await withManagedAccount(db, self.id, id, body, async (tx, actor, target) => {
      const action = String(body.action)
      if (action === 'reset-password') {
        if (!target.email || !target.email_verified_at) throw new AccountError('该用户尚未绑定已验证邮箱，请由用户先绑定邮箱')
        return { email: target.email, role: target.role, status: target.status }
      }
      if (action === 'user-role') {
        if (actor.role !== 'super_admin') throw new AccountError('只有超级管理员可以授予或撤销管理权限', 403)
        if (!isUserRole(body.role)) throw new AccountError('角色无效')
        await protectLastSuper(tx, target, body.role, target.status)
        await tx.query('UPDATE users SET role=$2,updated_at=$3 WHERE id=$1', [id, body.role, Date.now()])
      } else if (action === 'user-status') {
        if (body.status !== 'active' && body.status !== 'disabled') throw new AccountError('状态无效')
        if (id === actor.id && body.status === 'disabled') throw new AccountError('不能禁用自己的账号')
        await protectLastSuper(tx, target, target.role, body.status)
        await tx.query('UPDATE users SET status=$2,updated_at=$3 WHERE id=$1', [id, body.status, Date.now()])
      } else if (action === 'delete-user') {
        if (id === actor.id) throw new AccountError('不能删除自己的账号')
        if (body.confirmUsername !== target.username) throw new AccountError('用户名确认不匹配')
        await protectLastSuper(tx, target, '', 'disabled')
        await tx.query('DELETE FROM novel_comment_reports WHERE reported_by=$1 OR resolved_by=$1 OR comment_id IN (SELECT id FROM novel_comments WHERE user_id=$1)', [id])
        await tx.query('DELETE FROM novel_comment_likes WHERE user_id=$1 OR comment_id IN (SELECT id FROM novel_comments WHERE user_id=$1)', [id])
        await tx.query('DELETE FROM novel_comments WHERE user_id=$1', [id])
        await tx.query('DELETE FROM novel_ratings WHERE user_id=$1', [id])
        await tx.query('DELETE FROM thoughts WHERE user_id=$1', [id])
        await tx.query('DELETE FROM reading_progress WHERE user_id=$1', [id])
        await tx.query('DELETE FROM users WHERE id=$1', [id])
      }
      await tx.query('DELETE FROM user_sessions WHERE user_id=$1', [id])
      await tx.query('DELETE FROM account_email_tokens WHERE user_id=$1', [id])
      await auditAccount(tx, actor.id, id, action, reason, accountSnapshot(target),
        action === 'delete-user' ? { deleted: true } : { ...accountSnapshot(target),
          ...(action === 'user-role' ? { role: body.role } : {}), ...(action === 'user-status' ? { status: body.status } : {}) })
      return null
    })
    if (result?.email) {
      await limitEmailRequest(db, `admin-recovery:${self.id}`)
      await issueAccountEmail(db, id, result.email, 'reset-password', self.id, result, reason, true)
    }
    return c.json({ success: true })
  } catch (error) {
    if (error instanceof AccountError) return c.json({ error: error.message }, error.status)
    throw error
  }
}
