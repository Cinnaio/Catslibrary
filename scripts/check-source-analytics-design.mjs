import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
const base = process.env.WEB_URL || 'http://127.0.0.1:5198'
const output = process.env.SCREENSHOT_DIR || '/tmp/source-analytics-preview'
await mkdir(output, { recursive: true })
const now = Date.now()
const categories = ['enabled', 'paused', 'completed', 'unconfigured', 'available']
const hosts = ['source.example', 'jjwxc.net', 'example.org', '__none__']
const books = Array.from({ length: 36 }, (_, i) => {
  const site = hosts[i % 4],
    category = categories[i % 5]
  const sourceUrl = site === '__none__' ? '' : `https://${site}/book/${i}`
  return {
    id: `n${i}`,
    title: `作品${String(i).padStart(2, '0')}：书源与自动追更的示例作品`,
    author: `作者${i % 4}`,
    status: category === 'completed' ? 'completed' : 'ongoing',
    chapterCount: 88 + i,
    site,
    sourceUrl,
    sources: sourceUrl
      ? [
          { url: sourceUrl, host: site, kind: '抓取来源' },
          { url: `https://original.example/novel/${i}`, host: 'original.example', kind: '原作者来源' },
        ]
      : [],
    sourceCategory: !sourceUrl ? 'none' : category === 'unconfigured' ? 'link' : 'configured',
    followupCategory: category,
    attention: category === 'enabled' && i % 2 === 0,
    active: false,
    intervalHours: 6,
    checkedAt: i % 3 ? now - i * 60000 : 0,
    nextCheckAt: category === 'enabled' ? now + 3600000 : 0,
    result: category === 'enabled' && i % 2 === 0 ? 'protected' : 'no_change',
    message: '目录检查完成，仍有受保护章节待确认访问权限',
    failures: 0,
    pending: i % 3 === 0 ? null : i % 6,
    protected: i % 3 === 0 ? null : i % 2,
    updatedAt: now - i * 60000,
  }
})
const counts = () => ({ enabled: 0, paused: 0, completed: 0, unconfigured: 0, available: 0 })
function stats(query) {
  const view = query.get('view') === 'all' ? 'all' : 'primary'
  const sites = (book) => (view === 'primary' ? [book.site] : book.sources.length ? [...new Set(book.sources.map((s) => s.host))] : ['__none__'])
  const groups = new Map(),
    followups = counts()
  for (const book of books) {
    followups[book.followupCategory]++
    for (const site of sites(book)) {
      const g = groups.get(site) || { site, total: 0, configured: 0, link: 0, none: 0, followups: counts(), attention: 0 }
      g.total++
      g[book.sourceCategory]++
      g.followups[book.followupCategory]++
      g.attention += Number(book.attention)
      groups.set(site, g)
    }
  }
  const filtered = books.filter(
    (b) =>
      (!query.get('site') || sites(b).includes(query.get('site'))) &&
      (!query.get('source') || b.sourceCategory === query.get('source')) &&
      (query.get('followup') === 'attention' ? b.attention : !query.get('followup') || b.followupCategory === query.get('followup')) &&
      (!query.get('search') || `${b.title}${b.author}`.includes(query.get('search'))),
  )
  const limit = Number(query.get('limit') || 15),
    totalPages = Math.max(1, Math.ceil(filtered.length / limit)),
    page = Math.min(totalPages, Number(query.get('page') || 1))
  return {
    snapshotAt: now,
    view,
    total: books.length,
    withSource: books.filter((b) => b.sources.length).length,
    configured: books.filter((b) => b.sourceCategory === 'configured').length,
    attention: books.filter((b) => b.attention).length,
    followups,
    groups: [...groups.values()],
    books: filtered.slice((page - 1) * limit, page * limit),
    filteredTotal: filtered.length,
    limit,
    totalPages,
    page,
  }
}
const browser = await chromium.launch({ headless: true })
try {
  for (const theme of ['light', 'dark'])
    for (const width of [320, 390, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' })
      await context.addInitScript((theme) => {
        localStorage.setItem('user_session_token', 'source-analytics-fixture')
        localStorage.setItem('theme', theme)
      }, theme)
      let fail = false,
        writes = 0
      await context.route('**/api/**', async (route) => {
        const u = new URL(route.request().url())
        let data = {}
        if (route.request().method() !== 'GET' && ['/api/scrape', '/api/novels', '/api/chapters'].includes(u.pathname)) writes++
        if (u.pathname === '/api/auth/me') data = { user: { id: 'fixture', username: 'admin', role: 'admin', status: 'active' } }
        else if (u.pathname === '/api/admin/source-analytics') {
          if (fail) {
            await route.fulfill({ status: 503, json: { error: '模拟统计读取失败' } })
            return
          }
          data = stats(u.searchParams)
        } else if (u.pathname === '/api/scrape')
          data =
            u.searchParams.get('action') === 'source-bindings'
              ? { bindings: [{ isPrimary: true, sourceUrl: 'https://source.example/books/902326' }] }
              : {
                  enabled: true,
                  hasConfig: true,
                  ongoing: true,
                  result: 'protected',
                  message: '当前有受保护章节',
                  intervalHours: 6,
                  nextCheckAt: now + 3600000,
                  checkedAt: now,
                  pendingChapterCount: 4,
                  pendingProtectedChapterCount: 2,
                  pendingPublicChapterCount: 2,
                  pendingUnknownChapterCount: 0,
                  sourceUrl: 'https://source.example/book/0',
                  failures: 0,
                }
        await route.fulfill({ json: data })
      })
      const page = await context.newPage()
      await page.goto(`${base}/admin/source-analytics`)
      await page.getByRole('heading', { name: '书源分布', exact: true }).waitFor()
      const geometry = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
        title: getComputedStyle(document.querySelector('.admin-tab-header h2')).fontSize,
        panel: getComputedStyle(document.querySelector('.source-analytics-charts h3')).fontSize,
      }))
      assert.equal(geometry.overflow, false, `${theme}/${width} 页面不能横向溢出`)
      assert.equal(geometry.title, '20px')
      assert.equal(geometry.panel, '16px')
      await page.screenshot({ path: `${output}/${theme}-${width}-overview.png`, fullPage: width < 640 })
      await page.getByRole('button', { name: 'source.example：已开启 2 本', exact: true }).click()
      await page.getByText('匹配 2 本', { exact: true }).waitFor()
      assert.equal(await page.locator('.source-book-name').count(), 2)
      await page.getByRole('button', { name: '清除筛选', exact: true }).click()
      await page.getByText('匹配 36 本', { exact: true }).waitFor()
      await page.getByRole('button', { name: '下一页', exact: true }).click()
      await page.getByRole('button', { name: '作品15：书源与自动追更的示例作品', exact: true }).waitFor()
      await page.getByRole('button', { name: '上一页', exact: true }).click()
      await page.getByRole('button', { name: '作品00：书源与自动追更的示例作品', exact: true }).click()
      const detail = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: '书源与追更详情', exact: true }) })
      await detail.getByText('尚未核对源站目录', { exact: true }).waitFor()
      assert.equal(await detail.getByRole('link', { name: 'https://original.example/novel/0', exact: true }).count(), 1)
      await page.screenshot({ path: `${output}/${theme}-${width}-detail.png` })
      await detail.getByRole('button', { name: '追更详情与设置', exact: true }).click()
      const followup = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: '追更事件详情', exact: true }) })
      await followup.getByText('当前有受保护章节', { exact: true }).waitFor()
      await page.keyboard.press('Escape')
      await followup.waitFor({ state: 'detached' })
      await detail.getByRole('button', { name: '融合章节名', exact: true }).click()
      const merge = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: '融合章节名', exact: true }) })
      await merge.getByText('作品00：书源与自动追更的示例作品', { exact: true }).waitFor()
      const box = await merge.boundingBox()
      assert.ok(box.x >= 0 && box.x + box.width <= width + 1)
      await merge.getByRole('button', { name: '取消', exact: true }).click()
      await merge.waitFor({ state: 'detached' })
      await detail.getByRole('button', { name: '关闭', exact: true }).click()
      await detail.waitFor({ state: 'detached' })
      const scope = page.getByRole('combobox', { name: '来源统计口径', exact: true })
      await scope.click()
      await page.getByRole('option', { name: '全部来源 · 按站点去重', exact: true }).click()
      await page.getByText(/同一本书在不同站点分别计入/).waitFor()
      assert.equal(await page.getByRole('button', { name: 'original.example：已开启 6 本', exact: true }).count(), 1)
      await page.getByRole('textbox', { name: '搜索小说', exact: true }).fill('作品01')
      await page.getByText('匹配 1 本', { exact: true }).waitFor()
      fail = true
      await page.getByRole('button', { name: '刷新统计', exact: true }).click()
      await page.getByRole('alert').waitFor()
      fail = false
      await page.getByRole('button', { name: '重试', exact: true }).click()
      await page.getByRole('alert').waitFor({ state: 'detached' })
      assert.equal(writes, 0, '统计、筛选、详情和取消不能写入书库或启动任务')
      await context.close()
      console.log(`通过 ${theme}/${width}：图表筛选、分页、来源详情、追更/融合、搜索、刷新重试及无写入`)
    }
  console.log(`书源与追更隔离浏览器验证通过，截图：${output}`)
} finally {
  await browser.close()
}
