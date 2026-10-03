import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { app } from '../app'
import { setDbForTests } from '../db/pool'
import { createTestDb, type TestDb } from '../test/db'
import { createWebRoutes } from './web'
import { fileURLToPath } from 'node:url'
import { effectiveTurnstile } from '../services/turnstile'
import type { SiteBranding, TurnstileSettings } from '@shared/site-settings'

let t: TestDb, admin = '', reader = ''
const settings = '/api/admin/site-settings'
const brand = { name: '书灯', tagline: '慢慢阅读', homeTitle: '书灯 — 私家书库', description: '自己的阅读空间' }
function request(path: string, method = 'GET', body?: unknown, token = admin) {
  return app.request(path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
}
beforeAll(async () => {
  t = await createTestDb(); await t.applyMigrations(); setDbForTests(t.db)
  vi.stubEnv('DATABASE_URL', 'postgres://fixture/test')
  for (const name of ['TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY', 'TURNSTILE_HOSTNAMES', 'SITE_URL', 'CORS_ORIGIN', 'CORS_ORIGINS', 'SITE_SETTINGS_ENCRYPTION_KEY']) vi.stubEnv(name, '')
  admin = (await (await request('/api/auth/bootstrap-admin', 'POST', { username: 'settings-admin', password: 'fixturepass123' }, '')).json() as { token: string }).token
  await t.db.query("INSERT INTO invites (code, created_at) VALUES ('SETTINGS-INVITE', 1)")
  reader = (await (await request('/api/auth/register', 'POST', { username: 'settings-reader', password: 'fixturepass123', invite: 'SETTINGS-INVITE' }, '')).json() as { token: string }).token
})
afterAll(async () => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); setDbForTests(null); await t.close() })

