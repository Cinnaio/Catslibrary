/** Read-only, repeatable snapshot for an explicitly selected novel. Does not call
 * a model, start the API, migrate the database, or manufacture author corrections. */
import { mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { Client } from 'pg'

const args = process.argv.slice(2)
const options = new Map<string, string>()
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--read-only') continue
  if (!['--novel-title', '--output', '--source-type'].includes(args[i]!) || !args[i + 1] || args[i + 1]!.startsWith('--')) throw new Error('Invalid option')
  options.set(args[i]!, args[++i]!)
}
if (!args.includes('--read-only')) {
  console.log(JSON.stringify({ mode: 'plan', databaseReads: false, modelCalls: 0, required: ['--read-only', '--novel-title', '--output'] }))
  process.exit(0)
}
const title = options.get('--novel-title')
const destination = options.get('--output')
const sourceType = options.get('--source-type') || 'development_database_read_only'
if (!['development_database_read_only', 'isolated_local_trial'].includes(sourceType)) throw new Error('Invalid source type')
if (!title || !destination) throw new Error('Novel title and new output directory required')
const output = path.resolve(destination)
// The whole directory must be new, including its original-source snapshot.
await mkdir(path.dirname(output), { recursive: true })
await mkdir(output)
const { loadConfig } = await import('../src/config')
const db = new Client({ connectionString: loadConfig().databaseUrl, connectionTimeoutMillis: 10000 })
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
try {
  await db.connect()
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
  await db.query("SET LOCAL statement_timeout='30s'")
  const novels = (await db.query('SELECT id,title FROM novels WHERE title=$1', [title])).rows as Array<{ id: string; title: string }>
  if (novels.length !== 1) throw new Error('Expected exactly one matching novel')
  const novel = novels[0]!
  const chapters = (await db.query('SELECT id,title,sort_order,content FROM chapters WHERE novel_id=$1 ORDER BY sort_order,id', [novel.id])).rows as Array<{ id: string; title: string; sort_order: string; content: string }>
  const sessions = (await db.query('SELECT id,after_chapter_id,created_at,updated_at FROM ai_agent_sessions WHERE novel_id=$1 ORDER BY created_at,id', [novel.id])).rows
  const events = (await db.query('SELECT e.id,e.session_id,e.role,e.content,e.task_id,e.request_id,e.metadata,e.created_at FROM ai_agent_events e JOIN ai_agent_sessions s ON s.id=e.session_id WHERE s.novel_id=$1 ORDER BY e.id', [novel.id])).rows
  const summaries = (await db.query('SELECT su.* FROM ai_agent_summaries su JOIN ai_agent_sessions s ON s.id=su.session_id WHERE s.novel_id=$1 ORDER BY su.session_id', [novel.id])).rows
  const versionsAvailable = !!(await db.query("SELECT to_regclass('public.ai_agent_summary_versions') AS name")).rows[0]?.name
  const summaryVersions = versionsAvailable ? (await db.query('SELECT v.* FROM ai_agent_summary_versions v JOIN ai_agent_sessions s ON s.id=v.session_id WHERE s.novel_id=$1 ORDER BY v.session_id,v.revision', [novel.id])).rows : []
  const failuresAvailable = !!(await db.query("SELECT to_regclass('public.ai_agent_summary_failures') AS name")).rows[0]?.name
  const summaryFailures = failuresAvailable ? (await db.query('SELECT f.* FROM ai_agent_summary_failures f JOIN ai_agent_sessions s ON s.id=f.session_id WHERE s.novel_id=$1 ORDER BY f.id', [novel.id])).rows : []
  const tasks = (await db.query(`SELECT t.id,t.kind,t.status,t.error,t.created_at,t.updated_at,t.finished_at FROM ai_tasks t
    WHERE t.novel_id=$1 AND (EXISTS (SELECT 1 FROM ai_agent_events e JOIN ai_agent_sessions s ON s.id=e.session_id WHERE s.novel_id=$1 AND e.task_id=t.id)
      OR EXISTS (SELECT 1 FROM ai_agent_artifacts a JOIN ai_agent_sessions s ON s.id=a.session_id WHERE s.novel_id=$1 AND a.task_id=t.id)) ORDER BY t.created_at,t.id`, [novel.id])).rows
  const actions = (await db.query('SELECT a.* FROM ai_agent_actions a JOIN ai_agent_sessions s ON s.id=a.session_id WHERE s.novel_id=$1 ORDER BY a.created_at,a.id', [novel.id])).rows
  const memories = (await db.query('SELECT * FROM ai_agent_memories WHERE novel_id=$1 ORDER BY created_at,id', [novel.id])).rows
  const versionCounts = new Map<string, number>()
  for (const version of summaryVersions) if (!version.backfilled) versionCounts.set(version.session_id, (versionCounts.get(version.session_id) || 0) + 1)
  const hasThreeSummaries = [...versionCounts.values()].some(count => count >= 3)
  await db.query('ROLLBACK')
  const snapshot = JSON.stringify({ capturedAt: new Date().toISOString(), sourceType, novel, chapters, sessions, events, summaries, summaryVersions, summaryFailures, tasks, actions, memories }, null, 2)
  await writeFile(path.join(output, 'source.json'), snapshot, { flag: 'wx' })
  const manifest = {
    novelTitle: title, snapshotSha256: hash(snapshot), chapterCount: chapters.length,
    characters: chapters.reduce((sum, c) => sum + c.content.length, 0),
    sessions: sessions.length, userMessages: events.filter(e => e.role === 'user').length,
    summaryCheckpoints: summaries.length, summaryRevisions: summaries.map(s => Number(s.revision)),
    summaryVersionsAvailable: versionsAvailable, archivedSummaryVersions: summaryVersions.length,
    summaryFailuresAvailable: failuresAvailable, archivedSummaryFailures: summaryFailures.length,
    sourceType, reviewType: 'prepared_for_human', humanReviewer: null, humanVerdict: 'pending',
    actions: actions.length, memories: memories.length,
    limitations: ['摘要历史仅覆盖版本留档启用之后；backfilled 标记仅代表迁移时最新检查点，不能还原更早摘要。', ...(!versionsAvailable ? ['当前库尚未启用摘要版本留档。'] : []), ...(!events.some(e => e.role === 'user') ? ['该作品没有作者消息，无法审阅真实修正、多次对话摘要及恢复历史。'] : []), ...(!hasThreeSummaries ? ['尚缺同一会话至少三次摘要的实际审阅证据。'] : [])],
    chapters: chapters.map(c => ({ id: c.id, order: Number(c.sort_order), title: c.title, characters: c.content.length, sha256: hash(c.content) })),
  }
  await writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' })
  const checklist = [
    '# 真实长篇审阅材料', '', `作品：${title}`, '',
    `正文 ${manifest.chapterCount} 章、${manifest.characters} 字符；原文保存在同目录 source.json，快照 SHA-256：${manifest.snapshotSha256}。`, '',
    `Agent 会话 ${sessions.length}；作者消息 ${manifest.userMessages}；可取得摘要检查点 ${summaries.length}。`, '',
    ...manifest.limitations.map(text => `- ${text}`), '',
    '## 人工审阅记录（尚未填写）', '',
    '| 核对项 | 原文位置／消息号及短引文 | 实际回复／摘要 | 判断与失败原因 |',
    '| --- | --- | --- | --- |',
    '| 否定和条件是否保留 | | | 待人工审阅 |',
    '| 正文、档案、作者方案与推测是否混淆 | | | 待人工审阅 |',
    '| 冻结章节范围外是否作全局断言 | | | 待人工审阅 |',
    '| 最新真实修正是否覆盖旧方案 | | | 缺少真实会话时不得评分 |',
    '| 多次摘要是否保留来源与未决状态 | | | 缺少历史摘要时不得评分 |',
    '| 任务完成、采纳、发布是否分开 | | | 缺少任务证据时不得评分 |',
    '| 显式恢复是否保留原文且无重复生成 | | | 缺少恢复记录时不得评分 |', '',
    '审阅人：____　日期：____　结论：待审阅。模型检查不代替独立人工验收。', '',
    '## 失败转场景', '',
    '每个确认的失败保存：冻结来源哈希和偏移、原问题、原回复、期望边界、失败类型、人工判断。脱敏回归样本标注改编；不得称为原始作者修正。', '',
    '## 章节索引', '',
    '| 顺序 | 字符数 | 原文 SHA-256 |', '| --- | --- | --- |',
    ...manifest.chapters.map(c => `| ${c.order} | ${c.characters} | ${c.sha256} |`), '',
  ].join('\n')
  await writeFile(path.join(output, 'review.md'), checklist, { flag: 'wx' })
  console.log(JSON.stringify({ chapterCount: manifest.chapterCount, characters: manifest.characters, sessions: sessions.length, userMessages: manifest.userMessages, summaries: summaries.length, humanVerdict: 'pending' }))
} catch (error) {
  // Avoid printing connection strings, SQL values or private passages on failure.
  console.error(JSON.stringify({ category: 'review_export_failed', code: (error as { code?: string }).code || 'source_or_connection_unavailable' }))
  process.exitCode = 1
} finally { await db.query('ROLLBACK').catch(() => {}); await db.end() }
