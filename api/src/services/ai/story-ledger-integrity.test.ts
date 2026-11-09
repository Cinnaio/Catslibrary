import { describe, expect, it } from 'vitest'
import { aliasIdentityGrounded, replacementProblem } from './story-ledger-integrity'
import { emptyLedger, parseChapterMemory, type MemoryEntity, type MemoryFact } from './story-ledger'

const entities = new Map<string, MemoryEntity>([
  ['lin', { id: 'lin', name: '林舟', aliases: [], kind: 'person' }],
  ['shen', { id: 'shen', name: '沈砚', aliases: [], kind: 'person' }],
  ['key', { id: 'key', name: '铜钥匙', aliases: [], kind: 'item' }],
  ['sword', { id: 'sword', name: '银剑', aliases: [], kind: 'item' }],
  ['inn', { id: 'inn', name: '客栈', aliases: [], kind: 'place' }],
  ['gate', { id: 'gate', name: '城门', aliases: [], kind: 'place' }],
])
const fact = (patch: Partial<MemoryFact> = {}): MemoryFact => ({
  id: 'old',
  memoryType: 'state',
  kind: 'item',
  subjects: ['lin', 'key'],
  label: '铜钥匙归属',
  summary: '林舟持有铜钥匙。',
  certainty: 'fact',
  status: 'active',
  scope: 'local',
  replaces: [],
  quote: '林舟持有铜钥匙。',
  chapterId: 'c1',
  ordinal: 1,
  ...patch,
})

