import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from '../../test/db'
import { createAnalysis, editAnalysis, readAnalysis } from './novel-analysis-store'
import { createAnalysisReview, runAnalysisReview, stopAnalysisReview, applyAnalysisFinding } from './novel-analysis-review'
import { runNovelAnalysis } from './novel-analysis'
import { AiError, chat, type AiChatResult } from './client'
import { getAiTask } from './tasks'
import { getAnalysisReferences, readAnalysisReference, formatAnalysisReferences } from './analysis-reference'
import { createAgentSession } from './agent-store'
import { readAgentAnalysis } from './agent-retrieval'
import { app } from '../../app'
import { setDbForTests } from '../../db/pool'
import { createSession } from '../sessions'
import { loadConfig } from '../../config'

vi.mock('./client', async original => ({ ...(await original<typeof import('./client')>()), isTextAiConfigured: () => true, chat: vi.fn() }))

let t: TestDb, reportId: string, revision: number
const source = '青遥担心父母看到信，立刻关上抽屉。'
const original = '父母在场看到青遥收信。[[S1]]'
const corrected = '青遥担心父母看到信，关上了抽屉。[[S1]]'
const answer = (text: string): AiChatResult => ({ text, model: 'test', promptTokens: 10, completionTokens: 20, cost: 0, tokenUsageReported: true, finishReason: 'stop' })
const result = () => answer(JSON.stringify({ checkedSegmentIds: ['P0'], findings: [{ segmentId: 'P0', original, kind: 'inference', explanation: '担心不代表已被看见', suggestion: corrected, evidence: [{ sourceId: 'S1', quote: source }] }] }))
const create = (id = 'review-request-001') => createAnalysisReview(t.db, 'admin', 'book', reportId, id, revision)
beforeAll(async () => { t = await createTestDb(); await t.applyMigrations() })
beforeEach(async () => {
  await t.db.query('DELETE FROM ai_agent_sessions')
  await t.db.query('DELETE FROM novels')
  await t.db.query('DELETE FROM ai_tasks')
  await t.db.query('DELETE FROM ai_usage')
  await t.db.query("INSERT INTO users(id,username,role,password_hash,password_salt,created_at,updated_at) VALUES('admin','admin','admin','x','x',1,1) ON CONFLICT DO NOTHING")
  await t.db.query("INSERT INTO novels(id,title,created_at,updated_at) VALUES('book','测试',1,1),('other','外书',1,1)")
  await t.db.query("INSERT INTO chapters(id,novel_id,title,content,sort_order,created_at) VALUES('c1','book','第一章',$1,1,1),('c2','book','第二章','父母那时在邻镇，晚上才回来。',2,1)", [source])
  const receipt = await createAnalysis(t.db, 'admin', 'book', { kind: 'characters', startChapterId: 'c1', endChapterId: 'c2', question: '' }, 'analysis-request-01')
  reportId = receipt.reportId
  await runNovelAnalysis(t.db, 'book', reportId, receipt.taskId, {}, async () => answer(original))
  revision = (await readAnalysis(t.db, 'book', reportId)).revision
})
afterAll(async () => { await t.close() })

