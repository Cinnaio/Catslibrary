import { Hono } from 'hono'
import { serveStatic } from '@hono/node-server/serve-static'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { escHtml } from '@shared/utils'
import { getDb, type DbClient } from '../db/pool'
import { PROJECT_ROOT } from '../config'

const PAGE_SIZE = 1000
type PublicNovel = { id: string; title: string; author: string; description: string; updated_at: number }

/** Use a configured origin, never a client-controlled Host/forwarded header. */
export function seoOrigin(value: string): string {
  try {
    const url = new URL(value)
    return /^https?:$/.test(url.protocol) && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash ? url.origin : ''
  } catch {
    return ''
  }
}

export function createWebRoutes(
  options: {
    root?: string
    origin?: () => string
    db?: () => DbClient
    configured?: () => boolean
  } = {},
) {
  const routes = new Hono()
  const root = options.root || process.env.WEB_DIST_DIR || resolve(PROJECT_ROOT, 'web/dist')
  const origin = () => seoOrigin(options.origin?.() ?? process.env.SITE_URL ?? '')
  const db = options.db || getDb
  const configured = options.configured || (() => Boolean(process.env.DATABASE_URL))

  routes.get('/robots.txt', async (c) => {
    const rules = await readFile(resolve(root, 'robots.txt'), 'utf8')
    return c.text(rules + (origin() ? `\nSitemap: ${origin()}/sitemap.xml\n` : ''))
  })

  routes.get('/sitemap.xml', async (c) => {
    if (!origin() || !configured()) return c.text('SEO is not configured', 503)
    const { rows } = await db().query<{ count: number }>("SELECT COUNT(*)::int AS count FROM novels WHERE content_rating = 'general'")
    const pages = Math.max(1, Math.ceil(Number(rows[0]?.count || 0) / PAGE_SIZE))
    const entries = Array.from({ length: pages }, (_, i) => `<sitemap><loc>${escHtml(origin())}/sitemaps/novels-${i + 1}.xml</loc></sitemap>`).join('')
    c.header('Content-Type', 'application/xml; charset=utf-8')
    c.header('Cache-Control', 'no-store')
    return c.body(`<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}</sitemapindex>`)
  })

  routes.get('/sitemaps/:file', async (c) => {
    const match = /^novels-([1-9]\d*)\.xml$/.exec(c.req.param('file'))
    const page = Number(match?.[1])
    if (!match || !Number.isSafeInteger(page) || page > 1000000) return c.notFound()
    if (!origin() || !configured()) return c.text('SEO is not configured', 503)
    const { rows } = await db().query<PublicNovel>("SELECT id, updated_at FROM novels WHERE content_rating = 'general' ORDER BY id LIMIT $1 OFFSET $2", [
      PAGE_SIZE,
      (page - 1) * PAGE_SIZE,
    ])
    if (!rows.length && page !== 1) return c.notFound()
    const entries =
      (page === 1 ? `<url><loc>${escHtml(origin())}/</loc></url>` : '') +
      rows
        .map((row) => {
          const date = new Date(Number(row.updated_at))
          const lastmod = Number.isFinite(date.getTime()) ? `<lastmod>${date.toISOString()}</lastmod>` : ''
          return `<url><loc>${escHtml(origin())}/novel/${encodeURIComponent(row.id)}</loc>${lastmod}</url>`
        })
        .join('')
    c.header('Content-Type', 'application/xml; charset=utf-8')
    c.header('Cache-Control', 'no-store')
    return c.body(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}</urlset>`)
  })

  // API misses must remain API 404s, never an HTML fallback.
  routes.get('/api/*', (c) => c.notFound())
  routes.get('/assets/*', serveStatic({ root }))
  routes.get('/images/*', serveStatic({ root }))
  routes.get('*', async (c) => {
    c.header('X-Robots-Tag', 'noindex, follow')
    c.header('Cache-Control', 'no-store')
    if (c.req.path.startsWith('/assets/') || c.req.path.startsWith('/images/')) return c.notFound()
    let template: string
    try {
      template = await readFile(resolve(root, 'index.html'), 'utf8')
    } catch {
      return c.text('Build the web workspace before serving pages', 503)
    }
    let title = '知舟 — 小说阅读'
    let description = '知舟 — 发现精彩小说，享受阅读之美'
    let content = ''
    let indexable = false
    let status: 200 | 404 | 503 = 200
    const novelMatch = /^\/novel\/([^/]+)$/.exec(c.req.path)
    let novelId = ''
    if (novelMatch) {
      try {
        novelId = decodeURIComponent(novelMatch[1]!)
      } catch {
        return c.text('Invalid path', 400, { 'X-Robots-Tag': 'noindex, follow' })
      }
      if (novelId.includes('/')) return c.notFound()
    }
    if (origin() && configured() && (c.req.path === '/' || novelMatch)) {
      try {
        if (novelMatch) {
          const { rows } = await db().query<PublicNovel>(
            "SELECT id, title, author, description, updated_at FROM novels WHERE id = $1 AND content_rating = 'general'",
            [novelId],
          )
          const novel = rows[0]
          if (novel) {
            title = `${novel.title} — 知舟`
            description = `${novel.author}著。${novel.description || ''}`.slice(0, 180)
            content = `<main><h1>${escHtml(novel.title)}</h1><p>作者：${escHtml(novel.author)}</p><p>${escHtml(novel.description)}</p><a href="/">返回书库</a></main>`
            indexable = true
          } else {
            const exists = await db().query<{ id: string }>('SELECT id FROM novels WHERE id = $1', [novelId])
            if (!exists.rows.length) status = 404
          }
          // Non-general pages retain the application shell without exposing metadata.
        } else {
          const { rows } = await db().query<PublicNovel>(
            "SELECT id, title, author, description FROM novels WHERE content_rating = 'general' ORDER BY updated_at DESC, id LIMIT 24",
          )
          content = `<main><h1>知舟 — 小说阅读</h1><p>${escHtml(description)}</p><ul>${rows.map((row) => `<li><a href="/novel/${encodeURIComponent(row.id)}">${escHtml(row.title)}</a> — ${escHtml(row.author)}</li>`).join('')}</ul></main>`
          indexable = true
        }
      } catch (error) {
        console.error('[web-seo]', error)
        status = 503
      }
    }
    if (new URL(c.req.url).search) indexable = false
    if (!/^\/$|^\/novel\/[^/]+$|^\/read\/[^/]+\/[^/]+$|^\/bookshelf$|^\/profile$|^\/auth$|^\/install$|^\/admin(?:\/[^/]+)?$/.test(c.req.path)) status = 404
    const robots = indexable && status === 200 ? 'index, follow' : 'noindex, follow'
    const canonical = origin() && (c.req.path === '/' || novelMatch) ? `${origin()}${novelMatch ? `/novel/${encodeURIComponent(novelId)}` : '/'}` : ''
    template = template.replace(/<meta\s+name="(?:robots|description)"[^>]*>/g, '').replace(/<title>[^<]*<\/title>/, '')
    const head = `<title>${escHtml(title)}</title><meta name="robots" content="${robots}"><meta name="description" content="${escHtml(description)}">${canonical ? `<link rel="canonical" href="${escHtml(canonical)}">` : ''}${origin() && configured() && status === 200 ? `<meta name="zhizhou-seo-origin" content="${escHtml(origin())}">` : ''}`
    c.header('X-Robots-Tag', robots)
    c.header('Cache-Control', 'no-store')
    return c.html(template.replace('</head>', `${head}</head>`).replace('<div id="root"></div>', `<div id="root">${content}</div>`), status)
  })
  return routes
}
