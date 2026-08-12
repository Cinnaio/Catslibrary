import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { getPool, type Db } from './pool'

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations')

type MigrationDb = Pick<Db, 'query' | 'connect'>

/**
 * 列出迁移文件并校验版本号唯一。
 * 曾因两个 006_*.sql 版本号冲突导致全新安装的迁移在主键冲突处中断，
 * 这里在执行任何 SQL 之前直接报错，避免半途失败。
 */
async function listMigrationFiles(dir: string): Promise<string[]> {
  const files = (await readdir(dir))
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10))

  const byVersion = new Map<number, string>()
  for (const file of files) {
    const version = Number.parseInt(file, 10)
    if (!Number.isInteger(version)) throw new Error(`迁移文件名缺少数字版本前缀: ${file}`)
    const existing = byVersion.get(version)
    if (existing) throw new Error(`迁移版本号冲突: ${existing} 与 ${file} 均解析为版本 ${version}`)
    byVersion.set(version, file)
  }
  return files
}

/**
 * 版本化迁移核心：按文件名数字前缀排序，应用未记录在 schema_migrations 中的
 * 版本，每个版本在一个事务内执行。返回本次新应用的迁移名。
 * 独立于连接池以便测试注入（如 pglite）。
 */
export async function runMigrations(db: MigrationDb, dir: string = MIGRATIONS_DIR): Promise<string[]> {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`)

  const files = await listMigrationFiles(dir)

  const applied = new Set<number>()
  const { rows } = await db.query<{ version: number }>('SELECT version FROM schema_migrations')
  for (const r of rows) applied.add(r.version)

  const done: string[] = []
  for (const file of files) {
    const version = Number.parseInt(file, 10)
    if (applied.has(version)) continue
    const sql = await readFile(path.join(dir, file), 'utf8')
    const client = await db.connect()
    try {
      await client.query('BEGIN')
      await client.query(sql)
      await client.query('INSERT INTO schema_migrations (version, name) VALUES ($1, $2)', [version, file])
      await client.query('COMMIT')
      applied.add(version)
      done.push(file)
      console.log(`[migrate] applied ${file}`)
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }

  if (done.length === 0) console.log('[migrate] up to date')
  return done
}

/**
 * 生产入口：走 DATABASE_URL 连接池执行迁移。
 * keepPoolOpen：进程内复用（如 /api/setup）时传 true，不关闭生产池。
 */
export async function migrate(options: { keepPoolOpen?: boolean } = {}): Promise<string[]> {
  const pool = getPool()
  if (!pool) throw new Error('DATABASE_URL 未配置，无法执行迁移')
  const done = await runMigrations(pool)
  if (!options.keepPoolOpen) await pool.end()
  return done
}

// 直接执行：npm run db:migrate
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  migrate()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[migrate] failed:', err)
      process.exit(1)
    })
}
