/**
 * 校验 CSS 中引用的自定义属性是否都有定义，避免写出静默失效的样式。
 * 背景：本轮改动中两次用了不存在的变量（--danger、--bg-muted），
 * 声明被浏览器静默丢弃，外观无变化但不生效，肉眼与截图都难以发现。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const DIR = 'web/src/styles'
const files = readdirSync(DIR).filter((f) => f.endsWith('.css'))

const defined = new Set()
const used = [] // { name, file, line }

for (const f of files) {
  const lines = readFileSync(join(DIR, f), 'utf8').split(/\r?\n/)
  lines.forEach((text, i) => {
    // 定义：--name: value
    for (const m of text.matchAll(/(^|\s)(--[a-zA-Z0-9_-]+)\s*:/g)) defined.add(m[2])
    // 使用：var(--name) / var(--name, fallback)
    for (const m of text.matchAll(/var\(\s*(--[a-zA-Z0-9_-]+)/g)) used.push({ name: m[1], file: f, line: i + 1 })
  })
}

// 运行时会注入的变量：shadcn、Tailwind、浏览器原生，以及由 JS / 组件
// inline style 写入的变量（本轮新增的列宽变量就属于此类）。
const external = /^--(sh-|tw-|swiper-|radix-|sp-|sonner)/
const runtimeInjected = new Set([
  '--accent-base',
  '--accent-ink-light',
  '--accent-ink-dark',
  '--admin-metric-columns',
  '--admin-queue-columns',
  '--reader-line-height',
  '--reader-paragraph-spacing',
])
const isRuntimeVar = (n) => runtimeInjected.has(n) || /^--col-\d+-w$/.test(n)

const missing = used.filter((u) => !defined.has(u.name) && !external.test(u.name) && !isRuntimeVar(u.name))

const byName = new Map()
for (const m of missing) {
  if (!byName.has(m.name)) byName.set(m.name, [])
  byName.get(m.name).push(`${m.file}:${m.line}`)
}

if (byName.size === 0) {
  console.log(
    `\u2713 \u6240\u6709 var() \u5f15\u7528\u7684\u53d8\u91cf\u5747\u5df2\u5b9a\u4e49\uFF08\u5171 ${defined.size} \u4e2a\u5b9a\u4e49\uFF0C${used.length} \u5904\u5f15\u7528\uFF09`,
  )
} else {
  console.log(`\u2717 \u53d1\u73b0 ${byName.size} \u4e2a\u672a\u5b9a\u4e49\u7684\u53d8\u91cf\u5f15\u7528\uFF1A\n`)
  for (const [name, locs] of [...byName].sort()) {
    console.log(`  ${name}`)
    locs.slice(0, 4).forEach((l) => console.log(`      ${l}`))
    if (locs.length > 4) console.log(`      ...\u5171 ${locs.length} \u5904`)
  }
}
