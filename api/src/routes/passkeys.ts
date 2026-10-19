import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server'
import type { AuthenticationResponseJSON, RegistrationResponseJSON, WebAuthnCredential } from '@simplewebauthn/server'
import { Hono } from 'hono'
import { getDb, type Db, type DbClient } from '../db/pool'
import { first, run, withTx } from '../db/query'
import { requireAdmin, requireUser, type AuthEnv } from '../middlewares/auth'
import { requestSession, sessionResponse } from '../services/browser-session'
import {
  ADMIN_SESSION_TTL,
  REMEMBER_TTL,
  REAUTH_TTL,
  SESSION_TTL,
  cleanUsername,
  deviceName,
  hashToken,
  newId,
  publicUser,
  type UserRow,
  verifyPassword,
} from '../services/auth'
import { createSession } from '../services/sessions'
import { getPasskeyRuntimeConfig, getPasskeySettings } from '../services/passkey-settings'
import { loadConfig } from '../config'
import { recordLoginAudit } from '../services/login-audit'
import { markSessionReauthenticated } from '../services/reauthentication'

const CHALLENGE_TTL = 5 * 60_000
const MAX_PASSKEYS_PER_USER = 10
const PUBLIC_USER_COLUMNS = 'id, username, display_name, bio, role, status, created_at, updated_at, last_login_at'

interface PasskeyRow {
  id: string
  user_id: string
  credential_id: string
  public_key: string
  user_handle: string
  name: string
  sign_count: number
  transports: string
  backup_eligible: boolean
  backup_state: boolean
  created_at: number
  last_used_at: number
  last_user_agent: string
  revoked_at: number
}

interface ChallengeRow {
  id: string
  user_id: string
  session_hash: string
  purpose: 'login' | 'register' | 'reauth'
  challenge: string
  expires_at: number
  created_at: number
}

export const passkeyRoutes = new Hono<AuthEnv>()
passkeyRoutes.use('*', async (c, next) => {
  c.header('Cache-Control', 'private, no-store')
  await next()
})

/** 登录页只拿到是否开放，不暴露 RP ID / Origin。 */
passkeyRoutes.get('/config', async (c) => {
  const settings = await getPasskeySettings()
  const runtime = getPasskeyRuntimeConfig()
  return c.json({ enabled: settings.enabled, registrationEnabled: settings.registrationEnabled, configured: runtime.configured, rpName: settings.rpName })
})

passkeyRoutes.post('/login/options', async (c) => {
  const settings = await getPasskeySettings()
  const runtime = getPasskeyRuntimeConfig()
  if (!settings.enabled) return c.json({ error: 'Passkey 登录未启用', code: 'passkey_disabled' }, 403)
  if (!runtime.configured) return c.json({ error: 'Passkey 尚未完成部署配置', code: 'passkey_not_configured' }, 503)

  const body = asRecord(await c.req.json().catch(() => ({})))
  const username = cleanUsername(body.username)
  const user = username
    ? await first<UserRow>(getDb(), `SELECT ${PUBLIC_USER_COLUMNS} FROM users WHERE username = $1 AND status = 'active'`, [username])
    : undefined
  const credentials = user ? await listPasskeyRows(getDb(), user.id) : []
  const options = await generateAuthenticationOptions({
    rpID: runtime.rpId,
    userVerification: 'required',
    ...(credentials.length ? { allowCredentials: credentials.map((row) => ({ id: row.credential_id, transports: parseTransports(row.transports) })) } : {}),
  })

  const now = Date.now()
  const db = getDb()
  await run(db, 'DELETE FROM webauthn_challenges WHERE purpose = $1 AND (expires_at <= $2 OR created_at <= $3)', ['login', now, now - CHALLENGE_TTL])
  await run(
    db,
    `INSERT INTO webauthn_challenges (id, user_id, session_hash, purpose, challenge, expires_at, created_at)
     VALUES ($1, $2, '', 'login', $3, $4, $5)`,
    [newId('challenge'), user?.id || '', options.challenge, now + CHALLENGE_TTL, now],
  )
  return c.json(options)
})

