import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const base = process.env.WEB_URL || 'http://127.0.0.1:5174'
const out = '.impeccable/review/supplementary-sources'
await mkdir(out, { recursive: true })
const file = {
  key: 'file',
  url: 'https://dudu88.lanzov.com/iX93G4c5rk0j',
  name: '[更255] 圈宠（上-虐） 作者：尘星末位.txt',
  folder: '1016',
  size: '1.5 M',
  title: '圈宠(上-虐)',
  author: '尘星末位',
  revision: 255,
}
const novel = { id: 'fixture-novel', title: '圈宠（女上-虐男）', author: '尘星末位', chapterCount: 254, status: 'ongoing', categories: [] }
const source = {
  id: 'source',
  name: '微博书单 · 10月',
  url: 'https://dudu88.lanzov.com/b002w85o2f',
  hasPassword: false,
  enabled: false,
  intervalHours: 6,
  checkedAt: 1792197000000,
  nextCheckAt: 0,
  status: 'partial',
  error: '1015 等部分日期目录翻页受限，尚不能确认这些目录有无更新',
  fileCount: 38,
}
const binding = {
  id: 'binding',
  sourceId: 'source',
  novelId: novel.id,
  novelTitle: novel.title,
  aliasTitle: file.title,
  aliasAuthor: file.author,
  candidates: [file],
}
const chapters = Array.from({ length: 255 }, (_, i) => ({
  id: `chapter-${i + 1}`,
  status: i === 254 ? 'new' : 'unchanged',
  incomingOrder: i + 1,
  incomingTitle: `第${i + 1}章 验证章节`,
  incomingContent: '隔离界面验证样本。',
  localTitle: i < 254 ? `第${i + 1}章 验证章节` : undefined,
  localContent: i < 254 ? '隔离界面验证样本。' : undefined,
  confidence: 'high',
  reason: i === 254 ? '本地没有对应章节' : '序号、标题和正文一致',
  selected: i === 254,
}))
const preview = {
  runId: 'fixture-run',
  revision: 0,
  sourceType: 'file',
  sourceLabel: file.name,
  sourceUrl: file.url,
  book: { title: novel.title, author: novel.author, chapters },
  candidates: [],
  targetNovelId: novel.id,
  targetNovel: novel,
  chapters,
  summary: { newCount: 1, unchangedCount: 254, changedCount: 0, conflictCount: 0 },
  metadataDiff: [],
  warnings: ['附加源只更新你确认的章节，不修改作品信息。'],
  supplementary: { bindingId: 'binding', fileKey: 'file' },
}
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const evidence = []
try {
  for (const [width, height, theme] of [
    [1440, 1000, 'light'],
    [390, 844, 'light'],
    [1440, 1000, 'dark'],
  ]) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' })
    await context.addInitScript((theme) => {
      localStorage.setItem('user_session_token', 'isolated-supplementary-fixture')
      localStorage.setItem('theme', theme)
    }, theme)
    let empty = true,
      downloadFails = true,
      committed
    await context.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname
      let data = {}
      if (path === '/api/auth/me') data = { user: { id: 'fixture', username: 'admin', role: 'admin', status: 'active' } }
      else if (path === '/api/novels' || path.includes('novel-index')) data = { novels: [novel], total: 1 }
      else if (path === '/api/supplementary-sources' && route.request().method() === 'POST') {
        empty = false
        data = { id: 'source' }
      } else if (path === '/api/supplementary-sources') data = { sources: empty ? [] : [source], bindings: empty ? [] : [binding] }
      else if (path.endsWith('/check')) data = { sources: [source], bindings: [binding] }
      else if (path.endsWith('/files')) data = { items: [file], total: 1 }
      else if (path === '/api/book-import/preview') {
        if (downloadFails && !route.request().headers()['content-type']?.includes('multipart'))
          return route.fulfill({ status: 502, json: { error: '蓝奏返回了浏览器验证页，请在原文件页面下载后上传' } })
        data = preview
      } else if (path.endsWith('/commit')) {
        committed = route.request().postDataJSON()
        data = {
          runId: preview.runId,
          batchId: 'fixture',
          novelId: novel.id,
          novelCreated: false,
          created: 1,
          updated: 0,
          skipped: 254,
          metadataUpdated: [],
          conflicts: [],
        }
      }
      return route.fulfill({ json: data })
    })
    const page = await context.newPage(),
      errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(`${base}/admin/novels`)
    await page.getByRole('button', { name: '附加更新源', exact: true }).click()
    const dialog = page.locator('.supplementary-dialog')
    await page.getByLabel('来源名称').fill('微博书单 · 10月')
    await page.getByLabel('蓝奏文件夹链接').fill(source.url)
    await page.screenshot({ path: `${out}/${width}-${theme}-add.png` })
    assert.equal(await page.getByRole('checkbox').isChecked(), false)
    await page.getByRole('button', { name: '保存来源', exact: true }).click()
    await page.getByRole('button', { name: '下载并预览', exact: true }).waitFor()
    await page.screenshot({ path: `${out}/${width}-${theme}-bindings.png` })
    const box = await dialog.boundingBox()
    assert.ok(box.x >= 0 && box.x + box.width <= width + 1)
    if(width>=1000)assert.ok(box.width>=900,'desktop dialog should use the requested wide layout')
    assert.ok(box.y >= 0 && box.y + box.height <= height + 1)
    const noOverflow = await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)
    assert.ok(noOverflow, 'dialog horizontal overflow')
    await page.getByRole('tab', { name: '目录文件与绑定', exact: true }).click()
    await page.getByRole('button', { name: '绑定已有书籍', exact: true }).click()
    await page.getByLabel('搜索站内作品').fill('圈宠')
    await page.getByLabel('选择对应作品').selectOption(novel.id)
    await page.screenshot({ path: `${out}/${width}-${theme}-confirm-binding.png` })
    await page.getByRole('button', { name: '取消', exact: true }).click()
    await page.getByRole('tab', { name: '已绑定书籍（1）', exact: true }).click()
    await page.getByRole('button', { name: '下载并预览', exact: true }).click()
    await page.getByText('蓝奏返回了浏览器验证页，请在原文件页面下载后上传', { exact: true }).waitFor()
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: '上传对应文件', exact: true }).click()
    await (await chooser).setFiles({ name: file.name, mimeType: 'text/plain', buffer: Buffer.from('第一章 验证\n验证正文。') })
    await page.locator('.book-import-dialog').waitFor()
    assert.equal(await page.getByRole('tab', { name: /作品信息/ }).isDisabled(), true)
    await page.screenshot({ path: `${out}/${width}-${theme}-preview.png` })
    await page.getByRole('button', { name: /确认导入/ }).click()
    await page.getByText('已增量更新作品', { exact: true }).waitFor()
    assert.deepEqual(committed.metadataFields, [])
    assert.deepEqual(committed.selectedChapterIds, ['chapter-255'])
    assert.equal(committed.targetNovelId, novel.id)
    assert.deepEqual(errors, [])
    evidence.push({
      width,
      height,
      theme,
      box,
      noOverflow,
      committed: { targetNovelId: committed.targetNovelId, selectedChapterIds: committed.selectedChapterIds, metadataFields: committed.metadataFields },
    })
    await context.close()
  }
} finally {
  await browser.close()
}
await writeFile(`${out}/evidence.json`, JSON.stringify(evidence, null, 2))
console.log(JSON.stringify({ passed: evidence.length, output: out }))
