import { expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFile, readdir } from 'node:fs/promises'
import { runMigrations } from '../db/migrate'
import type { Db } from '../db/pool'
import { pruneImportSnapshots } from './book-import-state'

it('已记账早期 054 且仍保留旧状态约束的数据库可升级并执行启动清理', async () => {
  const pg = new PGlite()
  const query: Db['query'] = async (sql, params) => {
    const results = params?.length ? [await pg.query(sql, params)] : await pg.exec(sql)
    const last = results.at(-1)
    return { rows: (last?.rows || []) as never[], rowCount: last?.affectedRows ?? 0 }
  }
  const db: Db = { query, connect: async () => ({ query, release() {} }), end: async () => {} }
  try {
    const dir = new URL('../db/migrations/', import.meta.url)
    await pg.exec(await readFile(new URL('038_book_import.sql', dir), 'utf8'))
    await pg.exec(await readFile(new URL('053_import_source_text.sql', dir), 'utf8'))
    // 早期 054 已执行并记账，后来修改同名 SQL 不会再执行。
    const early054 = (await readFile(new URL('054_import_review_state.sql', dir), 'utf8'))
      .split('\n')
      .filter((line) => !line.startsWith('ALTER TABLE book_import_runs ') || !line.includes('CONSTRAINT'))
      .join('\n')
    await pg.exec(early054)
    await pg.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL)')
    for (const file of (await readdir(dir)).filter((file) => file.endsWith('.sql') && Number.parseInt(file, 10) <= 54)) {
      await pg.query('INSERT INTO schema_migrations(version,name) VALUES ($1,$2)', [Number.parseInt(file, 10), file])
    }
    await pg.exec(`INSERT INTO book_import_runs(id,created_at,status,source_text,source_expires_at,changes_json,history_summary)
      VALUES ('expired-preview',1,'preview','原文',2,'[]','{"title":"历史摘要"}'),
             ('finished',1,'applied','原文',2,'[{"kind":"create-chapter"}]','{"title":"历史摘要"}')`)
    await expect(pg.query("UPDATE book_import_runs SET status='expired' WHERE id='expired-preview'")).rejects.toMatchObject({
      code: '23514',
      constraint: 'book_import_runs_status_check',
    })
    // 这个夹具从 038 起只建了导入相关的表，模拟的是「历史上只有部分表 + 记账到 054」的实例。
    // 真实 runMigrations 会从 001 一路补齐；这里只验证 054 之后的那份迁移，所以把
    // 055 之后的版本预登记为已应用，避免在缺表环境下重放 056+。
    const files = (await readdir(dir)).filter((file) => file.endsWith('.sql'))
    for (const file of files.filter((f) => Number.parseInt(f, 10) > 55)) {
      await pg.query('INSERT INTO schema_migrations(version,name) VALUES ($1,$2)', [Number.parseInt(file, 10), file])
    }
    await expect(runMigrations(db)).resolves.toContain('055_import_expired_status.sql')
    await expect(pruneImportSnapshots(db, 100)).resolves.toBe(2)
    const { rows } = await pg.query<{ id: string; status: string; source_text: string; changes_json: string; history_summary: string }>(
      'SELECT * FROM book_import_runs ORDER BY id',
    )
    expect(rows[0]).toMatchObject({ id: 'expired-preview', status: 'expired', source_text: '', history_summary: '{"title":"历史摘要"}' })
    expect(rows[1]).toMatchObject({ id: 'finished', status: 'applied', source_text: '', changes_json: '[{"kind":"create-chapter"}]' })
    await expect(runMigrations(db)).resolves.toEqual([])
  } finally {
    await pg.close()
  }
})
it('迁移存量导入记录时回填轻量摘要和保留期限，回滚正文原样保留', async () => {
  const pg = new PGlite()
  try {
    await pg.exec(await readFile(new URL('../db/migrations/038_book_import.sql', import.meta.url), 'utf8'))
    await pg.exec(await readFile(new URL('../db/migrations/053_import_source_text.sql', import.meta.url), 'utf8'))
    const changes = JSON.stringify([{ kind: 'create-chapter', after: { content: '用于回滚的正文' } }, { kind: 'update-chapter' }])
    await pg.query(
      "INSERT INTO book_import_runs(id, created_at, applied_at, status, preview_json, changes_json, source_text) VALUES ('legacy',100,200,'applied',$1,$2,'原文')",
      [JSON.stringify({ book: { title: '存量作品' }, summary: { conflictCount: 3 } }), changes],
    )
    await pg.exec(await readFile(new URL('../db/migrations/054_import_review_state.sql', import.meta.url), 'utf8'))
    const { rows } = await pg.query<{ history_summary: string; source_expires_at: number; changes_json: string; revision: number }>(
      "SELECT history_summary,source_expires_at,changes_json,revision FROM book_import_runs WHERE id='legacy'",
    )
    expect(JSON.parse(rows[0]!.history_summary)).toEqual({ title: '存量作品', conflicts: 3, created: 1, updated: 1 })
    expect(Number(rows[0]!.source_expires_at)).toBe(200 + 30 * 86400000)
    expect(rows[0]!.changes_json).toBe(changes)
    expect(rows[0]!.revision).toBe(0)
  } finally {
    await pg.close()
  }
})
