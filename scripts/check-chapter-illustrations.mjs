import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import sharp from 'sharp'
import { mkdir } from 'node:fs/promises'

// Run Vite first. All API calls are intercepted; no real account or chapter is modified.
const base = process.env.READER_CHECK_BASE || 'http://127.0.0.1:5178'
const paragraphs = [
  '庭院落满了雨，远处的山影在暮色里渐渐隐去。',
  '他推开了门，眼前是一片被夕阳照亮的庭院。',
  '风从屋檐下穿过，吹动了悬挂的铃铛。',
  ...Array.from({ length: 12 }, (_, i) => `第${i + 4}段：少年沿着石阶缓缓前行，听见雨水从屋檐滴落，旧时的故事浮上心头。`),
]
const content = paragraphs.join('\n')
function hash(text) {
  let h = 2166136261
  text = text.replace(/\s+/g, ' ').trim()
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}
const novel = { id: 'illustration-book', title: '山雨来时', author: '测试', chapterCount: 1, contentRating: 'general', categories: [] }
const chapter = { id: 'illustration-chapter', novelId: novel.id, title: '庭院', order: 1, wordCount: content.length, content }
const image = await sharp({ create: { width: 800, height: 480, channels: 3, background: '#927c63' } })
  .composite([
    {
      input: Buffer.from(
        '<svg width="800" height="480"><rect x="100" y="90" width="600" height="300" rx="25" fill="#d4bd94"/><circle cx="650" cy="90" r="55" fill="#ecd9b1"/><path d="M0 420 L240 180 L480 420 L650 240 L800 420" fill="#596f60"/></svg>',
      ),
    },
  ])
  .webp()
  .toBuffer()
