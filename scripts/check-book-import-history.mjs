import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const base = process.env.WEB_URL || 'http://127.0.0.1:5182'
const out = '.impeccable/review/book-import-history'
await mkdir(out, { recursive: true })
const title = '和哥哥在乱交世界里假装do爱：用于检查完整书名的较长标题'
const source = '[更99]《和哥哥在乱交世界里假装do爱》作者：归零_用于验证长来源文件名的完整展示.txt'
const item = { runId: 'applied', novelTitle: title, sourceLabel: source, status: 'applied', createdAt: Date.now(), created: 26, updated: 2, canRollback: true }
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const evidence = []
try {
  for (const [width, height, theme] of [
    [1440, 1000, 'light'],
    [960, 826, 'light'],
    [390, 844, 'light'],
    [1440, 1000, 'dark'],
  ]) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' })
    await context.addInitScript((theme) => {
      localStorage.setItem('user_session_token', 'isolated-history-fixture')
      localStorage.setItem('theme', theme)
    }, theme)
    let rolledBack = false,
      empty = false,
      rollbackCalls = 0
    const page = await context.newPage(),
      errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await context.route('**/api/**', async (route) => {
      const url = new URL(route.request().url()),
        path = url.pathname
      let data = {}
      if (path === '/api/auth/me') data = { user: { id: 'fixture', username: 'admin', role: 'admin', status: 'active' } }
      else if (path === '/api/novels') data = { novels: [], total: 0 }
      else if (path.includes('novel-index')) data = { novels: [] }
      else if (path === '/api/book-import/history') {
        const current = rolledBack ? { ...item, status: 'rolled_back', canRollback: false } : item
        data = empty
          ? { items: [], total: 0 }
          : {
              items:
                Number(url.searchParams.get('offset')) > 0
                  ? [current]
                  : [
                      ...Array.from({ length: 3 }, (_, index) => ({
                        ...item,
                        runId: `preview-${index}`,
                        status: 'preview',
                        created: 0,
                        updated: 0,
                        canRollback: false,
                      })),
                      current,
                      { ...item, runId: 'partial', status: 'partial', created: 2, updated: 0, canRollback: false },
                      { ...item, runId: 'expired', status: 'expired', created: 0, updated: 0, canRollback: false },
                    ],
              total: 21,
            }
      } else if (path.endsWith('/rollback')) {
        rolledBack = true
        rollbackCalls++
        data = { runId: 'applied', rolledBack: 27, conflicts: [{ id: 'chapter', title: '后续编辑的章节', reason: '已有后续修改' }] }
      }
      await route.fulfill({ json: data })
    })
    await page.goto(`${base}/admin/novels`)
    await page.getByRole('button', { name: '导入历史', exact: true }).click()
    const dialog = page.locator('.book-import-history-dialog')
    const capture = async (name) => {
      assert.ok(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth), `${name}: dialog overflow`)
      const footer = await dialog.locator('[data-slot="dialog-footer"]').boundingBox()
      assert.ok(footer.y >= 0 && footer.y + footer.height <= height, `${name}: footer remains visible`)
      const spacing = await dialog.evaluate(el => {
        const body = el.querySelector('.admin-dialog__body')
        const footer = el.querySelector('[data-slot="dialog-footer"]')
        return {
          bodyTop: parseFloat(getComputedStyle(body).paddingTop),
          bodyBottom: parseFloat(getComputedStyle(body).paddingBottom),
          footerTop: parseFloat(getComputedStyle(footer).paddingTop),
          headerBottom: parseFloat(getComputedStyle(el.querySelector('[data-slot="dialog-header"]')).paddingBottom),
          footerGap: footer.querySelector('.admin-pagination').getBoundingClientRect().top - body.getBoundingClientRect().bottom,
        }
      })
      assert.equal(spacing.bodyTop, 0, `${name}: top inset transferred, not duplicated`)
      assert.equal(spacing.headerBottom, width <= 640 ? 16 : 20, `${name}: fixed header-to-body inset`)
      assert.equal(spacing.bodyBottom, 0, `${name}: bottom inset transferred, not duplicated`)
      assert.equal(spacing.footerTop, width <= 640 ? 20 : 24, `${name}: fixed body-to-footer inset`)
      assert.ok(spacing.footerGap >= spacing.footerTop, `${name}: visible gap survives scrolling`)
      await page.screenshot({ path: `${out}/${width}-${theme}-${name}.png` })
    }
    await dialog.getByText('共 21 条记录').waitFor()
    const contract = await dialog.evaluate((el) => {
      const style = getComputedStyle(el)
      const pagination = el.querySelector('.admin-pagination--dialog')
      const jump = pagination.querySelector('input')
      const rect = el.querySelector('[data-slot="dialog-description"]').getBoundingClientRect()
      const close = el.querySelector('[data-slot="dialog-close"]').getBoundingClientRect()
      return {
        width: el.getBoundingClientRect().width,
        titleSize: getComputedStyle(el.querySelector('article h3')).fontSize,
        badge: !!el.querySelector('article .admin-status-badge--muted'),
        jumpWidth: getComputedStyle(jump).width,
        jumpHeight: getComputedStyle(jump).height,
        paginationBorder: getComputedStyle(pagination).borderTopWidth,
        footerBorder: getComputedStyle(el.querySelector('[data-slot="dialog-footer"]')).borderTopWidth,
        descriptionClear: rect.right <= close.left || rect.top >= close.bottom,
        descriptionRect: rect.toJSON(), closeRect: close.toJSON(),
        expectedJumpWidth: parseFloat(style.getPropertyValue('--admin-pagination-jump-width')) * parseFloat(getComputedStyle(document.documentElement).fontSize),
      }
    })
    assert.equal(contract.titleSize, '14px', 'record titles use the shared list title scale')
    if (width > 640) assert.equal(contract.width, Math.min(width - 32, 760), 'dialog uses shared admin width without the base Dialog cap')
    assert.ok(contract.badge, 'status uses the shared semantic badge')
    assert.equal(parseFloat(contract.jumpWidth), contract.expectedJumpWidth)
    assert.equal(contract.jumpHeight, '32px')
    assert.equal(contract.paginationBorder, '0px')
    assert.equal(contract.footerBorder, '0px')
    assert.ok(contract.descriptionClear, `description stays clear of the close button: ${width} ${JSON.stringify(contract)}`)
    const first = dialog.locator('article').first()
    assert.equal(await first.getByRole('button').count(), 0, 'uncommitted previews do not offer rollback')
    const geometry = await first.evaluate((el) => ({ copy: el.querySelector('.book-import-history__copy').clientWidth, row: el.clientWidth }))
    assert.ok(geometry.copy / geometry.row > 0.6, 'title and source occupy the main column')
    assert.equal(
      await dialog
        .locator('article')
        .last()
        .evaluate((el) => getComputedStyle(el).borderBottomWidth),
      '0px',
      'no duplicate divider before footer',
    )
    await capture('records')
    await dialog.locator('.admin-dialog__body').evaluate(el => { el.scrollTop = el.scrollHeight / 2 })
    await capture('scrolled')
    await dialog.locator('.admin-dialog__body').evaluate(el => { el.scrollTop = 0 })
    await first.screenshot({ path: `${out}/${width}-${theme}-record.png` })
    await dialog.getByRole('button', { name: '下一页', exact: true }).click()
    await dialog.getByText('预览未提交', { exact: true }).waitFor({ state: 'detached' })
    await capture('page-two')
    await dialog.getByRole('button', { name: '撤回此次导入', exact: true }).click()
    await page.getByRole('button', { name: '撤回导入', exact: true }).click()
    await dialog.getByText('后续编辑的章节：已有后续修改').waitFor()
    await dialog.getByText('已撤回', { exact: true }).waitFor()
    assert.equal(rollbackCalls, 1)
    await capture('rollback')
    empty = true
    await dialog.getByRole('button', { name: '刷新历史', exact: true }).click()
    await dialog.getByText('暂无导入记录', { exact: true }).waitFor()
    await capture('empty')
    assert.deepEqual(errors, [])
    evidence.push({ width, height, theme, pass: true, states: 5 })
    await context.close()
  }
} finally {
  await browser.close()
}
await writeFile(`${out}/evidence.json`, JSON.stringify(evidence, null, 2))
console.log(JSON.stringify(evidence, null, 2))
