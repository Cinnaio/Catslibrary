/**
 * 内容分级预填 —— 可直接执行的独立脚本。
 *
 * 用途：在服务器上人工预览或补跑规则，不需要管理员 token。
 *
 * API 启动时会在开始接收请求前自动预填。本脚本保留给人工预览、补跑和回滚。
 * 读取侧只认字段；不要单独迁移后跳过预填就开放新前端。
 *
 * 红线：只写 'restricted'，绝不写 'general'。
 * 规则是枚举法（成人标签 + 文本正则），认不出的一律保持 unknown——若把「未命中」
 * 当成「一般」，等于把漏网永久固化成「已认证安全」，此后不再被检视。
 * general 只能由人工给出（系统不替运营做「这本书安全」的承诺）。
 *
 * 幂等：只处理 content_rating = 'unknown' 的书，已人工判定过的绝不覆盖。
 *
 * 用法：
 *   npx tsx scripts/prefill-content-rating.ts --dry-run   # 只统计，不写库（建议先跑）
 *   npx tsx scripts/prefill-content-rating.ts             # 实际写入
 *   npx tsx scripts/prefill-content-rating.ts --undo <ids.json>   # 按备份文件回滚
 *
 * 写入前会把受影响的 id 写入 data/content-rating-prefill-backup-<时间戳>.json，
 * 出问题可据此精确回滚。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isRestrictedByRules } from '../shared/restricted-rules.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function resolveDatabaseUrl(): string {
  const fromEnv = process.env.DATABASE_URL?.trim()
  if (fromEnv) return fromEnv
  try {
    const m = fs.readFileSync(path.join(ROOT, '.env'), 'utf8').match(/^DATABASE_URL=(.+)$/m)
    if (m?.[1]?.trim()) return m[1].trim()
  } catch {
    /* 无 .env */
  }
  throw new Error('DATABASE_URL 未配置')
}

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const undoIndex = args.indexOf('--undo')

const { default: pg } = await import('pg')
const client = new pg.Client({ connectionString: resolveDatabaseUrl(), ssl: false })
await client.connect()

/** 命中判定：成人分类标签 OR 标题/简介的限制级文本特征。与后端预填同源同语义。 */
function isRestricted(row: { title: string; description: string; categories: string }): boolean {
  let cats: string[] = []
  try {
    const parsed: unknown = JSON.parse(row.categories || '[]')
    cats = Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    cats = []
  }
  return isRestrictedByRules({ title: row.title, description: row.description, categories: cats })
}

const snapshot = async () => {
  const { rows } = await client.query(
    `SELECT COUNT(*) FILTER (WHERE content_rating='general')::int AS g,
            COUNT(*) FILTER (WHERE content_rating='restricted')::int AS r,
            COUNT(*) FILTER (WHERE content_rating='unknown')::int AS u,
            COUNT(*)::int AS total FROM novels`,
  )
  return rows[0]
}

// ---------- 回滚模式 ----------
if (undoIndex !== -1) {
  const backupFile = args[undoIndex + 1]
  if (!backupFile || !fs.existsSync(backupFile)) throw new Error(`备份文件不存在：${backupFile}`)
  const backup = JSON.parse(fs.readFileSync(backupFile, 'utf8')) as { ids: string[] }
  if (!Array.isArray(backup.ids) || backup.ids.length === 0) throw new Error('备份文件没有可回滚的 ids')
  const ph = backup.ids.map((_, i) => `$${i + 1}`).join(',')
  // 只退回仍是 restricted 的书，不覆盖人工改过的值
  const res = await client.query(
    `UPDATE novels SET content_rating = 'unknown' WHERE content_rating = 'restricted' AND id IN (${ph})`,
    backup.ids,
  )
  console.log(`已回滚 ${res.rowCount} 本 → unknown（备份含 ${backup.ids.length} 本）`)
  console.log('回滚后分布:', JSON.stringify(await snapshot()))
  await client.end()
  process.exit(0)
}

// ---------- 预填 ----------
const before = await snapshot()
console.log('起始分布:', JSON.stringify(before))

const { rows } = await client.query(
  `SELECT id, title, description, categories FROM novels WHERE content_rating = 'unknown'`,
)
const matched = rows.filter(isRestricted)
const remaining = rows.length - matched.length

console.log(`扫描 unknown ${rows.length} 本 → 命中 ${matched.length} 本；未命中 ${remaining} 本保持 unknown`)
console.log('红线检查: general 将保持为 0（预填绝不写 general）')

if (dryRun) {
  console.log('\n[dry-run] 未写入任何数据。命中样本（前 20）：')
  for (const r of matched.slice(0, 20)) console.log('  ·', r.title)
  console.log('\n确认无误后去掉 --dry-run 实际写入。')
  await client.end()
  process.exit(0)
}

if (!matched.length) {
  console.log('无命中，无需写入。')
  await client.end()
  process.exit(0)
}

// 写前备份 id，作为精确回滚凭据
const backupDir = path.join(ROOT, 'data')
fs.mkdirSync(backupDir, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backupFile = path.join(backupDir, `content-rating-prefill-backup-${stamp}.json`)
fs.writeFileSync(backupFile, JSON.stringify({ createdAt: new Date().toISOString(), ids: matched.map((r) => r.id) }, null, 2), 'utf8')
console.log(`\n回滚凭据已写入: ${backupFile}`)

await client.query('BEGIN')
try {
  for (const r of matched) {
    // 刻意不写 updated_at：分级是治理属性而非内容更新。刷新它会把存量书顶到首页
    // 最前（列表默认 sort=updated_at DESC），并让 quality=stale_ongoing 判定失真。
    await client.query(`UPDATE novels SET content_rating = 'restricted' WHERE id = $1 AND content_rating = 'unknown'`, [r.id])
  }
  await client.query('COMMIT')
} catch (err) {
  await client.query('ROLLBACK')
  throw err
}

const after = await snapshot()
console.log('写入后分布:', JSON.stringify(after))
console.log(`\n✓ 完成：restricted ${before.r} → ${after.r}，unknown ${before.u} → ${after.u}，general 仍为 ${after.g}`)
console.log(`如需回滚: npx tsx scripts/prefill-content-rating.ts --undo "${backupFile}"`)

await client.end()
