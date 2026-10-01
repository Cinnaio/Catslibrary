import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { app } from '../app'
import { setDbForTests } from '../db/pool'
import { createTestDb, type TestDb } from '../test/db'
let t: TestDb
let token = ''
beforeAll(async () => {
  t = await createTestDb()
  await t.applyMigrations()
  setDbForTests(t.db)
  process.env.DATABASE_URL = 'postgres://test/test'
  const response = await app.request('/api/auth/bootstrap-admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'adminpass123' }),
  })
  expect(response.status).toBe(201)
  token = ((await response.json()) as { token: string }).token
  for (let i = 0; i < 105; i++)
    await t.db.query(`INSERT INTO invites (code,created_at,used_at,used_by,disabled_at) VALUES ($1,$2,0,'',0)`, [`invite-${String(i).padStart(3, '0')}`, i + 1])
}, 30000)
afterAll(async () => {
  setDbForTests(null)
  delete process.env.DATABASE_URL
  await t.close()
})
describe('邀请码目录完整集合', () => {
  it('仅管理员可读取，返回超过一百个码以支持全量搜索和统计', async () => {
    expect((await app.request('/api/admin-users')).status).toBe(401)
    const response = await app.request('/api/admin-users', { headers: { Authorization: `Bearer ${token}` } })
    expect(response.status).toBe(200)
    const data = (await response.json()) as { invites: Array<{ code: string }> }
    expect(data.invites).toHaveLength(105)
    expect(data.invites[0]?.code).toBe('invite-104')
    expect(data.invites[104]?.code).toBe('invite-000')
  })
})
