import { describe, expect, it } from 'vitest'
import { applyChapterMemory, currentFacts, parseChapterMemory, relevantLedger, workingFacts, type MemoryEntity, type MemoryFact } from './story-ledger'
import { cognitionProblem, replacementProblem, resolutionProblem } from './story-ledger-integrity'
import { stateIdentity } from './story-ledger-state'

const entities: MemoryEntity[] = [
  { id: 'lin', name: '林舟', kind: 'person', aliases: [] },
  { id: 'shen', name: '沈砚', kind: 'person', aliases: [] },
  { id: 'key', name: '铜钥匙', kind: 'item', aliases: [] },
  { id: 'sword', name: '银剑', kind: 'item', aliases: [] },
]
const byId = new Map(entities.map((e) => [e.id, e]))
const fact = (patch: Partial<MemoryFact> = {}): MemoryFact => ({
  id: 'old', memoryType: 'state', kind: 'clue', subjects: ['key'], label: '钥匙密文含义', summary: '钥匙密文尚未破解。',
  certainty: 'clue', status: 'active', scope: 'local', replaces: [], quote: '钥匙密文尚未破解。', chapterId: 'c1', ordinal: 1, ...patch,
})
const text = '林舟把铜钥匙交给沈砚。银剑仍在林舟手中。两人查明钥匙密文指向东门。沈砚知道入口在东门。林舟不知道入口。'
const parse = (old: MemoryFact[], updates: MemoryFact[], supplied = old) => parseChapterMemory({ entities: [], facts: updates }, {
  novelId: 'book', chapterId: 'c2', ordinal: 2, part: 0, text, previous: { entities, facts: old }, supplied: { entities, facts: supplied },
})

