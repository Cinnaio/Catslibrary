import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { app } from '../app'
import { setDbForTests } from '../db/pool'
import { createTestDb, type TestDb } from '../test/db'

let t: TestDb
let adminToken = ''

beforeAll(async () => {
  t = await createTestDb()
  await t.applyMigrations()
  setDbForTests(t.db)
  process.env.DATABASE_URL = 'postgres://test/test'

  const response = await app.request('/api/auth/bootstrap-admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'audit-test/1.0', 'X-Forwarded-For': '198.51.100.12' },
    body: JSON.stringify({ username: 'admin', password: 'adminpass123' }),
  })
  expect(response.status).toBe(201)
  adminToken = (await response.json() as { token: string }).token
})

afterAll(async () => {
  setDbForTests(null)
  delete process.env.DATABASE_URL
  await t.close()
})

describe('login audit API', () => {
  it('records successful and failed logins with request metadata', async () => {
    const common = { 'Content-Type': 'application/json', 'User-Agent': 'audit-test/2.0', 'X-Forwarded-For': '198.51.100.12' }
    const failed = await app.request('/api/auth/login', {
      method: 'POST',
      headers: common,
      body: JSON.stringify({ username: 'admin', password: 'wrong-pass' }),
    })
    expect(failed.status).toBe(401)

    const succeeded = await app.request('/api/auth/login', {
      method: 'POST',
      headers: common,
      body: JSON.stringify({ username: 'admin', password: 'adminpass123' }),
    })
    expect(succeeded.status).toBe(200)

    const audit = await app.request('/api/admin-users/login-audit?status=success&username=admin', {
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    expect(audit.status).toBe(200)
    const data = await audit.json() as { audits: Array<{ username: string; status: string; ipAddress: string; userAgent: string }>; total: number }
    expect(data.total).toBe(1)
    expect(data.audits[0]).toMatchObject({ username: 'admin', status: 'success', ipAddress: '198.51.100.12', userAgent: 'audit-test/2.0' })

    const failures = await app.request('/api/admin-users/login-audit?status=failure&username=admin', {
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    expect((await failures.json() as { total: number }).total).toBe(1)
  })
})
