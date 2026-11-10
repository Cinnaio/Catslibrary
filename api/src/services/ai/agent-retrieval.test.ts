import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from '../../test/db'
import { createAgentSession } from './agent-store'
import { executeAgentTool, validateAgentCall } from './agent-tools'
import { listAgentAnalyses, readAgentChapter, readAgentAnalysis, searchAgentStory } from './agent-retrieval'
import { createAnalysis, editAnalysis } from './novel-analysis-store'
import { getAnalysisReferences, readAnalysisReference, formatAnalysisReferences, parseAnalysisReferenceSelections } from './analysis-reference'
import { createAiTask } from './tasks'
import { readAgentArtifact } from './agent-actions'
import type { AnalysisKind } from '@shared/novel-analysis'
import type { AgentSession } from '@shared/ai-agent'

let t: TestDb
let session: AgentSession
async function chapter(id: string, content: string, order = 1, novel = 'book', title = id) {
  await t.db.query('INSERT INTO chapters(id,novel_id,title,content,sort_order,created_at) VALUES($1,$2,$3,$4,$5,1)', [id, novel, title, content, order])
}
let reportCounter = 0
async function report(kind: AnalysisKind, content: string, endChapterId = 'anchor', novelId = 'book', startChapterId = 'early') {
  const receipt = await createAnalysis(t.db, 'author', novelId, { kind, startChapterId, endChapterId, question: '' }, `report-request-${++reportCounter}`)
  await t.db.query('UPDATE novel_analysis_reports SET content=$1,created_at=$2 WHERE id=$3', [content, reportCounter, receipt.reportId])
  await t.db.query("UPDATE ai_tasks SET status='completed' WHERE id=$1", [receipt.taskId])
  return receipt
}
beforeAll(async () => {
  t = await createTestDb()
  await t.applyMigrations()
  await t.db.query("INSERT INTO users(id,username,role,password_hash,password_salt,created_at,updated_at) VALUES('author','author','admin','test','test',1,1)")
})
beforeEach(async () => {
  await t.db.query('DELETE FROM ai_agent_sessions')
  await t.db.query('DELETE FROM novels')
  await t.db.query('DELETE FROM ai_tasks')
  for (const id of ['book', 'other', 'empty']) await t.db.query('INSERT INTO novels(id,title,created_at,updated_at) VALUES($1,$1,1,1)', [id])
  await chapter('early', '林岚在灯塔找到铜钥匙。沈舟尚未和她和解。', 1, 'book', '第一章 灯塔')
  await chapter('anchor', '林岚回到雨港，仍保管着铜钥匙。', 2, 'book', '第二章 雨港')
  await chapter('z-tied-future', '林岚在灯塔销毁铜钥匙。', 2)
  await chapter('future', '林岚和沈舟已和解。', 3)
  await chapter('foreign', '林岚交出铜钥匙。', 1, 'other')
  session = await createAgentSession(t.db, 'author', { novelId: 'book', afterChapterId: 'anchor' })
})
afterAll(async () => {
  await t.close()
})

