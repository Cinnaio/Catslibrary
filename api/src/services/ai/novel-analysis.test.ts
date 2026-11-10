import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { createTestDb, type TestDb } from '../../test/db'
import { first } from '../../db/query'
import { createAnalysis, editAnalysis, listAnalyses, readAnalysis, requireAnalysis, resumeAnalysis, stopAnalysis } from './novel-analysis-store'
import { analysisSourcesChanged, captureAnalysisSources, parseAnalysisRequest } from './novel-analysis-source'
import { runNovelAnalysis } from './novel-analysis'
import { AiError, type AiChatResult, type chat } from './client'
import { getAiTask } from './tasks'
import { cleanStoryText } from './story-memory'
import { app } from '../../app'
import { setDbForTests } from '../../db/pool'
import { createSession } from '../sessions'
import { loadConfig } from '../../config'

let t: TestDb
const input = { kind: 'plot' as const, startChapterId: 'c1', endChapterId: 'c2', question: '' }
const answer = (text: string): AiChatResult => ({ text, model: 'test', promptTokens: 10, completionTokens: 10, finishReason: 'stop', cost: 0, tokenUsageReported: true })
const create = (id = 'request-0001') => createAnalysis(t.db, 'admin', 'book', input, id)
const useLongRange = () => t.db.query("UPDATE chapters SET content=content || repeat('背景。',3650) WHERE novel_id='book'")
beforeAll(async () => { t = await createTestDb(); await t.applyMigrations() })
beforeEach(async () => {
  await t.db.query('DELETE FROM novels')
  await t.db.query('DELETE FROM ai_tasks')
  await t.db.query('DELETE FROM ai_usage')
  await t.db.query("INSERT INTO users(id,username,role,password_hash,password_salt,created_at,updated_at) VALUES('admin','admin','admin','test','test',1,1) ON CONFLICT DO NOTHING")
  await t.db.query("INSERT INTO novels(id,title,created_at,updated_at) VALUES('book','测试小说',1,1),('other','另一本',1,1)")
  await t.db.query("INSERT INTO chapters(id,novel_id,title,content,sort_order,created_at) VALUES('c1','book','起点','青遥把钥匙交给阿宁。',10,1),('c2','book','后来','阿宁计划明早去找青遥。',20,1),('x','other','外书','范围外',1,1)")
})
afterAll(async () => { await t.close() })

it('保存完整分段正文，不截断长章或跨书，并检测中途插章与源文修改', async () => {
  const raw = '<p>' + '甲'.repeat(11999) + '😀' + '乙'.repeat(13000) + '</p>'
  await t.db.query('UPDATE chapters SET content=$1 WHERE id=$2', [raw, 'c1'])
  const sources = await captureAnalysisSources(t.db, 'book', input)
  expect(sources.filter(s => s.chapterId === 'c1').map(s => s.text).join('')).toBe(cleanStoryText(raw))
  expect(sources.every(s => !/[\uD800-\uDBFF]$/.test(s.text))).toBe(true)
  expect(await analysisSourcesChanged(t.db, 'book', input, sources)).toBe(false)
  await expect(captureAnalysisSources(t.db, 'book', { ...input, endChapterId: 'x' })).rejects.toMatchObject({ status: 422 })
  await expect(captureAnalysisSources(t.db, 'book', { ...input, startChapterId: 'c2', endChapterId: 'c1' })).rejects.toMatchObject({ status: 422 })
  await t.db.query("INSERT INTO chapters(id,novel_id,title,content,sort_order,created_at) VALUES('inserted','book','插入章','新正文',15,1)")
  expect(await analysisSourcesChanged(t.db, 'book', input, sources)).toBe(true)
  await t.db.query("DELETE FROM chapters WHERE id='inserted'")
  await t.db.query("UPDATE chapters SET content='改稿' WHERE id='c2'")
  expect(await analysisSourcesChanged(t.db, 'book', input, sources)).toBe(true)
  expect(sources.at(-1)?.text).toBe('阿宁计划明早去找青遥。')
})

it('相同请求在 JSONB 重排后仍返回原任务，拒绝换范围与重复活动任务', async () => {
  const receipt = await create()
  expect(await create()).toEqual({ ...receipt, created: false })
  await expect(createAnalysis(t.db, 'admin', 'book', { ...input, question: '换题' }, 'request-0001')).rejects.toMatchObject({ status: 409 })
  await expect(create('request-0002')).rejects.toMatchObject({ status: 409 })
  await expect(requireAnalysis(t.db, 'other', receipt.reportId)).rejects.toMatchObject({ status: 404 })
  expect(() => parseAnalysisRequest({ ...input, kind: '__proto__' })).toThrow()
})

