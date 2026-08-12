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

export async function createTestDb(): Promise<TestDb> {
  // pg_trgm：011 迁移的 trigram 索引依赖该扩展，测试库同样装载以覆盖真实路径
  const pg = new PGlite({ extensions: { pg_trgm } })

  const applyMigrations = async (): Promise<void> => {
    const files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith('.sql'))
      .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10))
    for (const f of files) {
      await pg.exec(await readFile(path.join(MIGRATIONS_DIR, f), 'utf8'))
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