passkeyRoutes.post('/login/verify', async (c) => {
  const settings = await getPasskeySettings()
  const runtime = getPasskeyRuntimeConfig()
  if (!settings.enabled) return c.json({ error: 'Passkey 登录未启用', code: 'passkey_disabled' }, 403)
  if (!runtime.configured) return c.json({ error: 'Passkey 尚未完成部署配置', code: 'passkey_not_configured' }, 503)

  const body = asRecord(await c.req.json().catch(() => ({})))
  const challenge = typeof body.challenge === 'string' ? body.challenge : ''
  const response = asRecord(body.response) as unknown as AuthenticationResponseJSON
  if (!challenge || !response.id || !response.response) return c.json({ error: 'Passkey 登录请求无效' }, 400)

  const db = getDb()
  const challengeRow = await first<ChallengeRow>(db, `SELECT * FROM webauthn_challenges WHERE challenge = $1 AND purpose = 'login' AND expires_at > $2`, [
    challenge,
    Date.now(),
  ])
  if (!challengeRow) return c.json({ error: '登录请求已过期，请重试' }, 401)
  const credentialId = String(response.id || response.rawId || '')
  const credential = await first<PasskeyRow>(db, `SELECT * FROM user_passkeys WHERE credential_id = $1 AND revoked_at = 0 AND ($2 = '' OR user_id = $2)`, [
    credentialId,
    challengeRow.user_id,
  ])
  if (!credential) {
    await consumeChallenge(db, challengeRow.id)
    return c.json({ error: '无法识别此 Passkey' }, 401)
  }
  if (response.response.userHandle && response.response.userHandle !== credential.user_handle) {
    await consumeChallenge(db, challengeRow.id)
    return c.json({ error: 'Passkey 账户不匹配' }, 401)
  }

  let verification
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challengeRow.challenge,
      expectedOrigin: runtime.origins,
      expectedRPID: runtime.rpId,
      credential: toWebAuthnCredential(credential),
      requireUserVerification: true,
    })
  } catch {
    await consumeChallenge(db, challengeRow.id)
    return c.json({ error: 'Passkey 验证失败，请重试' }, 401)
  }
  if (!verification.verified || !verification.authenticationInfo.userVerified) {
    await consumeChallenge(db, challengeRow.id)
    return c.json({ error: 'Passkey 验证失败，请重试' }, 401)
  }
  const nextCounter = verification.authenticationInfo.newCounter
  const previousCounter = Number(credential.sign_count || 0)
  // Counter 0 is explicitly allowed by synced/multi-device credentials. For
  // credentials that report counters, a regression is treated as a clone signal.
  if (previousCounter > 0 && nextCounter > 0 && nextCounter <= previousCounter) {
    await consumeChallenge(db, challengeRow.id)
    return c.json({ error: 'Passkey 状态异常，请重新注册设备' }, 401)
  }

  const remember = body.remember === true
  const userAgent = c.req.header('User-Agent') || ''
  try {
    const result = await withTx(db, async (query) => {
      const deleted = await query("DELETE FROM webauthn_challenges WHERE id = $1 AND purpose = 'login' AND expires_at > $2", [challengeRow.id, Date.now()])
      if (!deleted.rowCount) throw new Error('challenge_consumed')
      const tx = { query } as Db
      const now = Date.now()
      await query(`UPDATE user_passkeys SET sign_count = GREATEST(sign_count, $1), last_used_at = $2, last_user_agent = $3 WHERE credential_id = $4`, [
        nextCounter,
        now,
        userAgent,
        credential.id,
      ])
      await query('UPDATE users SET last_login_at = $1, updated_at = $1 WHERE id = $2', [now, credential.user_id])
      const user = await first<UserRow>(tx, `SELECT ${PUBLIC_USER_COLUMNS} FROM users WHERE id = $1 AND status = 'active'`, [credential.user_id])
      if (!user) throw new Error('user_missing')
      const salt = loadConfig().sessionHashSalt
      const token = await createSession(tx, user.id, userAgent, salt, remember ? REMEMBER_TTL : SESSION_TTL)
      await recordLoginAudit(tx, c, {
        userId: user.id,
        username: user.username,
        status: 'success',
        reason: 'login',
        authMethod: 'passkey',
        passkeyId: credential.id,
      })
      return { user, token }
    })
    return c.json({
      user: publicUser(result.user),
      ...sessionResponse(c, result.token, result.user.role === 'admin' ? ADMIN_SESSION_TTL : remember ? REMEMBER_TTL : SESSION_TTL, remember),
    })
  } catch (error) {
    if (error instanceof Error && (error.message === 'challenge_consumed' || error.message === 'user_missing'))
      return c.json({ error: '登录请求已失效，请重试' }, 401)
    throw error
  }
})

