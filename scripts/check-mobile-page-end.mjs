import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

// Fixtures isolate layout checks from live accounts, reading progress and scrape jobs.
const base = process.env.WEB_URL || 'http://127.0.0.1:5197'
const output = '/tmp/mobile-page-end-preview'
await mkdir(output, { recursive: true })
const book = {
  id: 'layout-fixture',
  title: '纸上长夜',
  author: '测试作者',
  categories: ['现代'],
  status: 'ongoing',
  contentRating: 'general',
  chapterCount: 1,
  updatedAt: Date.now(),
}
const chapter = {
  id: 'chapter-fixture',
  novelId: book.id,
  title: '最后一章',
  order: 1,
  content: Array.from({ length: 24 }, () => '灯光落在纸上，故事缓缓走向尾声。').join('\n\n'),
}
const browser = await chromium.launch({ headless: true })
try {
  for (const theme of ['light', 'dark']) {
    for (const width of (process.env.CHECK_WIDTHS || '320,390,768,1440').split(',').map(Number)) {
      const context = await browser.newContext({ viewport: { width, height: 850 }, reducedMotion: 'reduce' })
      await context.addInitScript((theme) => {
        localStorage.setItem('user_session_token', 'layout-fixture')
        localStorage.setItem('theme', theme)
      }, theme)
      await context.route('**/api/**', async (route) => {
        const path = new URL(route.request().url()).pathname
        let data = {}
        if (path === '/api/auth/me') data = { user: { id: 'fixture', username: 'admin', role: 'admin', status: 'active' } }
        else if (path === '/api/auth/reader-settings') data = { settings: { contentMode: 'safe' } }
        else if (path === '/api/novels') {
          const admin = route.request().headers().referer?.includes('/admin/')
          data = {
            novels: admin ? Array.from({ length: 15 }, (_, i) => ({ ...book, id: `layout-fixture-${i}`, title: `${book.title} · ${i + 1}` })) : [book],
            total: admin ? 411 : 1,
            totalPages: admin ? 28 : 1,
            page: 1,
            availableCategories: [],
          }
        } else if (path === `/api/novels/${book.id}`) data = { novel: book }
        else if (path === '/api/chapters') data = { chapters: [chapter] }
        else if (path === `/api/chapters/${chapter.id}`) data = { chapter }
        else if (path.includes('/comments')) data = { comments: [], total: 0 }
        else if (path.includes('/thoughts')) data = { thoughts: [] }
        else if (path === '/api/categories') data = { categories: [] }
        await route.fulfill({ json: data })
      })
      const page = await context.newPage()
      const pages = [
        ['admin', '/admin/novels', '.admin-pagination'],
        ['reader', `/read/${book.id}/${chapter.id}`, '.reader-bottom'],
        ['home', '/', '.home-footer'],
        ['detail', `/novel/${book.id}`, '.comments-list'],
        ['bookshelf', '/bookshelf', '.bookshelf-shell'],
        ['profile', '/profile', '.profile-shell'],
      ]
      for (const [name, path, selector] of pages.filter(([name]) => !process.env.CHECK_PAGES || process.env.CHECK_PAGES.split(',').includes(name))) {
        await page.goto(`${base}${path}`)
        await page.locator(selector).waitFor()
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
        await page.screenshot({ path: `${output}/${theme}-${width}-${name}.png` })
        const metrics = await page.evaluate(() => ({
          width: document.documentElement.scrollWidth,
          viewport: innerWidth,
          bodyHeight: getComputedStyle(document.body).minHeight,
        }))
        assert.ok(metrics.width <= metrics.viewport + 1, `${name} 不应横向溢出`)
        assert.equal(metrics.bodyHeight, '850px', '画布应使用当前可见视口高度')
        if (name === 'admin' && width < 768) {
          const bottom = await page.locator('.admin-layout__content').evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom))
          assert.equal(bottom, 16, '后台各页面共用紧凑页尾')
          const pagination = await page.locator('.admin-pagination').boundingBox()
          assert.ok(Math.abs(850 - pagination.y - pagination.height - 16) <= 1, '长列表分页后只保留16px，不产生额外白色画布')
        }
        if (name === 'reader' && width <= 640) {
          const checkToolbar = async (button, expected) => {
            const padding = await page.locator('.reader-app').evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom))
            assert.equal(padding, expected, '阅读页按工具栏状态预留空间')
            await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
            const actions = await page.locator('.reader-footer-actions').boundingBox()
            const toolbar = await page.locator(button).boundingBox()
            assert.ok(actions.y + actions.height <= toolbar.y, '页尾按钮不应被工具栏遮住')
            assert.ok(toolbar.y - actions.y - actions.height <= 17, '工具栏前只保留16px呼吸空间')
          }
          await checkToolbar('.mobile-reader-bar-peek', 60)
          await page.getByRole('button', { name: '显示阅读工具栏' }).click()
          await checkToolbar('.mobile-reader-bar', 84)
          await page.screenshot({ path: `${output}/${theme}-${width}-reader-expanded.png` })
        }
      }
      await context.close()
    }
  }
  console.log(`${process.env.CHECK_PAGES || '六类页面'}、${process.env.CHECK_WIDTHS || '320,390,768,1440'}px 与明暗主题页尾检查通过。截图：${output}`)
} finally {
  await browser.close()
}