describe('story state identities and resolutions', () => {
  it('normalizes knowledge categories without turning a clue or another knower into a fact', () => {
    const old = fact({ certainty: 'belief', perspective: 'shen', subjects: ['shen'], label: '入口位置', summary: '沈砚不知道入口。' })
    const update = { ...old, kind: 'state' as const, summary: '沈砚知道入口在东门。', quote: '沈砚知道入口在东门', replaces: ['old'] }
    expect(parse([old], [update]).facts[0]).toMatchObject({ kind: 'state', certainty: 'belief', perspective: 'shen', replaces: ['old'] })
    expect(replacementProblem(old, { ...update, perspective: 'lin' }, byId)).toContain('认知口径不同')
    expect(replacementProblem(fact(), fact({ certainty: 'fact', kind: 'state' }), byId)).toContain('认知口径不同')
  })
  it('closes a clue through an explicit answer and retains searchable resolution history', () => {
    const old = fact()
    const next = fact({ kind: 'fact', certainty: 'fact', summary: '钥匙密文指向东门。', quote: '两人查明钥匙密文指向东门', resolves: [old.id] })
    const state = applyChapterMemory({ entities, facts: [old] }, parse([old], [next]))
    expect(workingFacts(state)).toHaveLength(1)
    expect(workingFacts(state)[0]).toMatchObject({ certainty: 'fact', resolves: ['old'] })
    expect(state.facts).toContainEqual(old)
    expect(relevantLedger(state, '', ['钥匙密文']).facts.find((f) => f.id === old.id)?.stillActive).toBe(false)
    expect(() => parse(state.facts, [{ ...next, resolves: ['old'] }], relevantLedger(state, '', ['钥匙密文']).facts)).toThrow('当前有效状态')
  })
  it('does not resolve beliefs, unrelated questions, events or already closed history', () => {
    const answer = fact({ kind: 'fact', certainty: 'fact' })
    for (const old of [fact({ certainty: 'belief', perspective: 'lin' }), fact({ memoryType: 'event' }), fact({ status: 'resolved' })])
      expect(resolutionProblem(old, answer)).toContain('只能解决')
    expect(resolutionProblem(fact(), { ...answer, label: '另一段密文' })).toContain('沿用')
    expect(resolutionProblem(fact(), { ...answer, subjects: ['sword'] })).toContain('沿用')
    expect(resolutionProblem(fact(), { ...answer, certainty: 'belief', perspective: 'lin' })).toContain('客观')
  })
  it('requires one operation per target and rejects an unresolved guess used as an answer', () => {
    const old = fact()
    expect(() => parse([old], [fact({ quote: text, replaces: ['old'], resolves: ['old'] })])).toThrow('当前有效状态')
    expect(() => parse([old], [fact({ quote: text, resolves: ['old'] })])).toThrow('客观')
  })
  it('rejects explicit knowledge phrased as fact and a mismatched or shared knower', () => {
    expect(cognitionProblem(fact({ certainty: 'fact', summary: '沈砚知道入口在东门。' }), byId)).toContain('certainty=belief')
    expect(cognitionProblem(fact({ certainty: 'belief', perspective: 'lin', summary: '沈砚知道入口在东门。' }), byId)).toContain('其他认知者')
    expect(cognitionProblem(fact({ certainty: 'belief', perspective: 'shen', summary: '沈砚知道入口在东门，林舟不知道入口。' }), byId)).toContain('分别记录')
    expect(cognitionProblem(fact({ certainty: 'belief', perspective: 'shen', summary: '沈砚知道入口在东门。' }), byId)).toBeUndefined()
    expect(cognitionProblem(fact({ certainty: 'belief', perspective: 'shen', status: 'resolved' }), byId)).toContain('active')
  })
  it('binds an ownership slot to the item, independently of the holder or label synonym', () => {
    const old = fact({ kind: 'item', certainty: 'fact', subjects: ['lin', 'key'], label: '归属', summary: '林舟持有铜钥匙。' })
    const next = { ...old, subjects: ['shen', 'key'], label: '保管人', summary: '沈砚保管铜钥匙。', quote: '林舟把铜钥匙交给沈砚' }
    expect(stateIdentity(old, byId)?.key).toBe(stateIdentity(next, byId)?.key)
    expect(stateIdentity(old, byId)?.key).not.toBe(stateIdentity({ ...next, subjects: ['shen', 'sword'] }, byId)?.key)
    const saved = parse([old], [next])
    expect(saved.facts[0]?.replaces).toEqual(['old'])
    expect(currentFacts(applyChapterMemory({ entities, facts: [old] }, saved))).toHaveLength(1)
  })
  it('uses the same item anchor for generic and explicit ownership, without deriving it from unrelated evidence', () => {
    const old = fact({ kind: 'state', certainty: 'fact', subjects: ['lin'], label: '铜钥匙持有人', summary: '林舟持有铜钥匙。' })
    const explicit = { ...old, subjects: ['shen', 'key'], kind: 'item' as const, label: '保管人', summary: '沈砚持有铜钥匙。', quote: text }
    expect(stateIdentity(old, byId)?.key).toBe(stateIdentity(explicit, byId)?.key)
    const initial = parse([], [{ ...old, quote: text }]).facts[0]!
    expect(initial.subjects).toEqual(['lin', 'key'])
    expect(parse([old], [explicit]).facts[0]?.replaces).toEqual(['old'])
    const vague = { ...old, label: '归属', summary: '林舟保管物品。', quote: text }
    expect(stateIdentity(vague, byId)?.singleton).toBe(false)
    expect(parse([], [vague]).facts[0]?.subjects).toEqual(['lin'])
  })
  it('retains separate slots for different knowers, topics and relationship directions', () => {
    const knowledge = fact({ certainty: 'belief', perspective: 'lin', subjects: ['lin', 'key'] })
    expect(stateIdentity(knowledge, byId)?.key).not.toBe(stateIdentity({ ...knowledge, perspective: 'shen', subjects: ['shen', 'key'] }, byId)?.key)
    expect(stateIdentity(knowledge, byId)?.key).not.toBe(stateIdentity({ ...knowledge, label: '另一场谈话' }, byId)?.key)
    const relation = fact({ kind: 'relationship', certainty: 'fact', directed: true, subjects: ['lin', 'shen'] })
    expect(stateIdentity(relation, byId)?.key).not.toBe(stateIdentity({ ...relation, subjects: ['shen', 'lin'] }, byId)?.key)
  })
  it('deduplicates an identical observation but requires explicit updates to free-form topics', () => {
    const old = fact()
    expect(parse([old], [{ ...old, quote: text }]).facts).toEqual([])
    expect(() => parse([old], [{ ...old, summary: '密文仍有其他疑点。', quote: text }])).toThrow('不能另建重复状态')
    expect(parse([old], [{ ...old, summary: '密文仍有其他疑点。', quote: text, replaces: ['old'] }]).facts[0]?.replaces).toEqual(['old'])
  })
  it('rejects two competing values in one segment and never replaces a hidden state', () => {
    const first = fact({ kind: 'item', certainty: 'fact', label: '归属', subjects: ['lin', 'key'], quote: text })
    expect(() => parse([], [first, { ...first, subjects: ['shen', 'key'] }])).toThrow('同一段不能重复')
    expect(() => parse([first], [{ ...first, subjects: ['shen', 'key'] }], [])).toThrow('needs')
  })
  it('preserves complete chapter atomicity when a later state fails validation', () => {
    const old = fact()
    const prefix = { entities, facts: [old] }
    expect(() => parse(prefix.facts, [
      fact({ kind: 'fact', certainty: 'fact', quote: text, resolves: ['old'] }),
      fact({ quote: '没有出现在正文中的内容' }),
    ])).toThrow('逐字匹配')
    expect(prefix.facts).toEqual([old])
    expect(workingFacts(prefix)).toEqual([old])
  })
})
