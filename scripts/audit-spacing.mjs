/**
 * 后台视觉细节审计：一次性量测关键间距、尺寸、对比，找出「细节不到位」的具体位置。
 * 判定依据是设计通则（接近性、8px 网格、触摸目标、对比度），而非主观感觉。
 */
import { chromium } from 'playwright'

const AUTH_TOKEN = process.env.AUTH_TOKEN || ''
const ORIGIN = 'http://localhost:5173'
const WIDTH = Number(process.env.W || 430)

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
})
const ctx = await browser.newContext({
  viewport: { width: WIDTH, height: 1400 },
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
await page.goto(`${ORIGIN}/admin/novels`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)

const data = await page.evaluate(() => {
  const rect = (el) => {
    if (!el) return null
    const b = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return {
      top: Math.round(b.top),
      bottom: Math.round(b.bottom),
      left: Math.round(b.left),
      right: Math.round(b.right),
      w: Math.round(b.width),
      h: Math.round(b.height),
      pad: cs.padding,
      margin: cs.margin,
      gap: cs.gap,
    }
  }
  const q = (s) => document.querySelector(s)
  const qa = (s) => [...document.querySelectorAll(s)]

  // 页面纵向区块顺序
  const blocks = [
    ['页头', '.admin-tab-header'],
    ['工作对象卡', '.admin-context-panel'],
    ['面板标题', '.admin-panel-heading'],
    ['工具栏', '.admin-toolbar'],
    ['首卡片', '.admin-data-panel--grid tbody tr'],
    ['分页', '.admin-pagination, [class*="pagination"]'],
  ]
    .map(([name, sel]) => ({ name, ...rect(q(sel)) }))
    .filter((x) => x.top != null)

  const cards = qa('.admin-data-panel--grid tbody tr')
    .slice(0, 3)
    .map((tr) => rect(tr))

  // 卡片内部：标签行间距
  const firstCard = q('.admin-data-panel--grid tbody tr')
  const fields = firstCard
    ? [...firstCard.querySelectorAll('td[data-label]')].map((td) => {
        const b = td.getBoundingClientRect()
        return { label: td.getAttribute('data-label'), top: Math.round(b.top), h: Math.round(b.height) }
      })
    : []

  // 标签与值的水平位置
  const tagPair = firstCard
    ? ['作者', '分类', '状态', '章节', '更新']
        .map((lb) => {
          const td = [...firstCard.querySelectorAll('td[data-label]')].find((t) => t.getAttribute('data-label') === lb)
          if (!td) return null
          const labelEl = td.querySelector('*')
          const tdBox = td.getBoundingClientRect()
          // 值 = 标签列之后的第一个非 pseudo 子元素
          const kids = [...td.children]
          const valueEl = kids[kids.length - 1]
          const vb = valueEl?.getBoundingClientRect()
          return {
            label: lb,
            tdLeft: Math.round(tdBox.left),
            valueLeft: vb ? Math.round(vb.left) : null,
          }
        })
        .filter(Boolean)
    : []

  return { blocks, cards, fields, tagPair, vw: window.innerWidth }
})

const line = (s) => console.log(s)
line(`视口宽 ${data.vw}px`)
line('\n=== 区块纵向间距（判定：相邻间距应 ≥8px，主区块之间应更大）===')
data.blocks.forEach((b, i) => {
  const gap = i > 0 ? b.top - data.blocks[i - 1].bottom : null
  const flag = gap === null ? '' : gap < 8 ? '  ⚠ 过小' : gap >= 16 ? '  ✓' : '  ~ 偏小'
  line(`  ${b.name.padEnd(10)} top=${String(b.top).padStart(5)} h=${String(b.h).padStart(4)}` + (gap !== null ? `  与上一块间距=${gap}px${flag}` : ''))
})

line('\n=== 卡片间距 ===')
data.cards.forEach((c, i) => {
  const gap = i > 0 ? c.top - data.cards[i - 1].bottom : null
  line(`  卡片${i}: h=${c.h}` + (gap !== null ? `  间距=${gap}px` : ''))
})

line('\n=== 卡片内字段行距（判定：应显著小于卡片间距）===')
data.fields.forEach((f, i) => {
  const gap = i > 0 ? f.top - (data.fields[i - 1].top + data.fields[i - 1].h) : null
  line(`  ${String(f.label).padEnd(4)} top=${String(f.top).padStart(5)} h=${f.h}` + (gap !== null ? `  行距=${gap}px` : ''))
})

line('\n=== 标签列与值列的水平对齐（判定：各值左边界应一致）===')
const lefts = data.tagPair.map((t) => t.valueLeft).filter((x) => x != null)
const uniform = lefts.length > 1 && Math.max(...lefts) - Math.min(...lefts) <= 1
data.tagPair.forEach((t) => line(`  ${t.label.padEnd(4)} 值左边界=${t.valueLeft}`))
line(`  → ${uniform ? '✓ 全部对齐' : '✗ 未对齐，最大偏差 ' + (Math.max(...lefts) - Math.min(...lefts)) + 'px'}`)

await browser.close()
