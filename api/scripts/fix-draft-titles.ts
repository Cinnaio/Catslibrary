/**
 * 一次性回填：修复 cde14a1 解析 bug 落库的续写/新写章节草稿
 * （draftTitle 误存章节号「第 N 章」、或【标题】HH 被剥成半括号、真标题残留在正文开头）。
 * 按生成时的剥离规则还原原始输出，再用修好的 parseContinuationTitle 重新解析。
 * 幂等：重复执行时重解析结果不变，不会再更新。用法：npx tsx scripts/fix-draft-titles.ts
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { Pool } from 'pg'
import { parseContinuationTitle } from '../src/services/ai/writing'

function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const file = path.resolve(__dirname, '../../data/runtime-config.json')
  if (existsSync(file)) {
    const cfg = JSON.parse(readFileSync(file, 'utf8')) as { DATABASE_URL?: string }
    if (cfg.DATABASE_URL) return cfg.DATABASE_URL
  }
  throw new Error('未找到 DATABASE_URL（环境变量或 data/runtime-config.json）')
}

/** 与 parseContinuationTitle 的章节号行规则一致：仅「第 N 章」（可带 # 前缀），无尾巴。 */
const NUMBER_LINE = /^(?:#+\s*)?第\s*[0-9一二三四五六七八九十百千零两]+\s*[章节回]$/

async function main() {
  const pool = new Pool({ connectionString: databaseUrl() })
  const { rows } = await pool.query(
    "SELECT id, kind, params_json::text AS params_json, result FROM ai_generations WHERE kind IN ('continue', 'write_chapter') AND status = 'draft' ORDER BY created_at",
  )
  let fixed = 0
  for (const row of rows) {
    const params = JSON.parse(row.params_json || '{}') as { draftTitle?: string }
    const draftTitle = typeof params.draftTitle === 'string' ? params.draftTitle : ''
    // 还原生成时被剥离的标题行：章节号行误当标题的（第 N 章）补回行首；半剥的「xx】HH」补回前括号
    let original = row.result as string
    if (NUMBER_LINE.test(draftTitle.trim())) original = `${draftTitle.trim()}\n${original}`
    else if (draftTitle) original = `${draftTitle.startsWith('【') || !draftTitle.includes('】') ? draftTitle : `【${draftTitle}`}\n\n${original}`
    const parsed = parseContinuationTitle(original)
    if (!parsed.title || (parsed.title === draftTitle && parsed.body === row.result)) continue
    console.log(`--- ${row.id} (${row.kind})`)
    console.log(`    draftTitle: ${JSON.stringify(draftTitle)} -> ${JSON.stringify(parsed.title)}`)
    console.log(`    正文开头:   ${JSON.stringify((row.result as string).slice(0, 30))} -> ${JSON.stringify(parsed.body.slice(0, 30))}`)
    params.draftTitle = parsed.title
    await pool.query('UPDATE ai_generations SET params_json = $1, result = $2 WHERE id = $3', [JSON.stringify(params), parsed.body, row.id])
    fixed += 1
  }
  console.log(`\n共 ${rows.length} 条草稿，修复 ${fixed} 条`)
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
