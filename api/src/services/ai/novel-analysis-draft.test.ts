import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import type { AnalysisDraft } from '@shared/novel-analysis'
import { createTestDb, type TestDb } from '../../test/db'
import { first } from '../../db/query'
import { AiError, type AiChatResult, type chat } from './client'
import { runNovelAnalysis } from './novel-analysis'
import { createAnalysis, deleteAnalysis, editAnalysis, readAnalysis, requireAnalysis, resumeAnalysis, stopAnalysis } from './novel-analysis-store'
import { getAiSettings, saveAiSettings } from './settings'
import { reconcileAnalysisDraft } from './novel-analysis-draft'

let t: TestDb
const answer = (text: string): AiChatResult => ({ text, model: 'test', finishReason: 'stop', promptTokens: 10, completionTokens: 10, cost: 0, tokenUsageReported: true })
const outline = JSON.stringify({ overview: '青遥将钥匙交给阿宁，次日会面只是计划。', sections: [
  { title: '信任变化', focus: '交接钥匙的含义', sourceIds: ['S1'] },
  { title: '后续约定', focus: '区分计划和实际行动', sourceIds: ['S2'] },
] })
const stage = (options: Parameters<typeof chat>[0]) => {
  const prompt = options.messages[0]!.content
  if (prompt.includes('为长篇分析规划目录')) return 'outline'
  if (prompt.includes('当前小节输出过长')) return 'split'
  if (prompt.includes('核对提供的全部小节')) return 'consistency'
  return 'section'
}
const payload = (options: Parameters<typeof chat>[0]) => JSON.parse(options.messages[1]!.content)
const create = async () => {
  const receipt = await createAnalysis(t.db, 'admin', 'book', { kind: 'relationships', startChapterId: 'c1', endChapterId: 'c2', question: '' }, 'request-sections')
  // A legacy interrupted report already has its reading/consolidation checkpoints.
  const notes = [{ sourceIds: ['S1', 'S2'], content: '钥匙已交接，会面仍是计划。[[S1]] [[S2]]' }]
  await t.db.query('UPDATE novel_analysis_reports SET notes_json=$1::jsonb,synthesis_json=$1::jsonb WHERE id=$2', [JSON.stringify(notes), receipt.reportId])
  return receipt
}
beforeAll(async () => { t = await createTestDb(); await t.applyMigrations() })
afterAll(async () => { await t.close() })
beforeEach(async () => {
  await t.db.query('DELETE FROM novels')
  await t.db.query('DELETE FROM ai_tasks')
  await t.db.query('DELETE FROM ai_usage')
  await t.db.query("INSERT INTO users(id,username,role,password_hash,password_salt,created_at,updated_at) VALUES('admin','admin','admin','test','test',1,1) ON CONFLICT DO NOTHING")
  await t.db.query("INSERT INTO novels(id,title,created_at,updated_at) VALUES('book','测试小说',1,1)")
  await t.db.query("INSERT INTO chapters(id,novel_id,title,content,sort_order,created_at) VALUES('c1','book','交接','青遥把钥匙交给阿宁。',10,1),('c2','book','约定','阿宁计划明早去找青遥。',20,1)")
})

it('旧检查点进入分节流程，失败仅保留完整小节，换上限续跑不重读或重写已完成节', async () => {
  const receipt = await create()
  const initial = await requireAnalysis(t.db, 'book', receipt.reportId)
  const calls: string[] = []
  await runNovelAnalysis(t.db, 'book', receipt.reportId, receipt.taskId, {}, async options => {
    calls.push(stage(options))
    if (stage(options) === 'outline') return answer(outline)
    expect(payload(options).notes).toEqual(initial.notes_json)
    expect(payload(options).overview).toContain('会面只是计划')
    if (payload(options).section.id === '1') return answer('阿宁接过钥匙。[[S1]]')
    throw new AiError('timeout', '暂时超时')
  })
  expect(calls).toEqual(['outline', 'section', 'section'])
  const paused = await readAnalysis(t.db, 'book', receipt.reportId)
  expect(paused).toMatchObject({ status: 'failed', content: '', revision: 1, processed: 2 })
  expect(paused.draft?.sections.map(section => section.content)).toEqual(['阿宁接过钥匙。[[S1]]', ''])
  await expect(editAnalysis(t.db, 'book', receipt.reportId, '不能把草稿冒充完整报告', 1)).rejects.toMatchObject({ status: 409 })
  const settings = await getAiSettings(t.db)
  try {
    await saveAiSettings(t.db, { novelAnalysisReportMaxTokens: 12000 })
    const next = await resumeAnalysis(t.db, 'admin', 'book', receipt.reportId)
    const resumed: string[] = []
    await runNovelAnalysis(t.db, 'book', receipt.reportId, next.taskId, {}, async options => {
      resumed.push(stage(options))
      expect(options.maxTokens).toBe(12000)
      if (stage(options) === 'consistency') return answer('{"patches":[]}')
      expect(payload(options).section.id).toBe('2')
      return answer('会面尚未发生。[[S2]]')
    })
    expect(resumed).toEqual(['section', 'consistency'])
    expect(await readAnalysis(t.db, 'book', receipt.reportId)).toMatchObject({ status: 'completed', revision: 2,
      content: '## 信任变化\n\n阿宁接过钥匙。[[S1]]\n\n## 后续约定\n\n会面尚未发生。[[S2]]', notes: initial.notes_json })
    expect((await requireAnalysis(t.db, 'book', receipt.reportId)).draft_json?.review).toBe('completed')
  } finally { await saveAiSettings(t.db, settings) }
})