passkeyRoutes.post('/reauth/options', requireAdmin(), async (c) => {
  const settings = await getPasskeySettings()
  const runtime = getPasskeyRuntimeConfig()
  if (!settings.enabled) return c.json({ error: 'Passkey 登录未启用', code: 'passkey_disabled' }, 403)
  if (!runtime.configured) return c.json({ error: 'Passkey 尚未完成部署配置', code: 'passkey_not_configured' }, 503)

  const user = c.get('user')
  const db = getDb()
  const credentials = await listPasskeyRows(db, user.id)
  if (!credentials.length) return c.json({ error: '当前账号没有可用 Passkey', code: 'passkey_unavailable' }, 409)

  const options = await generateAuthenticationOptions({
    rpID: runtime.rpId,
    userVerification: 'required',
    allowCredentials: credentials.map((row) => ({ id: row.credential_id, transports: parseTransports(row.transports) })),
  })
  const sessionHash = await hashToken(requestSession(c), loadConfig().sessionHashSalt)
  const now = Date.now()
  await run(db, 'DELETE FROM webauthn_challenges WHERE purpose = $1 AND (user_id = $2 OR session_hash = $3)', ['reauth', user.id, sessionHash])
  await run(
    db,
    `INSERT INTO webauthn_challenges (id, user_id, session_hash, purpose, challenge, expires_at, created_at)
     VALUES ($1, $2, $3, 'reauth', $4, $5, $6)`,
    [newId('challenge'), user.id, sessionHash, options.challenge, now + CHALLENGE_TTL, now],
  )
  return c.json(options)
})

passkeyRoutes.post('/reauth/verify', requireAdmin(), async (c) => {
  const settings = await getPasskeySettings()
  const runtime = getPasskeyRuntimeConfig()
  if (!settings.enabled) return c.json({ error: 'Passkey 登录未启用', code: 'passkey_disabled' }, 403)
  if (!runtime.configured) return c.json({ error: 'Passkey 尚未完成部署配置', code: 'passkey_not_configured' }, 503)

  const body = asRecord(await c.req.json().catch(() => ({})))
  const challenge = typeof body.challenge === 'string' ? body.challenge : ''
  const response = asRecord(body.response) as unknown as AuthenticationResponseJSON
  if (!challenge || !response.id || !response.response) return c.json({ error: 'Passkey 重新验证请求无效' }, 400)

  const user = c.get('user')
  const sessionHash = await hashToken(requestSession(c), loadConfig().sessionHashSalt)
  const db = getDb()
  const challengeRow = await first<ChallengeRow>(
    db,
    `SELECT * FROM webauthn_challenges
     WHERE challenge = $1 AND purpose = 'reauth' AND user_id = $2 AND session_hash = $3 AND expires_at > $4`,
    [challenge, user.id, sessionHash, Date.now()],
  )
  if (!challengeRow) return c.json({ error: '验证请求已过期，请重试' }, 401)

  const credentialId = String(response.id || response.rawId || '')
  const credential = await first<PasskeyRow>(db, 'SELECT * FROM user_passkeys WHERE credential_id = $1 AND user_id = $2 AND revoked_at = 0', [
    credentialId,
    user.id,
  ])
  if (!credential) {
    await consumeChallenge(db, challengeRow.id)
    return c.json({ error: '无法识别此 Passkey' }, 401)
  }
  if (response.response.userHandle && response.response.userHandle !== credential.user_handle) {
    await consumeChallenge(db, challengeRow.id)
    return c.json({ error: 'Passkey 账户不匹配' }, 401)
  }

  let verification
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challengeRow.challenge,
      expectedOrigin: runtime.origins,
      expectedRPID: runtime.rpId,
      credential: toWebAuthnCredential(credential),
      requireUserVerification: true,
    })
  } catch {
    await consumeChallenge(db, challengeRow.id)
    return c.json({ error: 'Passkey 验证失败，请重试' }, 401)
  }
  if (!verification.verified || !verification.authenticationInfo.userVerified) {
    await consumeChallenge(db, challengeRow.id)
    return c.json({ error: 'Passkey 验证失败，请使用设备验证后重试' }, 401)
  }

  const nextCounter = verification.authenticationInfo.newCounter
  const previousCounter = Number(credential.sign_count || 0)
  if (previousCounter > 0 && nextCounter > 0 && nextCounter <= previousCounter) {
    await consumeChallenge(db, challengeRow.id)
    return c.json({ error: 'Passkey 状态异常，请重新注册设备' }, 401)
  }

  try {
    await withTx(db, async (query) => {
      const deleted = await query("DELETE FROM webauthn_challenges WHERE id = $1 AND purpose = 'reauth' AND expires_at > $2", [challengeRow.id, Date.now()])
      if (!deleted.rowCount) throw new Error('challenge_consumed')
      const now = Date.now()
      await query(
        'UPDATE user_passkeys SET sign_count = GREATEST(sign_count, $1), last_used_at = $2, last_user_agent = $3 WHERE credential_id = $4 AND user_id = $5',
        [nextCounter, now, c.req.header('User-Agent') || '', credential.credential_id, user.id],
      )
      if (!(await markSessionReauthenticated({ query } as Db, sessionHash, user.id))) throw new Error('session_missing')
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'challenge_consumed') return c.json({ error: '验证请求已失效，请重试' }, 401)
    if (error instanceof Error && error.message === 'session_missing') return c.json({ error: '会话已失效，请重新登录' }, 401)
    throw error
  }
  return c.json({ success: true, expiresIn: REAUTH_TTL / 1000 })
})

