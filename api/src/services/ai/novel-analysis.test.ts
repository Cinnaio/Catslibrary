import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from '../../test/db'
import { first } from '../../db/query'
import { createAnalysis, deleteAnalysis, editAnalysis, listAnalyses, readAnalysis, requireAnalysis, resumeAnalysis, stopAnalysis } from './novel-analysis-store'
import { analysisSourcesChanged, captureAnalysisSources, parseAnalysisRequest, searchAnalysisSources } from './novel-analysis-source'
import { runNovelAnalysis } from './novel-analysis'
import { analysisPrompt } from './novel-analysis-prompts'
import { analysisGenerationKey, saveSharedAnalysisReading } from './novel-analysis-reuse'
import { AiError, chat, type AiChatResult } from './client'
import { withProviderSnapshot } from './provider-snapshot'
import { getAiTask } from './tasks'
import { subscribeAiTask } from './task-events'
import { createAnalysisReview, runAnalysisReview } from './novel-analysis-review'
import { saveAnalysisEvidence } from './novel-analysis-review-store'
import { cleanStoryText } from './story-memory'
import { app } from '../../app'
import { setDbForTests } from '../../db/pool'
import { createSession } from '../sessions'
import { loadConfig } from '../../config'
import { getAiSettings, saveAiSettings } from './settings'

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

it('文风分析分段保留语言样本，归并时保留适用范围，成稿提炼续写写法', () => {
  expect(analysisPrompt('reading', 'style')).toContain('紧邻来源编号的短引文')
  expect(analysisPrompt('condense', 'style')).toContain('准确来源编号和适用范围')
  for (const stage of ['direct', 'report', 'final'] as const) {
    const prompt = analysisPrompt(stage, 'style')
    expect(prompt).toContain('续写文风要点')
    expect(prompt).toContain('区分稳定特征和局部写法')
    expect(prompt).not.toContain('按主题展开关键转折')
  }
  expect(analysisPrompt('report', 'plot')).toContain('按主题展开关键转折')
})

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

it('相同请求在 JSONB 重排后仍返回原任务，相同活动分析共用任务而不同要求冲突', async () => {
  const receipt = await create()
  expect(await create()).toEqual({ ...receipt, created: false })
  await expect(createAnalysis(t.db, 'admin', 'book', { ...input, question: '换题' }, 'request-0001')).rejects.toMatchObject({ status: 409 })
  expect(await create('request-0002')).toEqual({ ...receipt, created: false, reused: true })
  await expect(createAnalysis(t.db, 'admin', 'book', { ...input, question: '另一问题' }, 'request-0003')).rejects.toMatchObject({ status: 409 })
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

it('原文搜索限制片段数量、保留 Unicode，并优先提供后文线索而不把无命中当结论', async () => {
  const [base] = await captureAnalysisSources(t.db, 'book', input)
  const sources = Array.from({ length: 9 }, (_, i) => ({ ...base!, id: `S${i + 1}`, text: '😀'.repeat(100) + '钥匙' + '😀'.repeat(150) }))
  const result = searchAnalysisSources(sources, ' 钥匙 ')
  expect(result).toMatchObject({ matchedSources: 9, truncated: true })
  expect(result.matches.map(s => s.id)).toEqual(['S9', 'S8', 'S7', 'S6', 'S5', 'S4'])
  for (const s of result.matches) {
    expect(s.excerpt).toContain('钥匙')
    expect(s.excerpt.length).toBeLessThanOrEqual(441)
    expect(s.excerpt).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u)
    expect(s).not.toHaveProperty('chapterId')
  }
  expect(searchAnalysisSources(sources, '.*')).toMatchObject({ matchedSources: 0, matches: [] })
  expect(searchAnalysisSources(sources, '无此词').notice).toContain('无命中不等于')
  for (const query of [null, ['钥匙'], 'a', '字'.repeat(81)]) expect(() => searchAnalysisSources(sources, query)).toThrow()
})

it('搜索使用冻结范围，重复查询不再返回正文片段，搜索本身不冒充完整回读', async () => {
  await useLongRange()
  const receipt = await create()
  await t.db.query("UPDATE chapters SET content='钥匙已被改稿替换' WHERE id='c1'")
  await t.db.query("UPDATE chapters SET content='钥匙在别的书中' WHERE id='x'")
  let round = 0
  const call = (name: string, args: unknown) => ({ ...answer(''), toolCalls: [{ id: `call-${round}`, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } }] })
  await runNovelAnalysis(t.db, 'book', receipt.reportId, receipt.taskId, {}, async options => {
    if (!options.tools) return answer('钥匙转手。[[S1]]')
    round++
    if (round === 1) return call('search_sources', { query: '钥匙' })
    const result = JSON.parse(options.messages.at(-1)!.content)
    if (round === 2) {
      expect(result.matches).toHaveLength(1)
      expect(result.matches[0]).toMatchObject({ id: 'S1', excerpt: expect.stringContaining('青遥把钥匙交给阿宁') })
      expect(JSON.stringify(result)).not.toMatch(/改稿替换|别的书/)
      expect((await requireAnalysis(t.db, 'book', receipt.reportId)).checked_source_ids).toEqual([])
      return call('search_sources', { query: ' 钥匙 ' })
    }
    if (round === 3) { expect(result.message).toContain('上方返回'); expect(result).not.toHaveProperty('matches'); return call('search_sources', { query: '钥匙', novelId: 'other' }) }
    if (round === 4) { expect(result.error).toBeTruthy(); return call('read_source', { sourceId: 'S1' }) }
    expect(Object.keys(result).sort()).toEqual(['chapterTitle', 'id', 'part', 'text'])
    return answer('阿宁持有钥匙。[[S1]]')
  })
  expect(round).toBe(5)
  expect((await readAnalysis(t.db, 'book', receipt.reportId)).checkedSourceIds).toEqual(['S1'])
})

