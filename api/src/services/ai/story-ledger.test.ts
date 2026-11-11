import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from '../../test/db'
import { AiError, chat, chatStream } from './client'
import { DEFAULT_AI_SETTINGS, getAiSettings } from './settings'
import { extractPlotState, getPlotStateForAnchor } from './plot-state'
import { extractRelationshipProfile } from './relationship-profile'
import { getMemoryAttempt, getStoryMemoryProgress, pauseStoryMemory } from './story-memory'
import { ledgerAtAnchor } from './story-ledger-store'
import { currentFacts, relevantLedger, renderLedger, workingFacts } from './story-ledger'
import { getEffectiveProfileForAnchor, saveProfileOverride } from './profile-overrides'
import { selectLedgerMaterials } from './story-ledger-materials'
import { generateStoryGraph } from './story-graph'
import { createStoryMemoryTask, preparePublishedMemory } from './story-memory-tasks'
import { planMemoryRebuild, startMemoryRebuild } from './story-memory-rebuild'
import { recordUsage } from './usage'
import { reviewSourcesCurrent } from './writing-review'
import { reviewChapterMemory, REVIEW_ASPECTS } from './story-ledger-review'

vi.mock('./client', async (original) => ({
  ...(await original<typeof import('./client')>()),
  chat: vi.fn(),
  chatStream: vi.fn(),
  isTextAiConfigured: () => true,
  textProvider: () => ({ baseUrl: 'https://example.test', model: 'test' }),
}))
vi.mock('./settings', async (original) => ({ ...(await original<typeof import('./settings')>()), getAiSettings: vi.fn() }))
vi.mock('./usage', () => ({ recordUsage: vi.fn() }))
// Most tests isolate extraction/persistence. The dedicated review integration
// cases below restore the real service and account for both paid requests.
vi.mock('./story-ledger-review', async (original) => ({ ...(await original<typeof import('./story-ledger-review')>()), reviewChapterMemory: vi.fn() }))
let t: TestDb
const opts = { novelId: 'book', userId: 'admin', sampleChapters: 1 }
const prose = ['林舟把铜钥匙交给沈砚，约定共同调查密道。', '沈砚拿着铜钥匙，却误以为林舟已经离城。', '林舟当面告知沈砚自己一直留在城中。']
const reply = (payload: unknown) => ({
  text: JSON.stringify(payload),
  model: 'test',
  promptTokens: 100,
  completionTokens: 50,
  cost: 0.01,
  finishReason: 'stop',
})
const entity = (name: string, kind = 'person', aliases: string[] = []) => ({ name, kind, aliases })
const fact = (values: Record<string, unknown> = {}) => ({
  memoryType: 'state',
  kind: 'state',
  subjects: ['沈砚'],
  label: '持有钥匙',
  summary: '沈砚持有铜钥匙。',
  certainty: 'fact',
  status: 'active',
  scope: 'local',
  replaces: [],
  quote: prose[0],
  ...values,
})
const payload = (facts = [fact()], entities: Array<ReturnType<typeof entity> & { identityQuote?: string; id?: string }> = [entity('林舟'), entity('沈砚')]) => ({
  complete: true,
  needs: [],
  entities,
  facts,
})
async function chapter(index: number, content = prose[index - 1] || `沈砚继续调查第${index}处线索。`) {
  await t.db.query('INSERT INTO chapters(id,novel_id,title,content,sort_order,created_at) VALUES($1,$2,$3,$4,$5,1)', [
    `c${index}`,
    'book',
    `第${index}章`,
    content,
    index,
  ])
}
const input = (index: number) => JSON.parse(vi.mocked(chat).mock.calls[index]![0].messages[1]!.content)
const reviewReply = (request: Parameters<typeof chat>[0]) => {
  const context = JSON.parse(request.messages[1]!.content)
  return {
    checks: context.targets.map((item: { id: string }) => ({ id: item.id, verdict: 'supported', reason: '测试复核：与正文及历史一致。' })),
    goalChecks: context.goalReviewTargets.map((item: { id: string }) => ({ id: item.id, verdict: 'supported', reason: '测试复核：目标生命周期一致。' })),
    coverage: REVIEW_ASPECTS.map((aspect) => ({ aspect, verdict: 'none', reason: '测试复核：该维度无新增变化。', claims: [] as Array<{ statement: string; sourceQuote: string; matches: Array<{ id: string; summarySpan: string }> }> })),
  }
}
const enableRealReview = async () => {
  const actual = await vi.importActual<typeof import('./story-ledger-review')>('./story-ledger-review')
  vi.mocked(reviewChapterMemory).mockImplementation(actual.reviewChapterMemory)
}
beforeAll(async () => {
  t = await createTestDb()
  await t.applyMigrations()
  // Full migration initialization can swap on small hosts; test bodies retain the
  // normal timeout so failures in cancellation and state transitions remain visible.
}, 120000)
afterAll(async () => {
  await t.close()
})
beforeEach(async () => {
  await t.db.query('DELETE FROM ai_tasks')
  await t.db.query('DELETE FROM novels')
  await t.db.query("INSERT INTO novels(id,title,created_at,updated_at) VALUES('book','增量记忆隔离测试',1,1)")
  vi.mocked(getAiSettings)
    .mockReset()
    .mockResolvedValue({ ...DEFAULT_AI_SETTINGS, storyMemoryEngine: 'incremental', storyMemoryStreamEnabled: false, plotStateMaxTokens: 8000, relationshipProfileMaxTokens: 8000 })
  vi.mocked(chat).mockReset().mockResolvedValue(reply(payload()))
  vi.mocked(chatStream).mockReset()
  vi.mocked(recordUsage).mockReset().mockResolvedValue(undefined)
  vi.mocked(reviewChapterMemory).mockReset().mockResolvedValue({ checks: [], goalChecks: [], coverage: [] })
})

