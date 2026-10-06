import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'

// 可传入含 content 的 JSON 验证实际正文；API 全部用夹具，不改原文或保存实际想法。
const content = process.argv[2]
  ? JSON.parse(readFileSync(process.argv[2], 'utf8')).content
  : Array.from({ length: 60 }, (_, i) => `这是第${i}处独有的景色，山间的风吹过树林。`).join('')
const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  const page = await browser.newPage()
  let posted
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname
    let data = {}
    if (path === '/api/chapters/paragraph-fixture')
      data = { chapter: { id: 'paragraph-fixture', novelId: 'paragraph-novel', title: '分段检查', content, order: 1 } }
    else if (path === '/api/novels/paragraph-novel') data = { novel: { id: 'paragraph-novel', title: '分段检查', contentRating: 'general' } }
    else if (path === '/api/chapters') data = { chapters: [] }
    else if (path === '/api/thoughts' && route.request().method() === 'POST') {
      posted = route.request().postDataJSON()
      data = { thought: { ...posted, id: 'paragraph-thought', createdAt: Date.now() } }
    } else if (path === '/api/thoughts') data = { thoughts: [] }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) })
  })
  await page.goto('http://localhost:5173/read/paragraph-novel/paragraph-fixture')
  await page.locator('.reader-body').waitFor()
  await page.locator('.reader-body p').nth(1).waitFor()
  const info = await page.evaluate(() => {
    const p = [...document.querySelectorAll('.reader-body p')]
    return { text: p.map((node) => node.textContent).join(''), lengths: p.map((node) => node.textContent.length), hash: p[1].dataset.sourceParagraphHash }
  })
  assert.equal(
    info.text,
    content
      .split(/\r\n?|\n/)
      .filter((line) => line.trim())
      .map((line) => line.trim())
      .join(''),
    '分段只处理段落边界，不得删改文字',
  )
  const selected = await page.evaluate(() => {
    const p = document.querySelectorAll('.reader-body p')[1]
    const range = document.createRange()
    range.setStart(p.firstChild, 0)
    range.setEnd(p.firstChild, 6)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
    p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    return selection.toString()
  })
  await page.getByRole('button', { name: '写想法', exact: true }).click()
  assert.equal(await page.locator('.thought-selected-text').textContent(), `划选：${selected}`)
  await page.getByRole('textbox', { name: '想法内容' }).fill('分段锚点检查')
  await page.getByRole('button', { name: '发布想法' }).click()
  await page.getByText('已发布', { exact: true }).waitFor()
  assert.equal(posted.paragraphIndex, 0, '保存想法仍使用原始段落下标')
  assert.equal(posted.paragraphHash, info.hash, '保存想法仍使用原始段落哈希')
  console.log(
    JSON.stringify({
      result: 'PASS',
      originalLength: content.length,
      displayedParagraphs: info.lengths.length,
      paragraphLengths: info.lengths,
      thoughtAnchor: 'source paragraph retained',
    }),
  )
} finally {
  await browser.close()
}
