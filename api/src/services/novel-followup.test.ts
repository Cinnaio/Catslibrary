import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from '../test/db'
import { enqueueFollowup, finishFollowup, followupDelay, getFollowup, runFollowupTick, saveFollowup, bindFollowupSource } from './novel-followup'
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
  it('有效来源的连载作品默认开启，未配置作品不能开启', async () => {
    expect(await getFollowup(t.db, 'follow')).toMatchObject({ enabled: true, sourceUrl: 'https://example.com/book', failures: 0 })
    await expect(saveFollowup(t.db, 'unconfigured', true, 6)).rejects.toThrow('已配置')
    await expect(saveFollowup(t.db, 'done', true, 6)).rejects.toThrow('已配置')
    await expect(saveFollowup(t.db, 'follow', true, 2)).rejects.toThrow('频率')
  })
  it('TXT 绑定网页来源保持暂停和自定义频率，不改作品元数据或章节', async () => {
    await t.db.query(
      "INSERT INTO novels(id,title,author,source_url,created_at,updated_at) VALUES('txt-source','原书名','作者','https://original.example/book',1,1)",
    )
    await t.db.query("INSERT INTO novel_followups(novel_id,enabled,interval_hours,user_configured) VALUES('txt-source',FALSE,12,TRUE)")
    await t.db.query("UPDATE novels SET remote_chapter_count=99,source_chapter_snapshot='[]' WHERE id='txt-source'")
    await t.db.query("UPDATE novel_followups SET checked_at=1,result='failed',message='旧来源失败',failures=2 WHERE novel_id='txt-source'")
    await t.db.query(
      "INSERT INTO book_import_runs(id,target_novel_id,source_type,source_label,status,created_at,applied_at) VALUES('txt-run','txt-source','file','原书名.txt','applied',1,1)",
    )
    await bindFollowupSource(t.db, 'txt-source', 'https://czbooks.net/n/123')
    expect(await getFollowup(t.db, 'txt-source')).toMatchObject({ enabled: false, intervalHours: 12, hasConfig: true, importSourceLabel: '原书名.txt', remoteChapterCount: 0, checkedAt: 0, result: 'idle', failures: 0, pendingChapterCount: null })
    const novel = await t.db.query("SELECT title,author,source_url FROM novels WHERE id='txt-source'")
    expect(novel.rows[0]).toEqual({ title: '原书名', author: '作者', source_url: 'https://original.example/book' })
    expect((await t.db.query("SELECT * FROM chapters WHERE novel_id='txt-source'")).rows).toHaveLength(0)
    await saveFollowup(t.db, 'txt-source', true, 12)
    expect((await getFollowup(t.db, 'txt-source'))?.enabled).toBe(true)
  })
  it('未知站点要求明确规则，拒绝伪装域名与无效配置，并保留自定义编码', async () => {
    await expect(bindFollowupSource(t.db, 'unconfigured', 'https://czbooks.net.evil.example/n/123')).rejects.toThrow('暂无内置规则')
    await expect(bindFollowupSource(t.db, 'unconfigured', 'file:///secret')).rejects.toThrow('HTTP')
    await expect(bindFollowupSource(t.db, 'unconfigured', 'https://example.com/book', { chapterList: 'a' })).rejects.toThrow('选择器')
    await bindFollowupSource(t.db, 'unconfigured', 'https://example.com/book', { chapterList: 'a', chapterContent: '.body' }, 'gbk')
    expect(await getFollowup(t.db, 'unconfigured')).toMatchObject({ enabled: false, hasConfig: true, encoding: 'gbk' })
  })
  it('活动任务阻止改绑来源，原配置保持不变', async () => {
    await t.db.query("INSERT INTO novels(id,title,created_at,updated_at) VALUES('binding-busy','执行中',1,1)")
    await t.db.query("INSERT INTO scrape_jobs(id,novel_id,status,started_at,updated_at) VALUES('binding-job','binding-busy','starting',1,1)")
    await expect(bindFollowupSource(t.db, 'binding-busy', 'https://czbooks.net/n/123')).rejects.toThrow('正在执行')
    expect((await t.db.query("SELECT * FROM scrape_configs WHERE novel_id='binding-busy'")).rows).toHaveLength(0)
    await t.db.query("UPDATE scrape_jobs SET status='cancelled' WHERE id='binding-job'")
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
    expect(state?.failures).toBe(1)
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

  it('未安装旧书源时保留绑定、开关及历史，其他书源仍可调度', async () => {
    await t.db.query(`INSERT INTO novels(id,title,status,created_at,updated_at) VALUES
      ('legacy','旧书源作品','ongoing',1,1),('available','可用书源作品','ongoing',1,1)`)
    const selectors = { chapterList: 'a', chapterContent: 'article' }
    const sourceUrl = 'https://wap.po18x.vip/book/1/'
    await store.upsertScrapeConfig({ novelId: 'legacy', sourceUrl, selectors })
    await store.upsertScrapeConfig({ novelId: 'available', sourceUrl: 'https://example.com/book', selectors })
    await t.db.query(`INSERT INTO novel_followups (novel_id,enabled,interval_hours,next_check_at,user_configured,message)
      VALUES ('legacy',TRUE,12,0,TRUE,'此前更新成功'),('available',TRUE,6,1,TRUE,'')
      ON CONFLICT(novel_id) DO UPDATE SET enabled=EXCLUDED.enabled,interval_hours=EXCLUDED.interval_hours,
        next_check_at=EXCLUDED.next_check_at,user_configured=EXCLUDED.user_configured,message=EXCLUDED.message`)

    expect(await getFollowup(t.db, 'legacy')).toMatchObject({
      sourceUrl, enabled: true, intervalHours: 12, nextCheckAt: 0,
      blockedReason: 'source_unavailable', message: '书源未安装',
    })
    await expect(enqueueFollowup(t.db, 'legacy')).rejects.toThrow('书源未安装')
    const started: string[] = []
    await runFollowupTick(t.db, id => started.push(id))
    expect(started).toHaveLength(1)
    expect((await t.db.query('SELECT novel_id FROM scrape_jobs WHERE id=$1', [started[0]])).rows).toEqual([{ novel_id: 'available' }])
    expect((await t.db.query("SELECT message FROM novel_followups WHERE novel_id='legacy'")).rows).toEqual([{ message: '此前更新成功' }])
  })

  it('连续无更新降低频率，错误重试有上限', () => {
    expect(followupDelay(6, 7, 0)).toBe(12 * 3600000)
    expect(followupDelay(24, 100, 0)).toBe(7 * 86400000)
    expect(followupDelay(6, 0, 50)).toBe(6 * 3600000)
  })
})