it('中断保留已读段与费用，继续时只读未完成部分；原始正文不变且不写续写档案', async () => {
  await useLongRange()
  const receipt = await create()
  let count = 0
  await runNovelAnalysis(t.db, 'book', receipt.reportId, receipt.taskId, {}, async () => {
    if (++count === 2) throw new AiError('upstream', '上游暂不可用')
    return answer('钥匙从青遥转交阿宁。[[S1]]')
  })
  expect(count).toBe(2)
  expect((await readAnalysis(t.db, 'book', receipt.reportId)).processed).toBe(1)
  expect((await getAiTask(t.db, receipt.taskId))?.status).toBe('failed')
  const next = await resumeAnalysis(t.db, 'admin', 'book', receipt.reportId)
  expect((await resumeAnalysis(t.db, 'admin', 'book', receipt.reportId)).created).toBe(false)
  const messages: string[] = []
  await runNovelAnalysis(t.db, 'book', receipt.reportId, next.taskId, {}, async options => {
    messages.push(options.messages.at(-1)!.content)
    return answer(options.tools ? '阿宁持有钥匙；会面仍只是计划。[[S1]] [[S2]]' : '计划明日会面，尚未成行。[[S2]]')
  })
  expect(messages).toHaveLength(2)
  expect(JSON.parse(messages[0]!).sources[0].id).toBe('S2')
  expect((await readAnalysis(t.db, 'book', receipt.reportId)).status).toBe('completed')
  expect(await first(t.db, "SELECT 1 FROM ai_generations WHERE novel_id='book'")).toBeUndefined()
  expect(Number((await first<{ count: string }>(t.db, 'SELECT count(*) FROM ai_usage'))?.count)).toBe(3)
})

it('取消后迟到回复不能推进检查点，恢复任务独立完成', async () => {
  const receipt = await create()
  let cancelled = false
  await runNovelAnalysis(t.db, 'book', receipt.reportId, receipt.taskId, {}, async () => {
    cancelled = true
    await stopAnalysis(t.db, 'book', receipt.reportId)
    return answer('迟到旧回复')
  })
  expect(cancelled).toBe(true)
  expect((await readAnalysis(t.db, 'book', receipt.reportId)).processed).toBe(0)
  expect((await getAiTask(t.db, receipt.taskId))?.status).toBe('cancelled')
  const next = await resumeAnalysis(t.db, 'admin', 'book', receipt.reportId)
  await runNovelAnalysis(t.db, 'book', receipt.reportId, receipt.taskId, {}, async () => { throw new Error('旧任务不得调用') })
  await runNovelAnalysis(t.db, 'book', receipt.reportId, next.taskId, {}, async () => answer('新报告 [[S1]]'))
  expect((await readAnalysis(t.db, 'book', receipt.reportId)).content).toBe('新报告 [[S1]]')
})

it('归属转移拒绝迟到落库，正文变化禁止从旧记录续跑', async () => {
  const receipt = await create()
  await runNovelAnalysis(t.db, 'book', receipt.reportId, receipt.taskId, {}, async () => {
    await t.db.query("UPDATE ai_tasks SET owner_id='another-worker' WHERE id=$1", [receipt.taskId])
    return answer('不能保存')
  })
  expect((await readAnalysis(t.db, 'book', receipt.reportId)).processed).toBe(0)
  await stopAnalysis(t.db, 'book', receipt.reportId)
  await t.db.query("UPDATE chapters SET content='已修改' WHERE id='c1'")
  await expect(resumeAnalysis(t.db, 'admin', 'book', receipt.reportId)).rejects.toMatchObject({ status: 409 })
})

