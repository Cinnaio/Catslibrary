import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { app } from '../app'
import { runMigrations } from '../db/migrate'
import { setDbForTests } from '../db/pool'
import { createTestDb, type TestDb } from '../test/db'

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
  for (const name of ['DATABASE_URL', 'PASSKEY_RP_ID', 'PASSKEY_ORIGINS', 'SITE_URL', 'CORS_ORIGIN', 'CORS_ORIGINS']) vi.stubEnv(name, name === 'DATABASE_URL' ? 'postgres://fixture/test' : '')
  admin = (await (await request('/api/auth/bootstrap-admin', 'POST', { username: 'passkey-admin', password: 'fixturepass123' }, '')).json() as { token: string }).token
})

afterAll(async () => {
  vi.unstubAllEnvs()
  setDbForTests(null)
  await t.close()
})

describe('Passkey WebAuthn endpoints', () => {
  it('disabled by default and does not expose runtime details in public config', async () => {
    const config = await (await request('/api/auth/passkeys/config', 'GET', undefined, '')).json()
    expect(config).toEqual({ enabled: false, registrationEnabled: true, configured: true, rpName: '知舟' })
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
    const loginOptions = await (await request('/api/auth/passkeys/login/options', 'POST', {}, '')).json() as Record<string, any>
    expect(loginOptions).toMatchObject({ rpId: 'localhost', userVerification: 'required' })
    expect(typeof loginOptions.challenge).toBe('string')

    const registration = await request('/api/auth/passkeys/register/options', 'POST', { currentPassword: 'fixturepass123' })
    expect(registration.status).toBe(200)
    expect(await registration.json()).toMatchObject({ rp: { id: 'localhost', name: '书灯' }, authenticatorSelection: { residentKey: 'required', userVerification: 'required' } })
    expect(((await (await request('/api/auth/passkeys', 'GET')).json()) as { passkeys: unknown[] }).passkeys).toEqual([])
  })

  it('requires the current password before issuing registration options', async () => {
    const response = await request('/api/auth/passkeys/register/options', 'POST', { currentPassword: 'wrong-password' })
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ error: '当前密码不正确' })
  })

  it('repairs a previously-created user_passkeys table before listing credentials', async () => {
    await t.db.query('DROP INDEX IF EXISTS idx_user_passkeys_active_credential')
    await t.db.query('ALTER TABLE user_passkeys DROP COLUMN revoked_at')
    await t.db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`)
    for (let version = 1; version <= 61; version += 1) {
      await t.db.query('INSERT INTO schema_migrations (version, name) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING', [version, `${String(version).padStart(3, '0')}_legacy.sql`])
    }
    await runMigrations(t.db)

    const response = await request('/api/auth/passkeys', 'GET')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ passkeys: [] })
  })
})
