import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { getPool } from './pool'

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations')

/**
 * 版本化迁移：按文件名数字前缀排序，应用未记录在 schema_migrations 中的
 * 版本，每个版本在一个事务内执行（幂等）。返回本次新应用的迁移名。
 * keepPoolOpen：进程内复用（如 /api/setup）时传 true，不关闭生产池。
 */
export async function migrate(options: { keepPoolOpen?: boolean } = {}): Promise<string[]> {
  const pool = getPool()
  if (!pool) throw new Error('DATABASE_URL 未配置，无法执行迁移')

  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`)

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10))

  const applied = new Set<number>()
  const { rows } = await pool.query<{ version: number }>('SELECT version FROM schema_migrations')
  for (const r of rows) applied.add(r.version)

  const done: string[] = []
  for (const file of files) {
    const version = Number.parseInt(file, 10)
    if (applied.has(version)) continue
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8')
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(sql)
      await client.query('INSERT INTO schema_migrations (version, name) VALUES ($1, $2)', [version, file])
      await client.query('COMMIT')
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
