import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { createWebRoutes, seoOrigin } from './web'
import { createTestDb, type TestDb } from '../test/db'
import { app } from '../app'

let t: TestDb
const root = fileURLToPath(new URL('../test/seo', import.meta.url))
let siteUrl = 'https://read.example.com'
const routes = createWebRoutes({ root, origin: () => siteUrl, db: () => t.db, configured: () => true })

beforeAll(async () => {
  t = await createTestDb()
  await t.applyMigrations()
  for (const rating of ['general', 'restricted', 'unknown']) {
    await t.db.query(
      `INSERT INTO novels (id, title, author, description, content_rating, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, 1, 1700000000000)`,
      [rating, `${rating}<script>`, '作者 & 测试', '<img src=x onerror=alert(1)>简介', rating],
    )
  }
})
afterAll(async () => {
  await t.close()
})

describe('public SEO responses', () => {
  it('marks actual API responses noindex without changing JSON', async () => {
    const response = await app.request('/api/health')
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex, follow')
    const body = (await response.json()) as { ok: boolean }
    expect(body.ok).toBe(true)
  })
  it('renders general details into initial HTML, escapes content and uses configured canonical', async () => {
    const response = await routes.request('http://spoofed.test/novel/general', { headers: { 'X-Forwarded-Host': 'evil.test' } })
    const html = await response.text()
    expect(response.status).toBe(200)
    expect(response.headers.get('X-Robots-Tag')).toBe('index, follow')
    expect(html).toContain('<h1>general&lt;script&gt;</h1>')
    expect(html).toContain('作者 &amp; 测试')
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('href="https://read.example.com/novel/general"')
    expect(html).not.toContain('noindex')
  })
  it('only includes general works in the homepage initial HTML', async () => {
    const response = await routes.request('/')
    const html = await response.text()
    expect(response.headers.get('X-Robots-Tag')).toBe('index, follow')
    expect(html).toContain('/novel/general')
    expect(html).not.toContain('/novel/restricted')
    expect(html).not.toContain('/novel/unknown')
  })
  it.each([
    '/novel/restricted',
    '/novel/unknown',
    '/read/general/chapter',
    '/admin',
    '/auth',
    '/install',
    '/profile',
    '/bookshelf',
    '/?search=book',
    '/novel/general?ref=test',
  ])('excludes %s from indexing', async (path) => {
    const response = await routes.request(path)
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex, follow')
    const html = await response.text()
    expect(html).toContain('content="noindex, follow"')
    expect(html).not.toContain('restricted&lt;script&gt;')
    expect(html).not.toContain('unknown&lt;script&gt;')
  })
  it('returns real 404s for missing works, unknown routes and missing static/API paths', async () => {
    for (const path of ['/novel/missing', '/missing', '/assets/missing.js', '/images/missing.png', '/api/missing']) {
      expect((await routes.request(path)).status).toBe(404)
    }
  })
  it('publishes sitemap index and only general detail URLs, with lastmod', async () => {
    expect(await (await routes.request('/sitemap.xml')).text()).toContain('https://read.example.com/sitemaps/novels-1.xml')
    const response = await routes.request('/sitemaps/novels-1.xml')
    expect(response.headers.get('Content-Type')).toContain('application/xml')
    const xml = await response.text()
    expect(xml).toContain('https://read.example.com/novel/general')
    expect(xml).toContain('<lastmod>2023-11-14T22:13:20.000Z</lastmod>')
    expect(xml).not.toContain('/novel/unknown')
    expect(xml).not.toContain('/novel/restricted')
    expect((await routes.request('/sitemaps/novels-2.xml')).status).toBe(404)
  })
  it('removes a work from initial HTML and sitemap immediately after rating changes', async () => {
    await t.db.query("UPDATE novels SET content_rating = 'restricted' WHERE id = 'general'")
    try {
      expect((await routes.request('/novel/general')).headers.get('X-Robots-Tag')).toBe('noindex, follow')
      expect(await (await routes.request('/sitemaps/novels-1.xml')).text()).not.toContain('/novel/general')
    } finally {
      await t.db.query("UPDATE novels SET content_rating = 'general' WHERE id = 'general'")
    }
  })
  it('appends the configured sitemap to robots', async () => {
    expect(await (await routes.request('/robots.txt')).text()).toContain('Sitemap: https://read.example.com/sitemap.xml')
  })
  it('fails closed without SITE_URL', async () => {
    siteUrl = ''
    try {
      const response = await routes.request('/')
      expect(response.headers.get('X-Robots-Tag')).toContain('noindex')
      expect(await response.text()).not.toContain('zhizhou-seo-origin')
      expect((await routes.request('/sitemap.xml')).status).toBe(503)
    } finally {
      siteUrl = 'https://read.example.com'
    }
  })
  it('fails closed during database errors', async () => {
    const failing = createWebRoutes({
      root,
      origin: () => siteUrl,
      configured: () => true,
      db: () => {
        throw new Error('offline')
      },
    })
    const response = await failing.request('/novel/general')
    expect(response.status).toBe(503)
    expect(response.headers.get('X-Robots-Tag')).toContain('noindex')
  })
  it('rejects invalid origin configuration', () => {
    for (const value of ['javascript:alert(1)', 'https://user:pass@example.com', 'https://example.com/path', 'https://example.com/?key=x'])
      expect(seoOrigin(value)).toBe('')
  })
})
