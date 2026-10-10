import { beforeAll, afterAll, expect, it } from 'vitest'
import { app } from '../app'
import { createTestDb, type TestDb } from '../test/db'
import { setDbForTests } from '../db/pool'
import { hashToken } from '../services/auth'
import { loadConfig } from '../config'
import { Hono } from 'hono'
import { browserSecurityHeaders } from '../middlewares/browser-security'
let t: TestDb, native: string, userId: string
const origin = 'https://security.test'
const call = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) =>
  app.request(origin + '/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
const web = { Origin: origin, 'X-ZZ-CSRF': '1', 'X-Session-Transport': 'cookie' }
beforeAll(async () => {
  t = await createTestDb()
  await t.applyMigrations()
  setDbForTests(t.db)
  process.env.DATABASE_URL = 'postgres://test/test'
  const result = (await (await call('/auth/bootstrap-admin', 'POST', { username: 'security-admin', password: 'fixturepass123' })).json()) as {
    token: string
    user: { id: string }
  }
  native = result.token
  userId = result.user.id
  Object.assign(web, { 'X-ZZ-Account': userId })
})
afterAll(async () => {
  setDbForTests(null)
  await t.close()
  delete process.env.DATABASE_URL
})
async function login() {
  const response = await call('/auth/login', 'POST', { username: 'security-admin', password: 'fixturepass123', remember: true }, web)
  expect(response.status).toBe(200)
  expect(await response.json()).not.toHaveProperty('token')
  const cookie = response.headers.get('set-cookie')!
  expect(cookie).toContain('__Host-zz_session=')
  expect(cookie).toContain('HttpOnly')
  expect(cookie).toContain('Secure')
  expect(cookie).toContain('SameSite=Lax')
  expect(cookie).not.toContain('Domain=')
  return cookie.split(';')[0]!
}
it('网页只收到 HttpOnly Cookie，原生客户端仍使用 Bearer；显式无效 Bearer 不回退 Cookie', async () => {
  expect((await call('/auth/me', 'GET', undefined, { Authorization: 'Bearer ' + native })).status).toBe(200)
  const cookie = await login()
  expect((await call('/auth/me', 'GET', undefined, { Cookie: cookie })).status).toBe(200)
  expect((await call('/auth/me', 'GET', undefined, { Cookie: cookie, Authorization: 'Bearer invalid' })).status).toBe(401)
  const insecure = cookie.replace('__Host-zz_session', 'zz_session')
  expect((await call('/auth/me', 'GET', undefined, { Cookie: insecure })).status).toBe(401)
})
it('登录与 Cookie 写入拒绝跨站、空来源、缺少自定义头；拒绝前不创建会话', async () => {
  const before = (await t.db.query('SELECT * FROM user_sessions')).rows
  for (const headers of [{ Origin: 'https://evil.test', 'X-ZZ-CSRF': '1' }, { Origin: origin }, { Origin: 'null', 'X-ZZ-CSRF': '1' }] as Record<
    string,
    string
  >[])
    expect((await call('/auth/login', 'POST', { username: 'security-admin', password: 'fixturepass123' }, headers)).status).toBe(403)
  expect((await t.db.query('SELECT * FROM user_sessions')).rows).toEqual(before)
  const cookie = await login()
  expect((await call('/auth/me', 'PUT', { displayName: '不能修改' }, { Cookie: cookie, Origin: 'https://evil.test', 'X-ZZ-CSRF': '1' })).status).toBe(403)
  expect((await call('/auth/me', 'PUT', { displayName: '旧账号不能写入' }, { ...web, Cookie: cookie, 'X-ZZ-Account': 'another-account' })).status).toBe(409)
  expect((await call('/auth/me', 'PUT', { displayName: '允许修改' }, { ...web, Cookie: cookie })).status).toBe(200)
})
it('迁移轮换旧凭据，旧 Bearer 失效；退出会清除会话和 Cookie', async () => {
  const old = ((await (await call('/auth/login', 'POST', { username: 'security-admin', password: 'fixturepass123' })).json()) as { token: string }).token
  const oldHash = await hashToken(old, loadConfig().sessionHashSalt)
  const created = Date.now() - 7 * 3600000
  await t.db.query('UPDATE user_sessions SET created_at=$2,reauthenticated_at=$3 WHERE token_hash=$1', [oldHash, created, Date.now() - 11 * 60000])
  const migrated = await call('/auth/web-session', 'POST', { remember: true }, { ...web, Authorization: 'Bearer ' + old })
  expect(migrated.status).toBe(200)
  expect(await migrated.json()).not.toHaveProperty('token')
  expect((await call('/auth/me', 'GET', undefined, { Authorization: 'Bearer ' + old })).status).toBe(401)
  const cookie = migrated.headers.get('set-cookie')!.split(';')[0]!
  const rotated = (
    await t.db.query<{ created_at: number; expires_at: number; reauthenticated_at: number }>(
      'SELECT created_at,expires_at,reauthenticated_at FROM user_sessions WHERE token_hash=$1',
      [await hashToken(cookie.split('=')[1]!, loadConfig().sessionHashSalt)],
    )
  ).rows[0]!
  expect(Number(rotated.created_at)).toBe(created)
  expect(Number(rotated.expires_at)).toBeLessThanOrEqual(created + 8 * 3600000)
  expect(Number(rotated.reauthenticated_at)).toBeLessThan(Date.now() - 10 * 60000)
  const sessions = (await (await call('/auth/sessions', 'GET', undefined, { Cookie: cookie })).json()) as { sessions: { current: boolean }[] }
  expect(sessions.sessions.some((row) => row.current)).toBe(true)
  const logout = await call('/auth/logout', 'POST', undefined, { ...web, Cookie: cookie })
  expect(logout.status).toBe(200)
  expect(logout.headers.get('set-cookie')).toContain('__Host-zz_session=;')
  expect(logout.headers.get('set-cookie')).toContain('Max-Age=0')
  expect((await call('/auth/me', 'GET', undefined, { Cookie: cookie })).status).toBe(401)
})
it('管理员会话最多八小时，闲置三十分钟失效；关键写入需要十分钟内认证', async () => {
  const cookie = await login()
  const token = cookie.split('=')[1]!,
    hash = await hashToken(token, loadConfig().sessionHashSalt)
  const session = (await t.db.query<{ expires_at: number; created_at: number }>('SELECT expires_at,created_at FROM user_sessions WHERE token_hash=$1', [hash]))
    .rows[0]!
  expect(Number(session.expires_at) - Number(session.created_at)).toBe(8 * 3600000)
  await t.db.query('UPDATE user_sessions SET reauthenticated_at=$2 WHERE token_hash=$1', [hash, Date.now() - 11 * 60000])
  const blocked = await call('/admin-users/' + userId, 'PUT', { displayName: '旧认证不允许' }, { ...web, Cookie: cookie })
  expect(blocked.status).toBe(403)
  expect(await blocked.json()).toMatchObject({ code: 'reauth_required' })
  expect((await call('/auth/reauthenticate', 'POST', { password: 'wrong' }, { ...web, Cookie: cookie })).status).toBe(401)
  expect((await call('/auth/me', 'GET', undefined, { Cookie: cookie })).status).toBe(200)
  expect((await call('/auth/reauthenticate', 'POST', { password: 'fixturepass123' }, { ...web, Cookie: cookie })).status).toBe(200)
  const retried = await call('/admin-users/' + userId, 'PUT', { displayName: '新认证' }, { ...web, Cookie: cookie })
  expect(retried.status).not.toBe(403)
  await t.db.query('UPDATE user_sessions SET last_seen_at=$2 WHERE token_hash=$1', [hash, Date.now() - 31 * 60000])
  expect((await call('/auth/me', 'GET', undefined, { Cookie: cookie })).status).toBe(401)
})
it('改密码后创建新会话失败时，密码与旧会话整批回滚', async () => {
  const cookie = await login()
  const original = t.db
  const failing = {
    ...original,
    query: original.query.bind(original),
    end: original.end.bind(original),
    connect: async () => {
      const client = await original.connect()
      return {
        release: () => client.release(),
        query: (async (sql: string, args?: unknown[]) => {
          if (sql.includes('INSERT INTO user_sessions')) throw new Error('fixture session insertion failure')
          return client.query(sql, args)
        }) as typeof client.query,
      }
    },
  }
  setDbForTests(failing)
  try {
    expect(
      (await call('/auth/change-password', 'POST', { currentPassword: 'fixturepass123', newPassword: 'changedpass123' }, { ...web, Cookie: cookie })).status,
    ).toBe(500)
  } finally {
    setDbForTests(original)
  }
  expect((await call('/auth/me', 'GET', undefined, { Cookie: cookie })).status).toBe(200)
  expect((await call('/auth/login', 'POST', { username: 'security-admin', password: 'fixturepass123' }, web)).status).toBe(200)
})
it('安全响应头覆盖 API 与 HTML，CSP 报告模式识别实际内联脚本哈希', async () => {
  const response = await call('/health')
  expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  expect(response.headers.get('x-frame-options')).toBe('DENY')
  expect(response.headers.get('strict-transport-security')).toBeTruthy()
  const site = new Hono()
  site.use('*', browserSecurityHeaders({ inlineScripts: ['console.log("bootstrap")'] }))
  site.get('/', (c) => c.html('<script>console.log("bootstrap")</script>'))
  const html = await site.request(origin)
  expect(html.headers.get('content-security-policy-report-only')).toContain("'sha256-")
  expect(html.headers.get('content-security-policy-report-only')).toContain("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;")
  expect(html.headers.get('content-security-policy-report-only')).toContain("font-src 'self' https://fonts.gstatic.com;")
  expect(html.headers.get('content-security-policy')).toBeNull()
})
it.skipIf(process.env.BROWSER_SECURITY_CHECK !== '1')(
  '真实浏览器 Cookie 登录、刷新恢复与退出',
  async () => {
    const { serve } = await import('@hono/node-server')
    const { chromium } = await import('playwright')
    const { createWebRoutes } = await import('./web')
    const browserApp = new Hono()
    browserApp.use('*', browserSecurityHeaders())
    browserApp.route('/', app)
    browserApp.route('/', createWebRoutes())
    const server = serve({ fetch: browserApp.fetch, hostname: '127.0.0.1', port: 0 })
    await new Promise<void>((resolve) => server.once('listening', resolve))
    const port = (server.address() as { port: number }).port,
      base = `http://127.0.0.1:${port}`
    const browser = await chromium.launch({ headless: true })
    try {
      const context = await browser.newContext({ viewport: { width: 390, height: 850 } })
      const page = await context.newPage()
      await page.goto(base + '/auth')
      await page.locator('#auth-username').fill('security-admin')
      await page.locator('#auth-password').fill('fixturepass123')
      await page.getByRole('button', { name: '登录', exact: true }).click()
      await page.waitForURL(base + '/')
      const cookies = await context.cookies()
      const session = cookies.find((cookie) => cookie.name === 'zz_session')!
      expect(session.httpOnly).toBe(true)
      expect(await page.evaluate('document.cookie')).not.toContain('zz_session')
      expect(await page.evaluate(() => localStorage.getItem('user_session_token'))).toBeNull()
      expect(await page.evaluate(() => sessionStorage.getItem('user_session_token'))).toBeNull()
      await page.goto(base + '/profile')
      await page.locator('#profileMeta').getByText('@security-admin', { exact: true }).waitFor()
      await page.reload()
      await page.locator('#profileMeta').getByText('@security-admin', { exact: true }).waitFor()
      await t.db.query('UPDATE user_sessions SET reauthenticated_at=$2 WHERE token_hash=$1', [
        await hashToken(session.value, loadConfig().sessionHashSalt),
        Date.now() - 11 * 60000,
      ])
      await page.goto(base + '/admin/users')
      // Reauthentication is exercised in component tests; browser checks actual cookie isolation and refresh.
      expect(await page.evaluate(() => localStorage.getItem('user_session_marker'))).toBeTruthy()
      expect(
        (
          await page.request.post(base + '/api/auth/logout', {
            headers: { Origin: base, 'X-ZZ-CSRF': '1', 'X-ZZ-Account': userId, 'X-Session-Transport': 'cookie' },
          })
        ).status(),
      ).toBe(200)
      expect((await page.request.get(base + '/api/auth/me')).status()).toBe(401)
      await context.close()
    } finally {
      await browser.close()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    }
  },
  60000,
)