it('截断保存拆分意图，拆分失败后续跑不再生成父节，已完成兄弟节保持原文', async () => {
  const receipt = await create()
  await runNovelAnalysis(t.db, 'book', receipt.reportId, receipt.taskId, {}, async options => {
    if (stage(options) === 'outline') return answer(outline)
    if (stage(options) === 'split') throw new AiError('timeout', '拆分暂时失败')
    return payload(options).section.id === '1' ? answer('已保存的第一节 [[S1]]') : { ...answer('半截不得保存'), finishReason: 'length' }
  })
  expect((await readAnalysis(t.db, 'book', receipt.reportId)).draft).toMatchObject({ splitSectionId: '2', sections: [{ content: '已保存的第一节 [[S1]]' }, { content: '' }] })
  const next = await resumeAnalysis(t.db, 'admin', 'book', receipt.reportId)
  const written: string[] = []
  await runNovelAnalysis(t.db, 'book', receipt.reportId, next.taskId, {}, async options => {
    if (stage(options) === 'split') return answer(JSON.stringify({ sections: [
      { title: '期待', focus: '人物期待', sourceIds: ['S2'] }, { title: '行动', focus: '实际行动', sourceIds: ['S2'] },
    ] }))
    if (stage(options) === 'consistency') return answer('{"patches":[]}')
    written.push(payload(options).section.id)
    return answer('子节已完成 [[S2]]')
  })
  expect(written).toEqual(['2.1', '2.2'])
  const report = await readAnalysis(t.db, 'book', receipt.reportId)
  expect(report.status).toBe('completed')
  expect(report.content).toContain('已保存的第一节')
  expect(report.content).not.toContain('半截')
})

it('跨节核对失败保留全部小节，继续时只核对且仅修改精确匹配的句子', async () => {
  const receipt = await create()
  await runNovelAnalysis(t.db, 'book', receipt.reportId, receipt.taskId, {}, async options => {
    if (stage(options) === 'outline') return answer(outline)
    if (stage(options) === 'consistency') return answer('{"patches":[{"sectionId":"1","before":"不存在的原句","after":"修订"}]}')
    return answer(payload(options).section.id === '1' ? '钥匙仍在青遥手中。[[S1]]' : '会面只是计划。[[S2]]')
  })
  const saved = await readAnalysis(t.db, 'book', receipt.reportId)
  expect(saved.content).toBe('')
  expect(saved.draft?.sections.every(section => section.content)).toBe(true)
  const next = await resumeAnalysis(t.db, 'admin', 'book', receipt.reportId)
  let count = 0
  await runNovelAnalysis(t.db, 'book', receipt.reportId, next.taskId, {}, async options => {
    count++
    expect(stage(options)).toBe('consistency')
    expect(payload(options).sections).toHaveLength(2)
    return answer(JSON.stringify({ patches: [{ sectionId: '1', before: '钥匙仍在青遥手中。', after: '钥匙已交给阿宁。' }] }))
  })
  expect(count).toBe(1)
  const report = await readAnalysis(t.db, 'book', receipt.reportId)
  expect(report.content).toContain('钥匙已交给阿宁。[[S1]]')
  expect(report.content).toContain('会面只是计划。[[S2]]')
})

