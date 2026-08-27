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

  it('updateJobProgress 不覆盖已取消的任务并返回 false（取消曾被整行 upsert 冲掉）', async () => {
    const now = Date.now()
    await store.saveJob({ id: 'job_cancel', novelId: 'n1', status: 'scraping_chapters', startedAt: now, updatedAt: now })

    expect(await store.updateJobProgress('job_cancel', { step: '第5/10章', current: 5, chapterCount: 5, progress: 0.5 })).toBe(true)

    await store.cancelJob('job_cancel')
    expect(await store.updateJobProgress('job_cancel', { step: '第10/10章', current: 10, chapterCount: 10, progress: 1 })).toBe(false)
    expect((await store.loadJob('job_cancel'))?.status).toBe('cancelled')
  })

  it('cancelJob 不改写已结束任务的最终状态', async () => {
    const now = Date.now()
    await store.saveJob({ id: 'job_done', novelId: 'n1', status: 'completed', startedAt: now, updatedAt: now })
    await store.cancelJob('job_done')
    expect((await store.loadJob('job_done'))?.status).toBe('completed')
  })

  it('保存并汇总公开章节与受保护正文数量', async () => {
    const now = Date.now()
    await store.saveJob({
      id: 'job_access_counts',
      novelId: 'n1',
      status: 'completed',
      total: 3,
      publicChapterCount: 2,
      protectedChapterCount: 1,
      startedAt: now,
      updatedAt: now,
    })

    const loaded = await store.loadJob('job_access_counts')
    expect(loaded?.publicChapterCount).toBe(2)
    expect(loaded?.protectedChapterCount).toBe(1)

    const summary = await store.getJobSummary('job_access_counts')
    expect(summary.publicChapterCount).toBe(2)
    expect(summary.protectedChapterCount).toBe(1)
  })
})
