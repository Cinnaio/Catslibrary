import { Hono } from 'hono'
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest'
import { backupRoutes } from './backups'
import { setDbForTests, type Db } from '../db/pool'
import { createTestDb, type TestDb } from '../test/db'
import { createSession } from '../services/sessions'
import { hashPassword } from '../services/auth'
import { enqueue, setSetting } from '../services/backups/store'
import { defaultPolicy } from '../services/backups/config'

const app = new Hono().route('/api/admin/backups', backupRoutes)
let fixture: TestDb,
  db: Db,
  admin = '',
  reader = ''
function call(path: string, method = 'GET', body?: unknown, token = admin) {
  return app.request(`/api/admin/backups${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
}
beforeAll(async () => {
  fixture = await createTestDb()
  await fixture.applyMigrations()
  const base = fixture.db
  // PGlite 没有会话级 advisory lock；控制表唯一约束、事务及 SQL 仍用真实数据库语义。
  const query: Db['query'] = async (text, params) => (/pg_advisory_xact_lock/.test(text) ? { rows: [], rowCount: 0 } : base.query(text, params))
  db = {
    ...base,
    query,
    async connect() {
      const client = await base.connect()
      return {
        query: async (text, params) =>
          /pg_try_advisory_xact_lock/.test(text)
            ? { rows: [{ locked: true }] as any, rowCount: 1 }
            : /pg_advisory_xact_lock/.test(text)
              ? { rows: [], rowCount: 0 }
              : client.query(text, params),
        release: () => client.release(),
      }
    },
  }
  setDbForTests(db)
  vi.stubEnv('BACKUP_ENCRYPTION_KEY', Buffer.alloc(32, 3).toString('base64'))
  vi.stubEnv('BACKUP_ALLOWED_HOSTS', 'backup.example.com')
  vi.stubEnv('SESSION_HASH_SALT', 'backup-fixture-salt')
  const salt = '0123456789abcdef',
    hash = await hashPassword('fixture-password', salt, 1000)
  for (const role of ['admin', 'reader']) {
    await db.query(
      'INSERT INTO users(id,username,role,password_hash,password_salt,password_iterations,created_at,updated_at) VALUES($1,$1,$2,$3,$4,1000,1,1)',
      [role, role, hash, salt],
    )
    const token = await createSession(db, role, 'fixture', 'backup-fixture-salt')
    if (role === 'admin') admin = token
    else reader = token
  }
})
afterAll(async () => {
  setDbForTests(null)
  await fixture.close()
  vi.unstubAllEnvs()
})
describe('备份管理权限、幂等及敏感边界', () => {
  it('游客和普通用户不能读取版本、日志或下载归档', async () => {
    for (const token of ['', reader])
      for (const path of ['/versions', '/logs', '/versions/example/download']) expect([401, 403]).toContain((await call(path, 'GET', undefined, token)).status)
  })
  it('SFTP 密码不回显、不以明文存储，目标更新检查 revision', async () => {
    const body = {
      name: '备份服务器',
      type: 'sftp',
      enabled: true,
      required: true,
      host: 'backup.example.com',
      port: 22,
      path: '/backups',
      username: 'backup',
      hostKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIA==',
      bucket: '',
      region: '',
      retention: 30,
      password: 'secret-fixture',
    }
    const response = await call('/targets', 'POST', body)
    expect(response.status).toBe(200)
    const target = (await response.json()) as { id: string; revision: number; credentialSet: boolean }
    expect(target.credentialSet).toBe(true)
    expect(JSON.stringify(target)).not.toContain('secret-fixture')
    const row = await db.query<{ secret: string }>('SELECT secret FROM backup_control.targets WHERE id=$1', [target.id])
    expect(row.rows[0]!.secret).not.toContain('secret-fixture')
    expect((await call('/targets', 'POST', { ...body, id: target.id, revision: 0 })).status).toBe(409)
    expect((await call('/targets', 'POST', { ...body, password: undefined, id: target.id, revision: 1 })).status).toBe(200)
  })
  it('重复操作仅创建一个版本，同 ID 不同内容返回冲突', async () => {
    const body = { operationId: 'backup-operation-fixture', targetIds: [], note: '测试版本' }
    const first = await call('/versions', 'POST', body),
      second = await call('/versions', 'POST', body)
    expect(first.status).toBe(202)
    expect(await first.json()).toEqual(await second.json())
    expect((await call('/versions', 'POST', { ...body, note: '变更' })).status).toBe(409)
    const versions = (await (await call('/versions')).json()) as { total: number }
    expect(versions.total).toBe(1)
  })
  it('自动计划验证 revision，保存失败不改变配置', async () => {
    const saved = await call('/policy', 'PUT', { ...defaultPolicy, enabled: true })
    expect(saved.status).toBe(200)
    expect((await call('/policy', 'PUT', { ...defaultPolicy, enabled: false })).status).toBe(409)
    expect((await call('/policy', 'PUT', { ...defaultPolicy, revision: 1, localRetention: 0 })).status).toBe(400)
  })
  it('保留标记可更新，保护版本不能解除固定， malformed JSON 不入队', async () => {
    const version = (await db.query<{ id: string }>('SELECT id FROM backup_control.versions LIMIT 1')).rows[0]!.id
    expect((await call(`/versions/${version}`, 'PATCH', { pinned: true })).status).toBe(200)
    await db.query('UPDATE backup_control.versions SET protection=TRUE WHERE id=$1', [version])
    expect((await call(`/versions/${version}`, 'PATCH', { pinned: false })).status).toBe(400)
    expect((await call('/versions', 'POST', [])).status).toBe(400)
    expect((await call('/versions', 'POST', { operationId: 'invalid-fixture', targetIds: 'all' })).status).toBe(400)
  })
  it('维护模式拒绝新任务；回滚错误密码不会入队或保存密码', async () => {
    await setSetting(db, 'maintenance', true)
    expect((await call('/versions', 'POST', { operationId: 'maintenance-fixture' })).status).toBe(409)
    await setSetting(db, 'maintenance', false)
    expect((await call('/versions/fixture/restore', 'POST', { operationId: 'restore-fixture', confirmVersion: 'fixture', password: 'wrong' })).status).toBe(403)
    const rows = await db.query<{ payload: string }>('SELECT payload FROM backup_control.tasks')
    expect(JSON.stringify(rows.rows)).not.toContain('wrong')
  })
  it('不向其他管理员暴露预检令牌，任务凭据不会作为 payload 返回', async () => {
    const task = await enqueue(
      db,
      'test',
      { targetId: (await db.query<{ id: string }>('SELECT id FROM backup_control.targets')).rows[0]!.id, operationId: 'test-operation-fixture' },
      { id: 'another-admin', name: '另一管理员' },
    )
    await db.query('UPDATE backup_control.tasks SET result=$2 WHERE id=$1', [task.id, JSON.stringify({ previewToken: 'private-token' })])
    const response = await call(`/tasks/${task.id}`)
    expect(response.status).toBe(200)
    const body = await response.text()
    expect(body).not.toContain('private-token')
    expect(body).not.toContain('secret')
    expect(body).not.toContain('payload')
  })
})