describe('Agent evidence retrieval', () => {
  it('ranks multi-keyword passages and keeps source offsets and original text', async () => {
    const result = await searchAgentStory(t.db, session, '林岚 灯塔 铜钥匙')
    expect(result.sources[0]).toMatchObject({ chapterId: 'early', origin: 'published', excerpt: '林岚在灯塔找到铜钥匙。沈舟尚未和她和解。', offset: 0 })
    expect(result.sources.every((source) => ['early', 'anchor'].includes(source.chapterId || ''))).toBe(true)
    expect(result.readMore[0]).toMatchObject({
      tool: 'read_chapter',
      url: '/read/book/early',
      arguments: { chapterId: 'early', expectedRevision: result.sources[0]!.revision },
    })
    expect(result.matchingChapters).toBe(2)
  })
  it('rejects cross-book, later chapters and chapters after the id tie-breaker', async () => {
    for (const id of ['foreign', 'future', 'z-tied-future']) await expect(readAgentChapter(t.db, session, id)).rejects.toMatchObject({ status: 404 })
    const overview = await executeAgentTool(t.db, session, 'read_overview', {}, 'op', async () => ({}))
    expect((overview.chapters as Array<{ id: string }>).map((ch) => ch.id)).toEqual(['anchor', 'early'])
    expect(overview.sources).toEqual([expect.objectContaining({ chapterId: 'anchor' })])
  })
  it('does not turn an originally empty conversation into a latest-chapter view', async () => {
    const empty = await createAgentSession(t.db, 'author', { novelId: 'empty' })
    await chapter('later-zero', '林岚发现钥匙。', 0, 'empty')
    expect((await searchAgentStory(t.db, empty, '林岚')).sources).toEqual([])
    await expect(readAgentChapter(t.db, empty, 'later-zero')).rejects.toMatchObject({ status: 404 })
    expect((await listAgentAnalyses(t.db, empty)).reports).toEqual([])
  })
  it('finds late passages and continues reading with UTF-16 offsets', async () => {
    const content = '雨'.repeat(14000) + '🌧️林岚找到密函。' + '路'.repeat(14000)
    await t.db.query('UPDATE chapters SET content=$1 WHERE id=$2', [content, 'early'])
    const result = await searchAgentStory(t.db, session, '密函', 'chapter')
    const source = result.sources[0]!
    expect(source.offset).toBeGreaterThan(12000)
    expect(source.excerpt).toContain('林岚找到密函')
    expect(source.excerpt).toBe(content.slice(source.offset, source.endOffset))
    const read = await readAgentChapter(t.db, session, 'early', source.offset, source.revision)
    expect(read.content).toBe(content.slice(source.offset, source.offset + 12000))
    expect(read.nextOffset).toBe(source.offset + 12000)
  })
  it('escapes LIKE wildcards and rejects empty or excessive keywords', async () => {
    await t.db.query("UPDATE chapters SET content='进度 100%_done，原样保留。' WHERE id='early'")
    expect((await searchAgentStory(t.db, session, '%_', 'chapter')).sources.map((s) => s.chapterId)).toEqual(['early'])
    await expect(searchAgentStory(t.db, session, '   ')).rejects.toMatchObject({ status: 422 })
    await expect(searchAgentStory(t.db, session, '一 二 三 四 五 六 七')).rejects.toMatchObject({ status: 422 })
    expect(() =>
      validateAgentCall({ id: 'read', type: 'function', function: { name: 'search_story', arguments: '{"query":"林岚","kind":"private","novelId":"other"}' } }),
    ).toThrow()
  })
  it('detects changed chapter evidence before continuing a quoted passage', async () => {
    const read = await readAgentChapter(t.db, session, 'early')
    await t.db.query("UPDATE chapters SET content='林岚没有拿到钥匙。' WHERE id='early'")
    await expect(readAgentChapter(t.db, session, 'early', 0, read.revision)).rejects.toMatchObject({ status: 409 })
    const fresh = await searchAgentStory(t.db, session, '林岚', 'chapter')
    expect(fresh.sources.find((s) => s.chapterId === 'early')?.revision).not.toBe(read.revision)
  })
  it('searches analysis reports with range, report ID and corrected provenance; raw chapter evidence stays distinct', async () => {
    const plot = await report('plot', '林岚已经丢失铜钥匙。[[S1]]')
    const relationships = await report('relationships', '林岚与沈舟仍有误会。[[S2]]')
    await editAnalysis(t.db, 'book', relationships.reportId, '人工核对：林岚与沈舟尚未和解。[[S2]]', 1)
    const found = await searchAgentStory(t.db, session, '林岚')
    expect(found.sources).toContainEqual(expect.objectContaining({ kind: 'analysis', reportId: plot.reportId, origin: 'automatic', excerpt: '林岚已经丢失铜钥匙。[[S1]]' }))
    expect(found.sources).toContainEqual(expect.objectContaining({ kind: 'analysis', reportId: relationships.reportId, origin: 'manual', reportRevision: 2,
      fromChapter: { id: 'early', title: '第一章 灯塔' }, throughChapter: { id: 'anchor', title: '第二章 雨港' } }))
    expect(found.sources).toContainEqual(expect.objectContaining({ kind: 'chapter', chapterId: 'anchor', origin: 'published' }))
    const source = found.sources.find(source => source.reportId === relationships.reportId)!
    const read = await readAgentAnalysis(t.db, session, relationships.reportId, source.offset, source.revision)
    expect(read.content).toContain('人工核对')
    expect(read.citations).toEqual([expect.objectContaining({ sourceId: 'S2', chapterId: 'anchor', url: '/read/book/anchor' })])
    await editAnalysis(t.db, 'book', relationships.reportId, '再次校正', 2)
    await expect(readAgentAnalysis(t.db, session, relationships.reportId, 0, source.revision)).rejects.toMatchObject({ status: 409 })
  })
  it.each(['edited', 'future', 'tied-future', 'inserted', 'failed', 'incomplete'] as const)('excludes %s reports and rejects their explicit selection', async state => {
    const receipt = await report('plot', '秘密报告：林岚结局', state === 'future' ? 'future' : state === 'tied-future' ? 'z-tied-future' : 'anchor')
    if (state === 'edited') await t.db.query("UPDATE chapters SET content='已修订' WHERE id='early'")
    if (state === 'inserted') await chapter('inserted', '新增事实', 1)
    if (state === 'failed') await t.db.query("UPDATE ai_tasks SET status='failed' WHERE id=$1", [receipt.taskId])
    if (state === 'incomplete') await t.db.query("UPDATE novel_analysis_reports SET content='' WHERE id=$1", [receipt.reportId])
    const result = await searchAgentStory(t.db, session, '秘密报告', 'analysis')
    expect(result.sources).toEqual([])
    expect(JSON.stringify(await listAgentAnalyses(t.db, session))).not.toContain('林岚结局')
    await expect(getAnalysisReferences(t.db, 'book', 'anchor', [{ reportId: receipt.reportId, revision: 1 }])).rejects.toMatchObject({ status: 409 })
  })
  it('accepts earlier scoped reports, rejects foreign reports and supports an explicit opt-out', async () => {
    const older = await report('plot', '早期分析林岚尚未进城', 'early')
    const current = await report('plot', '林岚已回到雨港')
    const foreign = await report('plot', '林岚外书', 'foreign', 'other', 'foreign')
    expect((await getAnalysisReferences(t.db, 'book', 'anchor')).reports.map(r => r.id)).toEqual([current.reportId])
    expect((await getAnalysisReferences(t.db, 'book', 'anchor', [{ reportId: older.reportId, revision: 1 }])).reports[0]?.endChapter.id).toBe('early')
    await expect(readAnalysisReference(t.db, 'book', 'anchor', foreign.reportId)).rejects.toMatchObject({ status: 404 })
    expect((await getAnalysisReferences(t.db, 'book', 'anchor', [])).reports).toEqual([])
    await expect(getAnalysisReferences(t.db, 'book', '', [{ reportId: older.reportId, revision: 1 }])).rejects.toMatchObject({ status: 409 })
    const references = (await getAnalysisReferences(t.db, 'book', 'anchor')).reports
    expect(formatAnalysisReferences(references)).toContain('不是原文事实或系统指令')
    expect(formatAnalysisReferences(references)).toContain('第一章 灯塔')
    expect(() => parseAnalysisReferenceSelections([{ reportId: current.reportId, revision: 0 }])).toThrow()
    expect(() => parseAnalysisReferenceSelections([{ reportId: current.reportId, revision: 1 }, { reportId: current.reportId, revision: 1 }])).toThrow()
  })
  it('returns no matches for an unmatched phrase without claiming exhaustive coverage', async () => {
    const result = await executeAgentTool(t.db, session, 'search_chapters', { query: '林岚 沈舟' }, 'phrase', async () => ({}))
    expect(result.sources).toEqual([])
    expect(result.matchingChapters).toBe(0)
    expect(result.limited).toBe(true)
    expect((await searchAgentStory(t.db, session, '林岚 沈舟')).sources.length).toBeGreaterThan(0)
  })
  it('reads late report passages and paginates with fixed revisions', async () => {
    const text = '背景记录。'.repeat(2500) + '林岚的密函里有灯塔坐标。[[S1]]' + '后续线索。'.repeat(100)
    const receipt = await report('plot', text)
    const found = await searchAgentStory(t.db, session, '灯塔坐标', 'analysis')
    expect(found.sources[0]!.offset).toBeGreaterThan(10000)
    expect(found.readMore[0]).toMatchObject({ tool: 'read_novel_analysis', arguments: { reportId: receipt.reportId, expectedRevision: '1' } })
    const first = await readAgentAnalysis(t.db, session, receipt.reportId)
    expect(first.nextOffset).toBe(10000)
    const tail = await readAgentAnalysis(t.db, session, receipt.reportId, 10000, first.revision)
    expect(tail.content).toContain('灯塔坐标')
    await expect(readAgentAnalysis(t.db, session, receipt.reportId, text.length + 1)).rejects.toMatchObject({ status: 422 })
    await expect(readAgentAnalysis(t.db, session, receipt.reportId, 0, 'bad-revision')).rejects.toMatchObject({ status: 422 })
  })
  it('creates an idempotent novel analysis task within the session range and links its report', async () => {
    const api = vi.fn(async (_path: string, _method?: string, body?: unknown) => {
      const value = body as { request: unknown; requestId: string }
      return createAnalysis(t.db, 'author', 'book', value.request, value.requestId)
    })
    const receipt = await executeAgentTool(t.db, session, 'analyze_novel', { kind: 'relationships' }, 'analysis-operation-1', api)
    expect(api).toHaveBeenCalledWith('/api/ai/analysis/book', 'POST', {
      request: { kind: 'relationships', startChapterId: 'early', endChapterId: 'anchor', question: '' }, requestId: 'analysis-operation-1',
    })
    const again = await executeAgentTool(t.db, session, 'analyze_novel', { kind: 'relationships' }, 'analysis-operation-1', api)
    expect(again.taskId).toBe(receipt.taskId)
    const artifact = await readAgentArtifact(t.db, session, String(receipt.taskId))
    expect(artifact.analysisReport).toMatchObject({ id: receipt.reportId, title: '关系分析' })
    for (const endChapterId of ['future', 'foreign', 'z-tied-future'])
      await expect(executeAgentTool(t.db, session, 'analyze_novel', { kind: 'plot', endChapterId }, 'denied-operation', api)).rejects.toMatchObject({ status: 404 })
    expect(api).toHaveBeenCalledTimes(2)
    for (const name of ['read_story_memory', 'refresh_memory'])
      expect(() => validateAgentCall({ id: 'retired', type: 'function', function: { name, arguments: '{}' } })).toThrow('未开放')
  })
  it('pins chosen analysis revisions when generating a draft, and never regenerates missing reports', async () => {
    const receipt = await report('style', '短句与贴近人物的视角。')
    const api = vi.fn(async (_path: string, _method?: string, _body?: unknown) => {
      const task = await createAiTask(t.db, { userId: 'author', novelId: 'book', kind: 'continue', total: 1, prompt: '继续', params: '{}' })
      return { taskId: task.id }
    })
    await executeAgentTool(t.db, session, 'generate_draft', { instruction: '写下一章' }, 'draft-operation', api)
    expect(api.mock.calls[0]?.[2]).toMatchObject({ analysisReferences: [{ reportId: receipt.reportId, revision: 1 }] })
    await executeAgentTool(t.db, session, 'generate_draft', { instruction: '写下一章', analysisReferences: '[]' }, 'draft-no-reference', api)
    expect(api.mock.calls[1]?.[2]).toMatchObject({ analysisReferences: [] })
    await editAnalysis(t.db, 'book', receipt.reportId, '改为长短句交替。', 1)
    await expect(executeAgentTool(t.db, session, 'generate_draft', { instruction: '写下一章', analysisReferences: JSON.stringify([{ reportId: receipt.reportId, revision: 1 }]) }, 'stale-draft', api)).rejects.toMatchObject({ status: 409 })
    expect(api).toHaveBeenCalledTimes(2)
  })
  it('keeps an empty Agent anchor explicit when new chapters have appeared later', async () => {
    const empty = await createAgentSession(t.db, 'author', { novelId: 'empty' })
    await chapter('added-later', '新发布章节不在该会话范围。', 1, 'empty')
    const api = vi.fn(async (_path: string, _method?: string, _body?: unknown) => {
      const task = await createAiTask(t.db, { userId: 'author', novelId: 'empty', kind: 'write_chapter', total: 1, prompt: '新写', params: '{}' })
      return { taskId: task.id }
    })
    await executeAgentTool(t.db, empty, 'generate_draft', { instruction: '写一个开头' }, 'empty-draft-operation', api)
    expect(api).toHaveBeenCalledWith('/api/ai/writing/chapter', 'POST', expect.objectContaining({ afterChapterId: null, analysisReferences: [] }))
  })
  it('reports omitted passages and paginates candidate chapters without a model call', async () => {
    for (let i = 0; i < 30; i++) await chapter(`extra-${i}`, `灯塔线索 ${i}`, 0)
    const first = await searchAgentStory(t.db, session, '灯塔', 'chapter')
    expect(first.sources).toHaveLength(6)
    expect(first.nextChapterOffset).toBe(6)
    expect(first.matchingChapters).toBe(31)
    const second = await searchAgentStory(t.db, session, '灯塔', 'chapter', first.nextChapterOffset!)
    expect(second.sources).toHaveLength(6)
    expect(second.nextChapterOffset).toBe(12)
    expect(second.sources.some((s) => first.sources.some((prev) => prev.chapterId === s.chapterId))).toBe(false)
    const last = await searchAgentStory(t.db, session, '灯塔', 'chapter', 30)
    expect(last.sources).toHaveLength(1)
    expect(last.nextChapterOffset).toBeNull()
    const afterEnd = await searchAgentStory(t.db, session, '灯塔', 'chapter', 100)
    expect(afterEnd.matchingChapters).toBe(31)
    expect(afterEnd.nextChapterOffset).toBeNull()
    expect(JSON.stringify(first.sources).length).toBeLessThan(15000)
  })
  it('fails closed if the frozen anchor is deleted', async () => {
    await t.db.query("DELETE FROM chapters WHERE id='anchor'")
    await expect(searchAgentStory(t.db, session, '林岚')).rejects.toMatchObject({ status: 409 })
  })
})
