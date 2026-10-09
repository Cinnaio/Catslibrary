import { Pool } from 'pg'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdtemp, mkdir, rm, readFile, writeFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { once } from 'node:events'
import type { Db } from '../../db/pool'
import { first, all } from '../../db/query'
import { rehearsalConnection } from './settings'
import { loadConfig } from '../../config'
import { BackupError, backupRoot } from './config'
import { command, pgEnvironment, psqlTool, restoreTool, dumpTool } from './process'
import { type Manifest, currentMigration, decryptArchive } from './archive'
import { ensureLocalArchive } from './storage'

const migrationsDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'db', 'migrations')
// 本目录在打包后通过显式相对 dist 路径解析；见 tsup/copy-migrations。
function migrationDir() {
  return (
    process.env.BACKUP_MIGRATIONS_DIR ||
    (path.basename(fileURLToPath(import.meta.url)).endsWith('.js')
      ? path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations')
      : migrationsDirectory)
  )
}
export async function validateCompatibility(db: Db, manifest: Manifest) {
  if (manifest.migrationVersion > (await currentMigration(db))) throw new BackupError('SCHEMA_INCOMPATIBLE', '备份结构比当前程序更新，请先升级程序')
  const current = Number((await first<{ version: string }>(db, "SELECT current_setting('server_version_num') AS version"))?.version || 0)
  if (Math.floor(current / 10000) < Math.floor(manifest.postgresVersion / 10000))
    throw new BackupError('SCHEMA_INCOMPATIBLE', '不能向较低大版本 PostgreSQL 恢复')
  for (const tool of [dumpTool(), restoreTool()]) {
    const version = await command(tool, ['--version'], { timeout: 5000 }),
      major = Number(version.match(/\b(\d+)\.\d+/)?.[1] || 0)
    if (major !== Math.floor(current / 10000)) throw new BackupError('TOOL_VERSION_MISMATCH', '备份与恢复工具大版本必须匹配当前 PostgreSQL')
  }
}
async function generateRestoreScript(dump: string, dir: string, manifest: Manifest, extensions: string[], commitId?: string) {
  const toc = await command(restoreTool(), ['--list', dump], { captureLimit: 4 * 1024 * 1024, failOnOverflow: true })
  const filtered = toc
    .split('\n')
    .filter((line) => !/;\s+\d+ \d+ SCHEMA - public /.test(line))
    .join('\n')
  const list = path.join(dir, 'restore.list'),
    sql = path.join(dir, 'restore.sql'),
    script = path.join(dir, 'transaction.sql')
  await writeFile(list, filtered, { mode: 0o600 })
  await command(restoreTool(), ['--no-owner', '--no-acl', '--use-list', list, '--file', sql, dump])
  const output = createWriteStream(script, { mode: 0o600 })
  let outputError: Error | null = null
  output.on('error', (error) => {
    outputError = error
  })
  const write = async (data: string | Buffer) => {
    if (outputError) throw outputError
    if (!output.write(data)) await once(output, 'drain')
  }
  try {
    // 扩展名来自数据库且仅接受标识符。schema 重建和数据恢复处于同一事务。
    await write(
      `BEGIN;\nDROP SCHEMA IF EXISTS public CASCADE;\nCREATE SCHEMA public;\n${extensions.map((name) => `CREATE EXTENSION IF NOT EXISTS "${name}" WITH SCHEMA public;`).join('\n')}\n`,
    )
    for await (const chunk of createReadStream(sql)) await write(chunk as Buffer)
    const files = (await readdir(migrationDir())).filter((name) => /^\d+_.*\.sql$/.test(name)).sort((a, b) => Number.parseInt(a) - Number.parseInt(b))
    for (const file of files) {
      const version = Number.parseInt(file)
      if (version <= manifest.migrationVersion) continue
      await write(
        `\n${await readFile(path.join(migrationDir(), file), 'utf8')}\nINSERT INTO public.schema_migrations(version,name) VALUES(${version},'${file.replace(/'/g, "''")}');\n`,
      )
    }
    await write(`\nDELETE FROM public.user_sessions;
UPDATE public.ai_tasks SET status='failed',step='备份恢复后已中断',error='请管理员重新确认后重试',finished_at=${Date.now()} WHERE status IN ('queued','running');
UPDATE public.scrape_jobs SET status='failed',step='备份恢复后已中断',error='请管理员重新确认后重试' WHERE status NOT IN ('completed','partial','failed','cancelled');
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.users WHERE role='admin' AND status='active') THEN RAISE EXCEPTION 'No active administrator'; END IF;
 IF EXISTS(SELECT 1 FROM public.chapters c LEFT JOIN public.novels n ON n.id=c.novel_id WHERE n.id IS NULL) THEN RAISE EXCEPTION 'Orphan chapters'; END IF;
END $$;
${commitId ? `INSERT INTO backup_control.settings(key,value,updated_at) VALUES('restoreCommit','${JSON.stringify(commitId).replace(/'/g, "''")}',${Date.now()}) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=EXCLUDED.updated_at;` : ''}
COMMIT;\n`)
    output.end()
    await once(output, 'close')
    if (outputError) throw outputError
    return script
  } catch (error) {
    output.destroy()
    throw error
  }
}
async function extensions(db: Db) {
  const rows = await all<{ name: string }>(
    db,
    "SELECT e.extname AS name FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE n.nspname='public'",
  )
  if (rows.some((row) => !/^[a-zA-Z0-9_]+$/.test(row.name))) throw new BackupError('SCHEMA_INCOMPATIBLE', '发现不支持的扩展名称')
  return rows.map((row) => row.name)
}
export async function prepareRestore(db: Db, manifest: Manifest, commitId?: string, offline = false) {
  if (offline) {
    const files = (await readdir(migrationDir())).filter((name) => /^\d+_.*\.sql$/.test(name))
    if (manifest.migrationVersion > Math.max(...files.map((name) => Number.parseInt(name))))
      throw new BackupError('SCHEMA_INCOMPATIBLE', '灾备包需要更新的应用版本')
    const current = Number((await first<{ version: string }>(db, "SELECT current_setting('server_version_num') AS version"))?.version || 0)
    if (Math.floor(current / 10000) < Math.floor(manifest.postgresVersion / 10000)) throw new BackupError('SCHEMA_INCOMPATIBLE', '灾备目标 PostgreSQL 版本过低')
  } else await validateCompatibility(db, manifest)
  await ensureLocalArchive(db, manifest.id, manifest)
  await mkdir(path.join(backupRoot(), 'work'), { recursive: true, mode: 0o700 })
  const dir = await mkdtemp(path.join(backupRoot(), 'work', 'restore-'))
  try {
    const dump = path.join(dir, 'database.dump')
    await decryptArchive(manifest.id, dump, manifest)
    const installed = await extensions(db)
    const script = await generateRestoreScript(dump, dir, manifest, offline ? [...new Set([...installed, 'pg_trgm'])] : installed, commitId)
    return { dir, script }
  } catch (error) {
    await rm(dir, { recursive: true, force: true })
    throw error
  }
}
export async function rehearse(db: Db, manifest: Manifest) {
  const connectionString = await rehearsalConnection(db)
  if (!connectionString) throw new BackupError('REHEARSAL_UNAVAILABLE', '请在备份设置中配置独立演练数据库后启用回滚')
  const current = new URL(loadConfig().databaseUrl),
    target = new URL(connectionString)
  if (current.hostname === target.hostname && current.port === target.port && current.pathname === target.pathname)
    throw new BackupError('REHEARSAL_UNSAFE', '演练数据库不能与业务数据库相同')
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 })
  let prepared: Awaited<ReturnType<typeof prepareRestore>> | undefined
  try {
    const live = await db.query<{ name: string }>('SELECT current_database() AS name')
    const shadow = await pool.query('SELECT current_database() AS name')
    // 数据库名相同即保守拒绝，覆盖域名别名/代理指向同一数据库的情况；不需超级用户权限。
    if (live.rows[0]?.name === shadow.rows[0]?.name) throw new BackupError('REHEARSAL_UNSAFE', '演练数据库必须使用与业务数据库不同的名称')
    // 专属 marker 由部署管理员或受控建库接口建立，防止误填另一生产库后清空它。
    const marker = await pool.query("SELECT value FROM backup_rehearsal.guard WHERE key='purpose'")
    if (marker.rows[0]?.value !== 'zhi-zhou-backup-rehearsal') throw new BackupError('REHEARSAL_UNSAFE', '演练数据库缺少专属保护标记')
    prepared = await prepareRestore(db, manifest)
    await command(psqlTool(), ['--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '--file', prepared.script], { env: pgEnvironment(connectionString) })
    const administrators = await pool.query("SELECT username FROM public.users WHERE role='admin' AND status='active' ORDER BY username")
    return administrators.rows.map((row) => String(row.username))
  } finally {
    await pool.end()
    if (prepared) await rm(prepared.dir, { recursive: true, force: true })
  }
}
export async function restoreBusiness(db: Db, manifest: Manifest, commitId?: string, offline = false) {
  const prepared = await prepareRestore(db, manifest, commitId, offline)
  try {
    await command(psqlTool(), ['--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '--file', prepared.script], { env: pgEnvironment() })
  } finally {
    await rm(prepared.dir, { recursive: true, force: true })
  }
}
