import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
const base = process.env.WEB_URL || 'http://127.0.0.1:5198'
const out = process.env.SCREENSHOT_DIR
if (out) await mkdir(out, { recursive: true })
const suggestion = {
  id: 'fixture',
  novelId: 'fixture',
  title: '审核示例作品',
  author: '示例作者',
  novelRevision: 0,
  currentRating: 'unknown',
  currentSource: 'system',
  currentRevision: 0,
  suggestedRating: 'restricted',
  confidence: 0.9,
  reason: '正文多章出现明确的成人向描写，相关段落包含连续的行为过程。建议结合原文核对语境后确认分级。',
  evidence: [
    {
      type: 'llm',
      value: '第74章《雨夜》：模型提取的原文线索与上下文摘要。这里用较长的示例文字检查证据列表的阅读体验、换行以及左右间距，审核时可以依次核对每一条依据。',
    },
    { type: 'llm', value: '第142章《翌日》：另一处原文线索。证据呈现为自然段，便于逐条阅读与核对。' },
    { type: 'llm', value: '关键词统计：语境词在多个章节出现，但词频本身不能直接决定分级。' },
  ],
  model: 'deepseek-v4.1-flash',
  promptVersion: 'content-rating-ai-v2',
  status: 'pending',
  revision: 0,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  inputSnapshot: {
    body: {
      hasBody: true,
      chapterCount: 181,
      scannedCharacters: 384537,
      matchedChapterCount: 73,
      matchedChapterRatio: 0.403,
      keywordHits: [
        { keyword: '胸口', chapters: 26 },
        { keyword: '湿了', chapters: 10 },
        { keyword: '腰肢', chapters: 9 },
      ],
      excerpts: [
        {
          chapter: '第74章 · 雨夜',
          origin: 'match',
          weakKeywords: ['胸口'],
          strongKeywords: [],
          text: '此处为原文片段的布局示例。审核员应结合前后文判断语境，再决定是否采纳模型建议。\n段落保持原有换行，便于核对较长文本。',
        },
        ...Array.from({ length: 9 }, (_, index) => ({
          chapter: `第${142 + index}章 · 翌日`,
          origin: 'uniform',
          weakKeywords: [],
          strongKeywords: [],
          text: '原文采样示例。'.repeat(40),
        })),
      ],
    },
  },
}
// Only isolated API fixtures are used; review confirmations are never submitted.
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH })
try {
  for (const theme of ['light', 'dark'])
    for (const width of [1920, 1440, 960, 900, 701, 700, 390, 320]) {
      const height = width > 700 ? 900 : width === 320 ? 568 : 720
      const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme, reducedMotion: 'reduce' })
      await context.addInitScript((theme) => {
        localStorage.setItem('user_session_marker', 'design-fixture')
        localStorage.setItem('theme', theme)
      }, theme)
      await context.route('**/api/**', async (route) => {
        const path = new URL(route.request().url()).pathname
        let data = {}
        if (path === '/api/auth/me') data = { user: { id: 'fixture', username: 'admin', role: 'admin', status: 'active' } }
        else if (path === '/api/auth/reader-settings') data = { settings: { contentMode: 'safe' } }
        else if (path === '/api/admin/content-rating-ai')
          data = { items: [suggestion], total: 1, counts: { pending: 1, approved: 0, rejected: 0, stale: 0, failed: 0 } }
        else if (path === '/api/admin/content-rating-ai/latest') data = { task: null }
        else if (path === '/api/admin/content-rating-rule-candidates') data = { items: [], total: 0, counts: { pending: 0 } }
        else if (path === '/api/admin/content-ratings') data = { items: [], total: 0, counts: { unknown: 1, general: 0, restricted: 0 } }
        await route.fulfill({ json: data })
      })
      const page = await context.newPage()
      await page.goto(`${base}/admin/content-ratings?view=ai`)
      await page.getByRole('button', { name: '审核建议', exact: true }).click()
      const dialog = page.getByRole('dialog')
      const body = dialog.getByRole('region', { name: '分级建议与原文审阅' })
      const approve = dialog.getByRole('button', { name: '进入批准确认' })
      assert.equal(await page.locator('html').getAttribute('data-theme'), theme)
      const box = await dialog.boundingBox()
      assert(box.x >= 0 && box.x + box.width <= width + 1 && box.y >= 0 && box.y + box.height <= height + 1)
      const contract = await body.evaluate((el) => {
        const header = el.previousElementSibling
        const footer = el.nextElementSibling
        return {
          headerLine: getComputedStyle(header).borderBottomWidth,
          footerLine: getComputedStyle(footer).borderTopWidth,
          horizontalOverflow: [el.parentElement, el, footer].some(node => node.scrollWidth > node.clientWidth + 1),
          scrollable: el.scrollHeight > el.clientHeight,
        }
      })
      assert.equal(contract.headerLine, '0px')
      assert.equal(contract.footerLine, '0px')
      assert(!contract.horizontalOverflow, 'dialog and actions fit the viewport')
      assert(contract.scrollable, 'long review scrolls independently')
      if (out) await page.screenshot({ path: `${out}/${theme}-${width}.png` })
      const footerY = (await approve.boundingBox()).y
      const excerpt = body.getByText('第142章 · 翌日', { exact: true })
      await excerpt.click()
      assert(await excerpt.evaluate(el => el.closest('details').open))
      assert.equal((await approve.boundingBox()).y, footerY, 'footer stays fixed while the body scrolls')
      await dialog.getByText('审核口径与模型信息', { exact: true }).click()
      await dialog.getByText('deepseek-v4.1-flash', { exact: true }).waitFor()
      await approve.click()
      const reason = dialog.getByLabel('批准理由')
      await reason.waitFor()
      assert(await reason.evaluate(el => el === document.activeElement), 'approve moves focus to the reason')
      await reason.fill('已核对原文与模型证据')
      const confirm = await dialog.getByRole('button', { name: '确认批准建议' }).boundingBox()
      assert(confirm.y + confirm.height <= height)
      if (out) await page.screenshot({ path: `${out}/${theme}-${width}-confirm.png` })
      await dialog.getByRole('button', { name: '返回查看' }).click()
      assert(await approve.evaluate(el => el === document.activeElement), 'return restores focus to approve')
      await dialog.getByRole('button', { name: '拒绝建议', exact: true }).click()
      assert(await dialog.getByLabel('拒绝理由').evaluate(el => el === document.activeElement), 'reject moves focus to the reason')
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'hidden' })
      await page.waitForFunction(() => document.activeElement?.textContent?.includes('审核建议'))
      assert(await page.getByRole('button', { name: '审核建议', exact: true }).evaluate((el) => el === document.activeElement), 'focus return')
      await context.close()
      console.log(`${theme} ${width}: passed`)
    }
} finally {
  await browser.close()
}
