import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestDb, type TestDb } from '../../test/db'
import { PgScrapeStore } from './store'

describe('PgScrapeStore（pglite）', () => {
  let tdb: TestDb
  let store: PgScrapeStore

  beforeAll(async () => {
    tdb = await createTestDb()
    await tdb.applyMigrations()
    store = new PgScrapeStore(tdb.db)

    const now = Date.now()
    await tdb.db.query(
      `INSERT INTO novels (id, title, created_at, updated_at) VALUES ('n1', '测试书', $1, $1), ('n2', '空书', $1, $1)`,
      [now],
    )
    for (const [id, order] of [['c1', 3], ['c2', 7], ['c3', 5]] as const) {
      await tdb.db.query(
        `INSERT INTO chapters (id, novel_id, title, sort_order, created_at) VALUES ($1, 'n1', $2, $3, $4)`,
        [id, `第${order}章`, order, now],
      )
    }
  })

  afterAll(async () => {
    await tdb.close()
  })

  it('getMaxChapterOrder 返回最大 sort_order（曾因列别名大小写折叠恒返回 0，导致增量抓取章节撞号）', async () => {
    expect(await store.getMaxChapterOrder('n1')).toBe(7)
  })

  it('无章节的小说返回 0', async () => {
    expect(await store.getMaxChapterOrder('n2')).toBe(0)
    expect(await store.getMaxChapterOrder('不存在')).toBe(0)
  })
})