describe('independent review persistence and accounting', () => {
  it('saves the review alongside the chapter and counts both model calls once', async () => {
    await enableRealReview()
    await chapter(1)
    vi.mocked(chat).mockResolvedValueOnce(reply(payload())).mockImplementationOnce(async (request) => reply(reviewReply(request)))
    await expect(extractPlotState(t.db, opts)).resolves.toMatchObject({ complete: true, usage: { promptTokens: 200, completionTokens: 100 } })
    expect(recordUsage).toHaveBeenCalledTimes(2)
    const stored = (await t.db.query<{ payload_json: string }>('SELECT payload_json FROM novel_story_memory_chapters')).rows[0]!
    expect(JSON.parse(stored.payload_json).semanticReviews[0]).toMatchObject({ part: 0, coverage: expect.arrayContaining([expect.objectContaining({ aspect: 'ownership' })]) })
    expect(await getMemoryAttempt(t.db, 'book', 'plot')).toMatchObject({ phase: 'review', status: 'complete' })
    await extractRelationshipProfile(t.db, opts)
    expect(chat).toHaveBeenCalledTimes(2)
  })
  it('retains the valid prefix after semantic failure and supplies that error on explicit retry', async () => {
    await chapter(1)
    await extractPlotState(t.db, opts)
    const before = (await getPlotStateForAnchor(t.db, 'book', 'c1')).state
    await chapter(2)
    await enableRealReview()
    vi.mocked(chat).mockResolvedValueOnce(reply(payload([], []))).mockImplementationOnce(async (request) => {
      const result = reviewReply(request)
      result.coverage[2] = { aspect: 'cognition', verdict: 'missing', reason: '漏记沈砚误以为林舟离城。', claims: [{ statement: '沈砚误以为林舟离城', sourceQuote: prose[1]!, matches: [] }] }
      return reply(result)
    })
    await expect(extractPlotState(t.db, opts)).rejects.toThrow('cognition 漏记')
    expect(chat).toHaveBeenCalledTimes(3)
    expect(recordUsage).toHaveBeenCalledTimes(3)
    expect((await ledgerAtAnchor(t.db, 'book'))!.processed).toBe(1)
    expect(await getMemoryAttempt(t.db, 'book', 'plot')).toMatchObject({ phase: 'review', status: 'complete', error: expect.stringContaining('漏记') })
    vi.mocked(chat).mockResolvedValueOnce(reply(payload([fact({ label: '林舟去向', summary: '沈砚误以为林舟已经离城。', certainty: 'belief', perspective: '沈砚', quote: prose[1] })], [])))
      .mockImplementationOnce(async (request) => reply(reviewReply(request)))
    await extractPlotState(t.db, opts)
    expect(input(3).previousValidationError).toContain('漏记沈砚')
    expect((await getPlotStateForAnchor(t.db, 'book', 'c1')).state).toBe(before)
    expect((await ledgerAtAnchor(t.db, 'book'))!.processed).toBe(2)
    expect(recordUsage).toHaveBeenCalledTimes(5)
  })
  it.each(['malformed', 'truncated', 'refused'])('does not save or replay a %s review and records its usage', async (mode) => {
    await enableRealReview()
    await chapter(1)
    vi.mocked(chat).mockResolvedValueOnce(reply(payload())).mockResolvedValueOnce({ ...reply({}),
      ...(mode === 'malformed' ? { text: '{broken' } : mode === 'truncated' ? { finishReason: 'length' } : { refusal: '无法复核' }),
    })
    await expect(extractPlotState(t.db, opts)).rejects.toThrow('未推进该章')
    expect(chat).toHaveBeenCalledTimes(2)
    expect(recordUsage).toHaveBeenCalledTimes(2)
    expect((await ledgerAtAnchor(t.db, 'book'))!.processed).toBe(0)
    expect(await getMemoryAttempt(t.db, 'book', 'plot')).toMatchObject({ phase: 'review', status: mode === 'malformed' ? 'complete' : mode === 'truncated' ? 'truncated' : 'refused' })
  })
  it('keeps a review timeout distinct from a completed extraction response', async () => {
    await enableRealReview()
    await chapter(1)
    vi.mocked(chat).mockResolvedValueOnce(reply(payload())).mockRejectedValueOnce(new AiError('timeout', '复核超时', 504))
    await expect(extractPlotState(t.db, opts)).rejects.toThrow('复核超时')
    expect(recordUsage).toHaveBeenCalledTimes(1)
    expect(await getMemoryAttempt(t.db, 'book', 'plot')).toMatchObject({ phase: 'review', status: 'timeout', promptTokens: null })
    expect((await ledgerAtAnchor(t.db, 'book'))!.processed).toBe(0)
  })
  it('honors a pause during review without publishing an unreviewed draft', async () => {
    await enableRealReview()
    await chapter(1)
    vi.mocked(chat).mockResolvedValueOnce(reply(payload())).mockImplementationOnce(async (request) => {
      await pauseStoryMemory(t.db, 'book', 'plot')
      return reply(reviewReply(request))
    })
    await expect(extractPlotState(t.db, opts)).resolves.toMatchObject({ paused: true, processedChapters: 0 })
    expect(recordUsage).toHaveBeenCalledTimes(2)
    expect((await t.db.query('SELECT * FROM novel_plot_states')).rows).toHaveLength(0)
  })
  it('rejects source changes made during review after accounting for both responses', async () => {
    await enableRealReview()
    await chapter(1)
    vi.mocked(chat).mockResolvedValueOnce(reply(payload())).mockImplementationOnce(async (request) => {
      await t.db.query("UPDATE chapters SET content='正文已被另行编辑' WHERE id='c1'")
      return reply(reviewReply(request))
    })
    await expect(extractPlotState(t.db, opts)).rejects.toMatchObject({ code: 'conflict' })
    expect(recordUsage).toHaveBeenCalledTimes(2)
    expect((await ledgerAtAnchor(t.db, 'book'))!.processed).toBe(0)
  })
  it('discards every part of a long chapter when the final review finds a missing state', async () => {
    await enableRealReview()
    await chapter(1, prose[0] + '雨声不断。'.repeat(5000))
    vi.mocked(chat).mockResolvedValueOnce(reply(payload())).mockImplementationOnce(async (request) => reply(reviewReply(request)))
      .mockResolvedValueOnce(reply(payload([], []))).mockImplementationOnce(async (request) => {
        const result = reviewReply(request)
        result.coverage[7] = { aspect: 'other', verdict: 'missing', reason: '测试模拟末段缺少重要状态。', claims: [{ statement: '测试缺项', sourceQuote: '雨声不断。', matches: [] }] }
        return reply(result)
      })
    await expect(extractPlotState(t.db, opts)).rejects.toThrow('other 漏记')
    expect(recordUsage).toHaveBeenCalledTimes(4)
    expect((await t.db.query('SELECT * FROM novel_story_memory_chapters')).rows).toHaveLength(0)
  })
})

