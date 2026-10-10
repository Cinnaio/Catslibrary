import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

// Production preview + API fixtures: never reads or changes deployment data.
const base = process.env.READING_DATA_CHECK_BASE || 'http://127.0.0.1:5189'
const origin = new URL(base).origin
const output = new URL('../.tmp/reading-data/', import.meta.url).pathname
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true })
try {
  for (const width of [1440, 390, 360])
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width, height: 900 } })
      await context.addInitScript(
        ({ theme }) => {
          localStorage.setItem('theme', theme)
          localStorage.setItem('user_session_marker', 'fixture-a')
          localStorage.setItem('novel_reading_history', JSON.stringify({ n: { novelId: 'n', chapterId: 'c', scrollPercent: 0.4, timestamp: 1 } }))
          localStorage.setItem('novel_bookmarks', JSON.stringify([{ novelId: 'n', chapterId: 'c', note: '旧备注', timestamp: 1 }]))
        },
        { theme },
      )
      const page = await context.newPage()
      let user = 'a',
        heldCheck,
        holdCheck = false
      const errors = [],
        unexpected = [],
        writes = []
      const report = (kind, id = user) => ({
        userId: id,
        previewToken: 'a'.repeat(64),
        expiresAt: Date.now() + 600000,
        hasMore: false,
        items: [
          {
            kind: 'progress',
            novelId: 'n',
            chapterId: 'c',
            novelTitle: '历史阅读作品',
            chapterTitle: '第一章',
            action: kind === 'repair' ? 'clear' : 'restore',
            detail: kind === 'repair' ? '清除失效或章节错配的进度，并同步清除标记' : '添加到当前账号',
          },
        ],
      })
      page.on('pageerror', (error) => errors.push(error.message))
      await page.route('**/*', (route) => {
        if (new URL(route.request().url()).origin !== origin) {
          unexpected.push(route.request().url())
          return route.abort()
        }
        return route.continue()
      })
      await page.route('**/api/**', async (route) => {
        const path = new URL(route.request().url()).pathname
        const json = (value) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) })
        if (path === '/api/auth/me')
          return json({ user: { id: user, role: 'reader', username: `reader-${user}`, displayName: `读者 ${user}`, status: 'active', createdAt: 1 } })
        if (path === '/api/site') return json({ announcement: '' })
        if (path === '/api/site/visits') return json({ ok: true })
        if (path === '/api/auth/sessions') return json({ sessions: [] })
        if (path === '/api/content-policy') return json({ adultContentEnabled: false, turnstileConfigured: false })
        if (path === '/api/site-settings') return json({ name: '知舟', logoUrl: '/images/logo.png' })
        if (path === '/api/reading-data/operations') return json({ operations: [] })
        if (path === '/api/reading-data/check') {
          if (holdCheck) {
            heldCheck = route
            return
          }
          return json(report('repair'))
        }
        if (path === '/api/reading-data/restore/preview') return json(report('restore'))
        if (path === '/api/reading-data/repair' || path === '/api/reading-data/restore') {
          const body = route.request().postDataJSON()
          writes.push({ path, body, user })
          assert.equal(body.confirmedUserId, user)
          return json({
            operationId: body.operationId,
            kind: path.endsWith('repair') ? 'repair' : 'restore',
            changed: 1,
            skipped: 0,
            clearedNovelIds: path.endsWith('repair') ? ['n'] : [],
            createdAt: Date.now(),
          })
        }
        unexpected.push(path)
        return json({})
      })
      await page.goto(`${base}/profile`)
      await page.getByRole('button', { name: '阅读数据', exact: true }).click()
      const panel = page.getByRole('region', { name: '阅读数据', exact: true })
      await panel.getByText('当前账号：', { exact: false }).first().waitFor()
      assert.equal(writes.length, 0)
      await page.getByRole('button', { name: '预览可恢复数据' }).click()
      const restore = page.getByRole('button', { name: '恢复到当前账号', exact: true })
      await restore.waitFor()
      assert(await restore.isDisabled())
      await page.screenshot({ path: `${output}/${width}-${theme}.png`, fullPage: true })
      await page.getByRole('checkbox').check()
      await restore.click()
      await page.getByRole('alertdialog').getByRole('button', { name: '取消', exact: true }).click()
      assert.equal(writes.length, 0)
      await restore.click()
      await page.getByRole('alertdialog').getByRole('button', { name: '恢复到当前账号', exact: true }).click()
      await panel.getByText('恢复完成：处理 1 项。', { exact: true }).waitFor()
      assert.equal(writes.length, 1)
      assert(await page.evaluate(() => localStorage.getItem('novel_bookmarks').includes('旧备注')))
      await page.getByRole('button', { name: '检查当前账号' }).click()
      await page.getByRole('button', { name: '确认修复 1 项', exact: true }).click()
      await page.getByRole('alertdialog').getByRole('button', { name: '确认修复', exact: true }).click()
      await panel.getByText('修复完成：处理 1 项。', { exact: true }).waitFor()
      assert.equal(writes.length, 2)
      // Old check finishes after another account has been confirmed.
      holdCheck = true
      await page.getByRole('button', { name: '检查当前账号' }).click()
      for (let attempt = 0; !heldCheck && attempt < 100; attempt++) await page.waitForTimeout(50)
      assert(heldCheck)
      user = 'b'
      await page.evaluate(() => {
        localStorage.setItem('user_session_marker', 'fixture-b')
        dispatchEvent(new StorageEvent('storage', { key: 'user_session_marker', newValue: 'fixture-b' }))
      })
      await page.locator('#profileMeta').getByText('@reader-b', { exact: true }).waitFor()
      await page.getByRole('button', { name: '检查当前账号' }).waitFor()
      await heldCheck.fulfill({ contentType: 'application/json', body: JSON.stringify(report('repair', 'a')) })
      await page.waitForLoadState('networkidle')
      assert.equal(await page.getByRole('button', { name: '确认修复 1 项', exact: true }).count(), 0)
      assert.equal(writes.length, 2)
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'profile overflow')
      assert.deepEqual(errors, [])
      assert.deepEqual(unexpected, [])
      console.log(`${width}px ${theme}: preview, confirmation, source preservation, repair and account isolation passed`)
      await context.close()
    }
} finally {
  await browser.close()
}
