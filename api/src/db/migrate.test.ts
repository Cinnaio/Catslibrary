import { describe, it, expect } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runMigrations } from './migrate'
import type { Db } from './pool'

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations')

/**
 * pglite 适配器：无参数语句走 exec（支持多语句迁移文件），
 * 参数化语句走 query（extended protocol）。
 */
function pgliteMigrationDb(pg: PGlite): Pick<Db, 'query' | 'connect'> {
  const query = async <T = unknown>(text: string, params: unknown[] = []) => {
    if (params.length > 0) {
      const res = await pg.query(text, params)
      return { rows: res.rows as T[], rowCount: res.affectedRows ?? res.rows.length }
    }
    const results = await pg.exec(text)
    const last = results[results.length - 1]
    return { rows: (last?.rows ?? []) as T[], rowCount: last?.affectedRows ?? last?.rows?.length ?? 0 }
  }
  return {
    query,
    async connect() {
      return { query, release() {} }
    },
  }
}

/** 走真实的 runMigrations 记账逻辑（migrations.test.ts 只裸执行 SQL，覆盖不到迁移器本身）。 */
describe('迁移器 runMigrations', () => {
  it('全新数据库：所有迁移各应用一次且记账完整，重复执行为空操作', async () => {
    const pg = new PGlite()
    const db = pgliteMigrationDb(pg)

    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql'))

    // 曾因两个 006_*.sql 版本号冲突在此处抛主键冲突，导致全新安装失败
    const applied = await runMigrations(db)
    expect(applied).toHaveLength(files.length)
    expect(new Set(applied)).toEqual(new Set(files))

    const { rows } = await db.query<{ version: number; name: string }>(
      'SELECT version, name FROM schema_migrations ORDER BY version',
    )
    expect(rows).toHaveLength(files.length)
    expect(new Set(rows.map((r) => r.version)).size).toBe(files.length)

    // 重命名后的 010 实际生效：connectivity 列存在
    const { rows: cols } = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'scrape_sources' AND column_name = 'connectivity'`,
    )
    expect(cols).toHaveLength(1)

    const second = await runMigrations(db)
    expect(second).toHaveLength(0)

    await pg.close()
  })

  it('历史库已按旧版本号记账时，幂等迁移跳过已建对象不报错', async () => {
    const pg = new PGlite()
    const db = pgliteMigrationDb(pg)

    // 模拟旧库：010 的内容曾以版本 6 记账并实际建列（006 时代的 scrape_source_connectivity）
    const preApplied = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql') && Number.parseInt(f, 10) <= 9)
    for (const f of preApplied) {
      await pg.exec(await readFile(path.join(MIGRATIONS_DIR, f), 'utf8'))
    }
    await pg.exec(`CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`)
    for (const f of preApplied) {
      await pg.query('INSERT INTO schema_migrations (version, name) VALUES ($1, $2)', [Number.parseInt(f, 10), f])
    }
    // 旧库中 connectivity 列已由 006 时代建出
    await pg.exec(`ALTER TABLE scrape_sources ADD COLUMN connectivity TEXT NOT NULL DEFAULT 'unknown'`)
    await pg.exec(`ALTER TABLE scrape_sources ADD COLUMN connectivity_checked_at BIGINT NOT NULL DEFAULT 0`)
    await pg.exec(`ALTER TABLE scrape_sources ADD COLUMN connectivity_error TEXT NOT NULL DEFAULT ''`)
    await pg.exec(`CREATE INDEX idx_scrape_sources_connectivity ON scrape_sources(connectivity)`)

    const applied = await runMigrations(db)
    expect(applied).toEqual(['010_scrape_source_connectivity.sql'])

    await pg.close()
  })

  it('迁移版本号冲突时在执行任何 SQL 前直接报错', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'zz-migrate-'))
    try {
      await writeFile(path.join(dir, '001_a.sql'), 'CREATE TABLE t_a (id INTEGER);\n')
      await writeFile(path.join(dir, '001_b.sql'), 'CREATE TABLE t_b (id INTEGER);\n')

      const pg = new PGlite()
      const db = pgliteMigrationDb(pg)
      await expect(runMigrations(db, dir)).rejects.toThrow(/版本号冲突/)

      // fail-fast：冲突文件的 SQL 不应被执行
      const { rows } = await db.query<{ tablename: string }>(
        `SELECT tablename FROM pg_tables WHERE tablename IN ('t_a', 't_b')`,
      )
      expect(rows).toHaveLength(0)
      await pg.close()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
