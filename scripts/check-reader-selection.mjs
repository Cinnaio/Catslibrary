import assert from 'node:assert/strict'
import { chromium } from 'playwright'

// npm run dev:web，然后 node scripts/check-reader-selection.mjs。
// API 失败时使用项目自带的演示章节，不读写实际账号或想法。
const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    const page = await browser.newPage({ viewport })
    await page.route('**/api/**', (route) => {
      if (new URL(route.request().url()).pathname === '/api/thoughts' && route.request().method() === 'POST') {
        return route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ thought: { ...route.request().postDataJSON(), id: 'selection-thought', createdAt: Date.now() } }),
        })
      }
      return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' })
    })
    await page.goto('http://localhost:5173/read/demo_1/dc1_1')
    await page.locator('.reader-body p').first().waitFor()
    await page.waitForTimeout(600)
    const points = await page.evaluate(() => {
      const text = document.querySelector('.reader-body p').firstChild
      function point(offset) {
        const range = document.createRange()
        range.setStart(text, offset)
        range.setEnd(text, offset + 1)
        const rect = range.getBoundingClientRect()
        return { x: rect.left, y: rect.top + rect.height / 2 }
      }
      return { start: point(2), end: point(8), expected: text.textContent.slice(2, 8) }
    })
    await page.mouse.move(points.start.x, points.start.y)
    await page.mouse.down()
    await page.mouse.move(points.end.x, points.end.y, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(350)
    assert.equal(await page.evaluate(() => window.getSelection()?.toString()), points.expected, '鼠标拖选部分文字，不应扩大为整段')
    await page.getByRole('button', { name: '写想法', exact: true }).click()
    assert.equal(await page.locator('.thought-selected-text').textContent(), `划选：${points.expected}`, '鼠标划选的引用只能包含选中文字')
    assert.equal(await page.locator('.thought-panel__excerpt').count(), 0, '划词面板不应额外显示整段摘要，造成整段被引用的错觉')
    await page.getByRole('textbox', { name: '想法内容' }).fill('局部引用回归检查')
    await page.getByRole('button', { name: '发布想法' }).click()
    await page.getByText('已发布', { exact: true }).waitFor()
    await page.getByRole('button', { name: '关闭想法面板' }).click()
    const markings = await page.evaluate(() => ({
      paragraphDecoration: getComputedStyle(document.querySelector('.reader-body p')).textDecorationLine,
      quoteDecoration: getComputedStyle(document.querySelector('.reader-body p'), '::highlight(reader-thought-quotes)').textDecorationLine,
      quotedRanges: [...(CSS.highlights.get('reader-thought-quotes') || [])].map((range) => range.toString()),
    }))
    assert.equal(markings.paragraphDecoration, 'none', '局部引用想法不应给整段文字加下划线')
    assert.deepEqual(markings.quotedRanges, [points.expected], '发布后仅标记原引用范围')
    assert.equal(markings.quoteDecoration, 'underline', '引用范围仍应显示下划线')
    const hoverPoint = await page.evaluate(() => {
      const range = [...CSS.highlights.get('reader-thought-quotes')][0]
      const rect = range.getClientRects()[0]
      return { x: rect.left + 3, y: rect.top + rect.height / 2, outsideX: rect.right + 15 }
    })
    await page.locator('.thought-overlay').waitFor({ state: 'hidden' })
    await page.mouse.move(hoverPoint.x, hoverPoint.y)
    const hover = await page.evaluate(() => ({
      ranges: [...(CSS.highlights.get('reader-thought-hover') || [])].map((range) => range.toString()),
      background: getComputedStyle(document.querySelector('.reader-body p'), '::highlight(reader-thought-hover)').backgroundColor,
    }))
    assert.deepEqual(hover.ranges, [points.expected], '鼠标移入已保存引用时，应仅高亮该引用')
    assert.notEqual(hover.background, 'rgba(0, 0, 0, 0)', '已保存引用悬停时应显示底色')
    await page.mouse.move(hoverPoint.outsideX, hoverPoint.y)
    assert.equal(await page.evaluate(() => CSS.highlights.get('reader-thought-hover')?.size || 0), 0, '移动到同段未引用文字时应移除引用底色')
    let selected
    for (const length of [8, 12, 5]) {
      selected = await page.evaluate((length) => {
        const paragraph = document.querySelector('.reader-body p')
        const text = paragraph.firstChild
        const range = document.createRange()
        range.setStart(text, 0)
        range.setEnd(text, Math.min(length, text.textContent.length))
        const selection = window.getSelection()
        selection.removeAllRanges()
        selection.addRange(range)
        const value = selection.toString()
        paragraph.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
        return value
      }, length)
      await page.getByRole('button', { name: '写想法', exact: true }).waitFor()
      await page.waitForTimeout(350)
      const after = await page.evaluate(() => window.getSelection()?.toString())
      assert.equal(after, selected, '显示写想法气泡后，首次文字选区应保持，底色不应消失')
    }
    await page.getByRole('button', { name: '写想法', exact: true }).click()
    assert.equal(await page.locator('.thought-selected-text').textContent(), `划选：${selected}`, '想法面板应保留最后一次划选的引用')
    console.log(`PASS: ${viewport.width}px 首次及连续划词保留选区，想法面板引用正确`)
    await page.close()
  }
} finally {
  await browser.close()
}
