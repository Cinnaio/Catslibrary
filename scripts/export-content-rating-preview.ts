/**
 * 导出内容分级预填命中清单（只读，不写库）。
 *
 * 用途：生产环境不便直调 API 时，在能连库的机器上生成人工过目用的 Markdown 清单。
 *
 * 与后端预填共用 shared/restricted-rules.ts 的判级入口；分类按完整标签匹配，
 * 标题和简介才用文本正则。前台只读取已落库的 content_rating 字段。
 *
 * 用法：
 *   npx tsx scripts/export-content-rating-preview.ts                 # 写入 docs/ 下带日期的文件
 *   npx tsx scripts/export-content-rating-preview.ts --stdout        # 输出到标准输出
 *
 * 连接串来源：环境变量 DATABASE_URL，或项目根目录 .env 的 DATABASE_URL。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { RESTRICTED_PATTERNS } from '../shared/restricted-patterns.ts'
import { isRestrictedCategoryTag } from '../shared/restricted-categories.ts'
import { isRestrictedByRules } from '../shared/restricted-rules.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function resolveDatabaseUrl(): string {
  const fromEnv = process.env.DATABASE_URL?.trim()
  if (fromEnv) return fromEnv
  try {
    const envFile = fs.readFileSync(path.join(ROOT, '.env'), 'utf8')
    const m = envFile.match(/^DATABASE_URL=(.+)$/m)
    if (m?.[1]?.trim()) return m[1].trim()
  } catch {
    /* 无 .env 时继续 */
  }
  throw new Error('DATABASE_URL 未配置（可设环境变量，或在项目根目录 .env 中提供）')
}

/** 用独立 RegExp 实例执行，避免 g 标志下的 lastIndex 状态污染。 */
function matchOf(text: string) {
  const hits: Array<{ pattern: string; word: string; snippet: string }> = []
  for (const source of RESTRICTED_PATTERNS) {
    const re = new RegExp(source.source, source.flags.replace('g', ''))
    const m = re.exec(text)
    if (!m) continue
    const at = m.index
    hits.push({
      pattern: source.source,
      word: m[0],
      snippet: text.slice(Math.max(0, at - 28), at + m[0].length + 28).replace(/\s+/g, ' '),
    })
  }
  return hits
}

interface BookRow {
  id: string
  title: string
  author: string
  description: string
  categories: string
  chapter_count: number
}

const url = resolveDatabaseUrl()
const { default: pg } = await import('pg')
const client = new pg.Client({ connectionString: url, ssl: false })
await client.connect()

const { rows } = (await client.query(
  `SELECT id, title, author, description, categories, chapter_count
   FROM novels WHERE content_rating = 'unknown' ORDER BY title`,
)) as { rows: BookRow[] }
await client.end()

const entries = []
for (const r of rows) {
  let categories: string[] = []
  try {
    const parsed: unknown = JSON.parse(r.categories || '[]')
    categories = Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    categories = []
  }
  const text = [r.title, r.description].filter(Boolean).join(' ')
  const hits = [
    ...categories.filter(isRestrictedCategoryTag).map((tag) => ({ pattern: `tag:${tag}`, word: tag, snippet: `分类标签：${tag}` })),
    ...matchOf(text),
  ]
  if (!isRestrictedByRules({ title: r.title, description: r.description, categories })) continue
  entries.push({ id: r.id, title: r.title, author: r.author, categories, chapters: r.chapter_count, hits })
}

// 按规则聚合：先看这里找过度匹配
const byPattern = new Map<string, string[]>()
for (const e of entries) {
  for (const h of e.hits) {
    const list = byPattern.get(h.pattern) ?? []
    list.push(e.title)
    byPattern.set(h.pattern, list)
  }
}

const lines: string[] = []
lines.push('# 内容分级规则预填命中清单（只读导出，未写入数据库）')
lines.push('')
lines.push(`- 导出时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`)
lines.push(`- 扫描范围：\`content_rating = 'unknown'\` 的全部 ${rows.length} 本`)
if (rows.length) lines.push(`- 命中：**${entries.length} 本**（命中率 ${((entries.length / rows.length) * 100).toFixed(1)}%）`)
lines.push(`- 本次预计新增 \`restricted\` ${entries.length} 本，\`unknown\` 剩余 ${rows.length - entries.length} 本；不会自动写 \`general\``)
lines.push('')
lines.push('> 判定依据是分类标签精确枚举或标题/简介文本特征，与后端预填共用 `shared/restricted-rules.ts`。')
lines.push('> 当前前台只读 `content_rating` 字段；尚未预填的命中书仍为 `unknown`，预填后安全模式可见性会改变。')
lines.push('')
lines.push('## 一、按规则聚合（先看这里，找过度匹配）')
lines.push('')
lines.push('| 规则 | 命中本数 |')
lines.push('|---|---|')
for (const [p, titles] of [...byPattern.entries()].sort((a, b) => b[1].length - a[1].length)) {
  lines.push(`| \`${p.replace(/\|/g, '\\|')}\` | ${titles.length} |`)
}
lines.push('')
lines.push('## 二、完整清单')
lines.push('')
lines.push('| # | 书名 | 分类 | 触发词 | 上下文片段 |')
lines.push('|---|---|---|---|---|')
entries.forEach((e, i) => {
  const words = [...new Set(e.hits.map((h) => h.word))].join('、')
  const snippet = e.hits[0].snippet.replace(/\|/g, '\\|')
  lines.push(`| ${i + 1} | ${e.title.replace(/\|/g, '\\|')} | ${e.categories.join('、') || '—'} | ${words} | ${snippet} |`)
})
lines.push('')

const out = lines.join('\n')
// 用显式参数而非 isTTY 判断：被管道/CI 捕获时 isTTY 恒为 false，会误把整份清单
// 倒进 stdout（200+ 行）。默认写文件更安全。
if (process.argv.includes('--stdout')) {
  console.log(out)
} else {
  const file = path.join(ROOT, 'docs', `content-rating-prefill-preview-${new Date().toISOString().slice(0, 10)}.md`)
  fs.writeFileSync(file, out, 'utf8')
  console.log(`扫描 ${rows.length} 本，命中 ${entries.length} 本`)
  console.log(`已写入 ${file}`)
}
