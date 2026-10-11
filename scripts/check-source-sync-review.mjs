import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'

// Isolated API fixtures. Start Vite on WEB_URL before running this check.
const base = process.env.WEB_URL || 'http://127.0.0.1:5182'
const out = '.impeccable/review/source-sync-review'
await mkdir(out, { recursive: true })
const novel = { id: 'review-book', title: '山雨来时', author: '测试作者', chapterCount: 3 }
const localChapters = [44, 46, 46].map((order, i) => ({ id: `c${i}`, order, title: ['他注视着她【900珠加更】', '不行了，累累', '没有喊哥哥'][i] }))
const sourceChapters = localChapters.map((row, i) => ({ key: `s${i}`, order: 44 + i, title: row.title }))
const original = { runId: 'review-run', revision: 0, site: 'po18tw', metadata: { title: novel.title, author: novel.author, description: '', coverUrl: '', categories: [], status: 'ongoing' }, sourceChapterCount: 3, localChapterCount: 3, matchedSourceCount: 2, unmatchedLocal: [localChapters[1]], unmatchedSource: [sourceChapters[1]], warnings: [], changes: [], manualMappings: [], localChapters, sourceChapters, mappings: [0, 2].map(i => ({ sourceChapterKey: `s${i}`, sourceOrder: 44 + i, sourceTitle: localChapters[i].title, localChapterIds: [`c${i}`], relation: 'one_to_one', confidence: 'high', matchReason: 'exact-title', matchEvidence: '完整标题一致，序号不同仍可独立定位。' })) }
const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  for (const [width, height, theme] of [[1440, 1000, 'light'], [390, 844, 'light'], [1440, 1000, 'dark']]) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' })
    await context.addInitScript(theme => { localStorage.setItem('user_session_token', 'isolated-review'); localStorage.setItem('theme', theme) }, theme)
    let remapped = false, rolledBack = false
    const errors = []
    await context.route('**/api/**', async route => {
      const url = new URL(route.request().url())
      const body = route.request().method() === 'POST' ? route.request().postDataJSON() : {}
      const action = body.action || url.searchParams.get('action')
      let data = {}
      if (url.pathname === '/api/auth/me') data = { user: { id: 'admin', username: 'admin', role: 'admin', status: 'active' } }
      else if (url.pathname.includes('novel-index')) data = { novels: [novel] }
      else if (url.pathname === '/api/chapters') data = { chapters: localChapters.map(row => ({ ...row, novelId: novel.id, wordCount: 100 })) }
      else if (action === 'source-bindings') data = { bindings: [{ isPrimary: true, sourceUrl: 'https://www.po18.tw/books/12345' }] }
      else if (action === 'source-sync-preview') data = original
      else if (action === 'source-sync-remap') {
        assert.equal(body.revision, 0)
        assert.deepEqual(body.manualMappings, [{ localChapterId: 'c1', sourceChapterKey: 's1' }])
        remapped = true
        data = { ...original, revision: 1, manualMappings: body.manualMappings, unmatchedLocal: [], unmatchedSource: [], mappings: [...original.mappings, { sourceChapterKey: 's1', sourceOrder: 45, sourceTitle: '不行了，累累', localChapterIds: ['c1'], relation: 'one_to_one', confidence: 'high', matchReason: 'manual', matchEvidence: '由管理员指定。' }] }
      } else if (action === 'source-sync-history') data = { total: 1, items: [{ runId: 'old-run', status: rolledBack ? 'rolled_back' : 'applied', appliedAt: Date.now(), summary: { novelTitle: novel.title, sourceUrl: 'https://www.po18.tw/books/12345', titleUpdated: 1, orderUpdated: 1, metadataUpdated: 0 }, canRollback: !rolledBack }] }
      else if (action === 'source-sync-history-detail') data = { runId: 'old-run', changes: [{ kind: 'chapter', id: 'c1', before: { order: 46, title: '不行了，累累' }, after: { order: 45, title: '不行了，累累' } }] }
      else if (action === 'source-sync-rollback') { rolledBack = true; data = { runId: 'old-run', restored: 1, conflicts: [] } }
      await route.fulfill({ json: data })
    })
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`${base}/admin/chapters`)
    await page.getByRole('combobox').first().click()
    await page.getByRole('option').filter({ hasText: novel.title }).click()
    await page.getByRole('button', { name: '融合章节名', exact: true }).click()
    const dialog = page.locator('.chapter-merge-dialog')
    await page.waitForFunction(() => document.querySelector('#chapter-source-url')?.value.includes('/books/'))
    await dialog.getByRole('button', { name: '读取源站', exact: true }).click()
    await dialog.locator('summary').filter({ hasText: '核对与调整映射' }).click()
    await dialog.getByRole('button', { name: '调整映射：本地 46', exact: true }).first().click()
    const editor = dialog.getByRole('region', { name: '人工映射编辑' })
    await editor.getByRole('combobox').click()
    assert.equal(await page.getByRole('option').filter({ hasText: '已占用' }).count(), 2)
    await page.getByRole('option', { name: '45 · 不行了，累累', exact: true }).click()
    await editor.scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${out}/${width}-${theme}-mapping.png` })
    assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth), true)
    await editor.getByRole('button', { name: '保存映射并重新预览' }).click()
    await page.waitForFunction(() => document.body.textContent.includes('映射已更新'))
    assert.equal(remapped, true)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: '融合历史', exact: true }).click()
    await dialog.getByRole('button', { name: '查看变化', exact: true }).click()
    await dialog.getByRole('heading', { name: '本次实际变化' }).waitFor()
    await page.screenshot({ path: `${out}/${width}-${theme}-history.png` })
    assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth), true)
    await dialog.getByRole('button', { name: '撤回此次融合', exact: true }).click()
    await page.getByRole('button', { name: '确认撤回', exact: true }).click()
    await dialog.getByText('已恢复 1 项，保留 0 项冲突。', { exact: true }).waitFor()
    assert.equal(rolledBack, true)
    assert.deepEqual(errors, [])
    console.log(`PASS ${width}px ${theme}: reasons, occupied targets, neighbor review, remap revision, history detail, rollback, overflow`)
    await context.close()
  }
} finally { await browser.close() }
