import { afterAll, beforeAll, expect, it } from 'vitest'
import { createTestDb, type TestDb } from '../test/db'
import { PgScrapeStore } from './scraper/store'
import { saveBatchFollowups } from './novel-followup-batch'
import { getFollowup } from './novel-followup'
let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
  await t.applyMigrations()
  await t.db.query(`INSERT INTO novels (id,title,status,created_at,updated_at) VALUES
    ('ready','可追更','ongoing',1,1),('paused','原本暂停','ongoing',1,1),('done','完结作品','completed',1,1),('no-config','未配置','ongoing',1,1),('bad-config','无效配置','ongoing',1,1)`)
  const store = new PgScrapeStore(t.db)
  for (const id of ['ready', 'paused', 'done'])
    await store.upsertScrapeConfig({ novelId: id, sourceUrl: 'https://example.com/book', selectors: { chapterList: 'a', chapterContent: '.content' } })
  await store.upsertScrapeConfig({ novelId: 'bad-config', sourceUrl: 'https://example.com/book', selectors: { chapterList: 'a' } })
})
afterAll(async () => {
  await t.close()
})
it('开启只作用于有效连载作品，并逐本报告跳过原因，重复 ID 只设置一次', async () => {
  const result = await saveBatchFollowups(t.db, ['ready', 'ready', 'done', 'no-config', 'bad-config', 'deleted'], 'enable', 3)
  expect(result.saved).toBe(1)
  expect(result.skipped).toBe(4)
  expect(result.results.find((row) => row.novelId === 'done')?.reason).toContain('已完结')
  expect(result.results.find((row) => row.novelId === 'bad-config')?.reason).toContain('选择器')
  expect(await getFollowup(t.db, 'ready')).toMatchObject({ enabled: true, intervalHours: 3 })
  expect((await getFollowup(t.db, 'done'))?.enabled).toBe(false)
})
it('只修改频率不改变已开启或已暂停的开关', async () => {
  const result = await saveBatchFollowups(t.db, ['ready', 'paused'], 'frequency', 12)
  expect(result.saved).toBe(2)
  expect(await getFollowup(t.db, 'ready')).toMatchObject({ enabled: true, intervalHours: 12 })
  expect(await getFollowup(t.db, 'paused')).toMatchObject({ enabled: false, intervalHours: 12, nextCheckAt: 0 })
})
it('暂停允许完结或未配置作品，保留各自频率并清除调度', async () => {
  const result = await saveBatchFollowups(t.db, ['ready', 'paused', 'done', 'no-config'], 'pause')
  expect(result.saved).toBe(4)
  expect(await getFollowup(t.db, 'ready')).toMatchObject({ enabled: false, intervalHours: 12, nextCheckAt: 0 })
  expect(await getFollowup(t.db, 'no-config')).toMatchObject({ enabled: false, intervalHours: 6 })
})
it('拒绝非法参数，不能改变已有设置', async () => {
  await expect(saveBatchFollowups(t.db, [], 'enable', 6)).rejects.toThrow('请选择')
  await expect(saveBatchFollowups(t.db, Array(501).fill('ready'), 'enable', 6)).rejects.toThrow('500')
  await expect(saveBatchFollowups(t.db, ['ready'], 'enable', 2)).rejects.toThrow('频率')
  expect(await getFollowup(t.db, 'ready')).toMatchObject({ enabled: false, intervalHours: 12 })
})
