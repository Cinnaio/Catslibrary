import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'

// Isolated API fixtures. Start Vite on WEB_URL before running this check.
const base = process.env.WEB_URL || 'http://127.0.0.1:5182'
const out = '.impeccable/review/source-sync-review'
await mkdir(out, { recursive: true })
const novel = { id: 'review-book', title: '山雨来时：一段较长的作品标题用于检查历史换行', author: '测试作者', chapterCount: 3 }
const localChapters = [44, 46, 46].map((order, i) => ({ id: `c${i}`, order, title: ['他注视着她【900珠加更】', '不行了，累累', '没有喊哥哥'][i] }))
localChapters.push(...Array.from({ length: 20 }, (_, i) => ({ id: `c${i + 3}`, order: i + 47, title: `后续章节 ${i + 1}` })))
const sourceChapters = localChapters.map((row, i) => ({ key: `s${i}`, order: 44 + i, title: row.title }))
const original = { runId: 'review-run', revision: 0, site: 'po18tw', metadata: { title: novel.title, author: novel.author, description: '', coverUrl: '', categories: [], status: 'ongoing' }, sourceChapterCount: 23, localChapterCount: 23, matchedSourceCount: 22, unmatchedLocal: [localChapters[1]], unmatchedSource: [sourceChapters[1]], warnings: [], changes: [], manualMappings: [], localChapters, sourceChapters, mappings: localChapters.flatMap((_, i) => i === 1 ? [] : [{ sourceChapterKey: `s${i}`, sourceOrder: 44 + i, sourceTitle: localChapters[i].title, localChapterIds: [`c${i}`], relation: 'one_to_one', confidence: 'high', matchReason: 'exact-title', matchEvidence: '完整标题一致，序号不同仍可独立定位。' }]) }
const browser = await chromium.launch({ channel: process.env.SOURCE_SYNC_CHECK_CHANNEL || undefined, headless: true })
try {
  for (const [width, height, theme] of [[1440, 1000, 'light'], [390, 844, 'light'], [1440, 1000, 'dark']]) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' })
    await context.addInitScript(theme => { localStorage.setItem('user_session_token', 'isolated-review'); localStorage.setItem('theme', theme) }, theme)
    let remapped = false, rolledBack = false, deleted = false, continued = false, previewReads = 0
    let currentPreview = original
    const errors = []
    await context.route('**/api/**', async route => {
      const url = new URL(route.request().url())
      const body = route.request().method() === 'POST' ? route.request().postDataJSON() : {}
      const action = body.action || url.searchParams.get('action')
      let data = {}
      if (url.pathname === '/api/auth/me') data = { user: { id: 'admin', username: 'admin', role: 'admin', status: 'active' } }
      else if (url.pathname.includes('novel-index')) data = { novels: [novel] }
      else if (url.pathname === '/api/chapters' && action === 'batch-delete') { assert.deepEqual(body.chapterIds, ['c1']); deleted = true; data = { success: true } }
      else if (url.pathname === '/api/chapters/c1') data = { chapter: { id: 'c1', novelId: novel.id, content: '隔离测试正文，用于确认混入章节。' } }
      else if (url.pathname === '/api/chapters') data = { chapters: localChapters.map(row => ({ ...row, novelId: novel.id, wordCount: 100 })) }
      else if (action === 'source-bindings') data = { bindings: [{ isPrimary: true, sourceUrl: 'https://www.po18.tw/books/12345' }] }
      else if (action === 'source-sync-preview') { previewReads++; data = original }
      else if (action === 'source-sync-remap') {
        assert.equal(body.revision, 0)
        assert.deepEqual(body.manualMappings, [{ localChapterId: 'c1', sourceChapterKey: 's1' }])
        remapped = true
        data = { ...original, revision: 1, manualMappings: body.manualMappings, unmatchedLocal: [], unmatchedSource: [], mappings: [...original.mappings, { sourceChapterKey: 's1', sourceOrder: 45, sourceTitle: '不行了，累累', localChapterIds: ['c1'], relation: 'one_to_one', confidence: 'high', matchReason: 'manual', matchEvidence: '由管理员指定。' }] }
        data.orderChanges = [{ localChapterId: 'c1', title: '不行了，累累', oldOrder: 46, newOrder: 45 }]
        currentPreview = data
      } else if (action === 'source-sync-apply') {
        assert.deepEqual(body.confirmedOrderIds, ['c1']); continued = true
        data = { updated: 0, orderUpdated: 1, metadataUpdated: [], mappings: 23 }
      } else if (action === 'source-sync-refresh') {
        data = { ...currentPreview, runId: deleted ? 'cleaned-run' : 'continued-run', revision: 0, orderChanges: [],
          localChapters: currentPreview.localChapters.filter(row => !deleted || row.id !== 'c1').map(row => row.id === 'c1' && continued ? { ...row, order: 45 } : row),
          mappings: currentPreview.mappings.filter(row => !deleted || !row.localChapterIds.includes('c1')),
          manualMappings: deleted ? [] : currentPreview.manualMappings, localChapterCount: deleted ? 22 : 23, matchedSourceCount: deleted ? 22 : 23,
          unmatchedSource: deleted ? [sourceChapters[1]] : [], unmatchedLocal: [] }
        currentPreview = data
      } else if (action === 'source-sync-history') data = { total: 2, items: [{ runId: 'old-run', status: rolledBack ? 'rolled_back' : 'applied', appliedAt: Date.now(), summary: { novelTitle: novel.title, sourceUrl: 'https://www.po18.tw/books/12345', titleUpdated: 0, orderUpdated: 25, metadataUpdated: 0 }, canRollback: !rolledBack }, { runId: 'earlier-run', status: 'applied', appliedAt: Date.now() - 3600000, summary: { novelTitle: novel.title, sourceUrl: 'https://www.po18.tw/books/12345', titleUpdated: 49, orderUpdated: 0, metadataUpdated: 0 }, canRollback: true }] }
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
    assert.equal(await dialog.locator('[data-slot=dialog-footer]').evaluate(el => getComputedStyle(el).borderTopWidth), '0px', '融合弹窗页脚不能添加分隔线')
    await dialog.locator('summary').filter({ hasText: '核对与调整映射' }).click()
    await dialog.getByRole('button', { name: '调整映射：本地 46', exact: true }).first().click()
    const editor = dialog.getByRole('region', { name: '人工映射编辑' })
    if (width === 1440) assert.equal(Math.round((await dialog.boundingBox()).width), 896)
    await page.waitForTimeout(100)
    const heading = editor.getByRole('heading')
    const bounds = await heading.boundingBox()
    assert.ok(bounds && bounds.y >= 0 && bounds.y + bounds.height < height, '点击调整后，编辑标题必须立即出现在视口内')
    assert.equal(await heading.evaluate(el => el === document.activeElement), true, '点击调整后，焦点必须进入编辑区域')
    await editor.getByRole('combobox').click()
    assert.equal(await page.getByRole('option').filter({ hasText: '选择后交换' }).count(), 22)
    await page.getByRole('option', { name: '45 · 不行了，累累', exact: true }).click()
    await editor.scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${out}/${width}-${theme}-mapping.png` })
    assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth), true)
    await editor.getByRole('button', { name: '暂存映射调整' }).click()
    assert.equal(remapped, false)
    await dialog.getByRole('button', { name: '保存 1 项映射并重新预览' }).click()
    await page.waitForFunction(() => document.body.textContent.includes('映射已更新'))
    assert.equal(remapped, true)
    assert.equal(await dialog.locator('.chapter-merge-dialog__mapping-review').evaluate(el => el.open), true)
    await dialog.getByRole('button', { name: '有差异 1', exact: true }).click()
    assert.equal(await dialog.getByRole('list', { name: '全部章节映射' }).locator(':scope > li').count(), 1)
    await dialog.getByText('序号不同', { exact: true }).waitFor()
    await dialog.locator('summary').filter({ hasText: '核对与调整映射' }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${out}/${width}-${theme}-differences.png` })
    await dialog.getByRole('checkbox', { name: '选择映射：本地 46', exact: true }).check()
    await dialog.getByRole('button', { name: '应用后继续核对', exact: true }).click()
    await page.getByRole('button', { name: '确认更新', exact: true }).click()
    await page.waitForFunction(() => document.body.textContent.includes('可继续核对'))
    assert.equal(continued, true)
    await dialog.getByRole('button', { name: '全部 23', exact: true }).click()
    await dialog.getByRole('button', { name: '预览正文：本地 45', exact: true }).click()
    await page.getByText('隔离测试正文，用于确认混入章节。', { exact: true }).waitFor()
    await page.getByRole('button', { name: '返回核对', exact: true }).click()
    await dialog.getByRole('checkbox', { name: '标记删除：本地 45', exact: true }).check()
    await dialog.getByRole('button', { name: '删除 1 个杂章并重新匹配', exact: true }).click()
    await page.getByRole('button', { name: '确认删除并重新匹配', exact: true }).click()
    await dialog.getByRole('button', { name: '全部 22', exact: true }).waitFor()
    assert.equal(deleted, true)
    assert.equal(previewReads, 1, '持续核对与删除不得再次读取源站')
    assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth), true)
    await dialog.locator('[data-slot=dialog-footer]').scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${out}/${width}-${theme}-continuous-review.png` })
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => document.querySelectorAll('[data-sonner-toast]').length === 0, null, { timeout: 8000 })
    await page.getByRole('button', { name: '融合历史', exact: true }).click()
    const records = dialog.getByRole('list', { name: '融合历史记录' })
    await records.locator(':scope > li').last().waitFor()
    assert.equal(await records.locator(':scope > li').last().evaluate(el => getComputedStyle(el).borderBottomWidth), '0px')
    assert.equal(await dialog.locator('.source-sync-history__pagination').evaluate(el => getComputedStyle(el).borderTopWidth), '0px')
    assert.equal(await dialog.locator('[data-slot=dialog-footer]').evaluate(el => getComputedStyle(el).borderTopWidth), '0px', '历史弹窗页脚沿用共享纸面与留白')
    await page.screenshot({ path: `${out}/${width}-${theme}-history-list.png` })
    await dialog.getByRole('button', { name: '查看变化', exact: true }).first().click()
    await dialog.getByRole('heading', { name: '本次实际变化' }).waitFor()
    await page.screenshot({ path: `${out}/${width}-${theme}-history.png` })
    assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth), true)
    await dialog.getByRole('button', { name: '撤回此次融合', exact: true }).first().click()
    await page.getByRole('button', { name: '确认撤回', exact: true }).click()
    await dialog.getByText('已恢复 1 项，保留 0 项冲突。', { exact: true }).waitFor()
    assert.equal(rolledBack, true)
    assert.deepEqual(errors, [])
    console.log(`PASS ${width}px ${theme}: immediate editor visibility/focus in long catalog, difference filter, staged mapping, occupied target swaps, continued apply, content preview, batch cleanup, cached catalog refresh, history detail, rollback, overflow`)
    await context.close()
  }
} finally { await browser.close() }
