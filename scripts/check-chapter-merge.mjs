import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
// Start Vite first. All API requests use isolated fixtures; the real book library is untouched.
const base = process.env.WEB_URL || 'http://127.0.0.1:5182'
const out = '.impeccable/review/chapter-merge'
await mkdir(out, { recursive: true })
const novel = { id: 'merge-book', title: '山雨来时：一段很长的书名用于检查弹窗换行', author: '测试作者', chapterCount: 272 }
const changes = Array.from({ length: 97 }, (_, i) => ({ localChapterId: `c-${i}`, localOrder: i + 1, oldTitle: `第${i + 1}章`, newTitle: `山雨来时 · ${i + 1}`, eligible: i < 92, partIndex: 1, partCount: i % 4 === 0 ? 2 : 1 }))
const fixture = { runId: 'fixture-run', site: 'po18tw', metadata: { title: novel.title, author: novel.author, description: '示例简介。'.repeat(140), coverUrl: '', categories: ['现代'], status: 'completed' }, sourceChapterCount: 100, localChapterCount: 272, matchedSourceCount: 97, unmatchedSource: [{ key: 's', order: 99, title: '未匹配源章' }], unmatchedLocal: [{ id: 'u', order: 272, title: '未匹配本地章节' }], warnings: [], mappings: [], changes }
const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  for (const [width, height, theme] of [[1440, 1000, 'light'], [676, 886, 'light'], [390, 844, 'light'], [1440, 1000, 'dark']]) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' })
    await context.addInitScript(theme => { localStorage.setItem('user_session_token', 'isolated-merge-fixture'); localStorage.setItem('theme', theme) }, theme)
    let applied, reads = 0, failRead = false, delayed = false
    const errors = []
    await context.route('**/api/**', async route => {
      const url = new URL(route.request().url()), path = url.pathname
      const body = route.request().method() === 'POST' ? route.request().postDataJSON() : {}
      let data = {}
      if (path === '/api/auth/me') data = { user: { id: 'fixture', username: 'admin', role: 'admin', status: 'active' } }
      else if (path.includes('novel-index')) data = { novels: [novel] }
      else if (path === '/api/chapters') data = { chapters: [{ id: 'c-0', title: '第1章', order: 1, novelId: novel.id, wordCount: 100 }] }
      else if (path === '/api/scrape') {
        if (url.searchParams.get('action') === 'source-bindings') data = { bindings: [{ isPrimary: true, sourceUrl: 'https://www.po18.tw/books/12345' }] }
        if (body.action === 'title-source-search') data = { sources: { jjwxc: { ok: true, results: [] }, po18tw: { ok: true, results: [{ site: 'po18tw', title: novel.title, author: novel.author, url: 'https://www.po18.tw/books/12345' }] } } }
        if (body.action === 'source-sync-preview') {
          reads++
          if (delayed) await new Promise(resolve => setTimeout(resolve, 700))
          if (failRead) return route.fulfill({ status: 500, json: { error: '模拟读取失败，请重试' } })
          data = fixture
        }
        if (body.action === 'source-sync-apply') { applied = body; data = { updated: 92, metadataUpdated: [], mappings: 97 } }
      }
      return route.fulfill({ json: data })
    })
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`${base}/admin/chapters`)
    await page.getByRole('combobox').first().click()
    await page.getByRole('option').filter({ hasText: novel.title }).click()
    await page.getByRole('button', { name: '融合章节名', exact: true }).click()
    const dialog = page.locator('.chapter-merge-dialog')
    await page.waitForFunction(() => document.querySelector('#chapter-source-url')?.value.includes('/books/'))
    await page.screenshot({ path: `${out}/${width}-${theme}-source.png` })
    await dialog.getByLabel('搜索书名').press('Enter')
    await dialog.getByRole('button').filter({ hasText: novel.title }).click()
    await dialog.getByRole('heading', { name: '可更新 92 个章节名' }).waitFor()
    assert.equal(await dialog.locator('.chapter-merge-dialog__source').getAttribute('open'), null)
    assert.equal(await dialog.locator('.chapter-merge-dialog__changes > li').count(), 20)
    await page.screenshot({ path: `${out}/${width}-${theme}-preview.png` })
    assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth), true)
    if (width === 1440) assert.equal(Math.round((await dialog.boundingBox()).width), 760)
    const footer = await dialog.locator('[data-slot="dialog-footer"]').boundingBox()
    assert.ok(footer.y + footer.height <= height && footer.y >= 0)
    await dialog.getByRole('button', { name: '需确认 5', exact: true }).click()
    assert.equal(await dialog.locator('.chapter-merge-dialog__changes > li').count(), 5)
    await dialog.getByRole('button', { name: '全部 97', exact: true }).click()
    await dialog.getByRole('button', { name: '下一页' }).click()
    assert.equal((await dialog.locator('.chapter-merge-dialog__order').first().innerText()).trim(), '21')
    await dialog.getByRole('searchbox').fill('山雨来时 · 97')
    assert.equal(await dialog.locator('.chapter-merge-dialog__changes > li').count(), 1)
    await dialog.locator('.chapter-merge-dialog__metadata > summary').click()
    await dialog.getByRole('button', { name: '清空选择' }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${out}/${width}-${theme}-metadata.png` })
    await dialog.getByRole('button', { name: '清空选择' }).click()
    await dialog.getByRole('button', { name: '更新 92 个标题', exact: true }).click()
    await page.getByRole('button', { name: '确认更新', exact: true }).click()
    await page.waitForFunction(() => !document.querySelector('.chapter-merge-dialog'))
    assert.equal(applied.confirmedChangeIds.length, 92)
    assert.equal(applied.applyMetadata, false)
    assert.deepEqual(applied.metadataFields, [])
    // A failed refresh must remove the previous preview; pending reads cannot close.
    await page.getByRole('button', { name: '融合章节名', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('#chapter-source-url')?.value.includes('/books/'))
    failRead = true; delayed = true
    await dialog.getByLabel('已有作品链接').press('Enter')
    await page.keyboard.press('Escape')
    assert.equal(await dialog.count(), 1)
    await dialog.getByRole('alert').waitFor()
    assert.equal(await dialog.getByRole('button', { name: '更新 92 个标题' }).count(), 0)
    failRead = false; delayed = false
    await dialog.getByRole('button', { name: '读取源站', exact: true }).click()
    await dialog.getByRole('heading', { name: '可更新 92 个章节名' }).waitFor()
    await dialog.locator('.chapter-merge-dialog__source > summary').click()
    await dialog.getByLabel('已有作品链接').fill('https://www.po18.tw/books/54321')
    assert.equal(await dialog.getByRole('button', { name: '更新 92 个标题' }).count(), 0)
    assert.deepEqual(errors, [])
    console.log(`PASS ${width}px ${theme}: Enter search/read, 97-row paging/filter/search, 92 eligible-only apply, metadata deselect, failure/retry, busy Escape, stale preview invalidation, footer/overflow; reads=${reads}`)
    await context.close()
  }
} finally { await browser.close() }