passkeyRoutes.get('/', requireUser(), async (c) => {
  const rows = await listPasskeyRows(getDb(), c.get('user').id)
  return c.json({ passkeys: rows.map(serializePasskey) })
})

passkeyRoutes.post('/register/options', requireUser(), async (c) => {
  const user = c.get('user')
  const settings = await getPasskeySettings()
  const runtime = getPasskeyRuntimeConfig()
  if (!settings.enabled || !settings.registrationEnabled) return c.json({ error: 'Passkey 注册未开放', code: 'passkey_registration_disabled' }, 403)
  if (!runtime.configured) return c.json({ error: 'Passkey 尚未完成部署配置', code: 'passkey_not_configured' }, 503)

  const body = asRecord(await c.req.json().catch(() => ({})))
  if (typeof body.currentPassword !== 'string' || !(await verifyPassword(body.currentPassword, user))) return c.json({ error: '当前密码不正确' }, 401)
  const rows = await listPasskeyRows(getDb(), user.id)
  if (rows.length >= MAX_PASSKEYS_PER_USER) return c.json({ error: `最多注册 ${MAX_PASSKEYS_PER_USER} 个 Passkey`, code: 'passkey_limit_reached' }, 409)
  const options = await generateRegistrationOptions({
    rpName: settings.rpName,
    rpID: runtime.rpId,
    userName: user.username,
    userID: new TextEncoder().encode(user.id),
    userDisplayName: user.display_name || user.username,
    attestationType: 'none',
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    excludeCredentials: rows.map((row) => ({ id: row.credential_id, transports: parseTransports(row.transports) })),
  })
  const session = requestSession(c)
  const sessionHash = await hashToken(session, loadConfig().sessionHashSalt)
  const now = Date.now()
  const db = getDb()
  await run(db, 'DELETE FROM webauthn_challenges WHERE purpose = $1 AND (user_id = $2 OR session_hash = $3)', ['register', user.id, sessionHash])
  await run(
    db,
    `INSERT INTO webauthn_challenges (id, user_id, session_hash, purpose, challenge, expires_at, created_at)
     VALUES ($1, $2, $3, 'register', $4, $5, $6)`,
    [newId('challenge'), user.id, sessionHash, options.challenge, now + CHALLENGE_TTL, now],
  )
  return c.json(options)
})

