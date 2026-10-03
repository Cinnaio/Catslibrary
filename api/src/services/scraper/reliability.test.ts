import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from '../../test/db'
import { PgScrapeStore, type JobData } from './store'
import { runScrapeJob, type ScrapeDeps } from './engine'

let t: TestDb
let store: PgScrapeStore
let sequence = 0
let novelId: string
const sourceUrl = 'https://fixture.example/book'
const selectors = { chapterList: '#list a', chapterTitle: 'h1', chapterContent: '#content' }
const listHtml = '<div id="list"><a href="/chapter/1">第一章</a><a href="/chapter/2">第二章</a></div>'
const contentHtml = '<h1>章节标题</h1><div id="content">' + '这是用于验证提交结果的小说正文。'.repeat(12) + '</div>'
beforeAll(async () => { t = await createTestDb(); await t.applyMigrations(); store = new PgScrapeStore(t.db) })
afterAll(async () => { await t.close() })
afterEach(() => { vi.restoreAllMocks() })
beforeEach(async () => {
  novelId = 'reliable-' + ++sequence
  await t.db.query('INSERT INTO novels (id,title,created_at,updated_at) VALUES ($1,$1,1,1)', [novelId])
  await store.upsertScrapeConfig({ novelId, sourceUrl, selectors })
})
async function job(suffix = '', extra: Partial<JobData> = {}) {
  const value: JobData = { id: novelId + suffix, novelId, status: 'starting', startedAt: Date.now(), ...extra }
  await store.saveJob(value); return value
}
function deps(): ScrapeDeps {
  return { store, log: () => {}, fetchHtml: async url => ({ html: url === sourceUrl ? listHtml : contentHtml, encoding: 'utf-8' }) }
}
async function chapterCount() { return Number((await t.db.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM chapters WHERE novel_id=$1', [novelId])).rows[0]?.count) }
it('落库失败不能标记成功，失败项可以被重试', async () => {
  const j = await job()
  vi.spyOn(store, 'batchInsertChapters').mockRejectedValueOnce(new Error('fixture database write failure'))
  await runScrapeJob(j.id, deps())
  expect(await chapterCount()).toBe(0)
  expect((await store.loadJob(j.id))?.status).toBe('failed')
  expect((await store.getJobSummary(j.id)).successCount).toBe(0)
  expect((await store.getJobSummary(j.id)).failedCount).toBe(2)
  const failed = await store.getJobItems(j.id, { status: 'failed' })
  const retry = await job('-retry-failed', { retrySourceJobId: j.id, retryLinks: failed.map(item => ({ href: item.chapterUrl, text: item.chapterTitle, order: item.order })) })
  await runScrapeJob(retry.id, deps())
  expect((await store.loadJob(retry.id))?.status).toBe('completed')
  expect(await chapterCount()).toBe(2)
})
it('事务提交前，章节项不能提前标为 saved', async () => {
  const j = await job()
  const original = store.batchInsertChapters.bind(store)
  let beforeCommit: string[] = []
  vi.spyOn(store, 'batchInsertChapters').mockImplementation(async (...args) => {
    beforeCommit = (await store.getJobItems(j.id)).map(item => item.status)
    return original(...args)
  })
  await runScrapeJob(j.id, deps())
  expect(beforeCommit).not.toContain('saved')
  expect((await store.getJobSummary(j.id)).successCount).toBe(2)
  expect((await store.loadJob(j.id))?.status).toBe('completed')
})
it('普通任务重新抓取同一目录不会重复章节或改变已有章节 ID', async () => {
  await runScrapeJob((await job()).id, deps())
  expect((await store.loadJob(novelId))?.status).toBe('completed')
  const before = await t.db.query('SELECT id FROM chapters WHERE novel_id=$1 ORDER BY id', [novelId])
  await runScrapeJob((await job('-retry')).id, deps())
  expect(await chapterCount()).toBe(2)
  expect((await t.db.query('SELECT id FROM chapters WHERE novel_id=$1 ORDER BY id', [novelId])).rows).toEqual(before.rows)
})
it('目录请求期间取消后，旧阶段响应不能覆盖取消或继续插入章节', async () => {
  const j = await job()
  const d = deps()
  const fetch = d.fetchHtml
  d.fetchHtml = async (...args) => { await store.cancelJob(j.id); return fetch(...args) }
  await runScrapeJob(j.id, d)
  expect((await store.loadJob(j.id))?.status).toBe('cancelled')
  expect(await chapterCount()).toBe(0)
})
it('正文请求期间取消后，尚未提交的章节不能继续保存', async () => {
  const j = await job()
  const d = deps(); const fetch = d.fetchHtml
  d.fetchHtml = async (...args) => { if (args[0] !== sourceUrl) await store.cancelJob(j.id); return fetch(...args) }
  await runScrapeJob(j.id, d)
  expect((await store.loadJob(j.id))?.status).toBe('cancelled')
  expect(await chapterCount()).toBe(0)
})
it('保存旧任务快照不能覆盖已经取消的状态', async () => {
  const j = await job()
  await store.cancelJob(j.id)
  await store.saveJob({ ...j, status: 'extracting_links' })
  expect((await store.loadJob(j.id))?.status).toBe('cancelled')
})

it('第二批落库失败时保留第一批，成功数、章节数与任务汇总一致', async () => {
  const j = await job('', { localMode: true })
  const original = store.batchInsertChapters.bind(store)
  let calls = 0
  vi.spyOn(store, 'batchInsertChapters').mockImplementation(async (...args) => {
    if (++calls === 2) throw new Error('second batch failed')
    return original(...args)
  })
  const d = deps()
  d.fetchHtml = async url => ({ html: url === sourceUrl ? '<div id="list">' + Array.from({ length: 12 }, (_, i) => `<a href="/chapter/${i + 1}">第${i + 1}章</a>`).join('') + '</div>' : contentHtml, encoding: 'utf-8' })
  await runScrapeJob(j.id, d)
  const saved = await chapterCount()
  const result = await store.loadJob(j.id)
  const summary = await store.getJobSummary(j.id)
  expect(result?.status).toBe('partial')
  expect(saved).toBe(10)
  expect(result?.chapterCount).toBe(saved)
  expect(summary.successCount).toBe(saved)
  expect(summary.failedCount).toBe(2)
  expect(result?.step).toContain('second batch failed')
})

it('同批第二章失败时，第一章和其 saved 状态也一起回滚', async () => {
  const j = await job()
  const urls = ['https://fixture.example/chapter/1', 'https://fixture.example/chapter/2']
  await store.replaceJobItems(j.id, urls.map(href => ({ href, text: '章' })))
  const chapters = urls.map((sourceUrl, i) => ({ id: 'same-primary-key', sourceUrl, title: '章', content: '正文', order: i + 1, wordCount: 2, createdAt: 1 }))
  await expect(store.batchInsertChapters(novelId, chapters, j.id)).rejects.toThrow()
  expect(await chapterCount()).toBe(0)
  expect((await store.getJobSummary(j.id)).successCount).toBe(0)
  expect((await store.getJobSummary(j.id)).pendingCount).toBe(2)
  expect((await store.loadJob(j.id))?.chapterCount).toBe(0)
})

it('取消保留已经提交的批次，但禁止提交余下缓冲章节', async () => {
  const j = await job('', { localMode: true })
  const original = store.batchInsertChapters.bind(store)
  vi.spyOn(store, 'batchInsertChapters').mockImplementation(async (...args) => {
    const result = await original(...args)
    if (result.insertedUrls.length) await store.cancelJob(j.id)
    return result
  })
  const d = deps()
  d.fetchHtml = async url => ({ html: url === sourceUrl ? '<div id="list">' + Array.from({ length: 12 }, (_, i) => `<a href="/chapter/${i + 1}">第${i + 1}章</a>`).join('') + '</div>' : contentHtml, encoding: 'utf-8' })
  await runScrapeJob(j.id, d)
  expect((await store.loadJob(j.id))?.status).toBe('cancelled')
  expect(await chapterCount()).toBe(10)
  expect((await store.loadJob(j.id))?.chapterCount).toBe(10)
  expect((await store.getJobSummary(j.id)).successCount).toBe(10)
})

it('目录检查错过已有 URL 时，事务内仍去重，保留原正文和 ID', async () => {
  await runScrapeJob((await job()).id, deps())
  const before = await t.db.query('SELECT id,content,sort_order FROM chapters WHERE novel_id=$1 ORDER BY id', [novelId])
  vi.spyOn(store, 'getExistingChapterKeys').mockResolvedValue({ urls: new Set(), titles: new Set() })
  const retry = await job('-stale-read')
  await runScrapeJob(retry.id, deps())
  expect((await t.db.query('SELECT id,content,sort_order FROM chapters WHERE novel_id=$1 ORDER BY id', [novelId])).rows).toEqual(before.rows)
  expect((await store.getJobSummary(retry.id)).skippedCount).toBe(2)
  expect((await store.loadJob(retry.id))?.chapterCount).toBe(0)
})

it('中间章节失败后重试补回原目录位置，不追加到末尾', async () => {
  const first = await job()
  const d = deps()
  d.fetchHtml = async url => ({ html: url.endsWith('/chapter/1') ? '<h1>短章</h1><div id="content">短正文</div>' : url === sourceUrl ? listHtml : contentHtml, encoding: 'utf-8' })
  await runScrapeJob(first.id, d)
  expect((await store.loadJob(first.id))?.status).toBe('partial')
  const failed = await store.getJobItems(first.id, { status: 'failed' })
  const retry = await job('-middle', { retryLinks: failed.map(item => ({ href: item.chapterUrl, order: item.order })) })
  await runScrapeJob(retry.id, deps())
  const rows = (await t.db.query<{ source_url: string; sort_order: number }>('SELECT source_url,sort_order FROM chapters WHERE novel_id=$1 ORDER BY sort_order', [novelId])).rows
  expect(rows.map(row => [row.source_url, row.sort_order])).toEqual([['https://fixture.example/chapter/1', 1], ['https://fixture.example/chapter/2', 2]])
})

it('已结束、已取消和已删除的任务均不能被阶段或进度更新复活', async () => {
  for (const status of ['completed', 'partial', 'failed', 'cancelled']) {
    const j = await job('-' + status, { status })
    expect(await store.saveJob({ ...j, status: 'preflight' }, true)).toBe(false)
    expect(await store.updateJobProgress(j.id, { current: 1, chapterCount: 1, progress: 1, step: '旧进度' })).toBe(false)
    expect(await store.updateLocalJobStatus(j.id, { status: 'scraping_chapters' })).toBe(false)
    expect((await store.loadJob(j.id))?.status).toBe(status)
  }
  const deleted = await job('-deleted')
  await t.db.query('DELETE FROM scrape_jobs WHERE id=$1', [deleted.id])
  expect(await store.saveJob({ ...deleted, status: 'failed' }, true)).toBe(false)
  await runScrapeJob(deleted.id, deps())
  expect(await store.loadJob(deleted.id)).toBeNull()
})

it('已提交批次的成功数不会被迟到的进度或失败快照回退', async () => {
  const j = await job('-late-count')
  const url = 'https://fixture.example/chapter/1'
  await store.replaceJobItems(j.id, [{ href: url, text: '章', order: 1 }])
  await store.batchInsertChapters(novelId, [{ id: 'late-count-chapter', sourceUrl: url, title: '章', content: '正文', order: 1, wordCount: 2, createdAt: 1 }], j.id)
  await store.updateJobProgress(j.id, { step: '旧进度', current: 1, chapterCount: 0, progress: 1 })
  expect((await store.loadJob(j.id))?.chapterCount).toBe(1)
  await store.saveJob({ ...j, status: 'failed', chapterCount: 0 }, true)
  expect((await store.loadJob(j.id))?.chapterCount).toBe(1)
  expect((await store.getJobSummary(j.id)).successCount).toBe(1)
})
