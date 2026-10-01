import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { app } from '../app'
import { setDbForTests } from '../db/pool'
import { createTestDb, type TestDb } from '../test/db'
let t: TestDb
let adminToken = '',
  readerToken = '',
  readerId = '',
  adminId = ''
interface AuthResult {
  token: string
  user: { id: string }
}
interface DirectoryResult {
  total: number
  users: Array<{ id: string; displayName: string }>
}
async function jsonOf<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}
const oldPassword = 'Reader-old-123'
function request(path: string, token?: string, body?: unknown) {
  return app.request(`/api/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
}
function change(newPassword: unknown, id = readerId, token = adminToken) {
  return request('admin-users', token, { action: 'set-password', id, newPassword })
}
beforeAll(async () => {
  t = await createTestDb()
  await t.applyMigrations()
  setDbForTests(t.db)
  process.env.DATABASE_URL = 'postgres://test/test'
  const admin = await jsonOf<AuthResult>(await request('auth/bootstrap-admin', undefined, { username: 'passwordadmin', password: 'Admin-test-123' }))
  adminToken = admin.token
  adminId = admin.user.id
  await t.db.query('INSERT INTO invites (code, created_at) VALUES ($1, $2)', ['PASSWORD-TEST', Date.now()])
  const reader = await jsonOf<AuthResult>(
    await request('auth/register', undefined, { username: 'passwordreader', password: oldPassword, invite: 'PASSWORD-TEST' }),
  )
  readerToken = reader.token
  readerId = reader.user.id
})
afterAll(async () => {
  setDbForTests(null)
  delete process.env.DATABASE_URL
  await t.close()
})
describe('管理员直接修改密码与完整用户目录', () => {
  it('未登录和读者均不能访问目录或修改密码', async () => {
    expect((await request('admin-users/users')).status).toBe(401)
    expect((await request('admin-users/users', readerToken)).status).toBe(403)
    expect((await change('New-test-123', readerId, readerToken)).status).toBe(403)
    expect((await request('admin-users', undefined, { action: 'set-password', id: readerId, newPassword: 'New-test-123' })).status).toBe(401)
  })
  it('拒绝短密码、非字符串、无目标、未知目标和跳过本人密码验证', async () => {
    for (const password of ['1234567', null, 123456789, { value: 'Long-pass-123' }]) expect((await change(password)).status).toBe(400)
    expect((await change('New-test-123', '')).status).toBe(400)
    expect((await change('New-test-123', 'missing')).status).toBe(404)
    expect((await change('New-test-123', adminId)).status).toBe(400)
    expect((await request('auth/me', readerToken)).status).toBe(200)
  })
  it('事务中清除会话失败时，密码与审计均回滚', async () => {
    const before = await t.db.query('SELECT password_hash, password_salt FROM users WHERE id = $1', [readerId])
    setDbForTests({
      ...t.db,
      connect: async () => {
        const client = await t.db.connect()
        return {
          ...client,
          query: async (sql, params) => {
            if (sql.startsWith('DELETE FROM user_sessions')) throw new Error('test session deletion failure')
            return client.query(sql, params)
          },
        }
      },
    })
    try {
      expect((await change('Rollback-test-123')).status).toBe(500)
    } finally {
      setDbForTests(t.db)
    }
    expect((await t.db.query('SELECT password_hash, password_salt FROM users WHERE id = $1', [readerId])).rows).toEqual(before.rows)
    expect((await request('auth/me', readerToken)).status).toBe(200)
    expect((await t.db.query("SELECT id FROM admin_operation_audit WHERE action = 'set-password'")).rows).toHaveLength(0)
  })
  it('新密码生效、旧密码失效、目标全部会话清除且管理员保持登录', async () => {
    await request('auth/login', undefined, { username: 'passwordreader', password: oldPassword })
    const res = await change('Reader-new-456')
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(await res.json()).toEqual({ success: true })
    expect((await request('auth/me', readerToken)).status).toBe(401)
    expect((await request('auth/me', adminToken)).status).toBe(200)
    expect((await t.db.query('SELECT * FROM user_sessions WHERE user_id = $1', [readerId])).rows).toHaveLength(0)
    expect((await request('auth/login', undefined, { username: 'passwordreader', password: oldPassword })).status).toBe(401)
    expect((await request('auth/login', undefined, { username: 'passwordreader', password: 'Reader-new-456' })).status).toBe(200)
    const audit = (
      await t.db.query<{ action: string; actor_user_id: string; status: string; request_hash: string; target_count: number }>(
        "SELECT * FROM admin_operation_audit WHERE action = 'set-password'",
      )
    ).rows
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ action: 'set-password', actor_user_id: adminId, status: 'completed', request_hash: '', target_count: 1 })
    expect(JSON.stringify(audit)).not.toContain('Reader-new-456')
  })
  it('修改密码不会解除账号禁用', async () => {
    await t.db.query("UPDATE users SET status = 'disabled' WHERE id = $1", [readerId])
    expect((await change('Disabled-new-123')).status).toBe(200)
    expect((await t.db.query<{ status: string }>('SELECT status FROM users WHERE id = $1', [readerId])).rows[0]!.status).toBe('disabled')
  })
  it('目录包含超过 100 个账号，分页稳定且搜索转义通配符', async () => {
    await t.db.query(
      `INSERT INTO users (id, username, display_name, password_hash, password_salt, role, status, created_at, updated_at)
      SELECT 'directory-' || n, 'directory' || n, CASE WHEN n = 110 THEN 'special%name' ELSE '目录用户' || n END,
      u.password_hash, u.password_salt, 'reader', 'active', 1, 1 FROM users u CROSS JOIN generate_series(1, 110) n WHERE u.id = $1`,
      [readerId],
    )
    const first = await request('admin-users/users?limit=100', adminToken)
    const data = await jsonOf<DirectoryResult>(first)
    expect(data.total).toBe(112)
    expect(data.users).toHaveLength(100)
    expect(first.headers.get('Cache-Control')).toBe('no-store')
    const second = await jsonOf<DirectoryResult>(await request('admin-users/users?limit=100&offset=100', adminToken))
    expect(second.users).toHaveLength(12)
    expect(new Set([...data.users, ...second.users].map((user) => user.id)).size).toBe(112)
    const search = await jsonOf<DirectoryResult>(await request('admin-users/users?search=%25', adminToken))
    expect(search.total).toBe(1)
    expect(search.users[0]!.displayName).toBe('special%name')
    expect(JSON.stringify(data)).not.toContain('password_hash')
    expect((await jsonOf<DirectoryResult>(await request('admin-users/users?role=admin', adminToken))).total).toBe(1)
    expect((await jsonOf<DirectoryResult>(await request('admin-users/users?status=disabled', adminToken))).total).toBe(1)
    expect((await request('admin-users/users?role=owner', adminToken)).status).toBe(400)
  })
})
