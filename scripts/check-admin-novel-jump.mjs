import assert from 'node:assert/strict'
import { chromium } from 'playwright'

// Run against the local web dev server; all API responses are isolated fixtures.
const base = process.env.WEB_URL || 'http://127.0.0.1:5197'
const books = Array.from({ length: 40 }, (_, i) => ({
  id: `jump-book-${i}`, title: i === 0 || i === 35 ? '同名目标小说' : `目录作品${i}`,
  author: '测试作者', description: '简介', categories: ['现代'], status: 'completed', contentRating: 'general',
  chapterCount: 1, remoteChapterCount: 1, updateCheckedAt: 1, sourceUrl: '', coverUrl: '', createdAt: 1, updatedAt: 1,
}))
const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  for (const [width, reducedMotion] of [[1440, 'no-preference'], [390, 'reduce']]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion })
    await context.addInitScript(() => {
      localStorage.setItem('user_session_token', 'isolated-jump-fixture')
      localStorage.setItem('admin_active_tab', 'scrape')
    })
    const requests = []
    await context.route('**/api/**', async route => {
      const parsed = new URL(route.request().url()), path = parsed.pathname
      let data = {}
      if (path === '/api/auth/me') data = { user: { id: 'fixture', username: 'admin', role: 'admin', status: 'active' } }
      else if (path === '/api/auth/reader-settings') data = { settings: { contentMode: 'safe' } }
      else if (path === '/api/novels/jump-book-35') data = { novel: books[35] }
      else if (path === '/api/novels') {
        requests.push(Object.fromEntries(parsed.searchParams))
        const limit = Number(parsed.searchParams.get('limit') || 15)
        const target = parsed.searchParams.get('locateNovelId')
        let page = Number(parsed.searchParams.get('page') || 1)
        if (target) {
          await new Promise(resolve => setTimeout(resolve, 400))
          page = Math.floor(books.findIndex(book => book.id === target) / limit) + 1
        }
        data = { novels: books.slice((page - 1) * limit, page * limit), page, limit,
          total: books.length, totalPages: Math.ceil(books.length / limit), availableCategories: ['现代'] }
      } else if (path === '/api/chapters') data = { chapters: [] }
      else if (path === '/api/comments') data = { comments: [], total: 0 }
      else if (path === '/api/ratings') data = { average: 0, count: 0, distribution: {}, myRating: null }
      else if (path === '/api/bookshelf') data = { favorites: [], recent: [] }
      else if (path === '/api/progress') data = { progress: [] }
      await route.fulfill({ json: data })
    })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`${base}/novel/jump-book-35`)
    const manage = page.getByRole('link', { name: '管理', exact: true })
    await manage.waitFor()
    assert.equal(await manage.getAttribute('href'), '/admin/novels?novelId=jump-book-35')
    await manage.click()
    const row = page.locator('.novel-row--highlight')
    await row.waitFor()
    assert.match(await row.innerText(), /同名目标小说/)
    assert.equal(await row.getByRole('checkbox').getAttribute('aria-label'), '选择小说：同名目标小说')
    assert.ok(requests.some(request => request.locateNovelId === 'jump-book-35'))
    await page.waitForFunction(() => {
      const row = document.querySelector('.novel-row--highlight')
      if (!row) return false
      const rect = row.getBoundingClientRect()
      return rect.top < innerHeight && rect.bottom > 0
    })
    if (reducedMotion === 'reduce') {
      assert.equal(await row.locator('td').first().evaluate(el => getComputedStyle(el).animationName), 'none')
    }
    await page.waitForURL(url => !url.searchParams.has('novelId'))
    assert.equal(await row.count(), 0)
    assert.equal(new URL(page.url()).searchParams.has('novelId'), false)
    assert.equal(new URL(page.url()).pathname, '/admin/novels')
    assert.ok(requests.some(request => request.page === '3' && !request.locateNovelId))
    assert.equal(await page.locator('[data-admin-search]').inputValue(), '')
    assert.deepEqual(errors, [])
    await context.close()
    console.log(`PASS ${width}px ${reducedMotion}: 详情入口、同名书按ID定位第3页、滚动、高亮自动消退及清除URL目标`)
  }
} finally {
  await browser.close()
}
