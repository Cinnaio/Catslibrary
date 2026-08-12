import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { app } from '../app'
import { setDbForTests } from '../db/pool'
import { createTestDb, type TestDb } from '../test/db'

let t: TestDb

beforeAll(async () => {
  t = await createTestDb()
  await t.applyMigrations()
  setDbForTests(t.db)
  // 放行 app 的 needsSetup 守卫（getDb 走 testOverride，不真正连远端）
  process.env.DATABASE_URL = 'postgres://test/test'
})

afterAll(async () => {
  setDbForTests(null)
  delete process.env.DATABASE_URL
  await t.close()
})

async function req(path: string, init?: RequestInit) {
  return app.request(path, init)
}
async function jsonOf<T>(res: Response): Promise<T> {
  return (await res.json()) as T
}
function json(method: string, body?: unknown, token?: string): RequestInit {
  return {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }
}

interface AuthResponse {
  user: { id: string; username: string; role: string }
  token: string
}

describe('auth 端到端（pglite）', () => {
  it('health 可用', async () => {
    const res = await req('/api/health')
    expect(res.status).toBe(200)
  })

  it('bootstrap-admin 创建首个管理员，重复创建 409', async () => {
    const res = await req('/api/auth/bootstrap-admin', json('POST', { username: 'admin', password: 'adminpass123', displayName: '站长' }))
    expect(res.status).toBe(201)
    const data = await jsonOf<AuthResponse>(res)
    expect(data.user.role).toBe('admin')
    expect(data.user.username).toBe('admin')
    expect(typeof data.token).toBe('string')

    const again = await req('/api/auth/bootstrap-admin', json('POST', { username: 'admin2', password: 'adminpass123' }))
    expect(again.status).toBe(409)
  })

  it('未带 token 访问 /me 返回 401', async () => {
    const res = await req('/api/auth/me')
    expect(res.status).toBe(401)
  })

  it('错误密码登录 401，正确密码登录返回 user+token，token 可访问 /me', async () => {
    const bad = await req('/api/auth/login', json('POST', { username: 'admin', password: 'wrong-pass' }))
    expect(bad.status).toBe(401)

    const ok = await req('/api/auth/login', json('POST', { username: 'admin', password: 'adminpass123' }))
    expect(ok.status).toBe(200)
    const { user, token } = await jsonOf<AuthResponse>(ok)
    expect(user.role).toBe('admin')
    expect(typeof token).toBe('string')

    const me = await req('/api/auth/me', json('GET', undefined, token))
    expect(me.status).toBe(200)
    const meData = await jsonOf<{ user: { username: string } }>(me)
    expect(meData.user.username).toBe('admin')
  })

  it('register 需邀请码，非法/占用邀请码 400，成功后可直接登录', async () => {
    // 默认 invite_required='1'
    const noInvite = await req('/api/auth/register', json('POST', { username: 'reader1', password: 'readerpass1' }))
    expect(noInvite.status).toBe(400)

    const badInvite = await req('/api/auth/register', json('POST', { username: 'reader1', password: 'readerpass1', invite: 'NOPE' }))
    expect(badInvite.status).toBe(400)

    await t.db.query('INSERT INTO invites (code, created_at) VALUES ($1, $2)', ['TEST-INVITE', Date.now()])
    const ok = await req('/api/auth/register', json('POST', { username: 'reader1', password: 'readerpass1', invite: 'TEST-INVITE' }))
    expect(ok.status).toBe(201)
    const { user } = await jsonOf<AuthResponse>(ok)
    expect(user.role).toBe('reader')

    // 同一邀请码已被占用 → 400；全新邀请码 + 已存在用户名 → 409（插入失败回滚邀请码）
    const reuse = await req('/api/auth/register', json('POST', { username: 'reader2', password: 'readerpass1', invite: 'TEST-INVITE' }))
    expect(reuse.status).toBe(400)

    await t.db.query('INSERT INTO invites (code, created_at) VALUES ($1, $2)', ['TEST-INVITE-2', Date.now()])
    const dup = await req('/api/auth/register', json('POST', { username: 'reader1', password: 'readerpass1', invite: 'TEST-INVITE-2' }))
    expect(dup.status).toBe(409)

    const login = await req('/api/auth/login', json('POST', { username: 'reader1', password: 'readerpass1' }))
    expect(login.status).toBe(200)
  })

  it('change-password 成功后旧 token 失效、新 token 可用', async () => {
    const login = await req('/api/auth/login', json('POST', { username: 'reader1', password: 'readerpass1' }))
    const { token } = await jsonOf<AuthResponse>(login)

    const wrongCurrent = await req('/api/auth/change-password', json('POST', { currentPassword: 'nope', newPassword: 'newpass123' }, token))
    expect(wrongCurrent.status).toBe(401)

    const changed = await req('/api/auth/change-password', json('POST', { currentPassword: 'readerpass1', newPassword: 'newpass123' }, token))
    expect(changed.status).toBe(200)
    const { token: newToken } = await jsonOf<AuthResponse>(changed)

    const oldMe = await req('/api/auth/me', json('GET', undefined, token))
    expect(oldMe.status).toBe(401)
    const newMe = await req('/api/auth/me', json('GET', undefined, newToken))
    expect(newMe.status).toBe(200)
  })

  it('reader-settings 写入与读取', async () => {
    const login = await req('/api/auth/login', json('POST', { username: 'reader1', password: 'newpass123' }))
    const { token } = await jsonOf<AuthResponse>(login)

    const put = await req(
      '/api/auth/reader-settings',
      json('PUT', { settings: { fontSize: '2', readerPageMode: 'page' }, updatedAt: { fontSize: 100, readerPageMode: 100 } }, token),
    )
    expect(put.status).toBe(200)
    const putData = await jsonOf<{ settings: Record<string, string> }>(put)
    expect(putData.settings.fontSize).toBe('2')

    const get = await req('/api/auth/reader-settings', json('GET', undefined, token))
    const getData = await jsonOf<{ settings: Record<string, string> }>(get)
    expect(getData.settings).toEqual({ fontSize: '2', readerPageMode: 'page' })
  })

  it('登录失败 10 次后触发限流 429', async () => {
    let lastStatus = 0
    for (let i = 0; i < 11; i++) {
      const res = await req('/api/auth/login', json('POST', { username: 'nobody', password: 'badpass' }))
      lastStatus = res.status
    }
    expect(lastStatus).toBe(429)
  })

  it('轮换用户名无法绕过 IP 维度限流', async () => {
    process.env.TRUST_PROXY = '1'
    try {
      const withIp = (body: unknown): RequestInit => ({
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.77' },
        body: JSON.stringify(body),
      })
      let lastStatus = 0
      // 每次换用户名：用户名维度（10 次）永不触发，只能靠 IP 维度（30 次）拦截
      for (let i = 0; i < 31; i++) {
        const res = await req('/api/auth/login', withIp({ username: `ipuser${i}`, password: 'badpass' }))
        lastStatus = res.status
      }
      expect(lastStatus).toBe(429)
    } finally {
      delete process.env.TRUST_PROXY
    }
  })

  it('sessions 列表与删除', async () => {
    const login = await req('/api/auth/login', json('POST', { username: 'reader1', password: 'newpass123' }))
    const { token } = await jsonOf<AuthResponse>(login)

    const list = await req('/api/auth/sessions', json('GET', undefined, token))
    expect(list.status).toBe(200)
    const { sessions } = await jsonOf<{ sessions: Array<{ id: string; current: boolean }> }>(list)
    expect(Array.isArray(sessions)).toBe(true)
    expect(sessions.some((s) => s.current)).toBe(true)

    // 删除当前会话后，token 应失效
    const current = sessions.find((s) => s.current)
    const del = await req(`/api/auth/sessions?id=${current!.id}`, json('DELETE', undefined, token))
    expect(del.status).toBe(200)
    const me = await req('/api/auth/me', json('GET', undefined, token))
    expect(me.status).toBe(401)
  })

  it('logout-all 后 token 失效', async () => {
    const login = await req('/api/auth/login', json('POST', { username: 'reader1', password: 'newpass123' }))
    const { token } = await jsonOf<AuthResponse>(login)
    const out = await req('/api/auth/logout-all', json('POST', undefined, token))
    expect(out.status).toBe(200)
    const me = await req('/api/auth/me', json('GET', undefined, token))
    expect(me.status).toBe(401)
  })
})
