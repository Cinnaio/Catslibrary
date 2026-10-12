import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
const base = process.env.WEB_URL || 'http://127.0.0.1:5198'
const output = process.env.SCREENSHOT_DIR || '/tmp/dashboard-preview'
await mkdir(output, { recursive: true })
const now = Date.now()
const item = (i, result) => ({
  novelId: `fixture-${i}`,
  title: i === 0 ? '一本很长很长的作品标题，用来确认窄屏下书名与追更状态都能完整阅读' : `追更作品 ${i + 1}`,
  enabled: true,
  intervalHours: 6,
  nextCheckAt: now + (i - 1) * 3600000,
  checkedAt: now - i * 60000,
  result,
  message:
    result === 'protected' ? '仍有 4 章受保护，请确认账号或购买权限' : result === 'failed' ? '无法连接源站：HTTP 403，请检查来源与访问权限' : '目录检查完成',
  addedCount: 3,
})
const stats = {
  snapshotAt: now,
  followups: {
    enabled: 312,
    waiting: 8,
    running: 2,
    attention: 4,
    issues: ['protected', 'failed', 'partial', 'pending'].map((r, i) => item(i, r)),
    scheduled: Array.from({ length: 6 }, (_, i) => item(i, i === 0 ? 'running' : 'idle')),
    recent: Array.from({ length: 6 }, (_, i) => item(i, i % 2 ? 'no_change' : 'updated')),
  },
  totals: { novels: 416, chapters: 38828, users: 3, covers: 416, failedJobs: 41, todayChapters: 1231, dbSize: 435000000 },
  jobStatus: { running: 2, completed: 406, failed: 41 },
  contentRating: { general: 1, unknown: 40, restricted: 375 },
  recentJobs: Array.from({ length: 6 }, (_, i) => ({
    id: `j${i}`,
    novelId: `fixture-${i}`,
    novelTitle: `最近抓取作品 ${i + 1}`,
    status: i < 2 ? 'failed' : 'completed',
    error: i < 2 ? '源站返回 HTTP 403，请检查访问权限' : '',
    step: '抓取完成',
    updatedAt: now - i * 60000,
  })),
  recentNovels: Array.from({ length: 6 }, (_, i) => ({
    id: `fixture-${i}`,
    title: `最近更新作品 ${i + 1}`,
    author: '作者',
    chapterCount: 90 + i,
    updatedAt: now - i * 60000,
  })),
}
const browser = await chromium.launch({ headless: true })
let checks = 0
try {
  for (const theme of ['light', 'dark'])
    for (const width of [320, 390, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' })
      await context.addInitScript((theme) => {
        localStorage.setItem('user_session_token', 'isolated-dashboard-fixture')
        localStorage.setItem('theme', theme)
      }, theme)
      let fail = false
      let mutations = 0
      let eventState = {
        enabled: true,
        intervalHours: 6,
        nextCheckAt: now + 3600000,
        checkedAt: now,
        result: 'failed',
        message: '无法连接源站：HTTP 403\n完整原因与来源：https://example.com/book/very-long-source-path',
        addedCount: 0,
        failures: 2,
        jobId: 'j0',
        sourceUrl: 'https://example.com/book/very-long-source-path',
        hasConfig: true,
        ongoing: true,
        pendingChapterCount: 4,
        pendingProtectedChapterCount: 2,
        pendingPublicChapterCount: 2,
        pendingUnknownChapterCount: 0,
      }
      await context.route('**/api/**', async (route) => {
        const path = new URL(route.request().url()).pathname
        let data = {}
        if (path === '/api/auth/me') data = { user: { id: 'fixture', username: 'admin', role: 'admin', status: 'active' } }
        else if (path === '/api/auth/reader-settings') data = { settings: { contentMode: 'adult' } }
        else if (path === '/api/scrape') {
          const query = new URL(route.request().url()).searchParams
          if (route.request().method() === 'POST') {
            mutations++
            const body = route.request().postDataJSON()
            if (body.action === 'update') {
              eventState = { ...eventState, result: 'running', message: '更新任务已启动' }
              data = { jobId: 'j0', message: '更新任务已启动' }
            } else if (body.action === 'followup-save') {
              eventState = { ...eventState, enabled: body.enabled, intervalHours: body.intervalHours }
              data = eventState
            }
          } else if (query.get('action') === 'followup') data = eventState
          else if (query.get('action') === 'job-status')
            data = {
              id: 'j0',
              status: 'failed',
              step: '检查目录',
              current: 1,
              total: 4,
              chapterCount: 0,
              error: '完整任务错误：HTTP 403',
              startedAt: now - 60000,
              updatedAt: now,
              recentLogs: [{ id: 'log', message: '请求目录失败', detail: 'HTTP 403', createdAt: now }],
              failedItems: [{ id: 'item', chapterTitle: '第一章', error: '访问权限不足' }],
            }
        } else if (path === '/api/admin/stats') {
          assert.equal(route.request().method(), 'GET')
          checks++
          if (fail) {
            await route.fulfill({ status: 503, json: { error: '隔离模拟刷新失败' } })
            return
          }
          data = stats
        }
        await route.fulfill({ json: data })
      })
      const page = await context.newPage()
      await page.goto(`${base}/admin/dashboard`)
      await page.getByRole('tab', { name: '需要处理', exact: true }).waitFor()
      await page.getByText('章节受保护', { exact: true }).waitFor()
      const geometry = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
        pageTitle: getComputedStyle(document.querySelector('.admin-tab-header h2')).fontSize,
        panelTitle: getComputedStyle(document.querySelector('.dashboard-followups h3')).fontSize,
        rowTitle: getComputedStyle(document.querySelector('.dashboard-row__title')).fontSize,
      }))
      assert.equal(geometry.overflow, false, `不能横向溢出：${theme}/${width}`)
      assert.equal(geometry.pageTitle, '20px')
      assert.equal(geometry.panelTitle, '16px')
      assert.equal(geometry.rowTitle, '14px')
      checks += 4
      assert.equal(await page.getByRole('button', { name: /查看追更事件：一本/ }).count(), 1)
      checks++
      await page.screenshot({ path: `${output}/${theme}-${width}-overview.png`, fullPage: true })
      await page.getByRole('tab', { name: '检查安排', exact: true }).click()
      await page.getByText('检查中', { exact: true }).last().waitFor()
      await page.getByText('等待调度', { exact: true }).last().waitFor()
      checks++
      await page.screenshot({ path: `${output}/${theme}-${width}-scheduled.png`, fullPage: true })
      await page.getByRole('tab', { name: '最近结果', exact: true }).click()
      await page.getByText('有新章', { exact: true }).first().waitFor()
      checks++
      await page.getByRole('tab', { name: '最近结果', exact: true }).focus()
      await page.keyboard.press('ArrowLeft')
      await page.getByRole('tab', { name: '检查安排', exact: true, selected: true }).waitFor()
      assert.equal(await page.getByRole('tab', { name: '检查安排', exact: true }).getAttribute('data-state'), 'active')
      checks++
      await page.getByRole('button', { name: /查看追更事件：一本/ }).click()
      const eventDialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: '追更事件详情', exact: true }) })
      await eventDialog.getByText('受保护 2 章', { exact: true }).waitFor()
      assert.equal(mutations, 0, '打开详情不得自动启动任务或保存设置')
      checks++
      assert.equal(await eventDialog.getByRole('link', { name: '管理这本小说 →' }).getAttribute('href'), '/admin/novels?novelId=fixture-0')
      checks++
      const box = await eventDialog.boundingBox()
      assert.ok(box.x >= 0 && box.x + box.width <= width + 1 && box.y >= 0 && box.y + box.height <= 1001, '详情弹窗适配视口')
      checks++
      await page.screenshot({ path: `${output}/${theme}-${width}-event.png` })
      await eventDialog.getByRole('button', { name: '查看任务详情' }).click()
      const taskDialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: '抓取任务详情', exact: true }) })
      await taskDialog.getByText('完整任务错误：HTTP 403', { exact: true }).waitFor()
      await taskDialog.getByText('请求目录失败', { exact: true }).waitFor()
      checks++
      await page.screenshot({ path: `${output}/${theme}-${width}-task.png` })
      await taskDialog.getByRole('button', { name: '关闭', exact: true }).click()
      await eventDialog.getByRole('button', { name: '调整追更设置' }).waitFor()
      await page.waitForFunction(() => document.activeElement?.textContent === '查看任务详情')
      checks++
      await eventDialog.getByRole('button', { name: '调整追更设置' }).click()
      await eventDialog.getByRole('checkbox', { name: '自动追更' }).waitFor()
      await eventDialog.getByRole('checkbox', { name: '自动追更' }).click()
      await eventDialog.getByRole('button', { name: '取消调整' }).click()
      assert.equal(mutations, 0, '取消草稿不修改追更设置')
      checks++
      await eventDialog.getByRole('button', { name: '检查更新', exact: true }).click()
      await eventDialog.getByRole('button', { name: '更新中…', exact: true }).waitFor()
      assert.equal(mutations, 1, '手动检查只提交一次任务')
      checks++
      await page.keyboard.press('Escape')
      await eventDialog.waitFor({ state: 'detached' })
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label')?.startsWith('查看追更事件：'))
      assert.ok(page.url().endsWith('/admin/dashboard'), '关闭详情仍留在总览')
      checks++
      fail = true
      await page.getByRole('button', { name: '刷新总览', exact: true }).click()
      await page
        .getByRole('alert')
        .getByText(/当前显示上次成功读取的数据/)
        .waitFor()
      assert.equal(await page.getByRole('heading', { name: '自动追更', exact: true }).count(), 1)
      checks++
      fail = false
      await page.getByRole('button', { name: '刷新总览', exact: true }).click()
      await page.getByRole('alert').waitFor({ state: 'detached' })
      checks++
      await context.close()
    }
  console.log(`后台总览隔离浏览器检查通过：${checks} 项；截图：${output}`)
} finally {
  await browser.close()
}
