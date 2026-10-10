import { expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
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
