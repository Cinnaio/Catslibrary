import { expect, it } from 'vitest'
import { readdir } from 'node:fs/promises'
import { createTestDb } from '../test/db'
import { runMigrations } from '../db/migrate'
import { checkSupplementarySource, supplementaryOverview } from './supplementary-source'

it('已执行早期 059 的数据库升级后可以保存部分目录结果，而不是目录检查失败', async () => {
  const t = await createTestDb()
  try {
    await t.applyMigrations()
    await t.db.query('ALTER TABLE supplementary_sources DROP CONSTRAINT supplementary_sources_status_check')
    await t.db.query("ALTER TABLE supplementary_sources ADD CONSTRAINT supplementary_sources_status_check CHECK (status IN ('never','ok','error'))")
    await t.db.query('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY,name TEXT NOT NULL,applied_at TIMESTAMPTZ NOT NULL DEFAULT now())')
    for (const name of (await readdir(new URL('../db/migrations/', import.meta.url))).filter((n) => n.endsWith('.sql') && Number.parseInt(n, 10) <= 59)) {
      await t.db.query('INSERT INTO schema_migrations(version,name) VALUES ($1,$2)', [Number.parseInt(name, 10), name])
    }
    // 本夹具只建到 059 为止的表；把 060 之后的版本预登记，避免在缺表环境下重放 063+。
    for (const name of (await readdir(new URL('../db/migrations/', import.meta.url))).filter((n) => n.endsWith('.sql') && Number.parseInt(n, 10) > 60)) {
      await t.db.query('INSERT INTO schema_migrations(version,name) VALUES ($1,$2)', [Number.parseInt(name, 10), name])
    }
    await t.db.query(
      "INSERT INTO supplementary_sources(id,name,url,status,error) VALUES ('legacy-source','微博目录','https://dudu88.lanzov.com/bMonth','error','目录检查失败，请稍后重试')",
    )
    const scan: Parameters<typeof checkSupplementarySource>[2] = async (_url, _password, _request, failed) => {
      failed?.push('1015')
      return [
        { key: 'file', url: 'https://dudu88.lanzov.com/iFile', name: '山雨.txt', folder: '1016', size: '1 M', title: '山雨', author: '作者', revision: 2 },
      ]
    }
    await expect(checkSupplementarySource(t.db, 'legacy-source', scan)).rejects.toThrow('目录检查失败')
    await expect(runMigrations(t.db)).resolves.toContain('060_supplementary_source_partial_status.sql')
    await expect(checkSupplementarySource(t.db, 'legacy-source', scan)).resolves.toBeUndefined()
    const overview = await supplementaryOverview(t.db)
    expect(overview.sources[0]).toMatchObject({ id: 'legacy-source', status: 'partial', fileCount: 1 })
    expect(overview.sources[0]!.error).toContain('1015')
    await expect(runMigrations(t.db)).resolves.toEqual([])
  } finally {
    await t.close()
  }
})
