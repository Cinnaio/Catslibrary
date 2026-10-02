import assert from 'node:assert/strict'
import { chromium } from 'playwright'

// Run against the web dev server: node scripts/check-novel-description.mjs
// API fixtures exercise the real page without changing stored novels.
const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  let description = Array.from({ length: 8 }, (_, i) => `第${i + 1}行简介，山间的故事仍在继续。`).join('\n')
  let releaseChapters
  let chapterRequested
  const requested = new Promise(resolve => { chapterRequested = resolve })
  const chapterGate = new Promise(resolve => { releaseChapters = resolve })
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    let data = {}
    if (path === '/api/novels/synopsis-fixture') {
      data = { novel: { id: 'synopsis-fixture', title: '简介展开回归检查', author: '测试作者', description,
        categories: [], contentRating: 'general', status: 'completed', chapterCount: 1 } }
    } else if (path === '/api/chapters') {
      chapterRequested()
      await chapterGate
      data = { chapters: [] }
    } else if (path.includes('comments')) data = { comments: [], total: 0 }
    else if (path.includes('ratings')) data = { average: 0, count: 0, distribution: {}, myRating: null }
    else if (path.includes('bookshelf')) data = { favorites: [], recent: [] }
    else if (path.includes('progress')) data = { progress: [], tombstones: [] }
    await route.fulfill({ json: data })
  })
  await page.goto(process.env.WEB_URL || 'http://127.0.0.1:5197/novel/synopsis-fixture')
  await requested
  // Let React commit the novel while the chapter request keeps the loading screen mounted.
  await page.waitForTimeout(150)
  assert.equal(await page.locator('.novel-hero__desc').count(), 0)
  releaseChapters()
  const desc = page.locator('.novel-hero__desc')
  await desc.waitFor()
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(100)
  const heights = await desc.evaluate(el => ({ full: el.scrollHeight, visible: el.clientHeight }))
  assert.ok(heights.full > heights.visible + 2, JSON.stringify(heights))
  assert.equal(await page.getByRole('button', { name: '展开全部', exact: true }).count(), 1,
    `简介已截断但没有展开按钮：${JSON.stringify(heights)}`)
  await page.getByRole('button', { name: '展开全部', exact: true }).click()
  await page.getByRole('button', { name: '收起', exact: true }).waitFor()
  assert.ok(await desc.evaluate(el => el.scrollHeight <= el.clientHeight + 2))
  await page.getByRole('button', { name: '收起', exact: true }).click()
  await page.getByRole('button', { name: '展开全部', exact: true }).waitFor()
  for (const width of [390, 320, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.getByRole('button', { name: '展开全部', exact: true }).waitFor()
  }
  description = '只有一行的短简介。'
  await page.reload()
  await desc.waitFor()
  await page.waitForTimeout(100)
  assert.equal(await page.locator('.novel-hero__desc-toggle').count(), 0, '短简介不应显示展开按钮')
  description = '山间的故事仍在继续，旅人沿着溪流走向远方。'.repeat(4)
  await page.reload()
  await desc.waitFor()
  await page.waitForFunction(() => {
    const el = document.querySelector('.novel-hero__desc')
    return el && el.scrollHeight <= el.clientHeight + 2 && !document.querySelector('.novel-hero__desc-toggle')
  })
  await page.setViewportSize({ width: 320, height: 1000 })
  await page.getByRole('button', { name: '展开全部', exact: true }).waitFor()
  assert.ok(await desc.evaluate(el => el.scrollHeight > el.clientHeight + 2))
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.waitForFunction(() => !document.querySelector('.novel-hero__desc-toggle'))
  console.log('PASS: 延迟章节加载后的长简介、展开/收起、短简介、窄屏换行后按钮出现及宽屏恢复后消失')
} finally {
  await browser.close()
}