describe('story memory identity and state transitions', () => {
  it.each(['林舟又名阿舟。', '林舟，化名为“阿舟”。', '阿舟本名林舟。'])('accepts an explicit identity statement: %s', (quote) => {
    expect(aliasIdentityGrounded('林舟', '阿舟', quote)).toBe(true)
  })
  it.each([
    ['沈砚', '林舟在门前，沈砚在屋内。'],
    ['阿舟', '林舟听沈砚说，他又名阿舟。'],
    ['阿舟', '林舟并非又名阿舟。'],
    ['阿舟', '林舟又名阿舟子。'],
    ['阿舟', '沈砚猜测林舟又名阿舟。'],
    ['阿舟', '林舟又名阿舟吗？'],
    ['阿舟', '林舟又名阿舟？'],
  ])('rejects an unsupported identity: %s / %s', (alias, quote) => {
    expect(aliasIdentityGrounded('林舟', alias, quote)).toBe(false)
  })

  it('allows ownership transfer of the same item, but never one item replacing another', () => {
    expect(replacementProblem(fact(), fact({ subjects: ['shen', 'key'] }), entities)).toBeUndefined()
    expect(replacementProblem(fact(), fact({ subjects: ['lin', 'sword'], summary: '林舟拿起银剑，铜钥匙仍在。' }), entities)).toContain('同一物品')
    expect(replacementProblem(fact(), fact({ subjects: ['shen', 'key'], label: '铜钥匙持有人' }), entities)).toBeUndefined()
    expect(replacementProblem(fact(), fact({ label: '铜钥匙完好程度' }), entities)).toContain('主题不同')
  })
  it('refines generic ownership into an item state using an explicit named item', () => {
    const before = fact({ kind: 'state', subjects: ['lin'], label: '持有钥匙' })
    expect(replacementProblem(before, fact({ subjects: ['shen', 'key'] }), entities)).toBeUndefined()
    expect(replacementProblem(before, fact({ subjects: ['lin', 'sword'], label: '银剑归属' }), entities)).toContain('同一物品')
  })
  it.each(['state', 'fact'] as const)('rejects unanchored ownership replacement classified as %s', (kind) => {
    const people = new Map([...entities].filter(([, entity]) => entity.kind === 'person'))
    const before = fact({ kind, subjects: ['lin'], label: '持有物品' })
    const next = { ...before, summary: '林舟持有银剑。' }
    expect(replacementProblem(before, next, people)).toContain('缺少可核对的物品身份')
    // Merely having an unrelated item in the ledger cannot provide the anchor.
    people.set('ring', { id: 'ring', name: '戒指', kind: 'item', aliases: [] })
    expect(replacementProblem(before, next, people)).toContain('缺少可核对的物品身份')
    expect(replacementProblem(before, next, entities)).toContain('同一物品')
    expect(replacementProblem(before, { ...before, summary: '铜钥匙仍在林舟手里。' }, entities)).toBeUndefined()
  })
  it.each(['归属', '持有人', '保管人', '持有'])('accepts a terse ownership label only for the same identifiable item: %s', (label) => {
    const before = fact({ label })
    expect(replacementProblem(before, { ...before, subjects: ['shen', 'key'] }, entities)).toBeUndefined()
    expect(replacementProblem(before, { ...before, subjects: ['shen', 'sword'] }, entities)).toContain('同一物品')
    const generic = { ...before, kind: 'state' as const, subjects: ['lin'] }
    expect(replacementProblem(generic, generic, new Map([['lin', entities.get('lin')!]]))).toContain('物品身份')
  })
  it('binds location to the person rather than a shared destination', () => {
    const before = fact({ kind: 'place', subjects: ['lin', 'inn'], label: '当前位置' })
    expect(replacementProblem(before, { ...before, subjects: ['lin', 'gate'] }, entities)).toBeUndefined()
    expect(replacementProblem(before, { ...before, subjects: ['lin', 'gate'], label: '所在地点' }, entities)).toBeUndefined()
    expect(replacementProblem(before, { ...before, subjects: ['shen', 'inn'] }, entities)).toContain('同一人物')
  })
  it('retains the relationship pair, direction and topic', () => {
    const before = fact({ kind: 'relationship', subjects: ['lin', 'shen'], label: '信任', directed: true })
    expect(replacementProblem(before, { ...before, summary: '林舟开始信任沈砚。' }, entities)).toBeUndefined()
    expect(replacementProblem(before, { ...before, subjects: ['shen', 'lin'] }, entities)).toContain('方向')
    expect(replacementProblem(before, { ...before, label: '债务' }, entities)).toContain('主题不同')
  })
  it('does not erase an event, change topic/category or guess the knower', () => {
    const before = fact({ kind: 'state', subjects: ['lin'], label: '入口认知', certainty: 'belief', perspective: 'lin' })
    expect(replacementProblem(before, { ...before, label: '城门认知' }, entities)).toContain('主题不同')
    expect(replacementProblem(before, { ...before, kind: 'boundary' }, entities)).toContain('类别不同')
    expect(replacementProblem(before, { ...before, perspective: 'shen' }, entities)).toContain('认知口径不同')
    expect(replacementProblem({ ...before, memoryType: 'event' }, before, entities)).toContain('持续状态')
    expect(replacementProblem(before, { ...before, certainty: 'fact', perspective: undefined }, entities)).toBeUndefined()
  })
  it('allows a boundary becoming a fact only with its original subjects and topic', () => {
    const before = fact({ kind: 'boundary', subjects: ['lin', 'shen'], label: '身份公开范围' })
    expect(replacementProblem(before, { ...before, kind: 'fact' }, entities)).toBeUndefined()
    expect(replacementProblem(before, { ...before, kind: 'fact', subjects: ['lin'] }, entities)).toContain('核心主体')
    expect(replacementProblem(before, { ...before, kind: 'fact', label: '当前位置' }, entities)).toContain('主题不同')
  })
})

