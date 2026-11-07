import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { readdir } from 'node:fs/promises'
const webAuthnMocks = vi.hoisted(() => ({ verifyAuthenticationResponse: vi.fn() }))
vi.mock('@simplewebauthn/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@simplewebauthn/server')>()
  return { ...actual, verifyAuthenticationResponse: webAuthnMocks.verifyAuthenticationResponse }
})
import { app } from '../app'
import { runMigrations } from '../db/migrate'
import { setDbForTests } from '../db/pool'
import { createTestDb, type TestDb } from '../test/db'
import { loadConfig } from '../config'
import { hashToken, SESSION_TTL, REMEMBER_TTL } from '../services/auth'

let t: TestDb
let admin = ''

function request(path: string, method = 'GET', body?: unknown, token = admin) {
  return app.request(path, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

beforeAll(async () => {
  t = await createTestDb()
  await t.applyMigrations()
  setDbForTests(t.db)
  for (const name of ['DATABASE_URL', 'PASSKEY_RP_ID', 'PASSKEY_ORIGINS', 'SITE_URL', 'CORS_ORIGIN', 'CORS_ORIGINS'])
    vi.stubEnv(name, name === 'DATABASE_URL' ? 'postgres://fixture/test' : '')
  admin = (
    (await (await request('/api/auth/bootstrap-admin', 'POST', { username: 'passkey-admin', password: 'fixturepass123' }, '')).json()) as { token: string }
  ).token
})

afterAll(async () => {
  vi.unstubAllEnvs()
  setDbForTests(null)
  await t.close()
})

beforeEach(() => {
  webAuthnMocks.verifyAuthenticationResponse.mockReset()
})

describe('Passkey WebAuthn endpoints', () => {
  it('disabled by default and does not expose runtime details in public config', async () => {
    const config = await (await request('/api/auth/passkeys/config', 'GET', undefined, '')).json()
    expect(config).toEqual({ enabled: false, registrationEnabled: true, configured: true, rpName: 'Cat’s Library' })
    const response = await request('/api/auth/passkeys/login/options', 'POST', {}, '')
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'passkey_disabled' })
  })

  it('generates a discoverable login challenge and registration options after enabling', async () => {
    await t.db.query(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ('site_passkey', $1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
      [JSON.stringify({ enabled: true, registrationEnabled: true, rpName: '书灯' }), Date.now()],
    )
    const loginOptions = (await (await request('/api/auth/passkeys/login/options', 'POST', {}, '')).json()) as Record<string, any>
    expect(loginOptions).toMatchObject({ rpId: 'localhost', userVerification: 'required' })
    expect(typeof loginOptions.challenge).toBe('string')

    const registration = await request('/api/auth/passkeys/register/options', 'POST', { currentPassword: 'fixturepass123' })
    expect(registration.status).toBe(200)
    expect(await registration.json()).toMatchObject({
      rp: { id: 'localhost', name: '书灯' },
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    })
    expect(((await (await request('/api/auth/passkeys', 'GET')).json()) as { passkeys: unknown[] }).passkeys).toEqual([])
  })

  it('selects the same account by verified email and username', async () => {
    await t.db.query("UPDATE users SET email='Passkey@Example.com',email_verified_at=$1 WHERE username='passkey-admin'", [Date.now()])
    for (const username of ['passkey-admin', ' PASSKEY@example.COM ']) {
      const response = await request('/api/auth/passkeys/login/options', 'POST', { username }, '')
      expect(response.status).toBe(200)
      const { challenge } = await response.json() as { challenge: string }
      const stored = await t.db.query<{ username: string }>('SELECT u.username FROM webauthn_challenges c JOIN users u ON u.id=c.user_id WHERE c.challenge=$1', [challenge])
      expect(stored.rows[0]?.username).toBe('passkey-admin')
    }
    await t.db.query("UPDATE users SET email_verified_at=0 WHERE username='passkey-admin'")
    const options = await (await request('/api/auth/passkeys/login/options', 'POST', { username: 'passkey@example.com' }, '')).json() as { challenge: string }
    const stored = await t.db.query<{ user_id: string }>('SELECT user_id FROM webauthn_challenges WHERE challenge=$1', [options.challenge])
    expect(stored.rows[0]?.user_id).toBe('')
    await t.db.query("UPDATE users SET email=NULL,email_verified_at=0 WHERE username='passkey-admin'")
  })

  it('requires the current password before issuing registration options', async () => {
    const response = await request('/api/auth/passkeys/register/options', 'POST', { currentPassword: 'wrong-password' })
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ error: '当前密码不正确' })
  })

  it('管理员可以用强制 User Verification 的 Passkey 重新验证当前会话，且 challenge 不能重放', async () => {
    await t.db.query(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ('site_passkey', $1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
      [JSON.stringify({ enabled: true, registrationEnabled: true, rpName: '书灯' }), Date.now()],
    )
    const user = (await t.db.query<{ id: string }>('SELECT id FROM users WHERE username = $1', ['passkey-admin'])).rows[0]!
    const credentialId = 'fixture-reauth-credential'
    const now = Date.now()
    await t.db.query(
      `INSERT INTO user_passkeys (id, user_id, credential_id, public_key, user_handle, name, sign_count, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        'fixture-reauth-passkey',
        user.id,
        credentialId,
        Buffer.from('fixture-public-key').toString('base64url'),
        Buffer.from(user.id).toString('base64url'),
        '测试设备',
        4,
        now,
      ],
    )

    const optionsResponse = await request('/api/auth/passkeys/reauth/options', 'POST')
    expect(optionsResponse.status).toBe(200)
    const options = (await optionsResponse.json()) as Record<string, any>
    expect(options).toMatchObject({ rpId: 'localhost', userVerification: 'required' })
    expect(options.allowCredentials).toEqual([{ id: credentialId, transports: [], type: 'public-key' }])

    webAuthnMocks.verifyAuthenticationResponse.mockResolvedValueOnce({
      verified: true,
      authenticationInfo: { userVerified: true, newCounter: 5 },
    })
    const response = {
      id: credentialId,
      rawId: credentialId,
      type: 'public-key',
      response: {
        clientDataJSON: 'fixture-client-data',
        authenticatorData: 'fixture-authenticator-data',
        signature: 'fixture-signature',
        userHandle: Buffer.from(user.id).toString('base64url'),
      },
    }
    const verified = await request('/api/auth/passkeys/reauth/verify', 'POST', { challenge: options.challenge, response })
    expect(verified.status).toBe(200)
    expect(await verified.json()).toMatchObject({ success: true, expiresIn: 600 })
    expect(webAuthnMocks.verifyAuthenticationResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedChallenge: options.challenge,
        expectedRPID: 'localhost',
        expectedOrigin: ['http://localhost:5173'],
        requireUserVerification: true,
      }),
    )

    const stored = (
      await t.db.query<{ sign_count: number; last_used_at: number }>('SELECT sign_count,last_used_at FROM user_passkeys WHERE credential_id=$1', [credentialId])
    ).rows[0]!
    expect(Number(stored.sign_count)).toBe(5)
    expect(Number(stored.last_used_at)).toBeGreaterThan(0)
    const session = (await t.db.query<{ reauthenticated_at: number }>('SELECT reauthenticated_at FROM user_sessions WHERE user_id=$1', [user.id])).rows[0]!
    expect(Number(session.reauthenticated_at)).toBeGreaterThan(now)
    const settingWrite = await request('/api/admin/site-settings/passkey', 'PUT', { enabled: true, registrationEnabled: true, rpName: '书灯' })
    expect(settingWrite.status).toBe(200)

    const replay = await request('/api/auth/passkeys/reauth/verify', 'POST', { challenge: options.challenge, response })
    expect(replay.status).toBe(401)
    expect(webAuthnMocks.verifyAuthenticationResponse).toHaveBeenCalledOnce()
  })

  it('Passkey 重新验证即使签名通过也拒绝未完成 User Verification 的响应', async () => {
    const user = (await t.db.query<{ id: string }>('SELECT id FROM users WHERE username = $1', ['passkey-admin'])).rows[0]!
    await t.db.query('UPDATE user_sessions SET reauthenticated_at = 0 WHERE user_id = $1', [user.id])
    const options = (await (await request('/api/auth/passkeys/reauth/options', 'POST')).json()) as Record<string, any>
    webAuthnMocks.verifyAuthenticationResponse.mockResolvedValueOnce({
      verified: true,
      authenticationInfo: { userVerified: false, newCounter: 6 },
    })
    const credentialId = 'fixture-reauth-credential'
    const response = {
      id: credentialId,
      rawId: credentialId,
      type: 'public-key',
      response: { clientDataJSON: 'fixture', authenticatorData: 'fixture', signature: 'fixture' },
    }
    const rejected = await request('/api/auth/passkeys/reauth/verify', 'POST', { challenge: options.challenge, response })
    expect(rejected.status).toBe(401)
    expect(await rejected.json()).toMatchObject({ error: 'Passkey 验证失败，请使用设备验证后重试' })
    const session = (await t.db.query<{ reauthenticated_at: number }>('SELECT reauthenticated_at FROM user_sessions WHERE user_id=$1', [user.id])).rows[0]!
    expect(Number(session.reauthenticated_at)).toBe(0)
    const saved = await request('/api/admin/site-settings/passkey', 'PUT', { enabled: true, registrationEnabled: true, rpName: '书灯' })
    expect(saved.status).toBe(200)
  })

  it('管理员 Passkey 登录使用三十天或一百八十天会话，保持登录 Cookie 与数据库期限一致', async () => {
    for (const remember of [false, true]) {
      const options = (await (await request('/api/auth/passkeys/login/options', 'POST', {}, '')).json()) as { challenge: string }
      webAuthnMocks.verifyAuthenticationResponse.mockResolvedValueOnce({
        verified: true,
        authenticationInfo: { userVerified: true, newCounter: remember ? 7 : 6 },
      })
      const response = await app.request('http://localhost:5173/api/auth/passkeys/login/verify', {
        method: 'POST',
        headers: {
          Origin: 'http://localhost:5173',
          'Content-Type': 'application/json',
          'X-ZZ-CSRF': '1',
          'X-Session-Transport': 'cookie',
          'User-Agent': 'passkey-session-ttl',
        },
        body: JSON.stringify({
          challenge: options.challenge,
          remember,
          response: {
            id: 'fixture-reauth-credential',
            rawId: 'fixture-reauth-credential',
            type: 'public-key',
            response: { clientDataJSON: 'fixture', authenticatorData: 'fixture', signature: 'fixture' },
          },
        }),
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ user: { role: 'super_admin' }, remember })
      const cookie = response.headers.get('set-cookie')!
      const ttl = remember ? REMEMBER_TTL : SESSION_TTL
      if (remember) expect(cookie).toContain(`Max-Age=${ttl / 1000}`)
      else expect(cookie).not.toContain('Max-Age=')
      const hash = await hashToken(cookie.split(';')[0]!.split('=')[1]!, loadConfig().sessionHashSalt)
      const session = (
        await t.db.query<{ created_at: number; expires_at: number }>('SELECT created_at,expires_at FROM user_sessions WHERE token_hash=$1', [hash])
      ).rows[0]!
      expect(Number(session.expires_at) - Number(session.created_at)).toBe(ttl)
    }
  })

  it('repairs a previously-created user_passkeys table before listing credentials', async () => {
    await t.db.query('DROP INDEX IF EXISTS idx_user_passkeys_active_credential')
    await t.db.query('ALTER TABLE user_passkeys DROP COLUMN revoked_at')
    await t.db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`)
    // 测试库已经执行全部迁移，仅缺少上方主动移除的 062 修复字段。
    // 按实际文件记账，避免新增迁移后重复创建已经存在的表。
    for (const file of (await readdir(new URL('../db/migrations', import.meta.url))).filter((name) => name.endsWith('.sql'))) {
      const version = Number.parseInt(file, 10)
      if (version === 62) continue
      await t.db.query('INSERT INTO schema_migrations (version, name) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING', [
        version,
        file,
      ])
    }
    await expect(runMigrations(t.db)).resolves.toEqual(['062_passkey_schema_repair.sql'])

    const response = await request('/api/auth/passkeys', 'GET')
    expect(response.status).toBe(200)
    const listed = (await response.json()) as { passkeys: { id: string }[] }
    expect(listed.passkeys).toHaveLength(1)
    expect(listed.passkeys[0]).toMatchObject({ id: 'fixture-reauth-passkey' })
  })
})