it('搜索片段与完整回读共享正文额度，超限后不会额外返回正文', async () => {
  await t.db.query('UPDATE chapters SET content=$1 WHERE id=$2', [('钥匙' + '甲'.repeat(11998)).repeat(4), 'c1'])
  const receipt = await create()
  const row = await requireAnalysis(t.db, 'book', receipt.reportId)
  await t.db.query('UPDATE novel_analysis_reports SET notes_json=$1::jsonb WHERE id=$2', [JSON.stringify(row.source_json.map(s => ({ sourceIds: [s.id], content: '已有阅读记录' }))), receipt.reportId])
  let round = 0
  await runNovelAnalysis(t.db, 'book', receipt.reportId, receipt.taskId, {}, async options => {
    round++
    if (round === 1) return { ...answer(''), toolCalls: [{ id: 'search', type: 'function', function: { name: 'search_sources', arguments: '{"query":"钥匙"}' } }] }
    if (round === 2) return { ...answer(''), toolCalls: ['S1', 'S2', 'S3', 'S4'].map(id => ({ id, type: 'function' as const, function: { name: 'read_source', arguments: JSON.stringify({ sourceId: id }) } })) }
    const results = options.messages.filter(m => m.role === 'tool').map(m => JSON.parse(m.content))
    expect(results[0].matches).toHaveLength(4)
    expect(results.filter(r => r.text)).toHaveLength(3)
    expect(results.at(-1).message).toContain('额度已用完')
    return answer('报告已核对。[[S1]]')
  })
  expect(round).toBe(3)
  expect((await readAnalysis(t.db, 'book', receipt.reportId)).checkedSourceIds).toEqual(['S1', 'S2', 'S3'])
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

it.each(['completed', 'interrupted', 'cancelled'] as const)('流式接收只在完整完成时保存报告，进度与费用保留且不重放：%s', async outcome => {
  const receipt = await create()
  const frames = [
    { choices: [{ delta: { reasoning: '不公开的思考' } }] },
    { choices: [{ delta: { content: '阿宁接过钥匙。[[S1]]' } }], usage: { prompt_tokens: 12, completion_tokens: 9 } },
    ...(outcome === 'completed' ? [{ choices: [{ delta: {}, finish_reason: 'stop' }] }] : []),
  ]
  const fetchMock = vi.fn(async () => new Response(frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join('') + (outcome === 'completed' ? 'data: [DONE]\n\n' : ''), { headers: { 'content-type': 'text/event-stream' } }))
  vi.stubGlobal('fetch', fetchMock)
  try {
    await withProviderSnapshot(() => runNovelAnalysis(t.db, 'book', receipt.reportId, receipt.taskId, {}, async options => {
      expect(options).toMatchObject({ stream: true, maxAttempts: 1, retryOnTimeout: false })
      return chat({ ...options, reasoningMode: 'inherit', onDelta: async () => {
        expect((await getAiTask(t.db, receipt.taskId))?.step).toContain('正在输出')
        expect((await requireAnalysis(t.db, 'book', receipt.reportId)).content).toBe('')
        if (outcome === 'cancelled') {
          await stopAnalysis(t.db, 'book', receipt.reportId)
          throw new AiError('cancelled', '已停止', 409)
        }
      } })
    }), { text: { baseUrl: 'https://closed.test/v1', apiKey: 'mock-key', model: 'mock-text' } })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const report = await readAnalysis(t.db, 'book', receipt.reportId)
    expect(report.status).toBe(outcome === 'interrupted' ? 'failed' : outcome)
    expect(report.content).toBe(outcome === 'completed' ? '阿宁接过钥匙。[[S1]]' : '')
    const usage = await first<{ count: number; tokens: number }>(t.db, 'SELECT count(*)::int AS count, sum(completion_tokens)::int AS tokens FROM ai_usage')
    expect(usage).toMatchObject({ count: 1, tokens: 9 })
    expect(JSON.stringify(report)).not.toContain('不公开的思考')
  } finally { vi.unstubAllGlobals() }
})

it.each(['text', 'tool', 'empty'] as const)('回查额度结束后仅携带冻结材料写报告，拒绝工具或空正文且不重试：%s', async outcome => {
  const receipt = await create()
  const row = await requireAnalysis(t.db, 'book', receipt.reportId)
  const notes = [{ sourceIds: row.source_json.map(source => source.id), content: '已有阅读记录' }]
  await t.db.query('UPDATE novel_analysis_reports SET notes_json=$1::jsonb WHERE id=$2', [JSON.stringify(notes), receipt.reportId])
  let calls = 0
  await runNovelAnalysis(t.db, 'book', receipt.reportId, receipt.taskId, {}, async options => {
    calls++
    const toolResult = { ...answer(''), reasoningContent: '不作为报告材料的思考', toolCalls: [{ id: `call-${calls}`, type: 'function' as const, function: { name: 'read_source', arguments: '{"sourceId":"S1"}' } }] }
    if (calls <= 8) return toolResult
    expect(options.toolChoice).toBe('none')
    expect(options.tools).toBeUndefined()
    expect(options.messages.map(message => message.role)).toEqual(['system', 'user', 'user'])
    expect(options.messages[0]!.content).not.toContain('search_sources')
    const evidence = JSON.parse(options.messages.at(-1)!.content).evidence
    expect(evidence[0]).toMatchObject({ id: 'S1', text: '青遥把钥匙交给阿宁。' })
    expect(evidence).toHaveLength(8)
    expect(JSON.stringify(options.messages)).not.toContain('不作为报告材料的思考')
    expect(options.maxAttempts).toBe(1)
    return outcome === 'text' ? answer('阿宁接过钥匙。[[S1]]') : outcome === 'tool' ? toolResult : answer('')
  })
  expect(calls).toBe(9)
  const report = await readAnalysis(t.db, 'book', receipt.reportId)
  expect(report.status).toBe(outcome === 'text' ? 'completed' : 'failed')
  expect(report.content).toBe(outcome === 'text' ? '阿宁接过钥匙。[[S1]]' : '')
  expect(report.notes).toEqual(notes)
  if (outcome === 'tool') expect(report.error).toContain('仍请求查原文')
  expect(Number((await first<{ count: string }>(t.db, 'SELECT count(*) FROM ai_usage'))?.count)).toBe(9)
})

it('仅思考耗尽额度与普通空正文分开提示，保留用量且不重试', async () => {
  const receipt = await create()
  let calls = 0
  await runNovelAnalysis(t.db, 'book', receipt.reportId, receipt.taskId, {}, async () => {
    calls++
    return { ...answer(''), finishReason: 'length', completionTokens: 8000, reasoningTokens: 8000 }
  })
  expect(calls).toBe(1)
  const report = await readAnalysis(t.db, 'book', receipt.reportId)
  expect(report.status).toBe('failed')
  expect(report.error).toContain('思考已达到输出上限')
  expect(report.content).toBe('')
  expect(Number((await first<{ tokens: number }>(t.db, 'SELECT completion_tokens AS tokens FROM ai_usage'))?.tokens)).toBe(8000)
})

it('高思考报告使用显式输出额度，单次完成且不修改共享设置', async () => {
  const previous = await getAiSettings(t.db)
  const settings = await saveAiSettings(t.db, { storyMemoryReasoningMode: 'high', novelAnalysisReportMaxTokens: 16000 })
  try {
    const receipt = await create()
    let calls = 0
    await runNovelAnalysis(t.db, 'book', receipt.reportId, receipt.taskId, {}, async options => {
      calls++
      expect(options).toMatchObject({ reasoningMode: 'high', maxTokens: 16000, maxAttempts: 1, retryOnTimeout: false })
      return { ...answer('报告 [[S1]]'), completionTokens: 8134, reasoningTokens: 6684 }
    })
    expect(calls).toBe(1)
    expect((await readAnalysis(t.db, 'book', receipt.reportId)).status).toBe('completed')
    expect((await first<{ value: string }>(t.db, "SELECT value FROM app_settings WHERE key='ai_settings'"))?.value).toBe(JSON.stringify(settings))
  } finally { await saveAiSettings(t.db, previous) }
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


const countRows = async (table: 'ai_tasks' | 'ai_usage' | 'novel_analysis_readings') =>
  Number((await first<{ count: number }>(t.db, 'SELECT count(*) AS count FROM ' + table))?.count)
const readingModel = () => vi.fn<typeof chat>(async options => {
  const payload = JSON.parse(options.messages[1]!.content)
  if (options.tools) return answer('完成报告，依据见 [[S1]]。')
  return answer(payload.sources.map((source: { id: string; chapterTitle: string }) =>
    source.chapterTitle + '的事件、人物选择和关系变化。[[' + source.id + ']]').join('\n'))
})
const completeLongAnalysis = async () => {
  await useLongRange()
  const receipt = await create()
  const invoke = readingModel()
  await runNovelAnalysis(t.db, 'book', receipt.reportId, receipt.taskId, {}, invoke)
  expect(invoke).toHaveBeenCalledTimes(3)
  expect(await countRows('novel_analysis_readings')).toBe(2)
  return receipt
}

it('跨管理员和新请求复用完整报告及人工修订，丢失响应后的重试始终指向原报告', async () => {
  const original = await create()
  await runNovelAnalysis(t.db, 'book', original.reportId, original.taskId, {}, async () => answer('原报告 [[S1]]'))
  await editAnalysis(t.db, 'book', original.reportId, '已经核对的人工修订 [[S1]]', 2)
  await t.db.query("INSERT INTO users(id,username,role,password_hash,password_salt,created_at,updated_at) VALUES('admin2','admin2','admin','test','test',1,1) ON CONFLICT DO NOTHING")
  const reused = await createAnalysis(t.db, 'admin2', 'book', input, 'request-shared')
  expect(reused).toEqual({ ...original, created: false, reused: true })
  expect((await readAnalysis(t.db, 'book', reused.reportId)).content).toContain('人工修订')
  expect(await countRows('ai_tasks')).toBe(1)
  expect(await countRows('ai_usage')).toBe(1)
  const fresh = await createAnalysis(t.db, 'admin', 'book', input, 'request-fresh', true)
  expect(fresh.reportId).not.toBe(original.reportId)
  await t.db.query("UPDATE chapters SET content='修改后' WHERE id='c1'")
  expect(await createAnalysis(t.db, 'admin2', 'book', input, 'request-shared')).toEqual(reused)
  await expect(createAnalysis(t.db, 'admin2', 'book', input, 'request-shared', true)).rejects.toMatchObject({ status: 409 })
})

it('主题不同共用中性底稿，关注问题只进入最终报告；文风和自定义仍独立阅读', async () => {
  const original = await completeLongAnalysis()
  for (const kind of ['relationships', 'characters'] as const) {
    const receipt = await createAnalysis(t.db, 'admin', 'book', { ...input, kind, question: '关注钥匙' }, 'request-' + kind)
    const invoke = readingModel()
    await runNovelAnalysis(t.db, 'book', receipt.reportId, receipt.taskId, {}, invoke)
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(JSON.parse(invoke.mock.calls[0]![0].messages[1]!.content).focus).toContain('关注钥匙')
    expect((await readAnalysis(t.db, 'book', receipt.reportId)).reusedSources).toBe(2)
  }
  for (const kind of ['style', 'custom'] as const) {
    const receipt = await createAnalysis(t.db, 'admin', 'book', { ...input, kind, question: '关注语言' }, 'request-' + kind)
    const invoke = readingModel()
    await runNovelAnalysis(t.db, 'book', receipt.reportId, receipt.taskId, {}, invoke)
    expect(invoke).toHaveBeenCalledTimes(3)
    expect((await readAnalysis(t.db, 'book', receipt.reportId)).reusedSources).toBe(0)
  }
  expect((await readAnalysis(t.db, 'book', original.reportId)).reusedSources).toBe(0)
  expect(await countRows('novel_analysis_readings')).toBe(2)
})

it('修改正文仅重读受影响批次，合并材料恢复原文顺序，旧报告标记过期', async () => {
  const original = await completeLongAnalysis()
  await t.db.query("UPDATE chapters SET content=content || '补充动机。' WHERE id='c1'")
  const receipt = await createAnalysis(t.db, 'admin', 'book', input, 'request-edit')
  expect(receipt.created).toBe(true)
  const invoke = readingModel()
  await runNovelAnalysis(t.db, 'book', receipt.reportId, receipt.taskId, {}, invoke)
  expect(invoke).toHaveBeenCalledTimes(2)
  const reading = JSON.parse(invoke.mock.calls[0]![0].messages[1]!.content)
  expect(reading).not.toHaveProperty('focus')
  expect(reading.sources.map((source: { id: string }) => source.id)).toEqual(['S1'])
  expect(invoke.mock.calls[0]![0].messages[0]!.content).toContain('共同使用的阅读底稿')
  const final = JSON.parse(invoke.mock.calls[1]![0].messages[1]!.content)
  expect(final.notes.map((note: { sourceIds: string[] }) => note.sourceIds)).toEqual([['S1'], ['S2']])
  expect((await readAnalysis(t.db, 'book', receipt.reportId)).reusedSources).toBe(1)
  expect((await readAnalysis(t.db, 'book', original.reportId)).sourceChanged).toBe(true)
})

it('缩小范围时重映射引用编号且不带入范围外底稿，新增章节只补读新增段', async () => {
  await completeLongAnalysis()
  const narrow = await createAnalysis(t.db, 'admin', 'book', { ...input, kind: 'characters', startChapterId: 'c2' }, 'request-narrow')
  const invoke = readingModel()
  await runNovelAnalysis(t.db, 'book', narrow.reportId, narrow.taskId, {}, invoke)
  expect(invoke).toHaveBeenCalledTimes(1)
  const report = await readAnalysis(t.db, 'book', narrow.reportId)
  expect(report).toMatchObject({ reusedSources: 1, total: 1 })
  expect(report.notes).toEqual([{ sourceIds: ['S1'], content: '后来的事件、人物选择和关系变化。[[S1]]' }])
  expect(report.sources[0]?.chapterId).toBe('c2')
  await t.db.query("INSERT INTO chapters(id,novel_id,title,content,sort_order,created_at) VALUES('c3','book','新章',repeat('后续。',3500),30,1)")
  const extended = await createAnalysis(t.db, 'admin', 'book', { ...input, endChapterId: 'c3' }, 'request-extend')
  const extra = readingModel()
  await runNovelAnalysis(t.db, 'book', extended.reportId, extended.taskId, {}, extra)
  expect(extra).toHaveBeenCalledTimes(2)
  expect(JSON.parse(extra.mock.calls[0]![0].messages[1]!.content).sources[0].id).toBe('S3')
  expect((await readAnalysis(t.db, 'book', extended.reportId)).reusedSources).toBe(2)
})

it('重新分析跳过报告和底稿复用，重试仍幂等且旧报告保留', async () => {
  const original = await completeLongAnalysis()
  const receipt = await createAnalysis(t.db, 'admin', 'book', input, 'request-force', true)
  expect(await createAnalysis(t.db, 'admin', 'book', input, 'request-force', true)).toEqual({ ...receipt, created: false })
  const invoke = readingModel()
  await runNovelAnalysis(t.db, 'book', receipt.reportId, receipt.taskId, {}, invoke)
  expect(invoke).toHaveBeenCalledTimes(3)
  expect((await readAnalysis(t.db, 'book', receipt.reportId)).reusedSources).toBe(0)
  expect((await readAnalysis(t.db, 'book', original.reportId)).status).toBe('completed')
  await expect(createAnalysis(t.db, 'admin', 'book', input, 'request-force', false)).rejects.toMatchObject({ status: 409 })
  await expect(createAnalysis(t.db, 'admin', 'book', input, 'request-invalid', 'true')).rejects.toMatchObject({ status: 422 })
})

it('模型设置变化不复用报告或底稿，其他作品不能读取本书缓存', async () => {
  await completeLongAnalysis()
  const provider = { baseUrl: 'https://example.test/v1', apiKey: 'test-key', model: 'different-model' }
  await withProviderSnapshot(async () => {
    const receipt = await createAnalysis(t.db, 'admin', 'book', input, 'request-model')
    expect(receipt.created).toBe(true)
    const invoke = readingModel()
    await runNovelAnalysis(t.db, 'book', receipt.reportId, receipt.taskId, {}, invoke)
    expect(invoke).toHaveBeenCalledTimes(3)
    expect((await readAnalysis(t.db, 'book', receipt.reportId)).reusedSources).toBe(0)
  }, { text: provider })
  await t.db.query("UPDATE chapters SET content=repeat('背景。',8000) WHERE id='x'")
  const receipt = await createAnalysis(t.db, 'admin', 'other', { ...input, startChapterId: 'x', endChapterId: 'x' }, 'request-other')
  const invoke = readingModel()
  await runNovelAnalysis(t.db, 'other', receipt.reportId, receipt.taskId, {}, invoke)
  expect((await readAnalysis(t.db, 'other', receipt.reportId)).reusedSources).toBe(0)
  expect(invoke).toHaveBeenCalledTimes(3)
})

it('取消后的迟到阅读不能写共享缓存，历史主题笔记也不晋升为通用底稿', async () => {
  await useLongRange()
  const cancelled = await create()
  await runNovelAnalysis(t.db, 'book', cancelled.reportId, cancelled.taskId, {}, async () => {
    await stopAnalysis(t.db, 'book', cancelled.reportId)
    return answer('迟到记录 [[S1]]')
  })
  expect(await countRows('novel_analysis_readings')).toBe(0)
  const legacy = await create('request-legacy')
  await t.db.query("UPDATE novel_analysis_reports SET generation_key='',reuse_key='' WHERE id=$1", [legacy.reportId])
  await runNovelAnalysis(t.db, 'book', legacy.reportId, legacy.taskId, {}, readingModel())
  expect(await countRows('novel_analysis_readings')).toBe(0)
  expect((await create('request-after-legacy')).created).toBe(true)
})


it('重映射只更换引用标记，保留原文中的同名编号', async () => {
  await useLongRange()
  await t.db.query("UPDATE chapters SET content=content || '设备编号是 S2。' WHERE id='c2'")
  const original = await create()
  await runNovelAnalysis(t.db, 'book', original.reportId, original.taskId, {}, async options => {
    if (options.tools) return answer('完整分析 [[S1]]')
    const source = JSON.parse(options.messages[1]!.content).sources[0]
    return answer(source.id === 'S2' ? '设备编号是“S2”。[[S2]]' : '转交钥匙。[[S1]]')
  })
  const narrow = await createAnalysis(t.db, 'admin', 'book', { ...input, startChapterId: 'c2' }, 'request-labels')
  await runNovelAnalysis(t.db, 'book', narrow.reportId, narrow.taskId, {}, readingModel())
  expect((await readAnalysis(t.db, 'book', narrow.reportId)).notes[0]?.content).toBe('设备编号是“S2”。[[S1]]')
})

it('恢复时更换模型仍保留进度，但混用配置的报告不能冒充原配置的可复用结果', async () => {
  await useLongRange()
  const receipt = await create()
  let calls = 0
  await runNovelAnalysis(t.db, 'book', receipt.reportId, receipt.taskId, {}, async () => {
    if (++calls === 2) throw new AiError('upstream', '暂停')
    return answer('首段阅读 [[S1]]')
  })
  await withProviderSnapshot(async () => {
    const next = await resumeAnalysis(t.db, 'admin', 'book', receipt.reportId)
    await runNovelAnalysis(t.db, 'book', receipt.reportId, next.taskId, {}, readingModel())
  }, { text: { baseUrl: 'https://example.test/v1', apiKey: 'test', model: 'new-model' } })
  expect((await requireAnalysis(t.db, 'book', receipt.reportId)).reuse_key).toBe('')
  expect((await create('request-after-mixed')).created).toBe(true)
})


it('补读不跨越已缓存的中间段，底稿整体保持章节顺序', async () => {
  await t.db.query("UPDATE chapters SET content=repeat('甲。',2500) WHERE novel_id='book'")
  await t.db.query("INSERT INTO chapters(id,novel_id,title,content,sort_order,created_at) VALUES('c3','book','第三章',repeat('乙。',2500),30,1),('c4','book','第四章',repeat('丙。',3500),40,1)")
  const request = { ...input, endChapterId: 'c4' }
  const sources = await captureAnalysisSources(t.db, 'book', request)
  const key = analysisGenerationKey((await getAiSettings(t.db)).storyMemoryReasoningMode)
  await saveSharedAnalysisReading(t.db, 'book', key, [sources[1]!], '中间章事实 [[S2]]')
  const receipt = await createAnalysis(t.db, 'admin', 'book', request, 'request-gap')
  const invoke = readingModel()
  await runNovelAnalysis(t.db, 'book', receipt.reportId, receipt.taskId, {}, invoke)
  const readings = invoke.mock.calls.filter(([options]) => !options.tools)
    .map(([options]) => JSON.parse(options.messages[1]!.content).sources.map((source: { id: string }) => source.id))
  expect(readings).toEqual([['S1'], ['S3', 'S4']])
  const report = await readAnalysis(t.db, 'book', receipt.reportId)
  expect(report.notes.map(note => note.sourceIds)).toEqual([['S1'], ['S2'], ['S3', 'S4']])
  expect(report.reusedSources).toBe(1)
})


it('冻结新任务的输出上限，继续分析采用新设置且高思考不自动加倍', async () => {
  const previous = await getAiSettings(t.db)
  try {
    await saveAiSettings(t.db, { novelAnalysisReportMaxTokens: 7000, storyMemoryReasoningMode: 'high' })
    const receipt = await create()
    await saveAiSettings(t.db, { novelAnalysisReportMaxTokens: 9000 })
    await runNovelAnalysis(t.db, 'book', receipt.reportId, receipt.taskId, {}, async options => {
      expect(options.maxTokens).toBe(7000)
      return { ...answer('半截'), finishReason: 'length', completionTokens: 7000 }
    })
    expect(await readAnalysis(t.db, 'book', receipt.reportId)).toMatchObject({ status: 'failed', phase: 'report', content: '' })
    const resumed = await resumeAnalysis(t.db, 'admin', 'book', receipt.reportId)
    await runNovelAnalysis(t.db, 'book', resumed.reportId, resumed.taskId, {}, async options => {
      expect(options.maxTokens).toBe(9000)
      return answer('完整报告 [[S1]]')
    })
    expect((await readAnalysis(t.db, 'book', receipt.reportId)).status).toBe('completed')
  } finally { await saveAiSettings(t.db, previous) }
})

it('整理截断自动拆小，已完成分组和游标一起保存，继续时跳过已完成分组', async () => {
  const previous = await getAiSettings(t.db)
  try {
    await saveAiSettings(t.db, { novelAnalysisCondenseMaxTokens: 7200, novelAnalysisReportMaxTokens: 9100 })
    await t.db.query("UPDATE chapters SET sort_order=130 WHERE id='c2'")
    for (let i = 1; i <= 10; i++) await t.db.query("INSERT INTO chapters(id,novel_id,title,content,sort_order,created_at) VALUES($1,'book',$1,'正文',$2,1)", [`extra-${i}`, 10 + i * 10])
    const receipt = await create()
    const captured = await requireAnalysis(t.db, 'book', receipt.reportId)
    const notes = captured.source_json.map(source => ({ sourceIds: [source.id], content: '记录。'.repeat(1000) }))
    await t.db.query('UPDATE novel_analysis_reports SET notes_json=$1::jsonb WHERE id=$2', [JSON.stringify(notes), receipt.reportId])
    let count = 0
    await runNovelAnalysis(t.db, 'book', receipt.reportId, receipt.taskId, {}, async options => {
      expect(options.maxTokens).toBe(7200)
      const group = JSON.parse(options.messages[1]!.content).notes
      count++
      if (count === 1) {
        expect(group).toHaveLength(3)
        return { ...answer('未完整的归并'), finishReason: 'length', completionTokens: 7200 }
      }
      if (count === 2) {
        expect(group).toHaveLength(2)
        return answer('已保存的第一组。'.repeat(100))
      }
      throw new AiError('timeout', '模拟超时')
    })
    expect(count).toBe(3)
    const failed = await readAnalysis(t.db, 'book', receipt.reportId)
    expect(failed).toMatchObject({ status: 'failed', phase: 'condensing', notes, processed: 12, content: '' })
    expect(failed.error).toBe('模拟超时')
    expect((await requireAnalysis(t.db, 'book', receipt.reportId)).synthesis_json?.[0]?.sourceIds).toEqual(['S1', 'S2'])
    expect((await listAnalyses(t.db, 'book')).reports[0]?.phase).toBe('condensing')
    await saveAiSettings(t.db, { novelAnalysisCondenseMaxTokens: 8000 })
    const resumed = await resumeAnalysis(t.db, 'admin', 'book', receipt.reportId)
    let resumedCalls = 0
    await runNovelAnalysis(t.db, 'book', resumed.reportId, resumed.taskId, {}, async options => {
      resumedCalls++
      if (resumedCalls === 1) {
        expect(options.maxTokens).toBe(8000)
        expect(JSON.parse(options.messages[1]!.content).notes.map((note: { sourceIds: string[] }) => note.sourceIds)).toEqual([['S3'], ['S4']])
        return answer('第二组摘要 [[S3]] [[S4]]')
      }
      expect(options.maxTokens).toBe(9100)
      return answer('最终报告 [[S1]]')
    })
    expect(resumedCalls).toBe(2)
    expect(await readAnalysis(t.db, 'book', receipt.reportId)).toMatchObject({ status: 'completed', notes })
  } finally { await saveAiSettings(t.db, previous) }
})

it('分段阅读使用独立上限，后续报告保留各自预算', async () => {
  const previous = await getAiSettings(t.db)
  try {
    await saveAiSettings(t.db, { novelAnalysisReadingMaxTokens: 7100, novelAnalysisReportMaxTokens: 9300 })
    await useLongRange()
    const receipt = await create()
    let readings = 0
    await runNovelAnalysis(t.db, 'book', receipt.reportId, receipt.taskId, {}, async options => {
      if (!options.tools) { readings++; expect(options.maxTokens).toBe(7100); return answer('简短阅读记录 [[S1]]') }
      expect(options.maxTokens).toBe(9300)
      return answer('完整报告 [[S1]]')
    })
    expect(readings).toBeGreaterThan(0)
    expect((await readAnalysis(t.db, 'book', receipt.reportId)).status).toBe('completed')
  } finally { await saveAiSettings(t.db, previous) }
})


it('删除报告按作品隔离，保留正文、其他报告、共享底稿和用量审计', async () => {
  const receipt = await completeLongAnalysis()
  const report = await readAnalysis(t.db, 'book', receipt.reportId)
  const row = await requireAnalysis(t.db, 'book', receipt.reportId)
  const review = await createAnalysisReview(t.db, 'admin', 'book', receipt.reportId, 'review-delete-01', report.revision)
  const other = await createAnalysis(t.db, 'admin', 'other', { ...input, startChapterId: 'x', endChapterId: 'x' }, 'request-other')
  const usage = await countRows('ai_usage'), readings = await countRows('novel_analysis_readings')
  expect(readings).toBeGreaterThan(0)
  await expect(deleteAnalysis(t.db, 'other', receipt.reportId)).rejects.toMatchObject({ status: 404 })
  expect((await getAiTask(t.db, review.taskId))?.status).toBe('queued')
  const events = vi.fn()
  const unsubscribe = subscribeAiTask(review.taskId, events)
  try { await deleteAnalysis(t.db, 'book', receipt.reportId) } finally { unsubscribe() }
  await expect(requireAnalysis(t.db, 'book', receipt.reportId)).rejects.toMatchObject({ status: 404 })
  expect((await listAnalyses(t.db, 'book')).reports).toHaveLength(0)
  expect(await first(t.db, 'SELECT id FROM novel_analysis_reviews WHERE report_id=$1', [receipt.reportId])).toBeUndefined()
  expect(await first(t.db, 'SELECT report_id FROM novel_analysis_requests WHERE report_id=$1', [receipt.reportId])).toBeUndefined()
  expect((await getAiTask(t.db, review.taskId))?.status).toBe('cancelled')
  expect((await getAiTask(t.db, receipt.taskId))?.status).toBe('completed')
  expect(events).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }))
  expect((await getAiTask(t.db, other.taskId))?.status).toBe('queued')
  expect(await requireAnalysis(t.db, 'other', other.reportId)).toBeTruthy()
  expect(await countRows('ai_usage')).toBe(usage)
  expect(await countRows('novel_analysis_readings')).toBe(readings)
  expect(await first(t.db, "SELECT content FROM chapters WHERE id='c1'")).toMatchObject({ content: expect.stringContaining('青遥把钥匙交给阿宁') })
  // A GET which captured the report before deletion cannot recreate citation rows.
  await expect(saveAnalysisEvidence(t.db, row)).resolves.toBeTruthy()
  expect(await first(t.db, 'SELECT id FROM novel_analysis_reviews WHERE report_id=$1', [receipt.reportId])).toBeUndefined()
  await expect(deleteAnalysis(t.db, 'book', receipt.reportId)).rejects.toMatchObject({ status: 404 })
})

it('删除进行中报告后迟到阅读不能恢复报告或写入共享底稿，仍记录已发生的用量', async () => {
  await useLongRange()
  const receipt = await create()
  const invoke = vi.fn<typeof chat>(async () => {
    await deleteAnalysis(t.db, 'book', receipt.reportId)
    return answer('迟到的阅读结果 [[S1]]')
  })
  await runNovelAnalysis(t.db, 'book', receipt.reportId, receipt.taskId, {}, invoke)
  expect(invoke).toHaveBeenCalledTimes(1)
  expect((await getAiTask(t.db, receipt.taskId))?.status).toBe('cancelled')
  await expect(requireAnalysis(t.db, 'book', receipt.reportId)).rejects.toMatchObject({ status: 404 })
  expect(await countRows('novel_analysis_readings')).toBe(0)
  expect(await countRows('ai_usage')).toBe(1)
  await expect(resumeAnalysis(t.db, 'admin', 'book', receipt.reportId)).rejects.toMatchObject({ status: 404 })
  expect((await create('request-after-delete')).created).toBe(true)
})

it('删除报告同时停止运行中的核查，迟到核查不能写回结果', async () => {
  const receipt = await create()
  await runNovelAnalysis(t.db, 'book', receipt.reportId, receipt.taskId, {}, async () => answer('青遥把钥匙交给阿宁。[[S1]]'))
  const report = await readAnalysis(t.db, 'book', receipt.reportId)
  const review = await createAnalysisReview(t.db, 'admin', 'book', receipt.reportId, 'review-delete-02', report.revision)
  const usage = await countRows('ai_usage')
  const invoke = vi.fn<typeof chat>(async () => {
    await deleteAnalysis(t.db, 'book', receipt.reportId)
    return answer('{}')
  })
  await runAnalysisReview(t.db, 'book', receipt.reportId, review.reviewId, review.taskId, {}, invoke)
  expect(invoke).toHaveBeenCalledTimes(1)
  expect((await getAiTask(t.db, review.taskId))?.status).toBe('cancelled')
  expect(await first(t.db, 'SELECT id FROM novel_analysis_reviews WHERE report_id=$1', [receipt.reportId])).toBeUndefined()
  expect(await countRows('ai_usage')).toBe(usage + 1)
  await expect(createAnalysisReview(t.db, 'admin', 'book', receipt.reportId, 'review-delete-03', report.revision)).rejects.toMatchObject({ status: 404 })
})

it('删除落库失败时回滚任务取消与报告删除，不提前发布取消事件', async () => {
  const receipt = await create()
  const events = vi.fn()
  const unsubscribe = subscribeAiTask(receipt.taskId, events)
  await t.db.query("CREATE FUNCTION reject_analysis_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test-delete-failure'; END $$")
  await t.db.query('CREATE TRIGGER reject_analysis_delete BEFORE DELETE ON novel_analysis_reports FOR EACH ROW EXECUTE FUNCTION reject_analysis_delete()')
  try {
    await expect(deleteAnalysis(t.db, 'book', receipt.reportId)).rejects.toThrow('test-delete-failure')
    expect((await getAiTask(t.db, receipt.taskId))?.status).toBe('queued')
    expect(await requireAnalysis(t.db, 'book', receipt.reportId)).toBeTruthy()
    expect(events).not.toHaveBeenCalled()
  } finally {
    unsubscribe()
    await t.db.query('DROP TRIGGER reject_analysis_delete ON novel_analysis_reports')
    await t.db.query('DROP FUNCTION reject_analysis_delete()')
  }
})

it('删除接口要求管理员并校验作品，重复删除返回不存在', async () => {
  const previousUrl = process.env.DATABASE_URL
  process.env.DATABASE_URL = 'postgres://isolated/test'
  setDbForTests(t.db)
  try {
    const receipt = await create()
    await t.db.query("INSERT INTO users(id,username,role,password_hash,password_salt,created_at,updated_at) VALUES('reader','reader','reader','test','test',1,1) ON CONFLICT DO NOTHING")
    const admin = await createSession(t.db, 'admin', 'test', loadConfig().sessionHashSalt)
    const reader = await createSession(t.db, 'reader', 'test', loadConfig().sessionHashSalt)
    const base = `/api/ai/analysis/book/${receipt.reportId}`
    const remove = (path: string, token = '') => app.request(path, { method: 'DELETE', headers: token ? { Authorization: `Bearer ${token}` } : {} })
    expect((await remove(base)).status).toBe(401)
    expect((await remove(base, reader)).status).toBe(403)
    expect((await remove(base.replace('/book/', '/other/'), admin)).status).toBe(404)
    expect((await getAiTask(t.db, receipt.taskId))?.status).toBe('queued')
    const response = await remove(base, admin)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(await response.json()).toEqual({ ok: true })
    expect((await remove(base, admin)).status).toBe(404)
  } finally {
    setDbForTests(null)
    if (previousUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = previousUrl
  }
})
