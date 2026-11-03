import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const base = process.env.WEB_URL || 'http://localhost:5173'
const output = '.visual/ai-content-mobile'
await mkdir(output, { recursive: true })
const items = Array.from({ length: 4 }, (_, i) => ({
  id: `generation-${i}`, kind: 'continue', model: 'deepseek-v4.1-flash-uncensored',
  novelId: 'fixture', novelTitle: '和哥哥在大世界里愉快恋爱', chapterId: '',
  chapterTitle: `第 ${i + 1} 章`, result: '窗外的夜色渐深，他们循着旧日留下的线索，再次走向故事的深处。',
  status: 'published', createdAt: 1793671200000, batchId: 'batch-fixture',
  batchIndex: i, batchCount: 4, draftTitle: `第 ${i + 1} 章`, contentRevision: 'fixture',
}))
const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || undefined })
try {
  for (const width of (process.env.CHECK_WIDTHS || '320,390,768,900,901,1440').split(',').map(Number)) {
    for (const theme of ['dark', 'light']) {
      const context = await browser.newContext({ viewport: { width, height: 850 }, reducedMotion: 'reduce' })
      await context.addInitScript(theme => {
        localStorage.setItem('user_session_token', 'layout-fixture')
        localStorage.setItem('theme', theme)
      }, theme)
      await context.route('**/api/**', async route => {
        const path = new URL(route.request().url()).pathname
        let data = {}
        if (path === '/api/auth/me') data = { user: { id: 'fixture', username: 'admin', role: 'admin', status: 'active' } }
        else if (path === '/api/auth/reader-settings') data = { settings: { contentMode: 'safe' } }
        else if (path === '/api/ai/settings') data = { settings: {}, provider: { model: 'fixture' } }
        else if (path === '/api/ai/generations') data = { items, total: 1 }
        await route.fulfill({ json: data })
      })
      const page = await context.newPage()
      await page.goto(`${base}/admin/ai?sub=content`)
      await page.locator('.ai-generation-row').first().waitFor()
      const checkLayout = async () => {
        const metrics = await page.evaluate(() => ({
          viewport: innerWidth, document: document.documentElement.scrollWidth,
          pageWidth: document.querySelector('.ai-admin-page').getBoundingClientRect().width,
          filters: [...document.querySelectorAll('.ai-generations-filter-rail .admin-filter-chips > *')].map(el => ({
            left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right,
          })),
        }))
        assert(metrics.document <= width + 1, 'AI content must not widen the mobile viewport')
        if (width < 768) assert(metrics.pageWidth >= width - 48, 'AI content must fill the mobile screen')
        if (width <= 900) for (const filter of metrics.filters) {
          assert(filter.left >= 0 && filter.right <= width, 'all filters and list status must be visible without horizontal scrolling')
        }
        return metrics
      }
      const metrics = await checkLayout()
      await page.getByRole('button', { name: '4 章', exact: true }).click()
      await page.locator('.ai-generation-row--child').first().waitFor()
      await checkLayout()
      await page.screenshot({ path: `${output}/${width}-${theme}.png` })
      await page.getByRole('combobox', { name: '按类型筛选生成内容' }).click()
      await page.getByRole('option', { name: '创作大纲', exact: true }).click()
      await page.getByRole('button', { name: '清除筛选', exact: true }).waitFor()
      await checkLayout()
      await page.getByRole('button', { name: '清除筛选', exact: true }).click()
      await checkLayout()
      console.log(JSON.stringify({ width, theme, ...metrics, expandedBatch: 'passed', filters: 'passed' }))
      await context.close()
    }
  }
} finally {
  await browser.close()
}