it('修订有版本冲突保护，保留模型原稿，删除任务后仍能读报告', async () => {
  const receipt = await create()
  await runNovelAnalysis(t.db, 'book', receipt.reportId, receipt.taskId, {}, async () => answer('原始报告 [[S1]]'))
  const original = await readAnalysis(t.db, 'book', receipt.reportId)
  await editAnalysis(t.db, 'book', receipt.reportId, '人工修订 [[S1]]', original.revision)
  await expect(editAnalysis(t.db, 'book', receipt.reportId, '过期编辑', original.revision)).rejects.toMatchObject({ status: 409 })
  await expect(resumeAnalysis(t.db, 'admin', 'book', receipt.reportId)).rejects.toMatchObject({ status: 409 })
  await t.db.query('DELETE FROM ai_tasks WHERE id=$1', [receipt.taskId])
  const result = await readAnalysis(t.db, 'book', receipt.reportId)
  expect(result).toMatchObject({ content: '人工修订 [[S1]]', originalContent: '原始报告 [[S1]]', status: 'completed', edited: true })
  const list = await listAnalyses(t.db, 'book')
  expect(list.reports[0]).toMatchObject({ total: 2, chapterCount: 2, processed: 2 })
  expect(JSON.stringify(list)).not.toContain('原始报告')
})

it('按需回查只返回范围内来源，拒绝越界且重复回查不膨胀上下文', async () => {
  await useLongRange()
  const receipt = await create()
  let round = 0
  const tools = (id: string, sourceId: string) => ({ ...answer(''), toolCalls: [{ id, type: 'function' as const, function: { name: 'read_source', arguments: JSON.stringify({ sourceId }) } }] })
  const invoke: typeof chat = async options => {
    if (!options.tools) return answer('阅读记录 [[S1]]')
    const r = ++round
    if (r === 1) return tools('first', 'S1')
    if (r === 2) { expect(options.messages.at(-1)!.content).toContain('青遥'); return tools('again', 'S1') }
    if (r === 3) { expect(options.messages.at(-1)!.content).toContain('上方返回'); return tools('outside', 'x') }
    expect(options.messages.at(-1)!.content).not.toContain('范围外')
    expect(options.messages.at(-1)!.content).toContain('error')
    return answer('报告 [[S1]]')
  }
  await runNovelAnalysis(t.db, 'book', receipt.reportId, receipt.taskId, {}, invoke)
  expect((await readAnalysis(t.db, 'book', receipt.reportId)).checkedSourceIds).toEqual(['S1'])
})

it('截断与空输出不形成完整报告或触发付费重试', async () => {
  const receipt = await create()
  let calls = 0
  await runNovelAnalysis(t.db, 'book', receipt.reportId, receipt.taskId, {}, async options => {
    calls++
    const partial = { ...answer('半截'), finishReason: 'length' }
    await options.onIncomplete?.(partial)
    return partial
  })
  expect(calls).toBe(1)
  expect((await readAnalysis(t.db, 'book', receipt.reportId))).toMatchObject({ status: 'failed', content: '', processed: 0 })
  expect(Number((await first<{ count: string }>(t.db, 'SELECT count(*) FROM ai_usage'))?.count)).toBe(1)
  const next = await resumeAnalysis(t.db, 'admin', 'book', receipt.reportId)
  await runNovelAnalysis(t.db, 'book', receipt.reportId, next.taskId, {}, async () => answer(''))
  expect((await readAnalysis(t.db, 'book', receipt.reportId))).toMatchObject({ status: 'failed', content: '', processed: 0 })
})

it('实际路由限制管理员访问，报告及来源不可跨书读取，正文仅在来源接口返回', async () => {
  const previousUrl = process.env.DATABASE_URL
  process.env.DATABASE_URL = 'postgres://isolated/test'
  setDbForTests(t.db)
  try {
    const receipt = await create()
    await t.db.query("INSERT INTO users(id,username,role,password_hash,password_salt,created_at,updated_at) VALUES('reader','reader','reader','test','test',1,1) ON CONFLICT DO NOTHING")
    const admin = await createSession(t.db, 'admin', 'test', loadConfig().sessionHashSalt)
    const reader = await createSession(t.db, 'reader', 'test', loadConfig().sessionHashSalt)
    const base = `/api/ai/analysis/book/${receipt.reportId}`
    const get = (path: string, token = '') => app.request(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    expect((await get(base)).status).toBe(401)
    expect((await get(base, reader)).status).toBe(403)
    expect((await get(base.replace('/book/', '/other/'), admin)).status).toBe(404)
    expect((await get(`${base}/sources/x`, admin)).status).toBe(404)
    const detail = await get(base, admin)
    expect(detail.status).toBe(200)
    expect(detail.headers.get('cache-control')).toContain('no-store')
    expect(await detail.text()).not.toContain('青遥把钥匙交给阿宁')
    expect(await (await get(`${base}/sources/S1`, admin)).json()).toMatchObject({ text: '青遥把钥匙交给阿宁。' })
  } finally {
    setDbForTests(null)
    if (previousUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = previousUrl
  }
})
