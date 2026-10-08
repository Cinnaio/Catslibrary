import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from '../test/db'
import { enqueueFollowup, finishFollowup, followupDelay, getFollowup, runFollowupTick, saveFollowup } from './novel-followup'
import { PgScrapeStore } from './scraper/store'
import { runScrapeJob } from './scraper/engine'

describe('连载追更', () => {
  let t: TestDb
  let store: PgScrapeStore
  beforeAll(async () => {
    t = await createTestDb()
    await t.applyMigrations()
    store = new PgScrapeStore(t.db)
    await t.db.query(
      "INSERT INTO novels (id,title,status,created_at,updated_at) VALUES ('follow','追更测试','ongoing',1,1),('done','完结','completed',1,1),('unconfigured','未配置','ongoing',1,1)",
    )
    await store.upsertScrapeConfig({ novelId: 'follow', sourceUrl: 'https://example.com/book', selectors: { chapterList: 'a', chapterContent: '.content' } })
  })
  afterAll(async () => {
    await t.close()
  })
  const fetches: string[] = []
  const deps = () => ({
    store,
    log: () => {},
    fetchHtml: async (url: string) => {
      fetches.push(url)
      return {
        encoding: 'utf-8',
        html: url.endsWith('/book') ? '<a href="/chapter-1">第一章</a>' : `<div class="content">${'这是足够长的小说正文。'.repeat(20)}</div>`,
      }
    },
  })
  it('默认关闭，拒绝未配置及已完结作品开启', async () => {
    expect((await getFollowup(t.db, 'follow'))?.enabled).toBe(false)
    await expect(saveFollowup(t.db, 'unconfigured', true, 6)).rejects.toThrow('已配置')
    await expect(saveFollowup(t.db, 'done', true, 6)).rejects.toThrow('连载')
    await expect(saveFollowup(t.db, 'follow', true, 2)).rejects.toThrow('频率')
  })
  it('保存频率，到期创建任务；再次手动更新复用活动任务', async () => {
    await saveFollowup(t.db, 'follow', true, 6)
    const started: string[] = []
    await runFollowupTick(t.db, (id) => started.push(id))
    expect(started).toHaveLength(0)
    await t.db.query("UPDATE novel_followups SET next_check_at=0 WHERE novel_id='follow'")
    await runFollowupTick(t.db, (id) => started.push(id))
    expect(started).toHaveLength(1)
    const duplicate = await enqueueFollowup(t.db, 'follow')
    expect(duplicate).toEqual({ jobId: started[0], started: false })
    await runScrapeJob(started[0]!, deps())
    await finishFollowup(t.db, started[0]!)
    expect(await getFollowup(t.db, 'follow')).toMatchObject({ result: 'updated', addedCount: 1 })
    expect(fetches).toHaveLength(2)
  })
  it('没有新增章节只取目录，并准确展示暂无新章', async () => {
    fetches.length = 0
    const job = await enqueueFollowup(t.db, 'follow')
    await runScrapeJob(job.jobId, deps())
    await finishFollowup(t.db, job.jobId)
    expect(fetches).toEqual(['https://example.com/book'])
    expect(await getFollowup(t.db, 'follow')).toMatchObject({ result: 'no_change', message: '暂无新章' })
    await finishFollowup(t.db, job.jobId)
    const rows = await t.db.query<{ empty_checks: number }>("SELECT empty_checks FROM novel_followups WHERE novel_id='follow'")
    expect(rows.rows[0]!.empty_checks).toBe(1)
  })
  it('失败不显示无更新，安排重试；暂停后不再启动定时任务', async () => {
    const job = await enqueueFollowup(t.db, 'follow')
    await runScrapeJob(job.jobId, {
      ...deps(),
      fetchHtml: async () => {
        throw new Error('源站不可达')
      },
    })
    await finishFollowup(t.db, job.jobId)
    const state = await getFollowup(t.db, 'follow')
    expect(state?.result).toBe('failed')
    expect(state?.message).toContain('源站不可达')
    expect(state!.nextCheckAt - state!.checkedAt).toBe(900000)
    await saveFollowup(t.db, 'follow', false, 6)
    await t.db.query("UPDATE novel_followups SET next_check_at=0 WHERE novel_id='follow'")
    const started: string[] = []
    await runFollowupTick(t.db, (id) => started.push(id))
    expect(started).toHaveLength(0)
  })
  it('长期无进度的任务回收为失败，允许重试', async () => {
    const job = await enqueueFollowup(t.db, 'follow')
    await t.db.query('UPDATE scrape_jobs SET updated_at=1 WHERE id=$1', [job.jobId])
    await runFollowupTick(t.db, () => {})
    expect((await getFollowup(t.db, 'follow'))?.result).toBe('failed')
    expect((await enqueueFollowup(t.db, 'follow')).started).toBe(true)
  })
  it('连续无更新降低频率，错误重试有上限', () => {
    expect(followupDelay(6, 7, 0)).toBe(12 * 3600000)
    expect(followupDelay(24, 100, 0)).toBe(7 * 86400000)
    expect(followupDelay(6, 0, 50)).toBe(6 * 3600000)
  })
})
