import { afterAll, beforeAll, expect, it } from 'vitest'
import { createTestDb, type TestDb } from '../test/db'
import { applyFollowupDefaults } from './novel-followup-defaults'
import { enqueueFollowup, getFollowup, saveFollowup } from './novel-followup'
import { saveBatchFollowups } from './novel-followup-batch'
import { PgScrapeStore } from './scraper/store'

let t: TestDb
let store: PgScrapeStore
const config = (novelId: string) => ({ novelId, sourceUrl: 'https://example.com/book', selectors: { chapterList: 'a', chapterContent: '.body' } })
beforeAll(async () => {
  t = await createTestDb()
  await t.applyMigrations()
  store = new PgScrapeStore(t.db)
  await t.db.query(`INSERT INTO novels(id,title,status,created_at,updated_at) VALUES
    ('old','旧书','ongoing',1,1),('new','新书','ongoing',1,1),('done','完结','completed',1,1),
    ('missing','无来源','ongoing',1,1),('bad','损坏配置','ongoing',1,1)`)
  // 模拟升级前的暂停记录及自定义频率，不经过新默认策略。
  await t.db.query("INSERT INTO novel_followups(novel_id,enabled,interval_hours) VALUES('old',FALSE,12)")
  await t.db.query(
    `INSERT INTO scrape_configs(novel_id,source_url,selectors,updated_at) VALUES
    ('old','https://example.com/book',$1,1),('bad','https://example.com/book','invalid-json',1)`,
    [JSON.stringify(config('old').selectors)],
  )
})
afterAll(async () => {
  await t.close()
})

it('旧书按默认策略开启并保留自定义频率，重复应用不重置下次时间', async () => {
  await applyFollowupDefaults(t.db)
  const state = await getFollowup(t.db, 'old')
  expect(state).toMatchObject({ enabled: true, intervalHours: 12 })
  expect(state!.nextCheckAt).toBeGreaterThan(Date.now())
  await applyFollowupDefaults(t.db)
  expect((await getFollowup(t.db, 'old'))!.nextCheckAt).toBe(state!.nextCheckAt)
})
it('新书配置来源后立即默认开启，每六小时检查；完结与无效来源不启用', async () => {
  await store.upsertScrapeConfig(config('new'))
  await store.upsertScrapeConfig(config('done'))
  expect(await getFollowup(t.db, 'new')).toMatchObject({ enabled: true, intervalHours: 6 })
  for (const id of ['done', 'missing', 'bad']) expect(await getFollowup(t.db, id)).toMatchObject({ enabled: false, nextCheckAt: 0 })
})
it('补充来源后开启；自动策略下改为完结暂停，恢复连载重新启用', async () => {
  await store.upsertScrapeConfig(config('missing'))
  expect((await getFollowup(t.db, 'missing'))!.enabled).toBe(true)
  await t.db.query("UPDATE novels SET status='completed' WHERE id='missing'")
  expect(await getFollowup(t.db, 'missing')).toMatchObject({ enabled: false, nextCheckAt: 0 })
  await t.db.query("UPDATE novels SET status='ongoing' WHERE id='missing'")
  expect((await getFollowup(t.db, 'missing'))!.enabled).toBe(true)
})
it('单本与批量手动暂停后，重读来源及默认策略不能覆盖偏好', async () => {
  await saveFollowup(t.db, 'new', false, 3)
  await saveBatchFollowups(t.db, ['old'], 'pause')
  await store.upsertScrapeConfig(config('new'))
  await store.upsertScrapeConfig(config('old'))
  await applyFollowupDefaults(t.db)
  expect(await getFollowup(t.db, 'new')).toMatchObject({ enabled: false, intervalHours: 3, nextCheckAt: 0 })
  expect(await getFollowup(t.db, 'old')).toMatchObject({ enabled: false, intervalHours: 12, nextCheckAt: 0 })
})
it('无效链接或空选择器不默认开启，手动开启也被拒绝', async () => {
  await store.upsertScrapeConfig({ ...config('missing'), sourceUrl: 'javascript:alert(1)' })
  expect(await getFollowup(t.db, 'missing')).toMatchObject({ enabled: false, hasConfig: false })
  await expect(saveFollowup(t.db, 'missing', true, 6)).rejects.toThrow('已配置')
  await store.upsertScrapeConfig({ ...config('missing'), selectors: { chapterList: ' ', chapterContent: '.body' } })
  expect((await getFollowup(t.db, 'missing'))!.enabled).toBe(false)
})
it('导入或新建作品仅有已支持站点链接时补齐配置，未知来源不猜测规则', async () => {
  await t.db.query(`INSERT INTO novels(id,title,status,source_url,created_at,updated_at) VALUES
    ('imported','网页导入','ongoing','https://czbooks.net/n/test',1,1),
    ('unknown','未知来源','ongoing','https://unknown.example/book/1',1,1)`)
  expect(await getFollowup(t.db, 'imported')).toMatchObject({ enabled: true, hasConfig: true, intervalHours: 6 })
  expect(await getFollowup(t.db, 'unknown')).toMatchObject({ enabled: false, hasConfig: false })
  const config = await store.getScrapeConfig('imported')
  expect(config?.selectors.chapterContent).toBe('.content')
})
it('完结作品默认关闭，但有配置时允许单本手动开启并执行定时检查', async () => {
  await saveFollowup(t.db, 'done', true, 3)
  await applyFollowupDefaults(t.db)
  expect(await getFollowup(t.db, 'done')).toMatchObject({ enabled: true, intervalHours: 3 })
  await t.db.query("UPDATE novel_followups SET next_check_at=0 WHERE novel_id='done'")
  expect(await enqueueFollowup(t.db, 'done', true)).toMatchObject({ started: true })
})