passkeyRoutes.post('/register/verify', requireUser(), async (c) => {
  const user = c.get('user')
  const settings = await getPasskeySettings()
  const runtime = getPasskeyRuntimeConfig()
  if (!settings.enabled || !settings.registrationEnabled) return c.json({ error: 'Passkey 注册未开放', code: 'passkey_registration_disabled' }, 403)
  if (!runtime.configured) return c.json({ error: 'Passkey 尚未完成部署配置', code: 'passkey_not_configured' }, 503)

  const body = asRecord(await c.req.json().catch(() => ({})))
  const challenge = typeof body.challenge === 'string' ? body.challenge : ''
  const response = asRecord(body.response) as unknown as RegistrationResponseJSON
  if (!challenge || !response.id || !response.response) return c.json({ error: 'Passkey 注册请求无效' }, 400)
  const sessionHash = await hashToken(requestSession(c), loadConfig().sessionHashSalt)
  const db = getDb()
  const challengeRow = await first<ChallengeRow>(
    db,
    `SELECT * FROM webauthn_challenges WHERE challenge = $1 AND purpose = 'register' AND user_id = $2 AND session_hash = $3 AND expires_at > $4`,
    [challenge, user.id, sessionHash, Date.now()],
  )
  if (!challengeRow) return c.json({ error: '注册请求已过期，请重试' }, 401)

  let verification
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challengeRow.challenge,
      expectedOrigin: runtime.origins,
      expectedRPID: runtime.rpId,
      requireUserVerification: true,
    })
  } catch {
    await consumeChallenge(db, challengeRow.id)
    return c.json({ error: 'Passkey 注册验证失败，请重试' }, 400)
  }
  if (!verification.verified || !verification.registrationInfo.userVerified) {
    await consumeChallenge(db, challengeRow.id)
    return c.json({ error: 'Passkey 注册验证失败，请重试' }, 400)
  }

  const info = verification.registrationInfo
  const credentialId = info.credential.id
  const now = Date.now()
  const name = cleanPasskeyName(body.name) || `设备 ${new Date(now).toLocaleDateString('zh-CN')}`
  try {
    const row = await withTx(db, async (query) => {
      const deleted = await query("DELETE FROM webauthn_challenges WHERE id = $1 AND purpose = 'register' AND expires_at > $2", [challengeRow.id, Date.now()])
      if (!deleted.rowCount) throw new Error('challenge_consumed')
      await query(
        `INSERT INTO user_passkeys (id, user_id, credential_id, public_key, user_handle, name, sign_count, transports, backup_eligible, backup_state, created_at, last_user_agent)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          newId('passkey'),
          user.id,
          credentialId,
          Buffer.from(info.credential.publicKey).toString('base64url'),
          Buffer.from(user.id).toString('base64url'),
          name,
          info.credential.counter,
          JSON.stringify(info.credential.transports || []),
          info.credentialDeviceType === 'multiDevice',
          info.credentialBackedUp,
          now,
          c.req.header('User-Agent') || '',
        ],
      )
      return first<PasskeyRow>({ query } as Db, 'SELECT * FROM user_passkeys WHERE credential_id = $1', [credentialId])
    })
    return c.json({ passkey: row ? serializePasskey(row) : null }, 201)
  } catch (error) {
    await consumeChallenge(db, challengeRow.id)
    if (error instanceof Error && error.message === 'challenge_consumed') return c.json({ error: '注册请求已失效，请重试' }, 409)
    if (error instanceof Error && /unique/i.test(error.message)) return c.json({ error: '此 Passkey 已经注册' }, 409)
    throw error
  }
})

passkeyRoutes.patch('/:id', requireUser(), async (c) => {
  const body = asRecord(await c.req.json().catch(() => ({})))
  const name = cleanPasskeyName(body.name)
  if (!name) return c.json({ error: '名称不能为空' }, 400)
  if (name.length > 80) return c.json({ error: '名称不能超过 80 个字符' }, 400)
  const result = await run(getDb(), 'UPDATE user_passkeys SET name = $1 WHERE id = $2 AND user_id = $3 AND revoked_at = 0', [
    name,
    c.req.param('id'),
    c.get('user').id,
  ])
  if (!result) return c.json({ error: 'Passkey 不存在' }, 404)
  const row = await first<PasskeyRow>(getDb(), 'SELECT * FROM user_passkeys WHERE id = $1 AND user_id = $2 AND revoked_at = 0', [
    c.req.param('id'),
    c.get('user').id,
  ])
  return c.json({ passkey: row ? serializePasskey(row) : null })
})

passkeyRoutes.delete('/:id', requireUser(), async (c) => {
  const result = await run(getDb(), 'UPDATE user_passkeys SET revoked_at = $1 WHERE id = $2 AND user_id = $3 AND revoked_at = 0', [
    Date.now(),
    c.req.param('id'),
    c.get('user').id,
  ])
  if (!result) return c.json({ error: 'Passkey 不存在' }, 404)
  return c.json({ success: true })
})

async function listPasskeyRows(db: DbClient, userId: string): Promise<PasskeyRow[]> {
  const { rows } = await db.query<PasskeyRow>('SELECT * FROM user_passkeys WHERE user_id = $1 AND revoked_at = 0 ORDER BY created_at DESC', [userId])
  return rows
}

async function consumeChallenge(db: DbClient, id: string): Promise<void> {
  await run(db, 'DELETE FROM webauthn_challenges WHERE id = $1', [id])
}

function toWebAuthnCredential(row: PasskeyRow): WebAuthnCredential {
  return {
    id: row.credential_id,
    publicKey: new Uint8Array(Buffer.from(row.public_key, 'base64url')),
    counter: Number(row.sign_count || 0),
    transports: parseTransports(row.transports),
  }
}

function parseTransports(value: string): string[] {
  try {
    const parsed = JSON.parse(value || '[]')
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : []
  } catch {
    return []
  }
}

function serializePasskey(row: PasskeyRow) {
  return {
    id: row.id,
    name: row.name || '未命名设备',
    createdAt: Number(row.created_at),
    lastUsedAt: Number(row.last_used_at || 0),
    deviceName: row.last_user_agent ? deviceName(row.last_user_agent) : '',
    transports: parseTransports(row.transports),
    backupEligible: Boolean(row.backup_eligible),
    backupState: Boolean(row.backup_state),
  }
}

function cleanPasskeyName(value: unknown): string {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {}
}
