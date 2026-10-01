import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { app } from '../app'
import { setDbForTests } from '../db/pool'
import { createTestDb, type TestDb } from '../test/db'

describe('管理员流量接口', () => {
  let db: TestDb
  let token = ''
  beforeAll(async () => {
    db = await createTestDb()
    await db.applyMigrations()
    setDbForTests(db.db)
    process.env.DATABASE_URL = 'postgres://test/test'
    const response = await app.request('/api/auth/bootstrap-admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'adminpass123' }),
    })
    expect(response.status).toBe(201)
    token = ((await response.json()) as { token: string }).token
  })
  afterAll(async () => {
    setDbForTests(null)
    delete process.env.DATABASE_URL
    await db.close()
  })
  it('无登录不能读取聚合数据', async () => {
    expect((await app.request('/api/admin/site/traffic')).status).toBe(401)
  })
  it('时间范围使用白名单，响应禁止缓存并补齐默认七日', async () => {
    const headers = { Authorization: `Bearer ${token}` }
    expect((await app.request('/api/admin/site/traffic?days=14', { headers })).status).toBe(400)
    const response = await app.request('/api/admin/site/traffic', { headers })
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    const data = (await response.json()) as { days: number; current: { dailyTrend: unknown[] }; timezone: string }
    expect(data.days).toBe(7)
    expect(data.current.dailyTrend).toHaveLength(7)
    expect(data.timezone).toBe('Asia/Shanghai')
  })
})