describe('chapter semantic completeness', () => {
  const text = '林舟站在门前，沈砚仍在屋内。'
  const opts = {
    novelId: 'book',
    chapterId: 'c2',
    ordinal: 2,
    part: 0,
    text,
    previous: { entities: [...entities.values()], facts: [] },
    supplied: emptyLedger(),
    tolerant: true,
  }
  const rawFact = { ...fact(), kind: 'state', subjects: ['林舟'], quote: text, replaces: [] }

  it('does not accept a partial fact list or silently remove an unknown participant', () => {
    expect(() => parseChapterMemory({ entities: [], facts: [rawFact, { ...rawFact, quote: '不存在的证据' }] }, opts)).toThrow('逐字匹配')
    expect(() => parseChapterMemory({ entities: [], facts: [{ ...rawFact, subjects: ['林舟', '未声明的人'] }] }, opts)).toThrow('未声明')
    expect(() => parseChapterMemory({ entities: [], facts: [{ ...rawFact, subjects: ['林舟父亲'] }] }, opts)).toThrow('未声明')
  })
  it('rejects co-occurring aliases even alongside valid facts and rejects a mismatched known id', () => {
    expect(() => parseChapterMemory({ entities: [{ name: '林舟', kind: 'person', aliases: ['沈砚'], identityQuote: text }], facts: [rawFact] }, opts)).toThrow(
      '冲突',
    )
    const unknownShen = { ...opts, previous: { entities: [entities.get('lin')!], facts: [] } }
    expect(() =>
      parseChapterMemory({ entities: [{ name: '林舟', kind: 'person', aliases: ['沈砚'], identityQuote: text }], facts: [rawFact] }, unknownShen),
    ).toThrow('明确身份说明')
    expect(() => parseChapterMemory({ entities: [{ id: 'shen', name: '林舟', kind: 'person', aliases: [] }], facts: [] }, opts)).toThrow('ID')
  })
  it('does not turn a clipped identity quote from speculation into a confirmed alias', () => {
    expect(() =>
      parseChapterMemory(
        { entities: [{ name: '林舟', kind: 'person', aliases: ['阿舟'], identityQuote: '林舟又名阿舟' }], facts: [] },
        {
          ...opts,
          text: '沈砚猜测林舟又名阿舟。',
        },
      ),
    ).toThrow('明确身份说明')
  })
  it('fills a missing name only from a known entity id and keeps exact references', () => {
    expect(
      parseChapterMemory({ entities: [{ id: 'lin', kind: 'person', aliases: [] }], facts: [{ ...rawFact, subjects: ['lin'] }] }, opts).entities[0]?.name,
    ).toBe('林舟')
    expect(() => parseChapterMemory({ entities: [{ id: 'unknown', kind: 'person', aliases: [] }], facts: [] }, opts)).toThrow('姓名')
    expect(() =>
      parseChapterMemory(
        { entities: [], facts: [{ ...rawFact, subjects: ['林舟父亲'], quote: '林舟的父亲站在门前。' }] },
        { ...opts, text: '林舟的父亲站在门前。' },
      ),
    ).toThrow('未声明')
  })
  it('rejects missing or invalid cognition, status, scope and replacement fields', () => {
    for (const patch of [
      { certainty: 'belief' },
      { status: 'unknown' },
      { scope: 'unknown' },
      { replaces: 'old' },
      { replaces: ['unknown'] },
      { certainty: 'fact', perspective: '沈砚' },
    ])
      expect(() => parseChapterMemory({ entities: [], facts: [{ ...rawFact, ...patch }] }, opts)).toThrow('校验失败')
  })
  it('repairs known enum/layout differences without inventing semantics and accepts a genuine empty chapter', () => {
    const result = parseChapterMemory(
      { entities: [], facts: [{ ...rawFact, status: 'ongoing', scope: 'chapter', quote: '林舟站在门前,沈砚仍在屋内。' }] },
      opts,
    )
    expect(result.facts[0]).toMatchObject({ status: 'active', scope: 'local', quote: text.slice(0, -1) })
    expect(parseChapterMemory({ entities: [], facts: [] }, opts).facts).toEqual([])
  })
  it('treats omitted aliases as no new aliases, but rejects malformed supplied aliases and invented entities', () => {
    expect(parseChapterMemory({ entities: [{ name: '林舟', kind: 'person' }], facts: [] }, opts).entities[0]?.aliases).toEqual([])
    for (const aliases of [null, '阿舟', {}]) {
      expect(() => parseChapterMemory({ entities: [{ name: '林舟', kind: 'person', aliases }], facts: [] }, opts)).toThrow('aliases')
    }
    expect(() => parseChapterMemory({ entities: [{ name: '城中退潮开门规则', kind: 'faction' }], facts: [] }, opts)).toThrow('不在本章正文')
  })
  it('rejects mixed valid and invalid replacement ids without modifying earlier memory', () => {
    const before = fact({ kind: 'state', subjects: ['lin'] })
    const state = { entities: [...entities.values()], facts: [before] }
    expect(() =>
      parseChapterMemory({ entities: [], facts: [{ ...rawFact, replaces: ['old', 'missing'] }] }, { ...opts, previous: state, supplied: state }),
    ).toThrow('当前有效状态')
    expect(state.facts).toEqual([before])
  })
})
