import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
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

// 各场景共享账号夹具，但不共享请求预算；同一场景内仍执行真实限流。
beforeEach(async () => {
  await t.db.query('DELETE FROM security_counters')
  await t.db.query('DELETE FROM login_failures')
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
    expect(data.user.role).toBe('super_admin')
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
    expect(user.role).toBe('super_admin')
    expect(typeof token).toBe('string')

    const me = await req('/api/auth/me', json('GET', undefined, token))
    expect(me.status).toBe(200)
    const meData = await jsonOf<{ user: { username: string } }>(me)
    expect(meData.user.username).toBe('admin')
  })

  it('相同 UA 的设备可同时登录，撤销其中一个不影响另一个', async () => {
    const login = () => req('/api/auth/login', {
      ...json('POST', { username: 'admin', password: 'adminpass123' }),
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'identical-browser-version' },
    })
    const first = await jsonOf<AuthResponse>(await login())
    const second = await jsonOf<AuthResponse>(await login())
    expect(first.token).not.toBe(second.token)
    expect((await req('/api/auth/me', json('GET', undefined, first.token))).status).toBe(200)
    expect((await req('/api/auth/me', json('GET', undefined, second.token))).status).toBe(200)
    const { sessions } = await jsonOf<{ sessions: Array<{ id: string; current: boolean }> }>(
      await req('/api/auth/sessions', json('GET', undefined, first.token)),
    )
    expect((await req(`/api/auth/sessions?id=${sessions.find(s => s.current)!.id}`, json('DELETE', undefined, first.token))).status).toBe(200)
    expect((await req('/api/auth/me', json('GET', undefined, first.token))).status).toBe(401)
    expect((await req('/api/auth/me', json('GET', undefined, second.token))).status).toBe(200)
  })

  it('头像允许超过 16 KB 直到 1 MB，文件超限与请求超限分别拒绝', async () => {
    const { token } = await jsonOf<AuthResponse>(await req('/api/auth/login', json('POST', { username: 'admin', password: 'adminpass123' })))
    const upload = (size: number) => {
      const png = new Uint8Array(size)
      png.set(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII=', 'base64'))
      const form = new FormData()
      form.set('avatar', new Blob([png], { type: 'image/png' }), 'avatar.png')
      return req('/api/auth/avatar', { method: 'PUT', headers: { Authorization: `Bearer ${token}` }, body: form })
    }
    expect((await upload(49_456)).status).toBe(200)
    expect((await upload(1024 * 1024)).status).toBe(200)
    const oversized = await upload(1024 * 1024 + 1)
    expect(oversized.status).toBe(400)
    expect(await oversized.json()).toMatchObject({ error: '头像不能超过 1MB' })
    expect((await upload(1024 * 1024 + 32768)).status).toBe(413)
    const stored = await t.db.query<{ size: number }>('SELECT octet_length(data) AS size FROM user_avatars')
    expect(stored.rows).toEqual([{ size: 1024 * 1024 }])
  })

  it('邮件和普通认证请求仍保留 16 KB 上限', async () => {
    for (const path of ['/email/request', '/email/verify', '/forgot-password', '/reset-password', '/login']) {
      const response = await req('/api/auth' + path, json('POST', { padding: 'x'.repeat(16384) }))
      expect(response.status, path).toBe(413)
    }
  })

  it('已验证邮箱支持大小写和首尾空格，仍需密码且返回真实用户名', async () => {
    await t.db.query("UPDATE users SET email='Owner@Example.com',email_verified_at=$1 WHERE username='admin'", [Date.now()])
    const login = (username: string, password = 'adminpass123') => req('/api/auth/login', json('POST', { username, password }))
    const ok = await login('  OWNER@example.COM  ')
    expect(ok.status).toBe(200)
    const data = await jsonOf<AuthResponse>(ok)
    expect(data.user.username).toBe('admin')
    expect((await req('/api/auth/me', json('GET', undefined, data.token))).status).toBe(200)
    const wrong = await login('owner@example.com', 'wrong-password')
    expect(wrong.status).toBe(401)
    expect(await wrong.json()).toEqual({ error: '账号或密码错误' })
    await t.db.query("UPDATE users SET email_verified_at=0 WHERE username='admin'")
    expect((await login('owner@example.com')).status).toBe(401)
    expect((await login('admin')).status).toBe(200)
    await t.db.query("UPDATE users SET email_verified_at=$1,status='disabled' WHERE username='admin'", [Date.now()])
    expect((await login('owner@example.com')).status).toBe(401)
    await t.db.query("UPDATE users SET status='active',email='replacement@example.com' WHERE username='admin'")
    expect((await login('owner@example.com')).status).toBe(401)
    expect((await login('replacement@example.com')).status).toBe(200)
    const audits = await t.db.query<{ username: string }>("SELECT username FROM login_audit WHERE username LIKE '%@%'")
    expect(audits.rows).toEqual([])
  })

  it('用户名和邮箱共用失败次数，邮箱大小写不能绕过限流', async () => {
    const login = (username: string, password: string) => req('/api/auth/login', json('POST', { username, password }))
    for (let i = 0; i < 10; i++) {
      expect((await login(i % 2 ? 'REPLACEMENT@example.COM' : 'admin', 'wrong-password')).status).toBe(401)
    }
    expect((await login('replacement@example.com', 'adminpass123')).status).toBe(429)
    expect((await login('admin', 'adminpass123')).status).toBe(429)
    // 清理本用例的锁定，不影响后续用户名登录回归。
    await t.db.query('DELETE FROM login_failures')
    await t.db.query("UPDATE users SET email=NULL,email_verified_at=0 WHERE username='admin'")
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
      json('PUT', { settings: { fontSize: '2', readerPageMode: 'page', contentMode: 'safe' }, updatedAt: { fontSize: 100, readerPageMode: 100, contentMode: 100 } }, token),
    )
    expect(put.status).toBe(200)
    const putData = await jsonOf<{ settings: Record<string, string> }>(put)
    expect(putData.settings.fontSize).toBe('2')

    const get = await req('/api/auth/reader-settings', json('GET', undefined, token))
    const getData = await jsonOf<{ settings: Record<string, string> }>(get)
    expect(getData.settings).toEqual({ fontSize: '2', readerPageMode: 'page', contentMode: 'safe' })

    const mobilePut = await req(
      '/api/auth/reader-settings',
      json('PUT', { device: 'mobile', settings: { fontSize: '5', readerTheme: 'eye' }, updatedAt: { fontSize: 200, readerTheme: 200 } }, token),
    )
    expect(mobilePut.status).toBe(200)

    const desktopAfterMobile = await req('/api/auth/reader-settings?device=desktop', json('GET', undefined, token))
    const desktopAfterMobileData = await jsonOf<{ settings: Record<string, string> }>(desktopAfterMobile)
    expect(desktopAfterMobileData.settings).toEqual({ fontSize: '2', readerPageMode: 'page', contentMode: 'safe' })

    const mobileAfterMobile = await req('/api/auth/reader-settings?device=mobile', json('GET', undefined, token))
    const mobileAfterMobileData = await jsonOf<{ settings: Record<string, string> }>(mobileAfterMobile)
    expect(mobileAfterMobileData.settings).toEqual({ fontSize: '5', readerTheme: 'eye', contentMode: 'safe' })

    const iosPut = await req(
      '/api/auth/reader-settings',
      json('PUT', { device: 'ios', settings: { fontSize: '1', readerTheme: 'paper' }, updatedAt: { fontSize: 300, readerTheme: 300 } }, token),
    )
    expect(iosPut.status).toBe(200)
    for (const [device, expected] of [
      ['desktop', { fontSize: '2', readerPageMode: 'page', contentMode: 'safe' }],
      ['mobile', { fontSize: '5', readerTheme: 'eye', contentMode: 'safe' }],
      ['ios', { fontSize: '1', readerTheme: 'paper', contentMode: 'safe' }],
    ] as const) {
      const response = await req(`/api/auth/reader-settings?device=${device}`, json('GET', undefined, token))
      expect(response.status).toBe(200)
      const data = await jsonOf<{ settings: Record<string, string> }>(response)
      expect(data.settings).toEqual(expected)
    }
  })

  it('同一账号超过默认六次请求预算后触发限流 429', async () => {
    for (let i = 0; i < 6; i++) {
      const res = await req('/api/auth/login', json('POST', { username: 'nobody', password: 'badpass' }))
      expect(res.status).toBe(401)
    }
    const limited = await req('/api/auth/login', json('POST', { username: 'nobody', password: 'badpass' }))
    expect(limited.status).toBe(429)
    expect(await limited.json()).toMatchObject({ code: 'security_rate_limited' })
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
      // 每次换用户名仍须受 IP 请求预算及登录失败次数保护。
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
    const init = json('POST', { username: 'reader1', password: 'newpass123' })
    init.headers = { ...init.headers, 'User-Agent': 'ZhiZhou/16 CFNetwork/3896.100.1.2.1 Darwin/27.0.0' }
    const login = await req('/api/auth/login', init)
    const { token } = await jsonOf<AuthResponse>(login)

    const stored = await t.db.query<{ device_name: string }>('SELECT device_name FROM user_sessions WHERE user_agent = $1', ['ZhiZhou/16 CFNetwork/3896.100.1.2.1 Darwin/27.0.0'])
    expect(stored.rows[0]?.device_name).toBe('Cat’s Library iOS App')
    // 模拟升级前已保存的错误名称，读取列表时应按原始 UA 重新识别。
    await t.db.query('UPDATE user_sessions SET device_name = $1 WHERE user_agent = $2', ['未知系统 · 浏览器', 'ZhiZhou/16 CFNetwork/3896.100.1.2.1 Darwin/27.0.0'])

    const list = await req('/api/auth/sessions', json('GET', undefined, token))
    expect(list.status).toBe(200)
    const { sessions } = await jsonOf<{ sessions: Array<{ id: string; current: boolean; deviceName: string }> }>(list)
    expect(Array.isArray(sessions)).toBe(true)
    expect(sessions.some((s) => s.current)).toBe(true)
    expect(sessions.find((s) => s.current)?.deviceName).toBe('Cat’s Library iOS App')

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

  it('logout 后当前 token 立即失效，重复登出也不会恢复会话', async () => {
    const login = await req('/api/auth/login', json('POST', { username: 'reader1', password: 'newpass123' }))
    const { token } = await jsonOf<AuthResponse>(login)
    const out = await req('/api/auth/logout', json('POST', undefined, token))
    expect(out.status).toBe(200)
    expect((await req('/api/auth/me', json('GET', undefined, token))).status).toBe(401)
    expect((await req('/api/auth/logout', json('POST', undefined, token))).status).toBe(401)
  })

  it('保持登录 remember=true 会给更长的会话有效期', async () => {
    const now = Date.now()
    // 不勾选：会话有效期应为默认 SESSION_TTL（30 天）
    const normal = await req('/api/auth/login', json('POST', { username: 'reader1', password: 'newpass123' }))
    const normalData = await jsonOf<{ token: string; remember?: boolean }>(normal)
    expect(normalData.remember).toBe(false)

    const listNormal = await req('/api/auth/sessions', json('GET', undefined, normalData.token))
    const { sessions: normalSessions } = await jsonOf<{ sessions: Array<{ expiresAt: number }> }>(listNormal)
    const normalExpiry = Math.max(...normalSessions.map((s) => s.expiresAt))
    // 30 天有效期（毫秒），允许少量偏差
    expect(normalExpiry - now).toBeGreaterThan(29 * 86400000)
    expect(normalExpiry - now).toBeLessThanOrEqual(31 * 86400000)

    // 勾选 remember=true：会话有效期应为 REMEMBER_TTL（180 天）
    const remember = await req('/api/auth/login', json('POST', { username: 'reader1', password: 'newpass123', remember: true }))
    const rememberData = await jsonOf<{ token: string; remember?: boolean }>(remember)
    expect(rememberData.remember).toBe(true)

    const listRemember = await req('/api/auth/sessions', json('GET', undefined, rememberData.token))
    const { sessions: rememberSessions } = await jsonOf<{ sessions: Array<{ expiresAt: number }> }>(listRemember)
    const rememberExpiry = Math.max(...rememberSessions.map((s) => s.expiresAt))
    expect(rememberExpiry - now).toBeGreaterThan(179 * 86400000)
    expect(rememberExpiry - now).toBeLessThanOrEqual(181 * 86400000)
  })
})
