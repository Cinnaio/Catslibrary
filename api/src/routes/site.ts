import { Hono } from 'hono'
import { loadConfig } from '../config'
import { getDb } from '../db/pool'
import { first, run } from '../db/query'
import { requireAdmin, type AuthEnv } from '../middlewares/auth'
import { hashToken, newId } from '../services/auth'
import { cleanText } from '../services/text'

const ANNOUNCEMENT_KEY = 'site_announcement'
const DAY_MS = 86400000

function countryCode(headers: Headers): string {
  const value = (headers.get('cf-ipcountry') || headers.get('x-vercel-ip-country') || '').trim().toUpperCase()
  return /^[A-Z]{2}$/.test(value) ? value : 'ZZ'
}

function deviceType(userAgent: string): string {
  if (/bot|crawler|spider|slurp/i.test(userAgent)) return 'bot'
  if (/ipad|tablet|kindle|silk/i.test(userAgent)) return 'tablet'
  if (/mobile|android|iphone|ipod/i.test(userAgent)) return 'mobile'
  return userAgent ? 'desktop' : 'other'
}

function referrerType(headers: Headers): string {
  const fetchSite = headers.get('sec-fetch-site')
  if (fetchSite === 'same-origin' || fetchSite === 'same-site') return 'internal'
  const referer = headers.get('referer') || ''
  if (!referer) return 'direct'
  if (/google\.|bing\.|baidu\.|sogou\.|so\.com/i.test(referer)) return 'search'
  return 'external'
}

async function announcement(): Promise<string> {
  const row = await first<{ value: string }>(getDb(), 'SELECT value FROM app_settings WHERE key = $1', [ANNOUNCEMENT_KEY])
  return row?.value || ''
}

export const siteRoutes = new Hono()

siteRoutes.get('/', async (c) => c.json({ announcement: await announcement() }, 200, { 'Cache-Control': 'no-store' }))

siteRoutes.post('/visits', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const visitorId = String(body.visitorId || '')
  const path = String(body.path || '')
  if (!/^[a-zA-Z0-9_-]{24,80}$/.test(visitorId) || !/^\/(?!\/)[^\s]{0,180}$/.test(path)) return c.body(null, 204)
  const visitorHash = await hashToken(visitorId, loadConfig().sessionHashSalt)
  await run(
    getDb(),
    'INSERT INTO site_visits (id, visitor_hash, path, country_code, device_type, referrer_type, visited_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [newId('visit'), visitorHash, path, countryCode(c.req.raw.headers), deviceType(c.req.header('user-agent') || ''), referrerType(c.req.raw.headers), Date.now()],
  )
  return c.body(null, 204)
})

export const adminSiteRoutes = new Hono<AuthEnv>()
adminSiteRoutes.use('*', requireAdmin())

