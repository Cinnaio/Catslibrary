import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
const base = process.env.WEB_URL || 'http://127.0.0.1:5182',
  out = '.impeccable/review/book-import'
await mkdir(out, { recursive: true })
const novel = { id: 'fixture-book', title: '山雨来时：沿着旧日书页寻找归途', author: '测试作者', chapterCount: 20, categories: ['现代'], status: 'ongoing' }
const chapters = Array.from({ length: 24 }, (_, i) => ({
  id: `diff-${i}`,
  status: ['new', 'changed', 'unchanged', 'conflict'][i % 4],
  incomingOrder: i + 1,
  incomingTitle: `第${i + 1}章 山雨来时，沿着旧日书页寻找归途`,
  localTitle: `第${i + 1}章 旧日记录`,
  localContent: '旧日的山路延伸到林间。'.repeat(18),
  incomingContent: '山雨来时，书页里留下了新的记录。'.repeat(18),
  reason: ['本地没有此章节', '正文发生变化，展开比较后选择', '正文与本地一致', '同名章节存在多个对应项'][i % 4],
  confidence: 'high',
  selected: i % 4 === 0,
}))
const fixture = {
  runId: 'fixture-run',
  sourceType: 'file',
  sourceLabel: '山雨来时.txt',
  sourceUrl: '',
  book: { title: novel.title, author: novel.author, chapters },
  targetNovelId: novel.id,
  targetNovel: novel,
  candidates: [{ novel, matchReason: 'title-author', score: 100 }],
  metadataDiff: [
    {
      field: 'description',
      label: '简介',
      localValue: '原有的作品简介',
      incomingValue: '山雨将至，旅人重新走进旧日的山林，寻找书页间遗失的故事。',
      changed: true,
      selected: false,
    },
    { field: 'author', label: '作者', localValue: '', incomingValue: novel.author, changed: true, selected: true },
  ],
  chapters,
  summary: { newCount: 6, changedCount: 6, unchangedCount: 6, conflictCount: 6 },
  warnings: ['存在同名章节，请在差异列表中核对。'],
}
const diagnostics = {
  heuristicVersion: 1,
  stats: {
    parser: 'text',
    totalLines: 240,
    headingLines: 24,
    volumeHeadingLines: 0,
    mergedHeadingLines: 0,
    frontMatterLines: 2,
    droppedEmptyChapters: 0,
    chapterCount: 24,
    chapterChars: { min: 600, median: 1200, max: 2400 },
    frontMatterChars: 80,
    numbering: { detected: 24, min: 1, max: 24, missing: 0, duplicated: 0 },
  },
  uncertain: [{ line: 42, raw: '山雨将至', verdict: 'prose', rule: 'prose', confidence: 'low', rejectedBy: 'prose-ending' }],
  uncertainTotal: 1,
  anomalies: [{ code: 'uncertain-lines', severity: 'warning', message: '有 1 行需要核对，可能影响章节边界。' }],
}
const aiReview = {
  reviewedAt: 1,
  model: 'fixture',
  heuristicVersion: 1,
  candidateCount: 1,
  projectedChapterCount: 25,
  suggestions: [{ line: 42, raw: '山雨将至', heuristic: 'prose', verdict: 'heading', confidence: 'high', reason: '独立标题行' }],
  usage: { promptTokens: 0, completionTokens: 0, costMillicents: 0 },
}
const browser = await chromium.launch({ channel: 'msedge', headless: true }),
  evidence = []
