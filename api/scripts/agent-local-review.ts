/** Local, persistent review environment. Default is a plan; never starts workers.
 * Preparation creates a NEW loopback database from one verified source snapshot.
 * Source database is read only. No model request is made by this script. */
import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client, Pool } from 'pg'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2)
const options = new Map<string, string>()
const modes = args.filter(arg => ['--prepare', '--serve', '--export'].includes(arg))
for (let i = 0; i < args.length; i++) {
  if (modes.includes(args[i]!)) continue
  if (!['--source', '--directory', '--output'].includes(args[i]!) || !args[i + 1] || args[i + 1]!.startsWith('--')) throw new Error('Invalid option')
  options.set(args[i]!, args[++i]!)
}
if (!modes.length) {
  console.log(JSON.stringify({ mode: 'plan', databaseWrites: false, modelCalls: 0, modes: ['--prepare --source <review-pack> --directory <new-local-directory>', '--serve --directory <local-directory>', '--export --directory <local-directory> --output <new-review-pack>'] }))
  process.exit(0)
}
if (modes.length !== 1 || !options.get('--directory')) throw new Error('Choose one mode and a directory')
const directory = path.resolve(options.get('--directory')!)
const localRoot = path.join(repo, '.tmp', 'agent-local-review')
const relative = path.relative(localRoot, directory)
if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Directory must be a child of .tmp/agent-local-review')
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const save = (name: string, value: unknown) => writeFile(path.join(directory, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
const apiPort = 8791
const webPort = 5177
const loopback = (url: URL) => ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
interface ReviewState {
  database: string
  novelId: string
  chapterCount: number
  sourceSha256: string
  sessionId: string
  apiPort: number
  webPort: number
}

async function prepare() {
  const sourceDir = options.get('--source')
  if (!sourceDir) throw new Error('A verified source pack is required')
  const raw = await readFile(path.resolve(sourceDir, 'source.json'), 'utf8')
  const manifest = JSON.parse(await readFile(path.resolve(sourceDir, 'manifest.json'), 'utf8')) as { snapshotSha256: string; chapterCount: number; chapters: Array<{ id: string; sha256: string }> }
  const source = JSON.parse(raw) as { novel: { id: string; title: string }; chapters: Array<{ id: string; title: string; content: string; sort_order: number }> }
  if (hash(raw) !== manifest.snapshotSha256 || source.chapters.length !== manifest.chapterCount) throw new Error('Snapshot verification failed')
  for (const [index, chapter] of source.chapters.entries()) {
    if (chapter.id !== manifest.chapters[index]?.id || hash(chapter.content) !== manifest.chapters[index]?.sha256) throw new Error('Chapter verification failed')
  }
  // Config reads the explicitly supplied source ENV_FILE; no app/migrations imported yet.
  const { loadConfig } = await import('../src/config')
  const originalConfig = loadConfig()
  const originalUrl = new URL(originalConfig.databaseUrl)
  if (!loopback(originalUrl) || originalUrl.search) throw new Error('Only a direct loopback development database is supported')
  const sourceDb = new Client({ connectionString: originalUrl.href, connectionTimeoutMillis: 5000 })
  const database = `agent_review_${Date.now()}_${randomBytes(4).toString('hex')}`
  const targetUrl = new URL(originalUrl)
  targetUrl.pathname = '/' + database
  await mkdir(path.dirname(directory), { recursive: true })
  await mkdir(directory) // Refuse reuse/overwrite, even after a partial preparation.
  let target: Pool | undefined
  try {
    await sourceDb.connect()
    await sourceDb.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const identity = (await sourceDb.query<{ name: string; allowed: boolean }>('SELECT current_database() AS name, (rolsuper OR rolcreatedb) AS allowed FROM pg_roles WHERE rolname=current_user')).rows[0]
    if (!identity?.allowed || identity.name === database) throw new Error('Cannot create an independent local database')
    const sourceBefore = (await sourceDb.query('SELECT max(version)::int AS migration, (SELECT count(*)::int FROM ai_agent_sessions WHERE novel_id=$1) AS sessions FROM schema_migrations', [source.novel.id])).rows[0]
    const novelMetadata = (await sourceDb.query('SELECT content_rating,author FROM novels WHERE id=$1', [source.novel.id])).rows[0]
    if (!novelMetadata) throw new Error('Source novel missing')
    await sourceDb.query('ROLLBACK')
    // The only cluster mutation: a new, random, task-owned database. Never clone
    // active sessions, jobs, mail queues, backup schedules, or account credentials.
    await sourceDb.query(`CREATE DATABASE "${database}" TEMPLATE template0`)
    await save('creation.json', { database, createdAt: new Date().toISOString(), sourceBefore, sourceSha256: manifest.snapshotSha256 })
    target = new Pool({ connectionString: targetUrl.href, max: 5, connectionTimeoutMillis: 5000 })
    const { runMigrations } = await import('../src/db/migrate')
    const migrations = await runMigrations(target)
    const { hashPassword, newSalt } = await import('../src/services/auth')
    const { createAgentSession } = await import('../src/services/ai/agent-store')
    const password = randomBytes(18).toString('base64url')
    const salt = newSalt()
    const now = Date.now()
    await target.query('INSERT INTO users(id,username,display_name,role,password_hash,password_salt,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$7)', ['local-reviewer', 'agent-reviewer', '本地复核', 'super_admin', await hashPassword(password, salt), salt, now])
    await target.query('INSERT INTO novels(id,title,author,chapter_count,content_rating,visibility,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$7)', [source.novel.id, source.novel.title, novelMetadata.author, source.chapters.length, novelMetadata.content_rating, 'admin', now])
    const tx = await target.connect()
    try {
      await tx.query('BEGIN')
      for (const chapter of source.chapters) {
        await tx.query('INSERT INTO chapters(id,novel_id,title,content,sort_order,word_count,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)', [chapter.id, source.novel.id, chapter.title, chapter.content, chapter.sort_order, chapter.content.length, now])
      }
      await tx.query('COMMIT')
    } catch (error) { await tx.query('ROLLBACK'); throw error } finally { tx.release() }
    // Empty genuine-trial session; no fabricated author messages or summaries.
    const session = await createAgentSession(target, 'local-reviewer', { novelId: source.novel.id, afterChapterId: source.chapters.at(-2)?.id || '', brief: '' })
    await target.query('UPDATE ai_agent_sessions SET title=$1 WHERE id=$2', ['人工复核 · 第98章范围', session.id])
    const stored = (await target.query<{ id: string; content: string }>('SELECT id,content FROM chapters WHERE novel_id=$1 ORDER BY sort_order,id', [source.novel.id])).rows
    const sourceHashes = new Map(manifest.chapters.map(c => [c.id, c.sha256]))
    if (stored.length !== source.chapters.length || stored.some(c => hash(c.content) !== sourceHashes.get(c.id))) throw new Error('Copied chapter verification failed')
    const env = {
      DATABASE_URL: targetUrl.href,
      AI_TEXT_BASE_URL: originalConfig.aiText.baseUrl,
      AI_TEXT_API_KEY: originalConfig.aiText.apiKey,
      AI_TEXT_MODEL: originalConfig.aiText.model,
      SESSION_HASH_SALT: randomBytes(32).toString('hex'),
      THOUGHT_HASH_SALT: randomBytes(32).toString('hex'),
      PROXY_BASE: originalConfig.proxyBase,
      PROXY_BYPASS: originalConfig.proxyBypass,
      CORS_ORIGINS: `http://127.0.0.1:${webPort}`,
    }
    await save('runtime-config.json', env)
    await save('account.json', { username: 'agent-reviewer', password })
    const state: ReviewState = { database, novelId: source.novel.id, chapterCount: stored.length, sourceSha256: manifest.snapshotSha256, sessionId: session.id, apiPort, webPort }
    await save('state.json', state)
    await sourceDb.query('BEGIN READ ONLY')
    const sourceAfter = (await sourceDb.query('SELECT max(version)::int AS migration, (SELECT count(*)::int FROM ai_agent_sessions WHERE novel_id=$1) AS sessions FROM schema_migrations', [source.novel.id])).rows[0]
    await sourceDb.query('ROLLBACK')
    await save('verification.json', { capturedAt: new Date().toISOString(), copiedChapterHashesMatch: true, sourceBefore, sourceAfter, sourceWrites: 0, modelCalls: 0, migratedOnlyNewDatabase: migrations, historicalAuthorMessagesCopied: 0, humanVerdict: 'pending' })
    const entry = `http://127.0.0.1:${webPort}/admin/ai?sub=agent&novel=${encodeURIComponent(state.novelId)}&session=${encodeURIComponent(state.sessionId)}`
    await writeFile(path.join(directory, '开始复核.md'), [
      '# 本地 Agent 复核', '',
      `打开：${entry}`, '',
      '专用账号见同目录 account.json；该账号只存在于独立数据库。', '',
      '作品正文已复制并逐章核对。会话从第98章范围开始，第99章不应被当作已知信息。尚无真实作者消息、修正或摘要；此处由你输入的消息才作为新试用记录。', '',
      '## 先查看现有材料', '',
      '打开同目录 复核材料.md；里面保留实际供应商回复、失败及摘要，不代表当前版本全部通过。', '',
      '## 实际试用顺序', '',
      '1. 用你自己的话提出一项真实创作限制，并明确只讨论；检查回复有没有当作正文事实。',
      '2. 对上一项做一次真实修正，再明确撤销或保留一个条件；检查当前选择、已否定和未决定是否分开。',
      '3. 需要作品记忆时，要求提议原话；在确认前检查否定和条件是否完整。',
      '4. 随正常讨论积累足够上下文，摘要达到至少3个版本后再评估多次摘要。未达到时标为未覆盖，不用填充消息冒充真实交流。',
      '5. 如果实际出现中断，先检查已产生内容，再手动继续；检查是否重复生成。没有中断时，真实恢复项仍为未覆盖。',
      '6. 运行导出命令保存当时记录，再逐项核对；把有问题的原话和回复一起保留。', '',
      '发送消息会使用已配置模型并产生实际用量。启动环境及查看材料不调用模型。', '',
      '## 启动与导出', '',
      '在独立工作区运行；同一进程启动 API 与 Web，Ctrl+C 停止。', '',
      '```powershell',
      `npm run review:agent:local -- --serve --directory "${directory}"`,
      '```', '',
      '结束后导出到一个尚不存在的目录：', '',
      '```powershell',
      `npm run review:agent:local -- --export --directory "${directory}" --output .tmp/agent-review/human-trial-new`,
      '```', '',
      '此环境使用独立 PostgreSQL 数据库，没有常驻抓取、邮件、备份或自动恢复任务；数据随重启保留。没有操作原开发库的作品或历史，也没有合并、推送或部署。', '',
    ].join('\n'), { flag: 'wx', mode: 0o600 })
    console.log(JSON.stringify({ prepared: true, chapters: stored.length, modelCalls: 0, directory, entry }))
  } finally {
    await sourceDb.query('ROLLBACK').catch(() => {})
    await sourceDb.end()
    await target?.end()
  }
}

async function loadLocal() {
  const state = JSON.parse(await readFile(path.join(directory, 'state.json'), 'utf8')) as ReviewState
  const env = JSON.parse(await readFile(path.join(directory, 'runtime-config.json'), 'utf8')) as Record<string, string>
  const url = new URL(env.DATABASE_URL!)
  if (!/^agent_review_\d+_[a-f0-9]{8}$/.test(state.database) || !loopback(url) || url.pathname !== '/' + state.database || url.search) throw new Error('Local database identity mismatch')
  // Set before importing config/app; never load the primary checkout's .env.
  process.env.ENV_FILE = path.join(directory, '.env-unused')
  process.env.RUNTIME_CONFIG_DIR = directory
  for (const [key, value] of Object.entries(env)) process.env[key] = value
  process.env.AI_IMAGE_BASE_URL = ''
  process.env.AI_IMAGE_API_KEY = ''
  process.env.NODE_ENV = 'development'
  process.env.TRUST_PROXY = 'false'
  process.env.SITE_URL = `http://127.0.0.1:${state.webPort}`
  const db = new Client({ connectionString: url.href, connectionTimeoutMillis: 5000 })
  try {
    await db.connect()
    if ((await db.query('SELECT current_database() AS name')).rows[0]?.name !== state.database) throw new Error('Wrong database')
    if (!(await db.query('SELECT 1 FROM schema_migrations WHERE version=81 AND name=$1', ['081_ai_agent_summary_versions.sql'])).rowCount) throw new Error('Summary archive migration missing')
  } finally { await db.end() }
  return state
}

try {
  if (modes[0] === '--prepare') await prepare()
  else {
    const state = await loadLocal()
    if (modes[0] === '--export') {
      const output = options.get('--output')
      if (!output) throw new Error('New export directory required')
      const db = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 })
      let title: string
      try {
        await db.connect()
        await db.query('BEGIN READ ONLY')
        title = (await db.query('SELECT title FROM novels WHERE id=$1', [state.novelId])).rows[0]?.title as string
        if (!title) throw new Error('Review novel missing')
      } finally { await db.query('ROLLBACK').catch(() => {}); await db.end() }
      process.argv = [process.argv[0]!, process.argv[1]!, '--read-only', '--source-type', 'isolated_local_trial', '--novel-title', title, '--output', output]
      await import('./export-agent-review')
    } else {
      const { app } = await import('../src/app')
      const { serve } = await import('@hono/node-server')
      const { getPool } = await import('../src/db/pool')
      const { createServer } = await import('vite')
      const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: state.apiPort })
      let web: Awaited<ReturnType<typeof createServer>> | undefined
      try {
        await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject) })
        web = await createServer({
          configFile: path.join(repo, 'web/vite.config.ts'), root: path.join(repo, 'web'),
          cacheDir: path.join(directory, 'vite-cache'),
          server: { host: '127.0.0.1', port: state.webPort, strictPort: true, proxy: { '/api': { target: `http://127.0.0.1:${state.apiPort}`, changeOrigin: false } } },
        })
        await web.listen()
      } catch (error) {
        server.close()
        await web?.close()
        await getPool()?.end()
        throw error
      }
      const shutdown = async () => {
        await web?.close()
        await new Promise<void>(resolve => server.close(() => resolve()))
        await getPool()?.end()
        process.exit(0)
      }
      process.on('SIGINT', () => { void shutdown() })
      process.on('SIGTERM', () => { void shutdown() })
      console.log(JSON.stringify({ localApi: `http://127.0.0.1:${state.apiPort}`, localWeb: `http://127.0.0.1:${state.webPort}`, workers: false, modelCallsOnStartup: 0 }))
    }
  }
} catch (error) {
  // Avoid connection strings, SQL parameters and source passages in tool output.
  console.error(JSON.stringify({ category: 'local_review_failed', code: (error as { code?: string }).code || 'local_review_validation_failed' }))
  process.exitCode = 1
}
