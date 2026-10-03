import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
const fixtures = vi.hoisted(() => ({ failFirst: false }))
vi.mock('../services/scraper/fetch', async importOriginal => ({
  ...await importOriginal<typeof import('../services/scraper/fetch')>(),
  fetchHtml: async (url: string) => ({
    html: url.endsWith('/book') ? '<div id="list"><a href="/c1">第一章</a><a href="/c2">第二章</a></div>'
      : '<h1>章节</h1><div id="content">' + (fixtures.failFirst && url.endsWith('/c1') ? '短正文' : '用于完整接口回归的正文内容。'.repeat(12)) + '</div>',
    encoding: 'utf-8',
  }),
}))
import { app } from '../app'
import { createTestDb, type TestDb } from '../test/db'
import { setDbForTests } from '../db/pool'
let t: TestDb
let token: string
const previousDatabaseUrl = process.env.DATABASE_URL
beforeAll(async () => {
  t = await createTestDb(); await t.applyMigrations(); setDbForTests(t.db)
  process.env.DATABASE_URL = 'postgres://test/test'
  const response = await app.request('/api/auth/bootstrap-admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'scrape-reliability', password: 'adminpass123' }) })
  expect(response.status).toBe(201)
  token = ((await response.json()) as { token: string }).token
})
afterAll(async () => {
  setDbForTests(null)
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL
  else process.env.DATABASE_URL = previousDatabaseUrl
  await t.close()
})
afterEach(() => { vi.restoreAllMocks(); fixtures.failFirst = false })
const selectors = { chapterList: '#list a', chapterTitle: 'h1', chapterContent: '#content' }
async function action(body: Record<string, unknown>) {
  return app.request('/api/scrape', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) })
}
interface Status { status: string; chapterCount: number; retrySourceJobId: string; summary: { successCount: number; failedCount: number; skippedCount: number } }
async function waitJob(jobId: string): Promise<Status> {
  let result!: Status
  await vi.waitFor(async () => {
    const response = await app.request(`/api/scrape?action=job-status&jobId=${encodeURIComponent(jobId)}`, { headers: { Authorization: `Bearer ${token}` } })
    expect(response.status).toBe(200)
    result = await response.json() as Status
    expect(['completed', 'partial', 'failed', 'cancelled']).toContain(result.status)
  }, { timeout: 10000, interval: 10 })
  return result
}
async function newNovel(id: string) { await t.db.query('INSERT INTO novels (id,title,created_at,updated_at) VALUES ($1,$1,1,1)', [id]) }
it('开始→真实引擎→任务状态→普通重试：不重复入库，API 成功数与数据库一致', async () => {
  await newNovel('route-reliable')
  vi.spyOn(Date, 'now').mockReturnValue(10000000)
  const response = await action({ action: 'start', novelId: 'route-reliable', sourceUrl: 'https://fixture.example/book', selectors })
  expect(response.status).toBe(202)
  const { jobId } = await response.json() as { jobId: string }
  const first = await waitJob(jobId)
  expect(first.status).toBe('completed')
  expect(first.chapterCount).toBe(2)
  expect(first.summary.successCount).toBe(2)
  const retryResponse = await action({ action: 'retry', jobId })
  expect(retryResponse.status).toBe(202)
  const retry = await retryResponse.json() as { jobId: string }
  expect(retry.jobId).not.toBe(jobId)
  const second = await waitJob(retry.jobId)
  expect(second.status).toBe('completed')
  expect(second.chapterCount).toBe(0)
  expect(second.summary.successCount).toBe(0)
  expect(second.retrySourceJobId).toBe(jobId)
  const count = await t.db.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM chapters WHERE novel_id=$1', ['route-reliable'])
  expect(count.rows[0]?.count).toBe(2)
})
it('部分失败→重试失败章节→状态重新读取：只补失败章，顺序正确', async () => {
  await newNovel('route-partial'); fixtures.failFirst = true
  const response = await action({ action: 'start', novelId: 'route-partial', sourceUrl: 'https://fixture.example/book', selectors })
  const { jobId } = await response.json() as { jobId: string }
  const first = await waitJob(jobId)
  expect(first.status).toBe('partial')
  expect(first.summary.successCount).toBe(1)
  expect(first.summary.failedCount).toBe(1)
  fixtures.failFirst = false
  const retryResponse = await action({ action: 'retry-failed', jobId })
  expect(retryResponse.status).toBe(202)
  const retry = await retryResponse.json() as { jobId: string }
  const done = await waitJob(retry.jobId)
  expect(done.status).toBe('completed')
  expect(done.chapterCount).toBe(1)
  expect(done.summary.successCount).toBe(1)
  const chapters = (await t.db.query<{ source_url: string; sort_order: number }>('SELECT source_url,sort_order FROM chapters WHERE novel_id=$1 ORDER BY sort_order', ['route-partial'])).rows
  expect(chapters.map(row => [row.source_url, row.sort_order])).toEqual([['https://fixture.example/c1', 1], ['https://fixture.example/c2', 2]])
})