it.each(['stop', 'delete'] as const)('分节过程中%s，迟到回复不能写回草稿或完整报告，用量仍被记录', async action => {
  const receipt = await create()
  await runNovelAnalysis(t.db, 'book', receipt.reportId, receipt.taskId, {}, async options => {
    if (stage(options) === 'outline') return answer(outline)
    if (action === 'stop') await stopAnalysis(t.db, 'book', receipt.reportId)
    else await deleteAnalysis(t.db, 'book', receipt.reportId)
    return answer('迟到的小节 [[S1]]')
  })
  expect(Number((await first<{ count: string }>(t.db, 'SELECT count(*) FROM ai_usage'))?.count)).toBe(2)
  if (action === 'delete') await expect(requireAnalysis(t.db, 'book', receipt.reportId)).rejects.toMatchObject({ status: 404 })
  else {
    const saved = await readAnalysis(t.db, 'book', receipt.reportId)
    expect(saved).toMatchObject({ status: 'cancelled', content: '' })
    expect(saved.draft?.sections.every(section => !section.content)).toBe(true)
    const next = await resumeAnalysis(t.db, 'admin', 'book', receipt.reportId)
    const old = vi.fn()
    await runNovelAnalysis(t.db, 'book', receipt.reportId, receipt.taskId, {}, old)
    expect(old).not.toHaveBeenCalled()
    await runNovelAnalysis(t.db, 'book', receipt.reportId, next.taskId, {}, async options => {
      expect(stage(options)).not.toBe('outline')
      return answer(stage(options) === 'consistency' ? '{"patches":[]}' : '新的完整小节 [[S1]]')
    })
    expect((await readAnalysis(t.db, 'book', receipt.reportId)).status).toBe('completed')
  }
})

it('反复截断最多拆分两层，正文变化拒绝从旧草稿续跑', async () => {
  const receipt = await create()
  let calls = 0
  await runNovelAnalysis(t.db, 'book', receipt.reportId, receipt.taskId, {}, async options => {
    calls++
    if (stage(options) === 'outline' || stage(options) === 'split') return answer(outline)
    return { ...answer('半截'), finishReason: 'length' }
  })
  expect(calls).toBe(6)
  const report = await readAnalysis(t.db, 'book', receipt.reportId)
  expect(report.status).toBe('failed')
  expect(report.draft?.sections[0]).toMatchObject({ id: '1.1.1', depth: 2, content: '' })
  await t.db.query("UPDATE chapters SET content='正文修改' WHERE id='c1'")
  await expect(resumeAnalysis(t.db, 'admin', 'book', receipt.reportId)).rejects.toMatchObject({ status: 409 })
})

it.each(['ambiguous', 'overlap', 'foreign', 'missing'] as const)('局部核对拒绝%s，错误修订不能部分落入已保存小节', kind => {
  const draft: AnalysisDraft = { version: 1, overview: '概览', review: 'pending', sections: [
    { id: '1', title: '交接', focus: '钥匙', sourceIds: ['S1'], depth: 0, content: '钥匙归阿宁。钥匙归阿宁。后续还未出发。[[S1]]' },
  ] }
  const before = JSON.stringify(draft)
  const patch = { sectionId: '1', before: '后续还未出发。', after: '尚未出发。[[S1]]' }
  const patches = kind === 'ambiguous' ? [{ ...patch, before: '钥匙归阿宁。' }]
    : kind === 'overlap' ? [patch, patch] : kind === 'foreign' ? [{ ...patch, after: '不存在的来源 [[S999]]' }]
      : [patch, { ...patch, sectionId: 'missing' }]
  expect(() => reconcileAnalysisDraft(draft, JSON.stringify({ patches }), new Set(['S1']))).toThrow()
  expect(JSON.stringify(draft)).toBe(before)
})


it('成稿预算跨同一任务的执行保留，显式继续后重新分配预算', async () => {
  const receipt = await create()
  await t.db.query('UPDATE ai_tasks SET result=$1 WHERE id=$2', [JSON.stringify({ phase: 'report', reportRequests: 80 }), receipt.taskId])
  const invoke = vi.fn()
  await runNovelAnalysis(t.db, 'book', receipt.reportId, receipt.taskId, {}, invoke)
  expect(invoke).not.toHaveBeenCalled()
  expect((await readAnalysis(t.db, 'book', receipt.reportId)).error).toContain('80 次请求预算')
  const next = await resumeAnalysis(t.db, 'admin', 'book', receipt.reportId)
  await runNovelAnalysis(t.db, 'book', receipt.reportId, next.taskId, {}, async options => {
    if (stage(options) === 'outline') return answer(outline)
    if (stage(options) === 'consistency') return answer('{"patches":[]}')
    return answer('已完成的小节 [[S1]]')
  })
  expect((await readAnalysis(t.db, 'book', receipt.reportId)).status).toBe('completed')
})

it('来源范围与目录结构无效时停止，不创建草稿或发起小节请求', async () => {
  const receipt = await create()
  let calls = 0
  await runNovelAnalysis(t.db, 'book', receipt.reportId, receipt.taskId, {}, async () => {
    calls++
    return answer(outline.replace('S1', 'S999'))
  })
  expect(calls).toBe(1)
  const report = await readAnalysis(t.db, 'book', receipt.reportId)
  expect(report).toMatchObject({ status: 'failed', content: '' })
  expect(report.draft).toBeUndefined()
  expect(report.error).toContain('范围外来源')
})
