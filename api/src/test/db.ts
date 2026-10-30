/**
 * 测试 DB：用 WASM PostgreSQL（pglite）提供真实 SQL 语义，
 * 让认证/内容路由在无本地 PG 服务器时也能端到端验证。
 */
import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Db } from '../db/pool'

export interface TestDb {
  db: Db
  /** 将 migrations/*.sql 按序应用到测试库。 */
  applyMigrations: () => Promise<void>
  close: () => Promise<void>
}

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations')

export async function createTestDb(dataDir?: string): Promise<TestDb> {
  // pg_trgm：011 迁移的 trigram 索引依赖该扩展，测试库同样装载以覆盖真实路径
  const pg = new PGlite({ dataDir, extensions: { pg_trgm } })

  const applyMigrations = async (): Promise<void> => {
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10))
    if (dataDir) await pg.exec('CREATE TABLE IF NOT EXISTS _test_schema_migrations (name TEXT PRIMARY KEY)')
    const applied = dataDir
      ? new Set((await pg.query<{ name: string }>('SELECT name FROM _test_schema_migrations')).rows.map((row) => row.name))
      : new Set<string>()
    for (const f of files) {
      if (applied.has(f)) continue
      const sql = await readFile(path.join(MIGRATIONS_DIR, f), 'utf8')
      if (!dataDir) {
        await pg.exec(sql)
        continue
      }
      await pg.exec('BEGIN')
      try {
        await pg.exec(sql)
        await pg.query('INSERT INTO _test_schema_migrations(name) VALUES($1)', [f])
        await pg.exec('COMMIT')
      } catch (error) {
        await pg.exec('ROLLBACK')
        throw error
      }
    }
  }

  const query = async <T = unknown>(text: string, params: unknown[] = []) => {
    const res = await pg.query(text, params)
    // PGlite 用 affectedRows 表示受影响行数（pg 驱动是 rowCount）
    const rowCount = res.affectedRows ?? res.rows.length
    return { rows: res.rows as T[], rowCount }
  }

  const db: Db = {
    query,
    async connect() {
      return {
        query: async (text: string, params: unknown[] = []) => {
          if (/^\s*(BEGIN|COMMIT|ROLLBACK)\b/i.test(text)) {
            await pg.exec(text)
            return { rows: [], rowCount: 0 }
          }
          // 迁移脚本是整份多语句 SQL。真实 pg 驱动走简单查询协议时允许一次发送多条语句，
          // pglite 的 query() 却会走扩展/预处理协议直接报
          // 「cannot insert multiple commands into a prepared statement」。
          // 无参数时统一走 exec()，与生产驱动的行为对齐。
          if (params.length === 0) {
            const results = await pg.exec(text)
            const last = results.at(-1)
            return { rows: (last?.rows ?? []) as never[], rowCount: last?.affectedRows ?? 0 }
          }
          return query(text, params)
        },
        release() {},
      }
    },
    async end() {
      await pg.close()
    },
  }

  return { db, applyMigrations, close: () => pg.close() }
}
