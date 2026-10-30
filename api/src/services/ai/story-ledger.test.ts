import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from '../../test/db'
import { AiError, chat, chatStream } from './client'
import { DEFAULT_AI_SETTINGS, getAiSettings } from './settings'
import { extractPlotState, getPlotStateForAnchor } from './plot-state'
import { extractRelationshipProfile } from './relationship-profile'
import { getStoryMemoryProgress, pauseStoryMemory } from './story-memory'
import { ledgerAtAnchor } from './story-ledger-store'
import { currentFacts, renderLedger } from './story-ledger'
import { getEffectiveProfileForAnchor, saveProfileOverride } from './profile-overrides'
import { selectLedgerMaterials } from './story-ledger-materials'
import { generateStoryGraph } from './story-graph'
import { createStoryMemoryTask, preparePublishedMemory } from './story-memory-tasks'
import { planMemoryRebuild, startMemoryRebuild } from './story-memory-rebuild'
import { recordUsage } from './usage'
import { reviewSourcesCurrent } from './writing-review'

vi.mock('./client', async (original) => ({
  ...(await original<typeof import('./client')>()),
  chat: vi.fn(),
  chatStream: vi.fn(),
  isTextAiConfigured: () => true,
  textProvider: () => ({ baseUrl: 'https://example.test', model: 'test' }),
}))
vi.mock('./settings', async (original) => ({ ...(await original<typeof import('./settings')>()), getAiSettings: vi.fn() }))
vi.mock('./usage', () => ({ recordUsage: vi.fn() }))
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
const payload = (facts = [fact()], entities: Array<ReturnType<typeof entity> & { identityQuote?: string }> = [entity('林舟'), entity('沈砚')]) => ({
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
    .mockResolvedValue({ ...DEFAULT_AI_SETTINGS, storyMemoryEngine: 'incremental', plotStateMaxTokens: 8000, relationshipProfileMaxTokens: 8000 })
  vi.mocked(chat).mockReset().mockResolvedValue(reply(payload()))
  vi.mocked(chatStream).mockReset()
  vi.mocked(recordUsage).mockReset().mockResolvedValue(undefined)
})

describe('chapter ledger shared extraction and source integrity', () => {
  it('counts only incremental records when switching from an already completed legacy archive', async () => {
    await chapter(1)
    vi.mocked(getAiSettings).mockResolvedValue({ ...DEFAULT_AI_SETTINGS, storyMemoryEngine: 'legacy' })
    await extractPlotState(t.db, opts)
    vi.mocked(getAiSettings).mockResolvedValue({ ...DEFAULT_AI_SETTINGS, storyMemoryEngine: 'incremental' })
    expect(await getStoryMemoryProgress(t.db, 'book', 'plot')).toMatchObject({ processedChapters: 0, totalChapters: 1, complete: false, previewContent: '' })
  })
  it('extracts each chapter once for both archives, derives the graph without another model call, and reuses a completed prefix', async () => {
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
    const graph = await generateStoryGraph(t.db, opts)
    expect(graph.status).toBe('ready')
    expect(graph.graph?.relationships[0]).toMatchObject({ directed: false, label: '共同调查' })
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

  it('honors a pause arriving with a complete batch response before another batch starts', async () => {
    await chapter(1)
    await chapter(2)
    vi.mocked(chat).mockImplementationOnce(async () => {
      await pauseStoryMemory(t.db, 'book', 'plot')
      return reply(payload())
    })
    await expect(extractPlotState(t.db, opts)).resolves.toMatchObject({ paused: true, processedChapters: 1, complete: false })
    expect(chat).toHaveBeenCalledTimes(1)
    expect((await ledgerAtAnchor(t.db, 'book'))!.processed).toBe(1)
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

  it('validates selected review material against its full archive base and invalidates it after a manual correction', async () => {
    await chapter(1)
    await extractPlotState(t.db, opts)
    const profile = await getEffectiveProfileForAnchor(t.db, { ...opts, kind: 'plot' })
    const sources = [
      { id: 'plot', title: '关联记忆', text: '部分关联材料', fingerprint: 'selected-content-hash', profileBaseRevision: profile.baseProfileRevision },
    ]
    expect(await reviewSourcesCurrent(t.db, 'book', sources, 'c1')).toBe(true)
    await saveProfileOverride(t.db, {
      ...opts,
      kind: 'plot',
      content: '作者校正',
      expectedRevision: 0,
      baseProfileRevision: profile.baseProfileRevision,
      updatedBy: 'admin',
    })
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
      const content = `沈砚现在持有第${i}把钥匙。`
      await chapter(i, content)
      vi.mocked(chat).mockResolvedValueOnce(
        reply(payload([fact({ label: '持有钥匙', summary: content, quote: content, replaces: previousId ? [previousId] : [] })], [entity('沈砚')])),
      )
      await extractPlotState(t.db, opts)
      previousId = (await ledgerAtAnchor(t.db, 'book'))!.state.facts.at(-1)!.id
    }
    expect(input(23).previous.facts).toHaveLength(1)
    expect((await ledgerAtAnchor(t.db, 'book'))!.state.facts).toHaveLength(24)
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
    await expect(extractPlotState(t.db, opts)).rejects.toThrow('同核心主体')
    expect((await ledgerAtAnchor(t.db, 'book'))!.processed).toBe(2)
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
    vi.mocked(getAiSettings).mockResolvedValue({ ...DEFAULT_AI_SETTINGS, storyMemoryEngine: 'incremental', storyMemoryAutoUpdate: true })
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
    expect(ledger.state.entities[0]!.aliasEvidence?.[0]).toMatchObject({ chapterId: 'c1', quote: '林舟又名阿舟' })
    expect(input(1).previous.entities[0].name).toBe('林舟')
    expect((await generateStoryGraph(t.db, opts)).graph?.people[0]?.aliases).toEqual(['阿舟'])
  })

  it('keeps an alias whose name is verbatim in the chapter even when the model sends no identityQuote', async () => {
    await chapter(1, '林舟又名阿舟，他留下铜钥匙。阿舟走进客栈。')
    vi.mocked(chat).mockResolvedValueOnce(
      reply(payload([fact({ subjects: ['林舟'], summary: '林舟留下铜钥匙。', quote: '他留下铜钥匙。' })], [{ ...entity('林舟', 'person', ['阿舟']) }])),
    )
    await extractPlotState(t.db, opts)
    const ledger = (await ledgerAtAnchor(t.db, 'book'))!
    expect(ledger.processed).toBe(1)
    expect(ledger.state.entities[0]!.aliases).toEqual(['阿舟'])
    expect(ledger.state.entities[0]!.aliasEvidence).toBeUndefined()

    await chapter(2, '阿舟再次走进客栈，见到沈砚。')
    vi.mocked(chat).mockResolvedValueOnce(reply(payload([], [{ ...entity('林舟', 'person', ['无名别称']) }])))
    await expect(extractPlotState(t.db, opts)).rejects.toThrow('缺少正文来源')
  })
})
