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
describe('停用管理员设密与完整用户目录', () => {
  it('未登录和读者均不能访问目录或修改密码', async () => {
    expect((await request('admin-users/users')).status).toBe(401)
    expect((await request('admin-users/users', readerToken)).status).toBe(403)
    expect((await change('New-test-123', readerId, readerToken)).status).toBe(403)
    expect((await request('admin-users', undefined, { action: 'set-password', id: readerId, newPassword: 'New-test-123' })).status).toBe(401)
  })
  it('旧设密接口统一返回 410，不因参数或目标不同重新开放', async () => {
    for (const value of ['1234567', null, 123456789, { value: 'Long-pass-123' }]) expect((await change(value)).status).toBe(410)
    for (const id of ['', 'missing', adminId]) expect((await change('New-test-123', id)).status).toBe(410)
    expect((await request('auth/me', readerToken)).status).toBe(200)
  })
  it('本人改密在清除会话失败时回滚密码', async () => {
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
      expect((await request('auth/change-password', readerToken, { currentPassword: oldPassword, newPassword: 'Rollback-test-123' })).status).toBe(500)
    } finally {
      setDbForTests(t.db)
    }
    expect((await t.db.query('SELECT password_hash, password_salt FROM users WHERE id = $1', [readerId])).rows).toEqual(before.rows)
    expect((await request('auth/me', readerToken)).status).toBe(200)
    expect((await t.db.query("SELECT id FROM admin_operation_audit WHERE action = 'set-password'")).rows).toHaveLength(0)
  })
  it('旧设密接口不修改密码、不撤销会话，也不解除禁用', async () => {
    const before = (await t.db.query('SELECT password_hash FROM users WHERE id=$1', [readerId])).rows
    const response = await change('Reader-new-456')
    expect(response.status).toBe(410)
    expect(response.headers.get('Cache-Control')).toContain('no-store')
    expect((await request('auth/me', readerToken)).status).toBe(200)
    expect((await request('auth/me', adminToken)).status).toBe(200)
    expect((await request('auth/login', undefined, { username: 'passwordreader', password: oldPassword })).status).toBe(200)
    expect((await t.db.query('SELECT password_hash FROM users WHERE id=$1', [readerId])).rows).toEqual(before)
    await t.db.query("UPDATE users SET status='disabled' WHERE id=$1", [readerId])
    expect((await change('Disabled-new-123')).status).toBe(410)
    expect((await t.db.query<{ status: string }>('SELECT status FROM users WHERE id=$1', [readerId])).rows[0]!.status).toBe('disabled')
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
    expect((await jsonOf<DirectoryResult>(await request('admin-users/users?role=super_admin', adminToken))).total).toBe(1)
    expect((await jsonOf<DirectoryResult>(await request('admin-users/users?status=disabled', adminToken))).total).toBe(1)
    expect((await request('admin-users/users?role=owner', adminToken)).status).toBe(400)
  })
})
