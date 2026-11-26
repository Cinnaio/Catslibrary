import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, rmdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as webpush from 'web-push'
import { Hono } from 'hono'
import { adminSiteSettingsRoutes } from './site-settings'
import { notificationRoutes } from './notifications'
import { createTestDb, type TestDb } from '../test/db'
import { setDbForTests } from '../db/pool'
import { hashToken } from '../services/auth'
import { loadConfig, PROJECT_ROOT } from '../config'
import { pushConfiguration, pushAdminSettings, savePushSettings, validVapidKeys } from '../services/push-settings'

const directory = mkdtempSync(path.join(tmpdir(), 'cats-push-settings-'))
const file = path.join(directory, 'push.json')
const initial = webpush.generateVAPIDKeys()
const input = { revision: 0, enabled: true, subject: 'mailto:owner@example.com', keyAction: 'generate' }
const tokens = { owner: 'o'.repeat(64), admin: 'a'.repeat(64), reader: 'r'.repeat(64) }
let t: TestDb
const app = new Hono().route('/api/admin/site-settings', adminSiteSettingsRoutes).route('/api/notifications', notificationRoutes)
function request(method = 'GET', body?: unknown, user: keyof typeof tokens | '' = 'owner', target = '/api/admin/site-settings/push') {
  return app.request(target, {
    method,
    headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${tokens[user]}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
beforeAll(async () => {
  t = await createTestDb()
  await t.applyMigrations()
  setDbForTests(t.db)
  for (const [id, role] of [
    ['owner', 'super_admin'],
    ['admin', 'admin'],
    ['reader', 'reader'],
  ] as const) {
    await t.db.query("INSERT INTO users(id,username,password_hash,password_salt,role,created_at,updated_at) VALUES($1,$1,'x','x',$2,1,1)", [id, role])
    await t.db.query('INSERT INTO user_sessions(token_hash,user_id,expires_at,created_at) VALUES($1,$2,$3,1)', [
      await hashToken(tokens[id], loadConfig().sessionHashSalt),
      id,
      Date.now() + 86400000,
    ])
  }
}, 30000)
beforeEach(() => {
  rmSync(file, { force: true })
  vi.stubEnv('WEB_PUSH_CONFIG_FILE', file)
  vi.stubEnv('WEB_PUSH_PUBLIC_KEY', '')
  vi.stubEnv('WEB_PUSH_PRIVATE_KEY', '')
  vi.stubEnv('WEB_PUSH_SUBJECT', '')
})
afterAll(async () => {
  vi.unstubAllEnvs()
  setDbForTests(null)
  await t.close()
  rmSync(file, { force: true })
  rmdirSync(directory)
})
it('only super administrators may read or change VAPID configuration', async () => {
  for (const user of ['', 'reader', 'admin'] as const) {
    expect([401, 403]).toContain((await request('GET', undefined, user)).status)
    expect([401, 403]).toContain((await request('PUT', input, user)).status)
  }
  const response = await request()
  expect(response.status).toBe(200)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
})
it('generates on the server, persists across reads, redacts private material and applies immediately', async () => {
  const response = await request('PUT', input)
  expect(response.status).toBe(200)
  const value = (await response.json()) as any
  expect(value).toMatchObject({ revision: 1, source: 'local', configured: true, privateKeySet: true })
  const stored = JSON.parse(readFileSync(file, 'utf8'))
  expect(validVapidKeys(stored.publicKey, stored.privateKey)).toBe(true)
  expect(JSON.stringify(value)).not.toContain(stored.privateKey)
  expect(value).not.toHaveProperty('privateKey')
  expect(pushConfiguration()).toMatchObject({ configured: true, publicKey: value.publicKey })
  const publicSettings = await request('GET', undefined, 'reader', '/api/notifications/settings')
  expect(await publicSettings.json()).toMatchObject({ pushConfigured: true, publicKey: value.publicKey })
  const audit = await t.db.query("SELECT * FROM admin_operation_audit WHERE scope='site-settings.push'")
  expect(JSON.stringify(audit.rows)).not.toContain(stored.privateKey)
})
it('imports matching keys, retains them when editing contact, and pauses without falling back to environment', async () => {
  vi.stubEnv('WEB_PUSH_PUBLIC_KEY', initial.publicKey)
  vi.stubEnv('WEB_PUSH_PRIVATE_KEY', initial.privateKey)
  vi.stubEnv('WEB_PUSH_SUBJECT', input.subject)
  expect(pushAdminSettings()).toMatchObject({ source: 'environment', configured: true })
  expect((await request('PUT', { ...input, keyAction: 'import', ...initial })).status).toBe(200)
  expect((await request('PUT', { ...input, revision: 1, keyAction: 'keep', subject: 'https://example.com/contact' })).status).toBe(200)
  expect(pushConfiguration()).toMatchObject({ privateKey: initial.privateKey, subject: 'https://example.com/contact' })
  expect((await request('PUT', { ...input, revision: 2, keyAction: 'keep', enabled: false })).status).toBe(200)
  expect(pushConfiguration().configured).toBe(false)
  expect(pushAdminSettings()).toMatchObject({ source: 'local', enabled: false, privateKeySet: true })
  expect((await request('PUT', { ...input, revision: 3, keyAction: 'keep' })).status).toBe(200)
  expect(pushConfiguration().publicKey).toBe(initial.publicKey)
})
it('rejects mismatched keys, invalid subjects and stale revisions without modifying saved secrets', async () => {
  expect((await request('PUT', input)).status).toBe(200)
  const before = readFileSync(file, 'utf8')
  expect(
    (
      await request('PUT', {
        ...input,
        revision: 1,
        keyAction: 'import',
        publicKey: initial.publicKey,
        privateKey: webpush.generateVAPIDKeys().privateKey,
        confirmRotation: true,
      })
    ).status,
  ).toBe(400)
  expect((await request('PUT', { ...input, revision: 1, subject: 'not a contact' })).status).toBe(400)
  expect((await request('PUT', { ...input, keyAction: 'keep' })).status).toBe(409)
  expect(readFileSync(file, 'utf8')).toBe(before)
})
it('requires explicit confirmation to rotate and accepts at most one writer per revision', async () => {
  expect((await request('PUT', input)).status).toBe(200)
  const old = pushAdminSettings().publicKey
  expect((await request('PUT', { ...input, revision: 1 })).status).toBe(409)
  const results = await Promise.all([
    request('PUT', { ...input, revision: 1, confirmRotation: true }),
    request('PUT', { ...input, revision: 1, confirmRotation: true }),
  ])
  expect(results.map((r) => r.status).sort()).toEqual([200, 409])
  expect(pushAdminSettings().publicKey).not.toBe(old)
  expect(pushAdminSettings().revision).toBe(2)
})
it('fails closed on corrupt private files while the personal inbox stays available', async () => {
  writeFileSync(file, '{bad', 'utf8')
  expect(pushConfiguration().configured).toBe(false)
  expect((await request()).status).toBe(503)
  expect((await request('GET', undefined, 'reader', '/api/notifications/settings')).status).toBe(200)
})
it('rejects static-file destinations without writing a secret', () => {
  vi.stubEnv('WEB_PUSH_CONFIG_FILE', path.join(PROJECT_ROOT, 'web', 'public', 'vapid-should-not-exist.json'))
  expect(() => savePushSettings({ ...input, keyAction: 'generate' })).toThrow('不能存入网站静态目录')
})
