import assert from 'node:assert/strict'
import { chromium } from 'playwright'

// Run a production Vite preview first. API fixtures prevent real data access.
const base = process.env.WEB_LOADING_CHECK_BASE || 'http://127.0.0.1:5188'
const origin = new URL(base).origin
const branding = {
  name: '知舟',
  tagline: '一个安静的中文小说书库',
  homeTitle: '知舟 — 小说阅读',
  description: '中文小说阅读',
  logoUrl: '/images/logo.png',
  faviconUrl: '/images/logo.png',
}
const stats = {
  totals: { novels: 0, chapters: 0, users: 1, covers: 0, failedJobs: 0, todayChapters: 0, dbSize: 0 },
  contentRating: { general: 0, restricted: 0, unknown: 0 },
  jobStatus: { running: 0, completed: 0, failed: 0 },
  recentJobs: [],
  recentNovels: [],
}
const browser = await chromium.launch({ headless: true })
try {
  for (const width of [1440, 390])
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width, height: 900 } })
      await context.addInitScript(
        ({ theme }) => {
          localStorage.setItem('user_session_token', 'fixture-admin')
          localStorage.setItem('theme', theme)
        },
        { theme },
      )
      const page = await context.newPage()
      const requested = [],
        errors = [],
        external = [],
        fontSizes = []
      let heldChart, chartRequested
      const chartArrived = new Promise((resolve) => {
        chartRequested = resolve
      })
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('request', (request) => requested.push(new URL(request.url()).pathname))
      page.on('response', (response) => {
        if (new URL(response.url()).pathname.endsWith('.woff2')) fontSizes.push(Number(response.headers()['content-length'] || 0))
      })
      await page.route('**/*', async (route) => {
        const url = new URL(route.request().url())
        if (url.origin !== origin) {
          external.push(url.href)
          return route.abort()
        }
        if (/\/assets\/CartesianChart-.*\.js$/.test(url.pathname)) {
          heldChart = route
          chartRequested()
          return
        }
        if (!url.pathname.startsWith('/api/')) return route.continue()
        const json = (value) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) })
        if (url.pathname === '/api/auth/me')
          return json({ user: { id: 'fixture-admin', role: 'admin', username: 'admin', displayName: '管理员', status: 'active' } })
        if (url.pathname === '/api/site-settings') return json(branding)
        if (url.pathname === '/api/content-policy') return json({ adultContentEnabled: false, turnstileConfigured: false })
        if (url.pathname === '/api/admin/stats') return json(stats)
        if (url.pathname === '/api/novels') return json({ novels: [], total: 0, page: 1, pageSize: 20 })
        if (url.pathname === '/api/categories') return json({ categories: [] })
        if (url.pathname === '/api/admin/site/traffic')
          return json({
            days: 7,
            timezone: 'Asia/Shanghai',
            generatedAt: Date.now(),
            current: { start: 0, end: Date.now(), pageViews: 0, visitors: 0, dailyTrend: [] },
            previous: { start: 0, end: 0, pageViews: 0, visitors: 0, dailyTrend: [] },
            countries: [],
            devices: [],
            sources: [],
            region: { unknownVisits: 0, knownVisits: 0, otherVisits: 0, coverage: 0 },
          })
        return json({})
      })
      await page.goto(base)
      await page.waitForLoadState('networkidle')
      await page.evaluate(() => document.fonts.ready.then(() => undefined))
      const homeFontBytes = fontSizes.reduce((sum, size) => sum + size, 0)
      assert(!requested.some((path) => /\/(Admin|Reader|CartesianChart)-.*\.js$/.test(path)), '首页不应下载后台、阅读器或图表')
      await page.evaluate(async () => {
        for (const weight of [400, 700, 900]) {
          const loaded = await document.fonts.load(`${weight} 16px "Noto Serif SC"`, '知舟中文阅读')
          if (!loaded.length || loaded.some((font) => font.status !== 'loaded')) throw new Error('本地字体未成功加载')
        }
      })
      assert(
        requested.some((path) => path.endsWith('.woff2')),
        '应使用本地 WOFF2',
      )
      await page.goto(`${base}/admin/dashboard`)
      await page.getByText('小说总数', { exact: true }).waitFor()
      assert(!requested.some((path) => /\/(AiTab|BackupsTab|CartesianChart)-.*\.js$/.test(path)), '总览不应下载其他后台模块或图表')
      if (width < 768) await page.getByRole('button', { name: '打开管理导航' }).click()
      await page.locator('a[href="/admin/site-operations?view=traffic"]').first().click()
      let timeout
      try {
        await Promise.race([
          chartArrived,
          new Promise((_, reject) => {
            timeout = setTimeout(() => reject(new Error('没有按需请求图表')), 10000)
          }),
        ])
      } finally {
        clearTimeout(timeout)
      }
      await page.locator('.route-loading--embedded').waitFor()
      // 手机导航抽屉关闭动画结束后才恢复主区域的可访问性。
      await page.getByRole('button', { name: '打开管理导航' }).waitFor({ state: 'visible' })
      await heldChart.continue()
      await page.getByRole('heading', { name: '流量分析', exact: true }).waitFor()
      await page.waitForLoadState('networkidle')
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '页面不应横向溢出')
      assert.deepEqual(errors, [])
      assert.deepEqual(external, [], '页面不应请求外部字体或其他外部资源')
      console.log(`${width}px ${theme}: lazy routes, persistent shell and local fonts passed; homepage font bytes=${homeFontBytes}`)
      await context.close()
    }
} finally {
  await browser.close()
}
