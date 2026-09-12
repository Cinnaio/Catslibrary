/**
 * 量测后台表格的细节尺寸：列边界、元素间距、字号，用于逐项核对视觉对齐。
 */
import { chromium } from 'playwright'

const AUTH_TOKEN = process.env.AUTH_TOKEN || ''
const ORIGIN = 'http://localhost:5173'
const url = `${ORIGIN}/admin/novels`

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
})
const ctx = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  storageState: {
    cookies: [],
    origins: [
      {
        origin: ORIGIN,
        localStorage: [{ name: 'theme', value: 'light' }, ...(AUTH_TOKEN ? [{ name: 'user_session_token', value: AUTH_TOKEN }] : [])],
      },
    ],
  },
})
const page = await ctx.newPage()
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)

const report = await page.evaluate(() => {
  const panel = document.querySelector('.admin-data-panel--grid')
  if (!panel) return { error: '未找到表格' }

  const head = panel.querySelector('thead tr')
  const body = panel.querySelector('tbody tr')
  const cells = (tr) => [...(tr?.children ?? [])]

  const describe = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return {
      x: Math.round(r.x),
      right: Math.round(r.right),
      w: Math.round(r.width),
      h: Math.round(r.height),
      font: cs.fontSize,
      padL: cs.paddingLeft,
      padR: cs.paddingRight,
      color: cs.color,
    }
  }

  // 表头与首行的列边界对比
  const headCells = cells(head).map((c, i) => ({ i, ...describe(c) }))
  const bodyCells = cells(body).map((c, i) => ({ i, ...describe(c) }))

  // 表头内排序按钮与其图标的间距
  const sortBtn = head?.querySelector('.admin-sort-button')
  const sortLabel = sortBtn?.querySelector('span')
  const caret = sortBtn?.querySelector('.admin-sort-caret')
  const btnLabel = sortBtn ? describe(sortBtn) : null
  const caretBox = caret ? describe(caret) : null
  const labelBox = sortLabel ? describe(sortLabel) : null

  // 复选框尺寸与所在单元格左边距
  const checkbox = body?.querySelector('[role="checkbox"], button[data-state]')
  const checkboxBox = checkbox ? describe(checkbox) : null

  // 分类标签与状态徽章的尺寸对比
  const tag = body?.querySelector('.admin-cell-tags [data-slot="badge"], .admin-cell-tags span')
  const status = body?.querySelector('[data-slot="badge"]')
  const tagBox = tag ? describe(tag) : null
  const statusBox = status ? describe(status) : null

  // 行内操作图标尺寸
  const actionIcon = body?.querySelector('.admin-cell-actions svg')
  const actionIconBox = actionIcon ? describe(actionIcon) : null

  return {
    headCells,
    bodyCells,
    sortButton: btnLabel,
    sortLabel: labelBox,
    sortCaret: caretBox,
    checkbox: checkboxBox,
    tag: tagBox,
    status: statusBox,
    actionIcon: actionIconBox,
    rowHeight: body ? Math.round(body.getBoundingClientRect().height) : null,
  }
})

if (report.error) {
  console.log('错误:', report.error)
} else {
  console.log('=== 表头列边界 vs 内容列边界（应完全一致）===')
  report.headCells.forEach((h, i) => {
    const b = report.bodyCells[i]
    const match = h.x === b?.x && h.right === b?.right ? '✓' : '✗ 错位'
    console.log(
      `  列${i}: 表头 x=${String(h.x).padStart(4)}~${String(h.right).padStart(4)} w=${String(h.w).padStart(4)}  ` +
        `内容 x=${String(b?.x).padStart(4)}~${String(b?.right).padStart(4)} w=${String(b?.w).padStart(4)}  ${match}`,
    )
  })

  console.log('\n=== 排序按钮 ===')
  console.log(`  按钮: x=${report.sortButton?.x} w=${report.sortButton?.w} h=${report.sortButton?.h}`)
  console.log(`  文字: x=${report.sortLabel?.x} w=${report.sortLabel?.w}`)
  console.log(`  图标: x=${report.sortCaret?.x} w=${report.sortCaret?.w} h=${report.sortCaret?.h}`)
  if (report.sortLabel && report.sortCaret) {
    // 直接由两者的右边界算间隙，不推算 padding
    const gap = report.sortCaret.x - (report.sortLabel.x + report.sortLabel.w)
    console.log(`  图标与文字间隙: ${gap}px`)
  }

  console.log('\n=== 行高与控件 ===')
  console.log(`  行高: ${report.rowHeight}px`)
  console.log(`  复选框: w=${report.checkbox?.w} h=${report.checkbox?.h}`)
  console.log(`  分类标签: w=${report.tag?.w} h=${report.tag?.h} font=${report.tag?.font} padL=${report.tag?.padL}`)
  console.log(`  状态徽章: w=${report.status?.w} h=${report.status?.h} font=${report.status?.font} padL=${report.status?.padL}`)
  console.log(`  操作图标: w=${report.actionIcon?.w} h=${report.actionIcon?.h}`)
}

await browser.close()