describe('站点设置管理与公开边界', () => {
  it('游客只可读取品牌，普通用户与游客均不能读写管理员配置', async () => {
    expect((await request('/api/site-settings', 'GET', undefined, '')).status).toBe(200)
    for (const token of ['', reader]) for (const path of ['/branding', '/turnstile']) {
      expect([401, 403]).toContain((await request(settings + path, 'GET', undefined, token)).status)
      expect([401, 403]).toContain((await request(settings + path, 'PUT', brand, token)).status)
    }
    expect([401, 403]).toContain((await request(settings + '/turnstile/test', 'POST', { token: 'x' }, reader)).status)
  })
  it('品牌文字校验、保存与公开响应，不允许客户端设置任意图片地址', async () => {
    expect((await request(settings + '/branding', 'PUT', { ...brand, name: '' })).status).toBe(400)
    expect((await request(settings + '/branding', 'PUT', { ...brand, name: 'x'.repeat(33) })).status).toBe(400)
    const result = await (await request(settings + '/branding', 'PUT', { ...brand, logoUrl: 'javascript:alert(1)' })).json()
    expect(result).toMatchObject({ ...brand, logoUrl: '/images/logo.png' })
    expect(await (await request('/api/site-settings', 'GET', undefined, '')).json()).toEqual(result)
  })
  it('Logo/Favicon 上传、真实解码、缓存与恢复默认，保留品牌文字', async () => {
    const image = await sharp({ create: { width: 24, height: 24, channels: 4, background: '#8b6045' } }).png().toBuffer()
    for (const kind of ['logo', 'favicon'] as const) {
      const form = new FormData(); form.set('image', new Blob([new Uint8Array(image)], { type: 'image/png' }), 'image.png')
      const res = await app.request(`${settings}/assets/${kind}`, { method: 'PUT', headers: { Authorization: `Bearer ${admin}` }, body: form })
      expect(res.status).toBe(200)
      const saved = await res.json() as SiteBranding
      expect(saved.name).toBe(brand.name)
      const asset = await request(saved[`${kind}Url`], 'GET', undefined, '')
      expect(asset.headers.get('Content-Type')).toBe('image/png')
      expect(asset.headers.get('X-Content-Type-Options')).toBe('nosniff')
      expect((await sharp(Buffer.from(await asset.arrayBuffer())).metadata()).width).toBe(24)
      expect((await app.request(saved[`${kind}Url`], { headers: { 'If-None-Match': asset.headers.get('ETag')! } })).status).toBe(304)
      expect((await (await request(`${settings}/assets/${kind}`, 'DELETE')).json() as SiteBranding)[`${kind}Url`]).toBe('/images/logo.png')
      expect((await request(`/api/site-settings/assets/${kind}`)).status).toBe(404)
    }
  })
  it.each(['<svg xmlns="http://www.w3.org/2000/svg"></svg>', '<html>bad</html>', '\x89PNG fake'])('拒绝伪装为 PNG 的文件 %s', async input => {
    const form = new FormData(); form.set('image', new Blob([input], { type: 'image/png' }), 'fake.png')
    expect((await app.request(`${settings}/assets/logo`, { method: 'PUT', headers: { Authorization: `Bearer ${admin}` }, body: form })).status).toBe(400)
  })
  it('超限图片与超大请求拒绝', async () => {
    const form = new FormData(); form.set('image', new Blob([new Uint8Array(1024 * 1024 + 1)], { type: 'image/png' }), 'big.png')
    expect((await app.request(`${settings}/assets/logo`, { method: 'PUT', headers: { Authorization: `Bearer ${admin}` }, body: form })).status).toBe(400)
    expect((await request(`${settings}/branding`, 'PUT', { ...brand, description: 'x'.repeat(1200000) })).status).toBe(413)
    const wide = await sharp({ create: { width: 4097, height: 1, channels: 4, background: '#fff' } }).png().toBuffer()
    const dimensions = new FormData(); dimensions.set('image', new Blob([new Uint8Array(wide)], { type: 'image/png' }), 'wide.png')
    expect((await app.request(`${settings}/assets/logo`, { method: 'PUT', headers: { Authorization: `Bearer ${admin}` }, body: dimensions })).status).toBe(400)
  })
  it('未配置加密主密钥时禁止存储私钥；保存后数据库无明文且所有响应脱敏', async () => {
    const body = { siteKey: 'site-fixture', secretKey: 'private-fixture', hostnames: ['READ.EXAMPLE.COM'] }
    expect((await request(settings + '/turnstile', 'PUT', body)).status).toBe(400)
    vi.stubEnv('SITE_SETTINGS_ENCRYPTION_KEY', Buffer.alloc(32, 1).toString('base64'))
    const res = await request(settings + '/turnstile', 'PUT', body)
    expect(res.status).toBe(200)
    const value = await res.json()
    expect(value).toMatchObject({ siteKey: body.siteKey, secretSet: true, configured: true, hostnames: ['read.example.com'] })
    expect(JSON.stringify(value)).not.toContain(body.secretKey)
    const row = await t.db.query<{ value: string }>("SELECT value FROM app_settings WHERE key = 'site_turnstile'")
    expect(row.rows[0]!.value).not.toContain(body.secretKey)
    expect(row.rows[0]!.value).toContain('v1.')
    expect(JSON.stringify(await (await request('/api/content-policy', 'GET', undefined, '')).json())).not.toContain(body.secretKey)
    expect((await effectiveTurnstile()).secret).toBe(body.secretKey)
  })
  it('留空保留密钥、主密钥丢失或错误时失败关闭、允许恢复后清除', async () => {
    const body = { siteKey: 'site-fixture', hostnames: ['read.example.com'], secretKey: '' }
    expect((await (await request(settings + '/turnstile', 'PUT', body)).json() as TurnstileSettings).secretSet).toBe(true)
    vi.stubEnv('SITE_SETTINGS_ENCRYPTION_KEY', Buffer.alloc(32, 2).toString('base64'))
    expect((await effectiveTurnstile()).configured).toBe(false)
    expect((await (await request(settings + '/turnstile')).json() as TurnstileSettings).secretReadable).toBe(false)
    vi.stubEnv('SITE_SETTINGS_ENCRYPTION_KEY', Buffer.alloc(32, 1).toString('base64'))
    expect((await effectiveTurnstile()).configured).toBe(true)
  })
  it('环境变量字段优先且不允许后台覆盖，其他字段可保存', async () => {
    vi.stubEnv('TURNSTILE_SITE_KEY', 'site-env')
    const body = { siteKey: 'site-fixture', hostnames: ['read.example.com'] }
    expect((await request(settings + '/turnstile', 'PUT', body)).status).toBe(400)
    const value = await (await request(settings + '/turnstile', 'PUT', { ...body, siteKey: 'site-env' })).json() as TurnstileSettings
    expect(value.sources.siteKey).toBe('environment')
    expect(value.sources.secret).toBe('database')
    vi.stubEnv('TURNSTILE_SITE_KEY', '')
  })
  it('不接受 URL、通配域名和非法字段', async () => {
    for (const host of ['https://read.example.com', '*.example.com', 'read.example.com:443', 'example.com/path']) {
      expect((await request(settings + '/turnstile', 'PUT', { siteKey: 'site-fixture', hostnames: [host] })).status).toBe(400)
    }
    expect((await request(settings + '/turnstile', 'PUT', { siteKey: 'site-fixture', hostnames: [], clearSecret: 'true' })).status).toBe(400)
  })
  it('真实验证接口校验 action/hostname，测试不会授予权限或 cookie', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true, hostname: 'read.example.com', action: 'r18_unlock' }))))
    const res = await request(settings + '/turnstile/test', 'POST', { token: 'test-token' })
    expect(res.status).toBe(200)
    expect(res.headers.get('Set-Cookie')).toBeNull()
    const sessions = await t.db.query<{ adult_access_until: number }>('SELECT adult_access_until FROM user_sessions')
    expect(sessions.rows.every(row => Number(row.adult_access_until) === 0)).toBe(true)
    for (const response of [{ success: true, hostname: 'evil.example', action: 'r18_unlock' }, { success: true, hostname: 'read.example.com', action: 'login' }, { success: false }]) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(response))))
      expect((await request(settings + '/turnstile/test', 'POST', { token: 'test-token' })).status).toBe(400)
    }
    // The sixth request in the minute is rejected before any upstream call.
    await request(settings + '/turnstile/test', 'POST', { token: 'test-token' })
    const limited = await request(settings + '/turnstile/test', 'POST', { token: 'test-token' })
    expect(limited.status).toBe(429)
    expect(limited.headers.get('Retry-After')).not.toBeNull()
    expect((await (await request(settings + '/turnstile', 'PUT', { siteKey: '', hostnames: [], clearSecret: true })).json() as TurnstileSettings).secretSet).toBe(false)
  })
  it('SSR 首页/详情标题、描述、品牌初始化数据与图标统一并安全转义', async () => {
    await request(settings + '/branding', 'PUT', { ...brand, name: '书灯<script>', homeTitle: '书灯 </script>', description: '介绍 <img>' })
    const web = createWebRoutes({ root: fileURLToPath(new URL('../test/seo', import.meta.url)), db: () => t.db, configured: () => true, origin: () => 'https://read.example.com' })
    const html = await (await web.request('/')).text()
    expect(html).toContain('<title>书灯 &lt;/script&gt;</title>')
    expect(html).toContain('介绍 &lt;img&gt;')
    expect(html).toContain('id="site-branding"')
    expect(html).toContain('书灯\\u003cscript>')
    expect(html).toContain('rel="icon"')
    await t.db.query("INSERT INTO novels (id, title, content_rating, created_at, updated_at) VALUES ('seo-brand', '作品', 'general', 1, 1)")
    expect(await (await web.request('/novel/seo-brand')).text()).toContain('<title>作品 — 书灯&lt;script&gt;</title>')
  })
  it.each(['$&', "$'", '$`', '$$'])('SSR 按字面保留替换标记 %s', async marker => {
    const name = `书灯${marker}`
    await request(settings + '/branding', 'PUT', { ...brand, name, homeTitle: name })
    const web = createWebRoutes({ root: fileURLToPath(new URL('../test/seo', import.meta.url)), db: () => t.db, configured: () => true, origin: () => 'https://read.example.com' })
    const html = await (await web.request('/')).text()
    const data = html.match(/<script id="site-branding" type="application\/json">(.*?)<\/script>/s)![1]!
    expect(JSON.parse(data).name).toBe(name)
    expect(html).toContain(`<title>${name.replaceAll('&', '&amp;').replaceAll("'", '&#39;')}</title>`)
    expect(html.match(/<\/head>/g)).toHaveLength(1)
  })
})