await mkdir('.tmp/illustration-checks', { recursive: true })
const browser = await chromium.launch({ headless: true })
try {
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({ viewport })
    await context.addInitScript(() => localStorage.setItem('user_session_token', 'mock-admin-session'))
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    let items = []
    let writes = 0
    await page.route('**/api/**', async (route) => {
      const req = route.request(),
        path = new URL(req.url()).pathname
      const json = (data) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) })
      if (path.endsWith('/image')) return route.fulfill({ contentType: 'image/webp', body: image })
      if (/\/illustrations(?:\/[^/]+)?$/.test(path)) {
        if (req.method() === 'GET')
          return json({ illustrations: items.filter((item) => !item.deleted), chapterRevision: 'revision', contentHash: hash(content) })
        writes++
        const metadata = JSON.parse(
          req
            .postDataBuffer()
            .toString()
            .match(/name="metadata"\r\n\r\n([^\r]+)/)[1],
        )
        const id = path.endsWith('/illustrations') ? `illustration-${writes}` : path.split('/').at(-1)
        const previous = items.find((item) => item.id === id)
        const illustration = {
          ...previous,
          ...metadata,
          id,
          chapterId: chapter.id,
          assetId: 'mock-asset',
          width: 800,
          height: 480,
          order: previous?.order || writes,
          version: (previous?.version || 0) + 1,
          deleted: metadata.deleted === true,
        }
        items = [...items.filter((item) => item.id !== id), illustration]
        return json({ illustration })
      }
      if (path === '/api/auth/me') return json({ user: { id: 'mock-admin', username: 'admin', displayName: '管理员', role: 'admin', status: 'active' } })
      if (path === '/api/content-policy') return json({ adultContentEnabled: false, turnstileConfigured: false })
      if (path === '/api/auth/reader-settings') return json({ settings: {}, updatedAt: {} })
      if (path === `/api/chapters/${chapter.id}`) return json({ chapter })
      if (path === '/api/chapters') return json({ chapters: [chapter] })
      if (path === `/api/novels/${novel.id}`) return json({ novel })
      if (path === '/api/bookmarks') return json({ bookmarks: [] })
      if (path.startsWith('/api/thoughts')) return json({ thoughts: [], allowed: false })
      if (path === '/api/progress') return json({ progress: null })
      return json({})
    })
    await page.goto(`${base}/read/${novel.id}/${chapter.id}`)
    await page.locator('.reader-body p').first().waitFor()
    const manage =
      viewport.width > 640
        ? page.locator('.reader-controls').getByRole('button', { name: '管理章节插图' })
        : page.locator('#mobile-reader-toolbar').getByRole('button', { name: '管理章节插图' })
    if (viewport.width <= 640) {
      const toggle = page.getByRole('button', { name: '显示阅读工具栏' })
      if (await toggle.isVisible()) await toggle.click()
    }
    await manage.click()
    await page.getByRole('button', { name: '在第 2 段后插图' }).click()
    await page.getByLabel('选择图片（也可以在此粘贴）').setInputFiles({ name: 'courtyard.webp', mimeType: 'image/webp', buffer: image })
    await page.getByLabel('图注（可选）').fill('暮色中的庭院')
    assert.equal(writes, 0, '预览期间不应发布')
    await page.screenshot({ path: `.tmp/illustration-checks/editor-${viewport.width}.png` })
    await page.getByRole('button', { name: '保存插图', exact: true }).click()
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
    await page.locator('.reader-body').getByRole('button', { name: '放大查看章节插图' }).waitFor()
    assert.equal(await page.locator('.reader-body p').count(), paragraphs.length, '插图不能改变段评段落数量')
    assert.equal(
      await page
        .locator('.reader-body p')
        .nth(1)
        .evaluate((p) => p.nextElementSibling.querySelectorAll('figure').length),
      1,
    )
    await page.locator('.reader-body').getByRole('button', { name: '放大查看章节插图' }).click()
    await page.getByRole('dialog', { name: '章节插图大图' }).waitFor()
    await page.getByRole('button', { name: '关闭图片预览' }).click()
    await page.getByRole('button', { name: '移动', exact: true }).click()
    await page.getByRole('button', { name: '在第 3 段后插图' }).click()
    await page.waitForFunction(() => !!document.querySelectorAll('.reader-body p')[2]?.nextElementSibling?.querySelector('figure'))
    await page.getByRole('button', { name: '删除', exact: true }).click()
    await page.locator('.reader-body figure').waitFor({ state: 'hidden' })
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    await page.locator('.reader-body figure').waitFor()
    await page.getByRole('button', { name: '完成', exact: true }).click()
    assert.equal(await page.locator('.illustration-insert').count(), 0)
    await page.locator('.reader-body figure').scrollIntoViewIfNeeded()
    await page.screenshot({ path: `.tmp/illustration-checks/reader-${viewport.width}.png` })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, '手机不应横向溢出')
    if (viewport.width <= 640) {
      const toggle = page.getByRole('button', { name: '显示阅读工具栏' })
      if (await toggle.isVisible()) await toggle.click()
    }
    const settings =
      viewport.width > 640
        ? page.locator('.reader-controls').getByRole('button', { name: '阅读设置' })
        : page.locator('#mobile-reader-toolbar').getByRole('button', { name: '阅读设置' })
    await settings.click()
    await page.getByRole('group', { name: '插图', exact: true }).getByRole('button', { name: '隐藏' }).click()
    await page.locator('.reader-body figure').waitFor({ state: 'hidden' })
    await page.getByRole('group', { name: '插图', exact: true }).getByRole('button', { name: '显示' }).click()
    await page.locator('.reader-body figure').waitFor()
    await page.getByRole('button', { name: '关闭阅读设置' }).click()
    await page.locator('.reader-body p').nth(1).scrollIntoViewIfNeeded()
    await page.evaluate(() => {
      const paragraph = document.querySelectorAll('.reader-body p')[1]
      const range = document.createRange()
      range.setStart(paragraph.firstChild, 2)
      range.setEnd(paragraph.firstChild, 8)
      const selection = window.getSelection()
      selection.removeAllRanges()
      selection.addRange(range)
      paragraph.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })
    await page.getByRole('button', { name: '在本段后插图' }).waitFor()
    assert.equal(
      await page.locator('.thought-selection-popover').evaluate((el) => el.getBoundingClientRect().right > innerWidth),
      false,
      '划词菜单不能溢出屏幕',
    )
    await page.getByRole('button', { name: '在本段后插图' }).click()
    assert.equal(await page.getByLabel('插入位置').inputValue(), '1')
    await page.getByRole('button', { name: '取消', exact: true }).click()
    await page.getByRole('button', { name: '完成', exact: true }).click()
    assert.deepEqual(errors, [], '不应有浏览器运行时异常')
    console.log(`PASS ${viewport.width}px: 上传预览、保存、查看大图、移动、删除、撤销、退出，段落索引完整`)
    await context.close()
  }
} finally {
  await browser.close()
}