it('核对幂等且独立，失败重试同请求不再付费，跨书/旧版本拒绝', async () => {
  const receipt = await create()
  expect(await create()).toEqual({ ...receipt, created: false })
  await expect(create('review-request-002')).rejects.toMatchObject({ status: 409 })
  await expect(createAnalysisReview(t.db, 'admin', 'other', reportId, 'review-request-003', revision)).rejects.toMatchObject({ status: 404 })
  await expect(createAnalysisReview(t.db, 'admin', 'book', reportId, 'review-request-001', revision + 1)).rejects.toMatchObject({ status: 409 })
  let calls = 0
  await runAnalysisReview(t.db, 'book', reportId, receipt.reviewId, receipt.taskId, {}, async options => {
    calls++; expect(options).toMatchObject({ stream: true, maxAttempts: 1, retryOnTimeout: false })
    throw new AiError('timeout', '核对超时')
  })
  await runAnalysisReview(t.db, 'book', reportId, receipt.reviewId, receipt.taskId, {}, async () => { calls++; return result() })
  expect(calls).toBe(1)
  expect((await readAnalysis(t.db, 'book', reportId)).content).toBe(original)
  expect((await getAiTask(t.db, receipt.taskId))?.status).toBe('failed')
})
it('疑点随手动参考传递，自动跳过，人工应用后 Agent 和续写只取新版本', async () => {
  const receipt = await create()
  await runAnalysisReview(t.db, 'book', reportId, receipt.reviewId, receipt.taskId, {}, async () => result())
  const reviewed = await readAnalysis(t.db, 'book', reportId)
  expect(reviewed.reviews?.[0]).toMatchObject({ stale: false, status: 'completed' })
  expect((await getAnalysisReferences(t.db, 'book', 'c2')).reports).toEqual([])
  const manual = await readAnalysisReference(t.db, 'book', 'c2', reportId, revision)
  expect(manual.review).toMatchObject({ factIssues: 1 })
  expect(formatAnalysisReferences([manual])).toContain(source)
  const session = await createAgentSession(t.db, 'admin', { novelId: 'book', afterChapterId: 'c2' })
  expect((await readAgentAnalysis(t.db, session, reportId)).review?.factIssues).toBe(1)
  await applyAnalysisFinding(t.db, 'book', reportId, receipt.reviewId, 'F1', revision)
  const revised = await readAnalysis(t.db, 'book', reportId)
  expect(revised).toMatchObject({ content: corrected, originalContent: original, revision: revision + 1 })
  expect(revised.reviews?.[0]?.stale).toBe(true)
  expect((await getAnalysisReferences(t.db, 'book', 'c2')).reports[0]?.content).toBe(corrected)
  expect((await readAgentAnalysis(t.db, session, reportId)).content).toBe(corrected)
  await expect(applyAnalysisFinding(t.db, 'book', reportId, receipt.reviewId, 'F1', revision)).rejects.toMatchObject({ status: 409 })
  await expect(readAnalysisReference(t.db, 'book', 'c2', reportId, revision)).rejects.toMatchObject({ status: 409 })
})
it('取消和迟到响应不保存结果，单次用量不重复记账', async () => {
  const receipt = await create()
  await runAnalysisReview(t.db, 'book', reportId, receipt.reviewId, receipt.taskId, {}, async options => {
    await stopAnalysisReview(t.db, 'book', reportId, receipt.reviewId)
    await options.onIncomplete?.(result())
    return result()
  })
  const report = await readAnalysis(t.db, 'book', reportId)
  expect(report.reviews?.[0]).toMatchObject({ status: 'cancelled' })
  expect(report.reviews?.[0]?.result).toBeUndefined()
  expect((await t.db.query("SELECT id FROM ai_usage WHERE generation_type='novel_analysis_review'")).rows).toHaveLength(1)
})
it('核对期间修订，旧结果保留为过期记录，不附到新版本上', async () => {
  const receipt = await create()
  await runAnalysisReview(t.db, 'book', reportId, receipt.reviewId, receipt.taskId, {}, async () => {
    await editAnalysis(t.db, 'book', reportId, corrected, revision)
    return result()
  })
  const report = await readAnalysis(t.db, 'book', reportId)
  expect(report.reviews?.[0]).toMatchObject({ status: 'completed', stale: true })
  expect((await readAnalysisReference(t.db, 'book', 'c2', reportId)).review?.factIssues).toBe(0)
  await expect(applyAnalysisFinding(t.db, 'book', reportId, receipt.reviewId, 'F1', revision + 1)).rejects.toMatchObject({ status: 409 })
})
it('原文变化阻止新核对和应用，失败结果不覆盖先前成功记录', async () => {
  const first = await create()
  await runAnalysisReview(t.db, 'book', reportId, first.reviewId, first.taskId, {}, async () => result())
  const second = await create('review-request-002')
  await runAnalysisReview(t.db, 'book', reportId, second.reviewId, second.taskId, {}, async () => answer('not json'))
  expect((await readAnalysis(t.db, 'book', reportId)).reviews?.some(r => !!r.result)).toBe(true)
  await t.db.query("UPDATE chapters SET content='改稿' WHERE id='c1'")
  await expect(create('review-request-003')).rejects.toMatchObject({ status: 409 })
  await expect(applyAnalysisFinding(t.db, 'book', reportId, first.reviewId, 'F1', revision)).rejects.toMatchObject({ status: 409 })
  expect((await readAnalysis(t.db, 'book', reportId)).reviews?.every(r => r.stale)).toBe(true)
})
it('实际路由保护权限、范围预览、任务筛选、重复回执和修订版本', async () => {
  const previous = process.env.DATABASE_URL
  process.env.DATABASE_URL = 'postgres://isolated/test'
  setDbForTests(t.db)
  try {
    await t.db.query("INSERT INTO users(id,username,role,password_hash,password_salt,created_at,updated_at) VALUES('reader','reader','reader','x','x',1,1) ON CONFLICT DO NOTHING")
    const admin = await createSession(t.db, 'admin', 'test', loadConfig().sessionHashSalt)
    const reader = await createSession(t.db, 'reader', 'test', loadConfig().sessionHashSalt)
    const base = `/api/ai/analysis/book/${reportId}`
    const request = (url: string, token = admin, body?: unknown) => app.request(url, { method: body === undefined ? 'GET' : 'POST',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    expect((await request(`${base}/review-preview`, '')).status).toBe(401)
    expect((await request(`${base}/reviews`, reader, {})).status).toBe(403)
    expect((await request(`${base.replace('/book/', '/other/')}/review-preview`)).status).toBe(404)
    expect((await request(`${base}/review-preview?paragraphStarts=`)).status).toBe(422)
    expect((await request(`${base}/review-preview?paragraphStarts=99`)).status).toBe(409)
    const preview = await request(`${base}/review-preview`)
    expect(preview.headers.get('cache-control')).toContain('no-store')
    expect(await preview.json()).toMatchObject({ revision, sourceIds: ['S1', 'S2'], segments: [{ start: 0 }] })
    vi.mocked(chat).mockResolvedValue(result())
    const input = { revision, requestId: 'route-review-0001' }
    const created = await request(`${base}/reviews`, admin, input)
    expect(created.status).toBe(201)
    const receipt = await created.json() as { reviewId: string; taskId: string }
    await vi.waitFor(async () => expect((await getAiTask(t.db, receipt.taskId))?.status).toBe('completed'))
    const retried = await request(`${base}/reviews`, admin, input)
    expect(retried.status).toBe(200)
    expect(await retried.json()).toMatchObject({ ...receipt, created: false })
    expect(chat).toHaveBeenCalledTimes(1)
    const tasks = await request('/api/ai/tasks?kind=novel_analysis_review')
    const body = await tasks.json() as { items: Array<{ kind: string }> }
    expect(body.items).toHaveLength(1)
    expect(body.items[0]?.kind).toBe('novel_analysis_review')
    const apply = `${base}/reviews/${receipt.reviewId}/apply`
    expect((await request(apply, admin, { revision, findingId: 'F1' })).status).toBe(200)
    expect((await request(apply, admin, { revision, findingId: 'F1' })).status).toBe(409)
  } finally { setDbForTests(null); if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous }
})