try {
  for (const [width, height, theme] of [
    [1440, 1000, 'light'],
    [960, 826, 'light'],
    [390, 844, 'light'],
    [1440, 1000, 'dark'],
  ]) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' })
    await context.addInitScript((theme) => {
      localStorage.setItem('user_session_token', 'isolated-import-fixture')
      localStorage.setItem('theme', theme)
    }, theme)
    let fail = false,
      delay = false,
      posted,
      previews = 0,
      showDiagnostics = false,
      reviewCalls = 0,
      applyCalls = 0
    await context.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname
      let data = {}
      if (path === '/api/auth/me') data = { user: { id: 'fixture', username: 'admin', role: 'admin', status: 'active' } }
      else if (path === '/api/novels') data = { novels: [novel], total: 1 }
      else if (path.includes('novel-index')) data = { novels: [novel] }
      else if (path === '/api/book-import/preview') {
        previews++
        if (delay) await new Promise((r) => setTimeout(r, 800))
        if (fail) return route.fulfill({ status: 500, json: { error: '模拟解析失败，请检查文件后重试。' } })
        data = showDiagnostics ? { ...fixture, diagnostics } : fixture
      } else if (path.endsWith('/ai-review/apply')) {
        applyCalls++
        data = { ...fixture, diagnostics }
      } else if (path.endsWith('/ai-review')) {
        reviewCalls++
        data = aiReview
      } else if (path.endsWith('/commit')) {
        posted = route.request().postDataJSON()
        data = {
          runId: fixture.runId,
          batchId: 'batch',
          novelId: novel.id,
          novelCreated: false,
          created: 6,
          updated: 1,
          skipped: 17,
          metadataUpdated: ['author'],
          conflicts: [],
        }
      } else if (path.endsWith('/rollback')) data = { runId: fixture.runId, rolledBack: 7, conflicts: [] }
      else if (path.endsWith('/target')) data = fixture
      return route.fulfill({ json: data })
    })
    const page = await context.newPage(),
      errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(`${base}/admin/novels`)
    await page.getByRole('button', { name: '导入书籍', exact: true }).click()
    const dialog = page.locator('.book-import-dialog'),
      footer = dialog.locator('[data-slot="dialog-footer"]')
    const capture = async (name) => {
      const title = await dialog.locator('[data-slot="dialog-title"]').evaluate(el => {
        const style = getComputedStyle(el)
        const rootSize = parseFloat(getComputedStyle(document.documentElement).fontSize)
        return { actual: parseFloat(style.fontSize), expected: parseFloat(style.getPropertyValue('--admin-dialog-title-size')) * rootSize }
      })
      assert.ok(Math.abs(title.actual - title.expected) < 0.1, `${name}: shared dialog title scale`)
      for (const stats of await dialog.locator('.book-import__summary-grid, .book-import__result-grid').all()) {
        assert.equal(await stats.evaluate(el => getComputedStyle(el).display), 'flex', `${name}: inline counts retain spacing`)
      }
      await page.screenshot({ path: `${out}/${width}-${theme}-${name}.png` })
      const box = await footer.boundingBox()
      assert.ok(box.y >= 0 && box.y + box.height <= height, `${name}: footer outside viewport`)
      assert.ok(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth), `${name}: overflow`)
    }
    assert.ok(await dialog.getByRole('button', { name: '生成预览', exact: true }).isDisabled())
    assert.equal(await dialog.locator('[aria-current="step"]').innerText(), '选择来源')
    if (width === 1440) assert.equal(Math.round((await dialog.boundingBox()).width), 760)
    await capture('source')
    assert.notEqual(await dialog.locator('.book-import__source-tabs').evaluate(el => getComputedStyle(el, '::before').content), 'none', 'source tabs use shared activation surface')
    const input = dialog.locator('input[type=file]')
    await input.setInputFiles({ name: '不支持.pdf', mimeType: 'application/pdf', buffer: Buffer.from('test') })
    await dialog.getByRole('alert').filter({ hasText: '请选择 TXT' }).waitFor()
    await input.setInputFiles({
      name: '山雨来时_章节补全_用于检查长文件名是否正常换行.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('第一章 山雨来时\n旅人回到了山间。'),
    })
    await dialog.locator('.book-import__selected-file').waitFor()
    await capture('file')
    await dialog.getByRole('button', { name: '移除已选文件' }).click()
    await dialog.getByRole('button', { name: '选择或拖入书籍文件' }).waitFor()
    await input.setInputFiles({ name: '山雨来时.txt', mimeType: 'text/plain', buffer: Buffer.from('第一章 山雨来时\n旅人回到了山间。') })
    await dialog.getByText('补充来源链接', { exact: false }).click()
    await dialog.getByLabel('原书来源 URL').fill('https://example.com/book/123')
    fail = true
    await dialog.getByRole('button', { name: '生成预览', exact: true }).click()
    await dialog.getByRole('alert').filter({ hasText: '模拟解析失败' }).waitFor()
    await capture('error')
    fail = false
    delay = true
    await dialog.getByLabel('原书来源 URL').press('Enter')
    await dialog.getByRole('button', { name: '分析中…' }).waitFor()
    assert.ok(await dialog.getByRole('tab', { name: '网页链接' }).isDisabled())
    await page.keyboard.press('Escape')
    assert.ok(await dialog.isVisible())
    await dialog.getByRole('heading', { name: '书库匹配', exact: true }).waitFor()
    delay = false
    await capture('match')
    await dialog.getByRole('button', { name: '查看差异', exact: true }).click()
    await dialog.getByRole('heading', { name: '章节差异', exact: true }).waitFor()
    assert.equal(await dialog.locator('.book-import__body').evaluate((el) => el.scrollTop), 0)
    await capture('diff')
    await dialog.locator('.book-import__metadata-disclosure > summary').click()
    const fieldLabels = await dialog.locator('.book-import__metadata-copy strong').evaluateAll(elements => elements.map(el => ({size: getComputedStyle(el).fontSize, weight: getComputedStyle(el).fontWeight})))
    assert.ok(fieldLabels.length > 0 && fieldLabels.every(label => label.size === '12px' && label.weight === '500'), 'metadata field labels follow shared dialog scale')
    const selectedMode = await dialog.locator('.book-import__mode-picker label:has(input:checked)').evaluate(el => ({weight: getComputedStyle(el).fontWeight, size: getComputedStyle(el).fontSize}))
    assert.equal(selectedMode.weight, '600', 'selected metadata mode keeps shared emphasis')
    assert.equal(selectedMode.size, '13px', 'metadata mode keeps shared size on every viewport')
    await capture('metadata')
    await dialog.locator('.book-import__metadata-disclosure > summary').click()
    await dialog.getByRole('button').filter({ hasText: '第2章 山雨来时' }).click()
    await dialog.getByRole('checkbox', { name: '有变化章节：第2章 山雨来时，沿着旧日书页寻找归途' }).check()
    await dialog.locator('.book-import__chapter-diff').scrollIntoViewIfNeeded()
    await capture('comparison')
    assert.ok(await dialog.getByRole('checkbox', { name: '需确认章节：第4章 山雨来时，沿着旧日书页寻找归途' }).isDisabled())
    await dialog.getByRole('button', { name: '确认导入 · 7 章', exact: true }).click()
    await dialog.getByRole('heading', { name: '已增量更新作品' }).waitFor()
    assert.equal(posted.selectedChapterIds.length, 7)
    assert.deepEqual(posted.metadataFields, ['author'])
    await capture('result')
    await dialog.getByRole('button', { name: '撤回这次导入', exact: true }).click()
    await dialog.getByRole('heading', { name: '已恢复可安全恢复的内容' }).waitFor()
    await capture('rollback')
    assert.equal(await dialog.locator('.book-import__result-grid').count(), 0)
    await dialog.getByRole('button', { name: '再导入一本' }).click()
    showDiagnostics = true
    await dialog.getByRole('tab', { name: '网页链接' }).click()
    await dialog.getByLabel('书籍详情页 URL').fill('https://example.com/book/123')
    const icon = await dialog.locator('.book-import__source-callout svg').boundingBox()
    assert.ok(icon.width >= 12 && icon.height >= 12, 'URL callout icon must remain legible')
    await capture('url')
    await dialog.getByLabel('书籍详情页 URL').press('Enter')
    await dialog.getByRole('heading', { name: '书库匹配', exact: true }).waitFor()
    await dialog.getByRole('button', { name: '查看差异', exact: true }).click()
    await dialog.getByRole('button', { name: '展开明细' }).click()
    await capture('diagnostics')
    await dialog.getByRole('button', { name: '运行 AI 复核' }).click()
    await dialog.getByRole('button', { name: '采纳建议并重新切分' }).waitFor()
    await dialog.locator('.book-import__diagnostics-review-result').scrollIntoViewIfNeeded()
    await capture('ai-review')
    await dialog.getByRole('button', { name: '采纳建议并重新切分' }).click()
    await dialog.getByRole('button', { name: '运行 AI 复核' }).waitFor()
    assert.equal(reviewCalls, 1)
    assert.equal(applyCalls, 1)
    assert.equal(previews, 3)
    assert.deepEqual(errors, [])
    evidence.push({ width, height, theme, pass: true, states: 13 })
    await context.close()
  }
} finally {
  await browser.close()
}
await writeFile(`${out}/checks.json`, JSON.stringify(evidence, null, 2))
console.log(JSON.stringify(evidence, null, 2))
