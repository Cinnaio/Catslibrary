/**
 * 回填修复前已经发布的 AI 续写章节：把正文首行的标题移入章节标题。
 * 幂等：只更新能解析出标题且正文确实变化的记录。
 * 用法：npx tsx scripts/fix-published-writing-titles.ts
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

async function main() {
  const pool = new Pool({ connectionString: databaseUrl() })
  const { rows } = await pool.query(
    `SELECT g.id, g.params_json, g.result, c.id AS chapter_id, c.title AS chapter_title, c.content AS chapter_content
     FROM ai_generations g
     JOIN chapters c ON c.id = g.chapter_id
     WHERE g.kind IN ('continue', 'write_chapter') AND g.status = 'published' AND g.deleted_at = 0
     ORDER BY g.created_at`,
  )
  let fixed = 0
  for (const row of rows) {
    const parsed = parseContinuationTitle(String(row.result || ''))
    if (!parsed.title || parsed.body === String(row.result || '')) continue

    let params: Record<string, unknown> = {}
    try {
      params = JSON.parse(row.params_json || '{}') as Record<string, unknown>
    } catch {
      // Keep malformed metadata usable while still repairing chapter content.
    }
    params.draftTitle = parsed.title
    await pool.query('BEGIN')
    try {
      await pool.query('UPDATE ai_generations SET result = $1, params_json = $2 WHERE id = $3', [parsed.body, JSON.stringify(params), row.id])
      await pool.query('UPDATE chapters SET title = $1, content = $2, word_count = $3 WHERE id = $4', [
        parsed.title,
        parsed.body,
        parsed.body.replace(/<[^>]*>/g, '').length,
        row.chapter_id,
      ])
      await pool.query('COMMIT')
      fixed += 1
      console.log(`${row.chapter_id}: ${JSON.stringify(row.chapter_title)} -> ${JSON.stringify(parsed.title)}`)
    } catch (err) {
      await pool.query('ROLLBACK')
      throw err
    }
  }
  console.log(`\n共检查 ${rows.length} 条已发布 AI 章节，修复 ${fixed} 条`)
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
