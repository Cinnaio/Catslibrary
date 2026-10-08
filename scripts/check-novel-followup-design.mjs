import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

// Isolated API fixtures: this check never starts a real scrape job.
const base = process.env.WEB_URL || 'http://127.0.0.1:5197'
const output = process.env.SCREENSHOT_DIR || '/tmp/novel-followup-preview'
await mkdir(output, { recursive: true })
const title = '网恋老公，是我最讨厌的竹马！'
const book = {
  id: 'design-fixture',
  title,
  author: '蜗牛',
  categories: ['现代'],
  status: 'ongoing',
  contentRating: 'general',
  chapterCount: 91,
  remoteChapterCount: 95,
  pendingChapterCount: 4,
  pendingProtectedChapterCount: 2,
  pendingPublicChapterCount: 2,
  pendingUnknownChapterCount: 0,
  updatedAt: Date.now(),
}
const browser = await chromium.launch({ headless: true })
try {
  for (const theme of ['light', 'dark']) {
    for (const width of [320, 390, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 850 }, reducedMotion: 'reduce' })
      await context.addInitScript((theme) => {
        localStorage.setItem('user_session_token', 'isolated-design-fixture')
        localStorage.setItem('theme', theme)
      }, theme)
      await context.route('**/api/**', async (route) => {
        const path = new URL(route.request().url()).pathname
        let data = {}
        if (path === '/api/auth/me') data = { user: { id: 'fixture', username: 'admin', role: 'admin', status: 'active' } }
        else if (path === '/api/auth/reader-settings') data = { settings: { contentMode: 'safe' } }
        else if (path === '/api/novels') data = { novels: [book], total: 1, totalPages: 1, page: 1, availableCategories: [] }
        else if (path === '/api/scrape')
          data = {
            pendingChapterCount: 4,
            pendingProtectedChapterCount: 2,
            pendingPublicChapterCount: 2,
            pendingUnknownChapterCount: 0,
            enabled: true,
            intervalHours: 1,
            nextCheckAt: Date.now() + 3600000,
            checkedAt: Date.now(),
            result: 'pending',
            message: '仍有 4 章待入库',
            hasConfig: true,
            ongoing: true,
          }
        if (path === '/api/scrape' && route.request().method() === 'POST' && route.request().postDataJSON()?.action === 'followup-batch-save')
          data = { saved: 1, skipped: 0, results: [{ novelId: book.id, title, status: 'saved', reason: '' }] }
        await route.fulfill({ json: data })
      })
      const page = await context.newPage()
      await page.goto(`${base}/admin/novels`)
      const tag = page.getByText('待更新 4 章', { exact: true })
      await tag.waitFor()
      await page.getByText('含受保护 2 章', { exact: true }).waitFor()
      if (width < 900) {
        const geometry = await tag.evaluate((el) => {
          const summary = el.closest('.novel-chapter-summary')
          const number = summary.firstElementChild.getBoundingClientRect()
          const badge = el.getBoundingClientRect()
          return { sameRow: Math.abs(number.y - badge.y) < 8, color: getComputedStyle(el).color }
        })
        assert.ok(geometry.sameRow, '章节数和更新标签应在同一行')
      }
      await page.screenshot({ path: `${output}/${theme}-${width}-list.png` })
      await page.getByRole('button', { name: `${title}：更多操作` }).click()
      await page.getByRole('menuitem', { name: '追更设置', exact: true }).click()
      const dialog = page.getByRole('dialog')
      await dialog.getByText('仍有 4 章待入库', { exact: true }).waitFor()
      assert.equal(
        await dialog.getByRole('heading', { name: '追更设置', exact: true }).evaluate((el) => getComputedStyle(el).boxShadow),
        'none',
        '标题的程序焦点不显示控件焦点框',
      )
      await dialog.getByText('受保护 2 章', { exact: true }).waitFor()
      const box = await dialog.boundingBox()
      assert.ok(box.x >= 0 && box.x + box.width <= width + 1, '弹窗不能超出视口')
      const check = await dialog.getByRole('button', { name: '检查更新', exact: true }).boundingBox()
      const save = await dialog.getByRole('button', { name: '保存设置', exact: true }).boundingBox()
      assert.ok(Math.abs(check.y - save.y) < 1, '底部操作必须同一行')
      assert.ok(check.height >= 44 && save.height >= 44, '保留触控高度')
      await page.screenshot({ path: `${output}/${theme}-${width}-dialog.png` })
      await page.keyboard.press('Escape')
      await page.getByRole('checkbox', { name: `选择小说：${title}`, exact: true }).click()
      const batchButton = page.getByRole('button', { name: '批量追更设置', exact: true })
      const batchButtonBox = await batchButton.boundingBox()
      assert.ok(batchButtonBox.x >= 0 && batchButtonBox.x + batchButtonBox.width <= width + 1, '批量入口不能超出视口')
      await page.screenshot({ path: `${output}/${theme}-${width}-batch-selection.png` })
      await batchButton.click()
      const batchDialog = page.getByRole('dialog')
      await batchDialog.getByRole('heading', { name: '批量追更设置', exact: true }).waitFor()
      const batchBox = await batchDialog.boundingBox()
      assert.ok(batchBox.x >= 0 && batchBox.x + batchBox.width <= width + 1, '批量弹窗不能超出视口')
      const cancel = await batchDialog.getByRole('button', { name: '取消', exact: true }).boundingBox()
      const apply = await batchDialog.getByRole('button', { name: '应用设置', exact: true }).boundingBox()
      assert.ok(Math.abs(cancel.y - apply.y) < 1 && cancel.height >= 44 && apply.height >= 44, '批量弹窗底部保持同一行和触控高度')
      await page.screenshot({ path: `${output}/${theme}-${width}-batch-dialog.png` })
      await batchDialog.getByRole('button', { name: '应用设置', exact: true }).click()
      await batchDialog.getByRole('status').getByText('已设置 1 本，跳过 0 本。', { exact: true }).waitFor()
      await context.close()
    }
  }
  console.log(`手机、桌面与明暗主题排版检查通过。截图：${output}`)
} finally {
  await browser.close()
}