adminSiteRoutes.get('/', async (c) => {
  const db = getDb()
  const now = Date.now()
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const todayStart = today.getTime()
  const weekStart = todayStart - 6 * DAY_MS
  const staleCutoff = now - 30 * DAY_MS
  const [todayStats, weekStats, activeReaders, popularNovels, dailyTrend, countries, devices, sources, contentHealth, categoryCounts, statusCounts, contentQuality, recentUpdateStats, recentUpdates] = await Promise.all([
    first<{ page_views: number; visitors: number }>(db, 'SELECT COUNT(*)::int AS page_views, COUNT(DISTINCT visitor_hash)::int AS visitors FROM site_visits WHERE visited_at >= $1', [todayStart]),
    first<{ page_views: number; visitors: number }>(db, 'SELECT COUNT(*)::int AS page_views, COUNT(DISTINCT visitor_hash)::int AS visitors FROM site_visits WHERE visited_at >= $1', [weekStart]),
    first<{ total: number }>(db, 'SELECT COUNT(DISTINCT user_id)::int AS total FROM reading_progress WHERE updated_at >= $1 AND deleted_at = 0', [weekStart]),
    db.query<{ novel_id: string; title: string; views: number }>(
      `SELECT substring(path from '^/novel/([^/?#]+)') AS novel_id, n.title, COUNT(*)::int AS views
       FROM site_visits v JOIN novels n ON n.id = substring(v.path from '^/novel/([^/?#]+)')
       WHERE v.visited_at >= $1 GROUP BY novel_id, n.title ORDER BY views DESC LIMIT 5`,
      [weekStart],
    ),
    db.query<{ date: string; page_views: number; visitors: number }>(
      `SELECT to_char(to_timestamp(visited_at / 1000.0), 'YYYY-MM-DD') AS date,
        COUNT(*)::int AS page_views, COUNT(DISTINCT visitor_hash)::int AS visitors
       FROM site_visits WHERE visited_at >= $1
       GROUP BY date ORDER BY date ASC`,
      [weekStart],
    ),
    db.query<{ country_code: string; visits: number; visitors: number }>(
      `SELECT country_code, COUNT(*)::int AS visits, COUNT(DISTINCT visitor_hash)::int AS visitors
       FROM site_visits WHERE visited_at >= $1
       GROUP BY country_code ORDER BY visits DESC LIMIT 8`,
      [weekStart],
    ),
    db.query<{ key: string; visits: number }>(
      `SELECT device_type AS key, COUNT(*)::int AS visits FROM site_visits
       WHERE visited_at >= $1 GROUP BY device_type ORDER BY visits DESC`,
      [weekStart],
    ),
    db.query<{ key: string; visits: number }>(
      `SELECT referrer_type AS key, COUNT(*)::int AS visits FROM site_visits
       WHERE visited_at >= $1 GROUP BY referrer_type ORDER BY visits DESC`,
      [weekStart],
    ),
    Promise.all([
      first<{ total: number }>(db, 'SELECT COUNT(*)::int AS total FROM novels'),
      first<{ total: number }>(db, 'SELECT COUNT(*)::int AS total FROM chapters'),
      first<{ total: number }>(db, 'SELECT COUNT(*)::int AS total FROM novel_comments WHERE created_at >= $1', [weekStart]),
      first<{ total: number }>(db, "SELECT COUNT(*)::int AS total FROM novel_comment_reports WHERE status = 'open'"),
    ]),
    db.query<{ category: string; novels: number }>(
      `SELECT category, COUNT(*)::int AS novels
       FROM novels n
       CROSS JOIN LATERAL jsonb_array_elements_text(n.categories::jsonb) AS categories(category)
       WHERE NULLIF(TRIM(category), '') IS NOT NULL
       GROUP BY category ORDER BY novels DESC, category ASC LIMIT 20`,
    ),
    db.query<{ status: string; novels: number }>(
      `SELECT status, COUNT(*)::int AS novels FROM novels GROUP BY status ORDER BY status`,
    ),
    first<{ uncategorized: number; missing_cover: number; missing_description: number; stale_ongoing: number }>(
      db,
      `SELECT
         COUNT(*) FILTER (WHERE categories = '[]' OR categories = '' OR categories IS NULL)::int AS uncategorized,
         COUNT(*) FILTER (WHERE NULLIF(TRIM(cover_url), '') IS NULL)::int AS missing_cover,
         COUNT(*) FILTER (WHERE NULLIF(TRIM(description), '') IS NULL)::int AS missing_description,
         COUNT(*) FILTER (WHERE status = 'ongoing' AND updated_at < $1)::int AS stale_ongoing
       FROM novels`,
      [staleCutoff],
    ),
    first<{ last_7_days: number; last_30_days: number }>(
      db,
      `SELECT
         COUNT(*) FILTER (WHERE updated_at >= $1)::int AS last_7_days,
         COUNT(*) FILTER (WHERE updated_at >= $2)::int AS last_30_days
       FROM novels`,
      [weekStart, now - 30 * DAY_MS],
    ),
    db.query<{ id: string; title: string; updated_at: number; status: string }>(
      `SELECT id, title, updated_at, status FROM novels ORDER BY updated_at DESC LIMIT 8`,
    ),
  ])
  return c.json({
    announcement: await announcement(),
    metrics: {
      todayPageViews: Number(todayStats?.page_views) || 0,
      todayVisitors: Number(todayStats?.visitors) || 0,
      weekPageViews: Number(weekStats?.page_views) || 0,
      weekVisitors: Number(weekStats?.visitors) || 0,
      activeReaders: Number(activeReaders?.total) || 0,
    },
    popularNovels: popularNovels.rows.map((row) => ({ novelId: row.novel_id, title: row.title, views: Number(row.views) || 0 })),
    traffic: {
      dailyTrend: dailyTrend.rows.map((row) => ({ date: row.date, pageViews: Number(row.page_views) || 0, visitors: Number(row.visitors) || 0 })),
      countries: countries.rows.map((row) => ({ countryCode: row.country_code || 'ZZ', visits: Number(row.visits) || 0, visitors: Number(row.visitors) || 0 })),
      devices: devices.rows.map((row) => ({ key: row.key, visits: Number(row.visits) || 0 })),
      sources: sources.rows.map((row) => ({ key: row.key, visits: Number(row.visits) || 0 })),
    },
    contentHealth: {
      novels: Number(contentHealth[0]?.total) || 0,
      chapters: Number(contentHealth[1]?.total) || 0,
      newComments: Number(contentHealth[2]?.total) || 0,
      openReports: Number(contentHealth[3]?.total) || 0,
      categories: categoryCounts.rows.map((row) => ({ category: row.category, novels: Number(row.novels) || 0 })),
      statuses: Object.fromEntries(statusCounts.rows.map((row) => [row.status, Number(row.novels) || 0])),
      quality: {
        uncategorized: Number(contentQuality?.uncategorized) || 0,
        missingCover: Number(contentQuality?.missing_cover) || 0,
        missingDescription: Number(contentQuality?.missing_description) || 0,
        staleOngoing: Number(contentQuality?.stale_ongoing) || 0,
      },
      recentUpdates: {
        last7Days: Number(recentUpdateStats?.last_7_days) || 0,
        last30Days: Number(recentUpdateStats?.last_30_days) || 0,
        novels: recentUpdates.rows.map((row) => ({ id: row.id, title: row.title, updatedAt: Number(row.updated_at) || 0, status: row.status })),
      },
    },
  }, 200, { 'Cache-Control': 'no-store' })
})

adminSiteRoutes.put('/', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const value = cleanText(body.announcement, 240)
  await run(getDb(), `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, $3)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`, [ANNOUNCEMENT_KEY, value, Date.now()])
  return c.json({ announcement: value })
})
