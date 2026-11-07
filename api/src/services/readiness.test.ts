import { afterEach, expect, it, vi } from 'vitest'
import { createReadinessProbe, READINESS_SQL, type DatabaseState } from './readiness'
import { buildInfo, requiredMigrations } from './build-info'
import { createTestDb } from '../test/db'
import { runMigrations } from '../db/migrate'
import { app } from '../app'

const info = { ...buildInfo, apiVersion: '0.10.0', releaseSha: 'a'.repeat(40), migrations: [{ version: 1, name: '001_initial.sql' }] }
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })

it('存活与业务就绪分开，数据库未配置时就绪返回 503', async () => {
  vi.stubEnv('DATABASE_URL', '')
  expect((await app.request('/api/health')).status).toBe(200)
  const response = await app.request('/api/ready')
  expect(response.status).toBe(503)
  expect(await response.json()).toMatchObject({ ready: false, reason: 'not_configured' })
})

it('成功包含源码版本，缺少或被改名的迁移均不算就绪', async () => {
  const query = vi.fn().mockResolvedValue({ migrations: info.migrations, maintenance: 'false' })
  const probe = createReadinessProbe({ configured: () => true, query, info, cacheMs: 0 })
  expect(await probe()).toEqual({ ready: true, version: '0.10.0', release: 'a'.repeat(40) })
  query.mockResolvedValueOnce({ migrations: [], maintenance: 'false' })
  expect(await probe()).toMatchObject({ ready: false, reason: 'schema_pending' })
  query.mockResolvedValueOnce({ migrations: [{ version: 1, name: 'wrong.sql' }], maintenance: 'false' })
  expect(await probe()).toMatchObject({ ready: false, reason: 'schema_pending' })
})

it('连接异常不泄漏内部错误，备份维护期间拒绝就绪', async () => {
  const query = vi.fn().mockRejectedValueOnce(new Error('postgres://private-secret@example/database'))
    .mockResolvedValueOnce({ migrations: info.migrations, maintenance: 'true' })
  const probe = createReadinessProbe({ configured: () => true, query, info, cacheMs: 0 })
  expect(await probe()).toEqual({ ready: false, version: '0.10.0', release: info.releaseSha, reason: 'database_unavailable' })
  expect(await probe()).toMatchObject({ ready: false, reason: 'maintenance' })
})

it('探针总截止时间生效，并发请求复用查询和短暂缓存', async () => {
  vi.useFakeTimers()
  const query = vi.fn(() => new Promise<DatabaseState>(() => {}))
  const probe = createReadinessProbe({ configured: () => true, query, info, timeoutMs: 20, cacheMs: 100 })
  const requests = [probe(), probe(), probe()]
  expect(query).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(20)
  for (const request of requests) expect(await request).toMatchObject({ ready: false, reason: 'database_timeout' })
  expect(await probe()).toMatchObject({ reason: 'database_timeout' })
  expect(query).toHaveBeenCalledOnce()
})

it('运行时与发布要求不匹配时不查询数据库', async () => {
  const query = vi.fn()
  const probe = createReadinessProbe({ configured: () => true, query, info: { ...info, nodeVersion: '0.0.0' } })
  expect(await probe()).toMatchObject({ ready: false, reason: 'runtime_mismatch' })
  expect(query).not.toHaveBeenCalled()
})

it('实际 SQL 验证全部迁移、目录字段和维护状态', async () => {
  const test = await createTestDb()
  try {
    await runMigrations(test.db)
    const migrations = await requiredMigrations()
    const probe = createReadinessProbe({ configured: () => true, info: { ...info, migrations }, cacheMs: 0,
      query: async () => (await test.db.query<DatabaseState>(READINESS_SQL)).rows[0] })
    expect(await probe()).toMatchObject({ ready: true })
    await test.db.query("INSERT INTO backup_control.settings(key,value,updated_at) VALUES('maintenance','true',0) ON CONFLICT(key) DO UPDATE SET value='true'")
    expect(await probe()).toMatchObject({ ready: false, reason: 'maintenance' })
    await test.db.query("UPDATE backup_control.settings SET value='false' WHERE key='maintenance'")
    await test.db.query('DELETE FROM schema_migrations WHERE version=(SELECT MAX(version) FROM schema_migrations)')
    expect(await probe()).toMatchObject({ ready: false, reason: 'schema_pending' })
    await test.db.query('ALTER TABLE novels RENAME COLUMN content_rating TO missing_content_rating')
    expect(await probe()).toMatchObject({ ready: false, reason: 'database_unavailable' })
  } finally { await test.close() }
})
