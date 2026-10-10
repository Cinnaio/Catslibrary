import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { encryptionReady } from '../services/backups/config'
import { loadConfig } from '../config'
import { backupMaintenance } from './backup-maintenance'

const mocks = vi.hoisted(() => ({ connect: vi.fn(), query: vi.fn(), release: vi.fn(), maintenance: vi.fn() }))
vi.mock('pg', () => ({
  Pool: class {
    connect = mocks.connect
    on() {}
  },
}))
vi.mock('../services/backups/store', () => ({ maintenance: mocks.maintenance }))

const app = new Hono().use('*', backupMaintenance()).get('/api/example', (c) => c.json({ ok: true }))
beforeEach(() => {
  vi.clearAllMocks()
  mocks.connect.mockResolvedValue({ query: mocks.query, release: mocks.release })
  mocks.query.mockResolvedValue({ rows: [{ locked: true }] })
  mocks.maintenance.mockResolvedValue(false)
})
afterEach(() => vi.unstubAllEnvs())

describe('隔离测试配置与备份维护保护', () => {
  it('默认测试不加载部署数据库或主密钥，不创建维护连接', async () => {
    expect(loadConfig().configured).toBe(false)
    expect(encryptionReady()).toBe(false)
    expect((await app.request('/api/example')).status).toBe(200)
    expect(mocks.connect).not.toHaveBeenCalled()
  })
  it('显式启用备份时仍取得业务共享锁，并在完成后释放连接', async () => {
    vi.stubEnv('BACKUP_ENCRYPTION_KEY', Buffer.alloc(32, 1).toString('base64'))
    expect((await app.request('/api/example')).status).toBe(200)
    expect(mocks.query).toHaveBeenCalledWith('SELECT pg_try_advisory_lock_shared($1) AS locked', [730048])
    expect(mocks.query).toHaveBeenCalledWith('SELECT pg_advisory_unlock_shared($1)', [730048])
    expect(mocks.release).toHaveBeenCalledOnce()
  })
  it('维护中拒绝业务访问，但释放已取得的共享锁', async () => {
    vi.stubEnv('BACKUP_ENCRYPTION_KEY', Buffer.alloc(32, 1).toString('base64'))
    mocks.maintenance.mockResolvedValue(true)
    const response = await app.request('/api/example')
    expect(response.status).toBe(503)
    expect(response.headers.get('Retry-After')).toBe('30')
    expect(await response.json()).toMatchObject({ code: 'BACKUP_MAINTENANCE' })
    expect(mocks.query).toHaveBeenCalledWith('SELECT pg_advisory_unlock_shared($1)', [730048])
    expect(mocks.release).toHaveBeenCalledOnce()
  })
  it('无法取得共享锁时拒绝业务访问，不释放未持有的锁', async () => {
    vi.stubEnv('BACKUP_ENCRYPTION_KEY', Buffer.alloc(32, 1).toString('base64'))
    mocks.query.mockResolvedValue({ rows: [{ locked: false }] })
    expect((await app.request('/api/example')).status).toBe(503)
    expect(mocks.query).toHaveBeenCalledTimes(1)
    expect(mocks.maintenance).not.toHaveBeenCalled()
    expect(mocks.release).toHaveBeenCalledOnce()
  })
})