describe('chapter ledger shared extraction and source integrity', () => {
  it('requires goal reviews, persists completion and retains the earlier anchor after retry', async () => {
    const start = '沈砚计划检修铜门。'
    await chapter(1, start)
    vi.mocked(chat).mockResolvedValueOnce(reply({ ...payload([], [entity('沈砚')]), goals: [{ subjects: ['沈砚'], objective: '检修铜门', quote: start }] }))
    await extractPlotState(t.db, opts)
    const old = (await ledgerAtAnchor(t.db, 'book'))!.state.facts[0]!
    const end = '沈砚完成检修铜门。'
    await chapter(2, end)
    const event = fact({ kind: 'fact', memoryType: 'event', label: '工作结束', summary: end, quote: end })
    vi.mocked(chat).mockResolvedValueOnce(reply(payload([event], [])))
    await expect(extractPlotState(t.db, opts)).rejects.toThrow('goalReviews 缺少')
    expect((await ledgerAtAnchor(t.db, 'book'))!.processed).toBe(1)
    vi.mocked(chat).mockResolvedValueOnce(reply({ ...payload([event], []), goalReviews: [{ id: old.id, decision: 'completed', quote: end }] }))
    await extractPlotState(t.db, opts)
    const current = (await ledgerAtAnchor(t.db, 'book'))!.state
    expect(workingFacts(current).some((fact) => fact.kind === 'goal')).toBe(false)
    expect(current.facts.find((fact) => fact.goalOutcome)?.replaces).toEqual([old.id])
    expect((await getPlotStateForAnchor(t.db, 'book', 'c1')).state).toContain('计划检修铜门')
    expect((await getPlotStateForAnchor(t.db, 'book', 'c2')).state).toContain('目标已完成')
    const stored = await t.db.query<{ payload_json: string }>('SELECT payload_json FROM novel_story_memory_chapters WHERE novel_id=$1 AND chapter_id=$2', ['book', 'c2'])
    expect(JSON.parse(stored.rows[0]!.payload_json).goalReviews).toHaveLength(1)
    expect(recordUsage).toHaveBeenCalledTimes(3)
  })

  it('counts only incremental records when switching from an already completed legacy archive', async () => {
    await chapter(1)
    vi.mocked(getAiSettings).mockResolvedValue({ ...DEFAULT_AI_SETTINGS, storyMemoryEngine: 'legacy', storyMemoryStreamEnabled: false })
    await extractPlotState(t.db, opts)
    vi.mocked(getAiSettings).mockResolvedValue({ ...DEFAULT_AI_SETTINGS, storyMemoryEngine: 'incremental' })
    expect(await getStoryMemoryProgress(t.db, 'book', 'plot')).toMatchObject({ processedChapters: 0, totalChapters: 1, complete: false, previewContent: '' })
  })
  it('reuses one chapter extraction for both legacy archives without using them as graph sources', async () => {
    await chapter(1)
    vi.mocked(chat).mockResolvedValue(
      reply(
        payload([fact(), fact({ kind: 'relationship', subjects: ['林舟', '沈砚'], label: '共同调查', summary: '双方约定合作调查密道。', directed: false })]),
      ),
    )
    await extractPlotState(t.db, opts)
    await extractRelationshipProfile(t.db, opts)
    const ledger = await ledgerAtAnchor(t.db, 'book')
    expect(ledger?.complete).toBe(true)
    expect(ledger?.state.facts).toHaveLength(2)
    expect(ledger?.state.facts).toContainEqual(expect.objectContaining({ kind: 'relationship', directed: false, label: '共同调查' }))
    await expect(generateStoryGraph(t.db, opts)).rejects.toMatchObject({ status: 422 })
    expect(chat).toHaveBeenCalledTimes(1)
    expect(recordUsage).toHaveBeenCalledTimes(1)
    expect(vi.mocked(recordUsage).mock.calls[0]![1]).toMatchObject({ generationType: 'story_memory', chapterId: 'c1' })
  })

  it('keeps belief separate from fact, retains replacement history and projects an earlier anchor without future knowledge', async () => {
    await chapter(1)
    await extractPlotState(t.db, opts)
    await chapter(2)
    vi.mocked(chat).mockResolvedValueOnce(
      reply(
        payload([fact({ kind: 'state', label: '林舟去向', summary: '沈砚误以为林舟已经离城。', certainty: 'belief', perspective: '沈砚', quote: prose[1] })]),
      ),
    )
    await extractRelationshipProfile(t.db, opts)
    const old = (await ledgerAtAnchor(t.db, 'book'))!.state.facts.find((f) => f.certainty === 'belief')!
    await chapter(3)
    vi.mocked(chat).mockResolvedValueOnce(
      reply(
        payload([
          fact({ label: '林舟去向', summary: '沈砚知道林舟一直留在城中。', certainty: 'belief', perspective: '沈砚', quote: prose[2], replaces: [old.id] }),
        ]),
      ),
    )
    await extractPlotState(t.db, opts)
    const ledger = (await ledgerAtAnchor(t.db, 'book'))!
    expect(ledger.state.facts).toHaveLength(3)
    expect(currentFacts(ledger.state).map((f) => f.summary)).not.toContain(old.summary)
    const earlier = await getPlotStateForAnchor(t.db, 'book', 'c2')
    expect(earlier.eligibility).toBe('usable')
    expect(earlier.state).toContain('误以为')
    expect(earlier.state).not.toContain('一直留在城中')
    const plot = await getEffectiveProfileForAnchor(t.db, { ...opts, kind: 'plot' })
    const relationship = await getEffectiveProfileForAnchor(t.db, { ...opts, kind: 'relationship' })
    const materials = await selectLedgerMaterials(t.db, 'book', 'c3', '沈砚调查林舟去向', { plot, relationship })
    expect(materials?.selected.plot).toContain('【历史记录，已被后续状态更新】')
    expect(materials?.selected.plot).toContain('一直留在城中')
  })

  it('persists a resolved clue and its answer without rewriting an earlier chapter or granting characters knowledge', async () => {
    await chapter(1, '铜钥匙上密文含义不明，沈砚不知道含义。')
    vi.mocked(chat).mockResolvedValueOnce(reply(payload([
      fact({ kind: 'clue', subjects: ['铜钥匙'], label: '钥匙密文含义', certainty: 'clue', summary: '铜钥匙密文含义不明。', quote: '铜钥匙上密文含义不明' }),
      fact({ subjects: ['沈砚', '铜钥匙'], label: '钥匙密文含义', certainty: 'belief', perspective: '沈砚', summary: '沈砚不知道含义。', quote: '沈砚不知道含义' }),
    ], [entity('铜钥匙', 'item'), entity('沈砚')])))
    await extractPlotState(t.db, opts)
    const old = (await ledgerAtAnchor(t.db, 'book'))!.state.facts[0]!
    await chapter(2, '林舟独自查明铜钥匙密文指向东门，没有告诉沈砚。')
    vi.mocked(chat).mockResolvedValueOnce(reply(payload([
      fact({ subjects: ['铜钥匙'], label: '钥匙密文含义', summary: '铜钥匙密文指向东门。', quote: '铜钥匙密文指向东门', resolves: [old.id] }),
      fact({ subjects: ['林舟', '铜钥匙'], label: '钥匙密文含义', certainty: 'belief', perspective: '林舟', summary: '林舟知道密文指向东门。', quote: '林舟独自查明铜钥匙密文指向东门' }),
    ], [entity('林舟')])))
    await extractRelationshipProfile(t.db, opts)
    const state = (await ledgerAtAnchor(t.db, 'book'))!.state
    expect(workingFacts(state).some((f) => f.id === old.id)).toBe(false)
    expect(workingFacts(state).map((f) => f.summary)).toContain('沈砚不知道含义。')
    expect(relevantLedger(state, '', ['钥匙密文含义']).facts.find((f) => f.id === old.id)?.stillActive).toBe(false)
    const earlier = await getPlotStateForAnchor(t.db, 'book', 'c1')
    expect(earlier.state).toContain('含义不明')
    expect(earlier.state).not.toContain('指向东门')
    const latest = await getPlotStateForAnchor(t.db, 'book', 'c2')
    expect(latest.state).toContain('指向东门')
    expect(latest.state).not.toContain('含义不明')
    expect(recordUsage).toHaveBeenCalledTimes(2)
  })

  it('automatically binds cognitive subject perspective into subjects when omitted by model', async () => {
    await chapter(1)
    vi.mocked(chat).mockResolvedValueOnce(
      reply(
        payload([
          fact({
            kind: 'state',
            subjects: ['林舟'],
            label: '性格评价',
            summary: '沈砚认为林舟为人谨慎。',
            certainty: 'belief',
            perspective: '沈砚',
            quote: prose[0],
          }),
        ]),
      ),
    )
    await extractPlotState(t.db, opts)
    const ledger = (await ledgerAtAnchor(t.db, 'book'))!
    const saved = ledger.state.facts.find((f) => f.label === '性格评价')!
    expect(saved).toBeDefined()
    expect(saved.perspective).toBe(ledger.state.entities.find((e) => e.name === '沈砚')!.id)
    expect(saved.subjects).toContain(saved.perspective)
  })

  it('rejects invented quotations, invalid replacement references, alias collisions and unscoped beliefs without advancing', async () => {
    await chapter(1)
    for (const bad of [
      payload([fact({ quote: '编造的正文' })]),
      payload([fact({ replaces: ['foreign_fact'] })]),
      payload([fact({ certainty: 'belief' })]),
      payload([fact({ memoryType: undefined })]),
      payload([fact({ kind: 'relationship', subjects: ['林舟', '沈砚'] })]),
      payload([], [entity('林舟', 'person', ['沈砚']), entity('沈砚')]),
    ]) {
      vi.mocked(chat).mockResolvedValueOnce(reply(bad))
      await expect(extractPlotState(t.db, opts)).rejects.toThrow('校验失败')
      expect((await ledgerAtAnchor(t.db, 'book'))!.processed).toBe(0)
    }
    expect(recordUsage).toHaveBeenCalledTimes(6)
  })

  it('maps only unambiguous kind synonyms and still rejects unknown categories', async () => {
    await chapter(1)
    vi.mocked(chat).mockResolvedValueOnce(reply(payload([fact({ kind: 'event', label: '交钥匙' })])))
    await extractPlotState(t.db, opts)
    const stored = (await ledgerAtAnchor(t.db, 'book'))!.state.facts[0]!
    expect(stored.kind).toBe('fact')

    // belief 在事实里按语义还原：带 perspective 的认知落成 state，普通线索落成 clue。
    await chapter(2, '沈砚听伙计说林舟已离城，便以为他远行。')
    vi.mocked(chat).mockResolvedValueOnce(
      reply(
        payload([
          fact({
            kind: 'belief',
            certainty: 'belief',
            perspective: '沈砚',
            label: '以为林舟离城',
            quote: '沈砚听伙计说林舟已离城',
            summary: '沈砚以为林舟远行。',
          }),
        ]),
      ),
    )
    await extractPlotState(t.db, opts)
    const belief = (await ledgerAtAnchor(t.db, 'book'))!.state.facts.find((f) => f.label === '以为林舟离城')!
    expect(belief).toMatchObject({ kind: 'state', certainty: 'belief' })

    // 仍然不给未知类别开口子。
    await chapter(3, '苏越走进萧家大堂。')
    vi.mocked(chat).mockResolvedValueOnce(reply(payload([fact({ kind: 'saga', label: '未知类别', quote: '苏越走进萧家大堂' })])))
    await expect(extractPlotState(t.db, opts)).rejects.toThrow('事实类别 无效')
  })

  it('accepts a quotation that differs only in layout noise and still rejects rewritten or merged sources', async () => {
    await chapter(3, '林舟把铜钥匙交给沈砚，约定共同调查密道。沈砚接过钥匙后说：“别急，先查清楚。”')
    vi.mocked(chat).mockResolvedValueOnce(
      reply(
        payload([
          fact({ quote: '林舟把铜钥匙交给沈砚, 约定共同调查密道。' }),
          fact({ label: '接过钥匙', quote: '沈砚接过钥匙后说:"别急，先查清楚。"' }),
        ]),
      ),
    )
    await extractPlotState(t.db, opts)
    const ledger = (await ledgerAtAnchor(t.db, 'book'))!
    expect(ledger.processed).toBe(1)
    expect(ledger.state.facts).toHaveLength(2)

    for (const [index, quote] of ['林舟把铜钥要是交给沈砚', '林舟把铜钥匙交给沈砚，约定共同调查密道。'.repeat(2), '，。'].entries()) {
      await chapter(4 + index, `苏越走进萧家大堂，看见萧炎，这是第${index + 1}次改写。`)
      vi.mocked(chat).mockResolvedValueOnce(reply(payload([fact({ label: `改写${index}`, quote })])))
      await expect(extractPlotState(t.db, opts)).rejects.toThrow('逐字匹配本章正文')
      expect((await ledgerAtAnchor(t.db, 'book'))!.processed).toBe(1)
    }
  })

  it('accepts a pronoun-completed entity name only when its identity is quoted from the chapter', async () => {
    await chapter(1, '萧炎的父亲站在台阶上，看着苏越。苏越低头行礼。')
    vi.mocked(chat).mockResolvedValueOnce(
      reply(
        payload([fact({ subjects: ['萧炎父亲'], label: '在场', summary: '萧炎父亲在场。', quote: '萧炎的父亲站在台阶上' })], [
          entity('苏越'),
          { ...entity('萧炎父亲'), identityQuote: '萧炎的父亲站在台阶上，看着苏越' },
        ]),
      ),
    )
    // 无身份说明但「人名+亲属关系」都能在正文核对的代词补全名：保留实体，不整章拒收。
    await extractPlotState(t.db, opts)
    const ledger = (await ledgerAtAnchor(t.db, 'book'))!
    expect(ledger.processed).toBe(1)
    expect(ledger.state.entities.map((e) => e.name)).toContain('萧炎父亲')

    await chapter(2, '苏越继续扫地。')
    vi.mocked(chat).mockResolvedValueOnce(
      reply(
        payload([fact({ subjects: ['萧炎母亲'], label: '在场', summary: '萧炎母亲在场。', quote: '苏越继续扫地' })], [
          entity('苏越'),
          { ...entity('萧炎母亲'), identityQuote: '苏越继续扫地' },
        ]),
      ),
    )
    await expect(extractPlotState(t.db, opts)).rejects.toThrow('不在本章正文')
  })

  it('supplements historical evidence when requested and fails closed when the ambiguity remains', async () => {
    await chapter(1)
    await extractPlotState(t.db, opts)
    await chapter(2, '城外有人打听铜钥匙。')
    vi.mocked(chat)
      .mockResolvedValueOnce(reply({ complete: false, needs: ['沈砚'], entities: [], facts: [] }))
      .mockResolvedValueOnce(reply(payload([], [])))
    await extractPlotState(t.db, opts)
    expect(input(2).previous.facts[0].summary).toContain('铜钥匙')
    await chapter(3)
    vi.mocked(chat).mockResolvedValue(reply({ complete: false, needs: ['未确认身份'], entities: [], facts: [] }))
    await expect(extractPlotState(t.db, opts)).rejects.toThrow('仍缺少可靠依据')
    expect((await ledgerAtAnchor(t.db, 'book'))!.processed).toBe(2)
  })

  it.each(['edit', 'insert', 'delete', 'reorder'] as const)('invalidates dependent chapters after a historical %s', async (change) => {
    await chapter(1)
    await chapter(2)
    await extractPlotState(t.db, opts)
    vi.mocked(chat).mockResolvedValueOnce(reply(payload([], [])))
    await extractPlotState(t.db, opts)
    if (change === 'edit') await t.db.query("UPDATE chapters SET content='林舟独自带走铜钥匙。' WHERE id='c1'")
    if (change === 'insert')
      await t.db.query("INSERT INTO chapters(id,novel_id,title,content,sort_order,created_at) VALUES('c0','book','前传','林舟到达城门。',0,1)")
    if (change === 'delete') await t.db.query("DELETE FROM chapters WHERE id='c1'")
    if (change === 'reorder') await t.db.query("UPDATE chapters SET sort_order=3 WHERE id='c1'")
    expect((await ledgerAtAnchor(t.db, 'book'))!.processed).toBe(0)
    vi.mocked(chat).mockResolvedValue(reply(payload([], [])))
    await extractPlotState(t.db, opts)
    expect(input(2).previous.facts).toHaveLength(0)
  })

  it('does not expose a checkpoint as an effective archive and resumes after a billed truncated response', async () => {
    await chapter(1)
    await chapter(2)
    await extractPlotState(t.db, opts)
    expect((await getPlotStateForAnchor(t.db, 'book')).eligibility).toBe('missing')
    vi.mocked(chat).mockResolvedValueOnce({ ...reply(payload()), finishReason: 'length' })
    await expect(extractPlotState(t.db, opts)).rejects.toThrow('输出截断')
    expect((await ledgerAtAnchor(t.db, 'book'))!.processed).toBe(1)
    vi.mocked(chat).mockResolvedValueOnce(reply(payload([], [])))
    await extractPlotState(t.db, opts)
    expect(input(2).text).toBe(prose[1])
    expect((await getPlotStateForAnchor(t.db, 'book')).eligibility).toBe('usable')
    expect(recordUsage).toHaveBeenCalledTimes(3)
  })

  it('pauses a stalled call, releases both leases and reuses only whole chapters', async () => {
    await chapter(1)
    await chapter(2)
    await extractPlotState(t.db, opts)
    let entered!: () => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    vi.mocked(chat).mockImplementationOnce(({ signal }) => {
      entered()
      return new Promise((_resolve, reject) => {
        signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      })
    })
    const running = extractPlotState(t.db, opts)
    await started
    await pauseStoryMemory(t.db, 'book', 'relationship')
    await expect(running).resolves.toMatchObject({ paused: true, processedChapters: 1 })
    expect(await getStoryMemoryProgress(t.db, 'book', 'plot')).toMatchObject({ running: false, processedChapters: 1 })
    expect(await getStoryMemoryProgress(t.db, 'book', 'relationship')).toMatchObject({ running: false, processedChapters: 1 })
  })

  it('honors a pause before the independent review and leaves the draft unsaved', async () => {
    await chapter(1)
    await chapter(2)
    vi.mocked(chat).mockImplementationOnce(async () => {
      await pauseStoryMemory(t.db, 'book', 'plot')
      return reply(payload())
    })
    await expect(extractPlotState(t.db, opts)).resolves.toMatchObject({ paused: true, processedChapters: 0, complete: false })
    expect(chat).toHaveBeenCalledTimes(1)
    expect((await ledgerAtAnchor(t.db, 'book'))!.processed).toBe(0)
  })

  it('keeps streamed JSON fragments out of the archive until the complete chapter passes validation', async () => {
    await chapter(1)
    vi.mocked(getAiSettings).mockResolvedValue({ ...DEFAULT_AI_SETTINGS, storyMemoryEngine: 'incremental', storyMemoryStreamEnabled: true })
    const task = await createStoryMemoryTask(t.db, 'plot', opts)
    vi.mocked(chatStream).mockImplementationOnce(async (_request, onDelta) => {
      await onDelta('{"complete":true,"entities":[')
      expect((await t.db.query('SELECT * FROM novel_story_memory_chapters')).rows).toHaveLength(0)
      expect((await t.db.query('SELECT * FROM novel_plot_states')).rows).toHaveLength(0)
      return { ...reply(payload()), streamed: true }
    })
    await expect(extractPlotState(t.db, { ...opts, taskId: task.taskId })).resolves.toMatchObject({ complete: true })
    expect((await ledgerAtAnchor(t.db, 'book'))!.state.facts).toHaveLength(1)
    expect(chat).not.toHaveBeenCalled()
  })

  it('rejects mid-flight edits and accounts for the response without saving mixed sources', async () => {
    await chapter(1)
    vi.mocked(chat).mockImplementationOnce(async () => {
      await t.db.query("UPDATE chapters SET content='原文已变化' WHERE id='c1'")
      return reply(payload())
    })
    await expect(extractPlotState(t.db, opts)).rejects.toMatchObject({ code: 'conflict' })
    expect(recordUsage).toHaveBeenCalledOnce()
    expect((await ledgerAtAnchor(t.db, 'book'))!.processed).toBe(0)
  })

  it('does not re-read unrelated history for a new scene and keeps its source available', async () => {
    await chapter(1)
    await extractPlotState(t.db, opts)
    await chapter(2, '周宁在北海修理船帆。')
    vi.mocked(chat).mockResolvedValueOnce(
      reply(payload([fact({ subjects: ['周宁'], label: '北海修船', summary: '周宁在北海修理船帆。', quote: '周宁在北海修理船帆。' })], [entity('周宁')])),
    )
    await extractPlotState(t.db, opts)
    expect(input(1).previous.facts).toHaveLength(0)
    expect(renderLedger((await ledgerAtAnchor(t.db, 'book'))!.state, 'plot')).toContain('沈砚持有铜钥匙')
  })

  it('deduplicates relationship and plot task submissions and retains manual corrections whole', async () => {
    await chapter(1)
    await extractPlotState(t.db, opts)
    const plot = await getEffectiveProfileForAnchor(t.db, { ...opts, kind: 'plot' })
    const manual = await saveProfileOverride(t.db, {
      ...opts,
      kind: 'plot',
      content: '作者校正：不得让沈砚丢失钥匙。',
      expectedRevision: 0,
      baseProfileRevision: plot.baseProfileRevision,
      updatedBy: 'admin',
    })
    const relationship = await getEffectiveProfileForAnchor(t.db, { ...opts, kind: 'relationship' })
    const selected = await selectLedgerMaterials(t.db, 'book', 'c1', '沈砚', { plot: manual.effective, relationship })
    expect(selected?.selected.plot).toBeUndefined()
    const a = await createStoryMemoryTask(t.db, 'plot', opts)
    const b = await createStoryMemoryTask(t.db, 'relationship', opts)
    expect(b).toMatchObject({ taskId: a.taskId, created: false })
  })

  it('rebuilds shared dependencies once and keeps old archives backed up', async () => {
    await chapter(1)
    await chapter(2)
    await extractPlotState(t.db, opts)
    vi.mocked(chat).mockResolvedValueOnce(reply(payload([], [])))
    await extractPlotState(t.db, opts)
    const request = { kinds: ['plot' as const], range: 'single' as const, startChapterId: 'c2', followThrough: true }
    const plan = await planMemoryRebuild(t.db, 'book', request)
    expect(plan.items).toHaveLength(2)
    expect(plan.items.every((i) => i.actualStart === 2)).toBe(true)
    const started = await startMemoryRebuild(t.db, 'book', request, plan.revision, 'admin')
    expect(started.tasks).toHaveLength(1)
    expect((await ledgerAtAnchor(t.db, 'book'))!.processed).toBe(1)
    vi.mocked(chat).mockResolvedValueOnce(reply(payload([], [])))
    await extractPlotState(t.db, opts)
    expect((await ledgerAtAnchor(t.db, 'book'))!.complete).toBe(true)
    expect((await t.db.query('SELECT * FROM novel_story_memory_snapshots WHERE novel_id=$1', ['book'])).rows.length).toBeGreaterThan(0)
  })

  it('keeps a timeout unknown rather than pretending a free call and releases the lease', async () => {
    await chapter(1)
    vi.mocked(chat).mockRejectedValueOnce(new AiError('timeout', '等待超时', 504))
    await expect(extractPlotState(t.db, opts)).rejects.toMatchObject({ code: 'timeout' })
    expect(recordUsage).not.toHaveBeenCalled()
    expect((await getStoryMemoryProgress(t.db, 'book', 'plot'))?.running).toBe(false)
  })

  it('treats an archive-based quality review as stale even while its archive revision is current', async () => {
    await chapter(1)
    await extractPlotState(t.db, opts)
    const profile = await getEffectiveProfileForAnchor(t.db, { ...opts, kind: 'plot' })
    expect(profile.baseProfileRevision).toBeTruthy()
    const sources = [
      { id: 'plot', title: '关联记忆', text: '部分关联材料', fingerprint: 'selected-content-hash', profileBaseRevision: profile.baseProfileRevision },
    ]
    expect(await reviewSourcesCurrent(t.db, 'book', sources, 'c1')).toBe(false)
  })

  it('discards a partially read long chapter on pause and saves both pieces only after completion', async () => {
    await chapter(1, '林舟'.repeat(12500) + '章末出现铜钥匙。')
    vi.mocked(chat).mockImplementationOnce(async () => {
      await pauseStoryMemory(t.db, 'book', 'plot')
      return reply(payload([], []))
    })
    expect(await extractPlotState(t.db, opts)).toMatchObject({ paused: true, processedChapters: 0 })
    expect((await ledgerAtAnchor(t.db, 'book'))!.processed).toBe(0)
    vi.mocked(chat).mockResolvedValue(reply(payload([], [])))
    expect(await extractPlotState(t.db, opts)).toMatchObject({ complete: true, processedChapters: 1 })
    expect(input(2).text).toContain('章末出现铜钥匙')
  })

  it('keeps extraction input focused on current state even when the same protagonist has a long history', async () => {
    let previousId: string | undefined
    for (let i = 1; i <= 24; i++) {
      const content = `沈砚当前正在调查第${i}处密道。`
      await chapter(i, content)
      vi.mocked(chat).mockResolvedValueOnce(
        reply(payload([fact({ label: '调查进度', summary: content, quote: content, replaces: previousId ? [previousId] : [] })], [entity('沈砚')])),
      )
      await extractPlotState(t.db, opts)
      previousId = (await ledgerAtAnchor(t.db, 'book'))!.state.facts.at(-1)!.id
    }
    expect(input(23).previous.facts).toHaveLength(1)
    expect((await ledgerAtAnchor(t.db, 'book'))!.state.facts).toHaveLength(24)
  })

  it('discards all pieces of a long chapter when the final piece fails validation', async () => {
    await chapter(1)
    await extractPlotState(t.db, opts)
    const prefix = (await ledgerAtAnchor(t.db, 'book'))!
    await chapter(2, '林舟走进客栈。' + '廊'.repeat(24000) + '沈砚仍在门外等待。')
    const firstPiece = payload([fact({ subjects: ['林舟'], label: '当前行动', quote: '林舟走进客栈。' })], [entity('林舟')])
    vi.mocked(chat)
      .mockResolvedValueOnce(reply(firstPiece))
      .mockResolvedValueOnce(reply(payload([fact({ quote: '不存在的原文' })], [])))
    await expect(extractPlotState(t.db, opts)).rejects.toThrow('逐字匹配')
    const rejected = (await ledgerAtAnchor(t.db, 'book'))!
    expect(rejected.processed).toBe(1)
    expect(rejected.state).toEqual(prefix.state)
    expect(await getMemoryAttempt(t.db, 'book', 'plot')).toMatchObject({ error: expect.stringContaining('逐字匹配'), chapterIds: ['c2'] })
    vi.mocked(chat).mockResolvedValueOnce(reply(firstPiece)).mockResolvedValueOnce(reply(payload([], [])))
    await expect(extractPlotState(t.db, opts)).resolves.toMatchObject({ complete: true, processedChapters: 2 })
    expect((await ledgerAtAnchor(t.db, 'book'))!.state.facts).toHaveLength(prefix.state.facts.length + 1)
    expect(input(3).previousValidationError).toBeUndefined()
    expect(input(4).previousValidationError).toContain('逐字匹配')
    expect(recordUsage).toHaveBeenCalledTimes(5)
  })

  it('retains multiple same-source validation errors across manual retries without another automatic model call', async () => {
    await chapter(1)
    vi.mocked(chat).mockResolvedValueOnce(reply(payload([fact({ quote: '不存在的正文' })])))
    await expect(extractPlotState(t.db, opts)).rejects.toThrow('逐字匹配')
    vi.mocked(chat).mockResolvedValueOnce(reply(payload([fact({ subjects: ['未声明的人物'] })])))
    await expect(extractPlotState(t.db, opts)).rejects.toThrow('未声明')
    expect(chat).toHaveBeenCalledTimes(2)
    expect(await getMemoryAttempt(t.db, 'book', 'plot')).toMatchObject({ validationErrors: [expect.stringContaining('逐字匹配'), expect.stringContaining('未声明')] })
    vi.mocked(chat).mockResolvedValueOnce(reply(payload()))
    await extractPlotState(t.db, opts)
    expect(input(2).previousValidationError).toContain('逐字匹配')
    expect(input(2).previousValidationError).toContain('未声明')
    expect(await getMemoryAttempt(t.db, 'book', 'plot')).not.toHaveProperty('validationErrors')
  })

  it('drops manual retry feedback after the source chapter changes', async () => {
    await chapter(1)
    vi.mocked(chat).mockResolvedValueOnce(reply(payload([fact({ quote: '不存在的正文' })])))
    await expect(extractPlotState(t.db, opts)).rejects.toThrow('逐字匹配')
    await t.db.query('UPDATE chapters SET content=$1 WHERE id=$2', ['林舟站在门前。', 'c1'])
    vi.mocked(chat).mockResolvedValueOnce(reply(payload([], [])))
    await expect(extractPlotState(t.db, opts)).resolves.toMatchObject({ complete: true })
    expect(input(1).previousValidationError).toBeUndefined()
    expect(await getMemoryAttempt(t.db, 'book', 'plot')).not.toHaveProperty('error')
  })

  it.each(['not json', JSON.stringify({ complete: true, needs: ['unfinished'], entities: [], facts: [] })])('records a completed but invalid response diagnostic: %s', async (text) => {
    await chapter(1)
    vi.mocked(chat).mockResolvedValueOnce({ ...reply(payload()), text })
    await expect(extractPlotState(t.db, opts)).rejects.toThrow('未推进该章')
    expect((await ledgerAtAnchor(t.db, 'book'))!.processed).toBe(0)
    expect(await getMemoryAttempt(t.db, 'book', 'plot')).toMatchObject({ status: 'complete', error: expect.stringContaining('未推进该章'), completionTokens: 50 })
    expect(recordUsage).toHaveBeenCalledTimes(1)
  })

  it('archives ordinary chapter actions and resolved clues without losing durable state or explicit history lookup', async () => {
    await chapter(1)
    vi.mocked(chat).mockResolvedValueOnce(
      reply(
        payload([
          fact(),
          fact({ memoryType: 'event', kind: 'fact', label: '会面', summary: '林舟与沈砚见面。' }),
          fact({ kind: 'clue', label: '旧线索', summary: '旧线索已解决。', status: 'resolved' }),
        ]),
      ),
    )
    await extractPlotState(t.db, opts)
    await chapter(2)
    vi.mocked(chat).mockResolvedValueOnce(reply(payload([], [])))
    await extractPlotState(t.db, opts)
    expect(input(1).previous.facts).toHaveLength(1)
    const ledger = (await ledgerAtAnchor(t.db, 'book'))!
    expect(ledger.state.facts).toHaveLength(3)
    const plot = await getEffectiveProfileForAnchor(t.db, { ...opts, kind: 'plot' })
    const relationship = await getEffectiveProfileForAnchor(t.db, { ...opts, kind: 'relationship' })
    const ordinary = await selectLedgerMaterials(t.db, 'book', 'c2', '沈砚继续调查', { plot, relationship })
    expect(ordinary?.retrievedFacts).toBe(1)
    const historical = await selectLedgerMaterials(t.db, 'book', 'c2', '沈砚回忆会面与旧线索', { plot, relationship })
    expect(historical?.selected.plot).toContain('林舟与沈砚见面')
    expect(historical?.selected.plot).toContain('旧线索已解决')
  })

  it('requires reinitialization when a formal archive no longer has a valid extraction ledger', async () => {
    await chapter(1)
    await extractPlotState(t.db, opts)
    await t.db.query('DELETE FROM novel_story_memory_chapters WHERE novel_id=$1', ['book'])
    expect(await getEffectiveProfileForAnchor(t.db, { ...opts, kind: 'plot' })).toMatchObject({
      eligibility: 'source_changed',
      effectiveContent: '',
      effectiveOrigin: 'none',
    })
  })

  it('updates the holder of the same item and rejects replacing it with a different item', async () => {
    await chapter(1)
    vi.mocked(chat).mockResolvedValueOnce(
      reply(
        payload(
          [fact({ kind: 'item', subjects: ['沈砚', '铜钥匙'], label: '钥匙归属', summary: '铜钥匙由沈砚保管。' })],
          [entity('林舟'), entity('沈砚'), entity('铜钥匙', 'item')],
        ),
      ),
    )
    await extractPlotState(t.db, opts)
    const old = (await ledgerAtAnchor(t.db, 'book'))!.state.facts[0]!
    await chapter(2, '沈砚把铜钥匙交给林舟。')
    vi.mocked(chat).mockResolvedValueOnce(
      reply(
        payload(
          [
            fact({
              kind: 'item',
              subjects: ['林舟', '铜钥匙'],
              label: '钥匙归属',
              summary: '铜钥匙现在由林舟保管。',
              quote: '沈砚把铜钥匙交给林舟。',
              replaces: [old.id],
            }),
          ],
          [],
        ),
      ),
    )
    await extractPlotState(t.db, opts)
    const state = (await ledgerAtAnchor(t.db, 'book'))!.state
    expect(currentFacts(state).map((f) => f.summary)).toEqual(['铜钥匙现在由林舟保管。'])
    expect(state.facts).toHaveLength(2)
    const plot = await getEffectiveProfileForAnchor(t.db, { ...opts, kind: 'plot' })
    const relationship = await getEffectiveProfileForAnchor(t.db, { ...opts, kind: 'relationship' })
    expect((await selectLedgerMaterials(t.db, 'book', 'c2', '沈砚独自散步', { plot, relationship }))?.retrievedFacts).toBe(0)
    expect((await selectLedgerMaterials(t.db, 'book', 'c2', '沈砚独自散步，铜钥匙却在沈砚手里', { plot, relationship }))?.selected.plot).toContain('铜钥匙现在由林舟保管')
    await chapter(3, '林舟拿着银剑。')
    vi.mocked(chat).mockResolvedValueOnce(
      reply(
        payload(
          [
            fact({
              kind: 'item',
              subjects: ['林舟', '银剑'],
              label: '钥匙归属',
              summary: '林舟持有银剑。',
              quote: '林舟拿着银剑。',
              replaces: [state.facts[1]!.id],
            }),
          ],
          [entity('银剑', 'item')],
        ),
      ),
    )
    await expect(extractPlotState(t.db, { ...opts, tolerant: true })).rejects.toThrow('同一物品')
    const unchanged = (await ledgerAtAnchor(t.db, 'book'))!
    expect(unchanged.processed).toBe(2)
    expect(currentFacts(unchanged.state).map((f) => f.summary)).toEqual(['铜钥匙现在由林舟保管。'])
  })

  it('rejects generic ownership without an item identity and resumes after the item is declared', async () => {
    await chapter(1, '林舟持有铜钥匙。')
    vi.mocked(chat).mockResolvedValueOnce(reply(payload([
      fact({ subjects: ['林舟'], label: '持有物品', summary: '林舟持有铜钥匙。', quote: '林舟持有铜钥匙。' }),
    ], [entity('林舟')])))
    await extractPlotState(t.db, opts)
    const prefix = (await ledgerAtAnchor(t.db, 'book'))!
    const old = prefix.state.facts[0]!
    await chapter(2, '林舟拿起银剑，将铜钥匙交给沈砚。')
    vi.mocked(chat).mockResolvedValueOnce(reply(payload([
      fact({ subjects: ['林舟'], label: '持有物品', summary: '林舟持有银剑。', quote: '林舟拿起银剑', replaces: [old.id] }),
    ], [])))
    await expect(extractPlotState(t.db, { ...opts, tolerant: true })).rejects.toThrow('缺少可核对的物品身份')
    const rejected = (await ledgerAtAnchor(t.db, 'book'))!
    expect(rejected.processed).toBe(1)
    expect(rejected.state).toEqual(prefix.state)
    expect(await getMemoryAttempt(t.db, 'book', 'plot')).toMatchObject({ error: expect.stringContaining('物品身份') })
    vi.mocked(chat).mockResolvedValueOnce(reply(payload([
      fact({ kind: 'item', subjects: ['沈砚', '铜钥匙'], label: '铜钥匙归属', summary: '沈砚保管铜钥匙。', quote: '将铜钥匙交给沈砚', replaces: [old.id] }),
      fact({ kind: 'item', subjects: ['林舟', '银剑'], label: '银剑归属', summary: '林舟持有银剑。', quote: '林舟拿起银剑' }),
    ], [entity('沈砚'), entity('铜钥匙', 'item'), entity('银剑', 'item')])))
    await expect(extractPlotState(t.db, opts)).resolves.toMatchObject({ complete: true, processedChapters: 2 })
    expect(input(2).previousValidationError).toContain('物品身份')
    expect(currentFacts((await ledgerAtAnchor(t.db, 'book'))!.state).map((f) => f.summary)).toEqual(['沈砚保管铜钥匙。', '林舟持有银剑。'])
    expect(recordUsage).toHaveBeenCalledTimes(3)
  })

  it('updates a person moving between places while retaining their previous location as history', async () => {
    await chapter(1, '林舟在客栈等待。')
    vi.mocked(chat).mockResolvedValueOnce(
      reply(
        payload(
          [fact({ kind: 'place', subjects: ['林舟', '客栈'], label: '当前位置', summary: '林舟位于客栈。', quote: '林舟在客栈等待。' })],
          [entity('林舟'), entity('客栈', 'place')],
        ),
      ),
    )
    await extractPlotState(t.db, opts)
    const old = (await ledgerAtAnchor(t.db, 'book'))!.state.facts[0]!
    await chapter(2, '林舟离开客栈来到城门。')
    vi.mocked(chat).mockResolvedValueOnce(
      reply(
        payload(
          [
            fact({
              kind: 'place',
              subjects: ['林舟', '城门'],
              label: '当前位置',
              summary: '林舟位于城门。',
              quote: '林舟离开客栈来到城门。',
              replaces: [old.id],
            }),
          ],
          [entity('城门', 'place')],
        ),
      ),
    )
    await extractPlotState(t.db, opts)
    const state = (await ledgerAtAnchor(t.db, 'book'))!.state
    expect(currentFacts(state).map((f) => f.summary)).toEqual(['林舟位于城门。'])
    expect(state.facts[0]!.summary).toBe('林舟位于客栈。')
  })

  it('queues a later publication behind a fixed target and prepares it without duplicate extraction', async () => {
    vi.mocked(getAiSettings).mockResolvedValue({ ...DEFAULT_AI_SETTINGS, storyMemoryEngine: 'incremental', storyMemoryStreamEnabled: false, storyMemoryAutoUpdate: true })
    await chapter(1)
    let entered!: () => void, finish!: (result: ReturnType<typeof reply>) => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    vi.mocked(chat)
      .mockImplementationOnce(async () => {
        entered()
        return new Promise((resolve) => {
          finish = resolve
        })
      })
      .mockResolvedValueOnce(reply(payload([], [])))
    const first = preparePublishedMemory(t.db, { ...opts, afterChapterId: 'c1' })
    await started
    await chapter(2)
    await preparePublishedMemory(t.db, { ...opts, afterChapterId: 'c2' })
    expect((await t.db.query<{ chapter_id: string }>('SELECT chapter_id FROM novel_story_memory_preparations')).rows[0]!.chapter_id).toBe('c2')
    finish(reply(payload()))
    await first
    expect((await ledgerAtAnchor(t.db, 'book'))!.complete).toBe(true)
    expect(chat).toHaveBeenCalledTimes(2)
    expect((await t.db.query('SELECT * FROM novel_story_memory_preparations')).rows).toHaveLength(0)
  })

  it('preserves explicit alias evidence and resolves a later alias without duplicating the person', async () => {
    await chapter(1, '林舟又名阿舟，他留下铜钥匙。')
    vi.mocked(chat).mockResolvedValueOnce(
      reply(
        payload(
          [fact({ subjects: ['林舟'], summary: '林舟留下铜钥匙。', quote: '他留下铜钥匙。' })],
        [{ ...entity('林舟', 'person', ['阿舟']), identityQuote: ' 林舟又名阿舟 ' }],
        ),
      ),
    )
    await extractPlotState(t.db, opts)
    await chapter(2, '阿舟走进客栈。')
    vi.mocked(chat).mockResolvedValueOnce(reply(payload([], [entity('林舟', 'person', ['阿舟'])])))
    await extractPlotState(t.db, opts)
    const ledger = (await ledgerAtAnchor(t.db, 'book'))!
    expect(ledger.state.entities).toHaveLength(1)
    expect(ledger.state.entities[0]).toMatchObject({ name: '林舟', aliases: ['阿舟'], aliasEvidence: [{ alias: '阿舟', chapterId: 'c1', quote: '林舟又名阿舟' }] })
    expect(input(1).previous.entities[0].name).toBe('林舟')
  })

  it('recovers explicit identity evidence from the chapter when identityQuote is omitted', async () => {
    await chapter(1, '林舟又名阿舟，他留下铜钥匙。阿舟走进客栈。')
    vi.mocked(chat).mockResolvedValueOnce(reply(payload([fact({ subjects: ['林舟'], quote: '他留下铜钥匙。' })], [entity('林舟', 'person', ['阿舟'])])))
    await extractPlotState(t.db, opts)
    const ledger = (await ledgerAtAnchor(t.db, 'book'))!
    expect(ledger.processed).toBe(1)
    expect(ledger.state.entities[0]).toMatchObject({ aliases: ['阿舟'], aliasEvidence: [{ alias: '阿舟', quote: '林舟又名阿舟', chapterId: 'c1' }] })

    await chapter(2, '阿舟走进客栈，沈砚仍在屋内。')
    vi.mocked(chat).mockResolvedValueOnce(reply(payload([], [entity('林舟', 'person', ['沈砚'])])))
    await expect(extractPlotState(t.db, { ...opts, tolerant: true })).rejects.toThrow('明确身份说明')
    expect((await ledgerAtAnchor(t.db, 'book'))!.processed).toBe(1)
  })

  it('refuses to let a stale summary resurrect a replaced record and tolerates quotes from wrapped json context', async () => {
    // 正文里夹着 JSON 代码块：抽取时剥离包裹字符是既有行为，比对口径不能因此判负。
    await chapter(1, '林舟把铜钥匙交给沈砚。\n```json\n{"action":"把铜钥匙交给沈砚"}\n```')
    vi.mocked(chat).mockResolvedValueOnce(
      reply(payload([fact({ subjects: ['林舟'], label: '持有钥匙', summary: '林舟把铜钥匙交给沈砚。', quote: '林舟把铜钥匙交给沈砚。' })])),
    )
    await extractPlotState(t.db, opts)
    const first = (await ledgerAtAnchor(t.db, 'book'))!.state.facts[0]!

    // 旧泛化状态可细化为同一物品的归属，不能仅凭共有持有者判断。
    await chapter(2, '沈砚把铜钥匙交给林舟。')
    vi.mocked(chat).mockResolvedValueOnce(
      reply(
        payload(
          [fact({ subjects: ['林舟', '铜钥匙'], kind: 'item', label: '铜钥匙归属', summary: '铜钥匙现在由林舟保管。', quote: '沈砚把铜钥匙交给林舟。', replaces: [first.id] })],
          [entity('铜钥匙', 'item')],
        ),
      ),
    )
    await extractPlotState(t.db, opts)
    const state = (await ledgerAtAnchor(t.db, 'book'))!.state
    expect(currentFacts(state).map((f) => f.label)).toEqual(['铜钥匙归属'])
    const second = state.facts.at(-1)!

    // 参考集只派发当前有效记录：已被替换的 first 不得再出现，模型无法顺着旧摘要二次替换。
    await chapter(3, '铜钥匙仍由林舟保管。')
    vi.mocked(chat).mockResolvedValueOnce(
      reply(
        payload(
          [fact({ subjects: ['林舟', '铜钥匙'], kind: 'item', label: '铜钥匙归属', summary: '铜钥匙仍在林舟手里。', quote: '铜钥匙仍由林舟保管。', replaces: [second.id] })],
          [entity('铜钥匙', 'item')],
        ),
      ),
    )
    await extractPlotState(t.db, opts)
    const dispatched = input(2).previous.facts as Array<{ id: string; stillActive?: boolean }>
    expect(dispatched.some((f) => f.id === first.id)).toBe(false)
    expect(dispatched.some((f) => f.id === second.id)).toBe(true)
    expect(currentFacts((await ledgerAtAnchor(t.db, 'book'))!.state).map((f) => f.summary)).toEqual(['铜钥匙仍在林舟手里。'])
  })
  it('keeps a confirmed truth separate from a character knowledge update and rejects cross-perspective replacement', async () => {
    await chapter(1, '林舟猜测密道在城门，沈砚不知道入口。')
    vi.mocked(chat).mockResolvedValueOnce(reply(payload([
      fact({ label: '密道入口', subjects: ['林舟'], summary: '林舟猜测密道在城门。', certainty: 'belief', perspective: '林舟', quote: '林舟猜测密道在城门' }),
      fact({ label: '密道入口', subjects: ['沈砚'], summary: '沈砚不知道入口。', certainty: 'belief', perspective: '沈砚', quote: '沈砚不知道入口' }),
    ])))
    await extractPlotState(t.db, opts)
    const prefix = (await ledgerAtAnchor(t.db, 'book'))!.state
    const old = prefix.facts[0]!
    await chapter(2, '林舟查明密道入口在废井，林舟知道先前猜错；沈砚没有收到消息。')
    vi.mocked(chat).mockResolvedValueOnce(reply(payload([
      fact({ label: '密道入口', subjects: ['林舟'], summary: '入口在废井。', quote: '密道入口在废井', replaces: [old.id] }),
    ])))
    await expect(extractPlotState(t.db, opts)).rejects.toThrow('认知口径不同')
    expect((await ledgerAtAnchor(t.db, 'book'))!.state).toEqual(prefix)
    vi.mocked(chat).mockResolvedValueOnce(reply(payload([
      fact({ label: '密道入口', subjects: ['林舟'], summary: '林舟知道入口在废井。', certainty: 'belief', perspective: '林舟', quote: '林舟查明密道入口在废井', replaces: [old.id] }),
      fact({ label: '入口位置', subjects: ['林舟'], summary: '密道入口在废井。', quote: '密道入口在废井' }),
    ])))
    await extractPlotState(t.db, opts)
    const state = (await ledgerAtAnchor(t.db, 'book'))!.state
    expect(currentFacts(state).filter((f) => f.certainty === 'belief')).toHaveLength(2)
    expect(currentFacts(state).map((f) => f.summary)).toContain('沈砚不知道入口。')
    expect(currentFacts(state).find((f) => f.replaces.includes(old.id))).toMatchObject({ certainty: 'belief', perspective: old.perspective, status: 'active' })
    expect(state.facts).toContainEqual(old)
  })

  it('updates a stable belief topic while rejecting a boundary replacement with different participants', async () => {
    await chapter(1, '在萧媚视角里，苏越就是一个普通人。苏越觉醒斗气的事除萧玉外无人知道。')
    vi.mocked(chat).mockResolvedValueOnce(
      reply(
        payload(
          [
            fact({ subjects: ['萧媚', '苏越'], label: '对苏越身份认知', summary: '萧媚认为苏越是普通人。', certainty: 'belief', perspective: '萧媚', quote: '在萧媚视角里，苏越就是一个普通人。' }),
            fact({ kind: 'boundary', subjects: ['苏越', '萧玉'], label: '斗气觉醒保密范围', summary: '苏越觉醒斗气除萧玉外无人知晓。', quote: '苏越觉醒斗气的事除萧玉外无人知道。' }),
          ],
          [entity('萧媚'), entity('苏越'), entity('萧玉')],
        ),
      ),
    )
    await extractPlotState(t.db, opts)
    const state1 = (await ledgerAtAnchor(t.db, 'book'))!.state
    const oldBelief = state1.facts.find((f) => f.certainty === 'belief')!
    const oldBoundary = state1.facts.find((f) => f.kind === 'boundary')!

    await chapter(2, '你你你！你竟然是斗者！苏越在萧媚面前展现了斗气。')
    vi.mocked(chat).mockResolvedValueOnce(
      reply(
        payload(
          [
            // 认知保留同一主体、对象与主题。
            fact({ subjects: ['萧媚', '苏越'], label: '对苏越身份认知', summary: '萧媚震惊苏越是斗者。', certainty: 'belief', perspective: '萧媚', quote: '你你你！你竟然是斗者！', replaces: [oldBelief.id] }),
            // 共享苏越不足以证明两个边界相同，必须拒绝替换。
            fact({ kind: 'boundary', subjects: ['苏越', '萧媚'], label: '斗气觉醒保密范围', summary: '苏越向萧媚展现斗气。', quote: '苏越在萧媚面前展现了斗气。', replaces: [oldBoundary.id] }),
          ],
          [entity('萧媚'), entity('苏越'), entity('萧玉')],
        ),
      ),
    )
    await expect(extractPlotState(t.db, opts)).rejects.toThrow('固定双方')
    expect((await ledgerAtAnchor(t.db, 'book'))!.processed).toBe(1)
    vi.mocked(chat).mockResolvedValueOnce(reply(payload([fact({ subjects: ['萧媚', '苏越'], label: '对苏越身份认知', certainty: 'belief', perspective: '萧媚', quote: '苏越在萧媚面前展现了斗气。', replaces: [oldBelief.id] })], [])))
    await extractPlotState(t.db, opts)
    const active = currentFacts((await ledgerAtAnchor(t.db, 'book'))!.state)
    expect(active.some((f) => f.replaces.includes(oldBelief.id))).toBe(true)
    expect(active.some((f) => f.id === oldBoundary.id)).toBe(true)
  })

  it('resolves entity ids supplied directly in subjects and perspective fields', async () => {
    await chapter(1, '苏越吸收了夭夜的斗气，修为提升。夭夜震惊地看着苏越。')
    vi.mocked(chat).mockResolvedValueOnce(
      reply(
        payload(
          [
            fact({
              subjects: ['苏越', '夭夜'],
              label: '双修提升',
              summary: '苏越吸收夭夜斗气。',
              quote: '苏越吸收了夭夜的斗气，修为提升。',
            }),
          ],
          [entity('苏越'), entity('夭夜')],
        ),
      ),
    )
    await extractPlotState(t.db, opts)
    const ledger1 = (await ledgerAtAnchor(t.db, 'book'))!
    const suEntity = ledger1.state.entities.find((e) => e.name === '苏越')!
    const yaoEntity = ledger1.state.entities.find((e) => e.name === '夭夜')!

    await chapter(2, '夭夜回过神来，发现面前的人是苏越。')
    vi.mocked(chat).mockResolvedValueOnce(
      reply(
        payload(
          [
            fact({
              subjects: [suEntity.id, yaoEntity.id],
              label: '认出苏越',
              summary: '夭夜认出面前之人是苏越。',
              certainty: 'belief',
              perspective: yaoEntity.id,
              quote: '夭夜回过神来，发现面前的人是苏越。',
            }),
          ],
          [{ ...entity('苏越'), id: suEntity.id }, { ...entity('夭夜'), id: yaoEntity.id }],
        ),
      ),
    )
    await extractPlotState(t.db, opts)
    const ledger2 = (await ledgerAtAnchor(t.db, 'book'))!
    expect(ledger2.processed).toBe(2)
    const fact2 = ledger2.state.facts.find((f) => f.label === '认出苏越')!
    expect(fact2).toBeDefined()
    expect(fact2.subjects).toContain(suEntity.id)
    expect(fact2.subjects).toContain(yaoEntity.id)
    expect(fact2.perspective).toBe(yaoEntity.id)
  })

  it.each([true, false, undefined])('never discards invalid facts with tolerant=%s and resumes from the valid prefix', async (tolerant) => {
    await chapter(1)
    await extractPlotState(t.db, opts)
    await chapter(2)
    const original = await getPlotStateForAnchor(t.db, 'book', 'c1')
    for (const facts of [
      [fact({ quote: '原文中不存在的引句' })],
      [fact({ quote: prose[1] }), fact({ quote: '原文中不存在的引句' })],
      [fact({ quote: prose[1], certainty: 'belief' })],
      [fact({ quote: prose[1], replaces: ['missing-record'] })],
    ]) {
      vi.mocked(chat).mockResolvedValueOnce(reply(payload(facts)))
      await expect(extractPlotState(t.db, { ...opts, tolerant })).rejects.toThrow('校验失败')
      expect((await ledgerAtAnchor(t.db, 'book'))!.processed).toBe(1)
      expect((await getPlotStateForAnchor(t.db, 'book', 'c1')).state).toBe(original.state)
      expect(await getMemoryAttempt(t.db, 'book', 'plot')).toMatchObject({ status: 'complete', error: expect.stringContaining('校验失败'), completionTokens: 50 })
      expect((await getStoryMemoryProgress(t.db, 'book', 'plot'))?.running).toBe(false)
    }
    expect(recordUsage).toHaveBeenCalledTimes(5)
    vi.mocked(chat).mockResolvedValueOnce(reply(payload([], [])))
    await expect(extractPlotState(t.db, { ...opts, tolerant })).resolves.toMatchObject({ complete: true, processedChapters: 2 })
  })

  it('retrieves resolved events and replaced state on explicit request without allowing replacement of history', async () => {
    await chapter(1)
    vi.mocked(chat).mockResolvedValueOnce(reply(payload([
      fact(),
      fact({ memoryType: 'event', label: '旧线索', status: 'resolved' }),
    ], [entity('林舟'), entity('沈砚'), entity('铜钥匙', 'item')])))
    await extractPlotState(t.db, opts)
    const old = (await ledgerAtAnchor(t.db, 'book'))!.state.facts[0]!
    await chapter(2)
    vi.mocked(chat).mockResolvedValueOnce(reply(payload([fact({ quote: prose[1], replaces: [old.id] })])))
    await extractPlotState(t.db, opts)
    await chapter(3)
    vi.mocked(chat)
      .mockResolvedValueOnce(reply({ complete: false, needs: ['持有钥匙', '旧线索'], entities: [], facts: [] }))
      .mockResolvedValueOnce(reply(payload([fact({ quote: prose[2], replaces: [old.id] })])))
    await expect(extractPlotState(t.db, opts)).rejects.toThrow('历史依据不能作为替换目标')
    expect(input(2).previous.facts).toHaveLength(1)
    const history = input(3).previous.facts as Array<{ id: string; label: string; stillActive?: boolean }>
    expect(history.find((fact) => fact.id === old.id)?.stillActive).toBe(false)
    expect(history.find((fact) => fact.label === '旧线索')?.stillActive).toBe(false)
    expect((await ledgerAtAnchor(t.db, 'book'))!.processed).toBe(2)
    vi.mocked(chat).mockResolvedValueOnce(reply(payload([], [])))
    await expect(extractPlotState(t.db, opts)).resolves.toMatchObject({ complete: true })
  })
})
