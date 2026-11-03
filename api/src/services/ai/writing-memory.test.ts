import { describe, expect, it } from 'vitest'
import { renderLedger, type LedgerState, type MemoryFact } from './story-ledger'
import { projectWritingState, selectWritingLedger } from './writing-memory'

const fact = (id: string, ordinal: number, overrides: Partial<MemoryFact> = {}): MemoryFact => ({
  id,
  ordinal,
  memoryType: 'state',
  kind: 'state',
  subjects: ['person'],
  label: '当前位置',
  summary: `林舟在第${ordinal}处地点。`,
  certainty: 'fact',
  status: 'active',
  scope: 'local',
  replaces: [],
  quote: `林舟在第${ordinal}处地点。`,
  chapterId: `c${ordinal}`,
  ...overrides,
})
const ledger = (facts: MemoryFact[]): LedgerState => ({
  entities: [
    { id: 'person', name: '林舟', aliases: [], kind: 'person' },
    { id: 'other', name: '沈月', aliases: [], kind: 'person' },
    { id: 'key', name: '铜钥匙', aliases: [], kind: 'item' },
  ],
  facts,
})

describe('writing memory projection', () => {
  it('projects the latest exact state topic while preserving the original ledger and evidence', () => {
    const original = ledger([fact('old', 1), fact('new', 2)])
    const snapshot = structuredClone(original)
    const projected = projectWritingState(original)
    expect(projected.facts.map((f) => f.id)).toEqual(['new'])
    expect(original).toEqual(snapshot)
    expect(projected.facts[0]?.quote).toBe(original.facts[1]?.quote)
  })

  it('keeps distinct themes, knowledge owners, relationship directions and global rules separate', () => {
    const facts = [
      fact('location', 1),
      fact('goal', 2, { label: '调查目标' }),
      fact('belief-a', 2, { label: '密道入口认知', certainty: 'belief', perspective: 'person' }),
      fact('belief-b', 3, { label: '密道入口认知', certainty: 'belief', perspective: 'other' }),
      fact('a-to-b', 2, { kind: 'relationship', subjects: ['person', 'other'], directed: true, label: '信任' }),
      fact('b-to-a', 3, { kind: 'relationship', subjects: ['other', 'person'], directed: true, label: '信任' }),
      fact('rule-a', 1, { label: '世界规则', scope: 'global' }),
      fact('rule-b', 2, { label: '世界规则', scope: 'global' }),
    ]
    expect(projectWritingState(ledger(facts)).facts.map((f) => f.id)).toEqual(facts.map((f) => f.id))
  })

  it('recognizes the same item when its holder changes, keeping other items intact', () => {
    const state = ledger([
      fact('old-holder', 1, { kind: 'item', label: '钥匙归属', subjects: ['key', 'person'] }),
      fact('new-holder', 2, { kind: 'item', label: '钥匙归属', subjects: ['key', 'other'] }),
    ])
    expect(projectWritingState(state).facts.map((f) => f.id)).toEqual(['new-holder'])
  })

  it('retains unresolved clues and distinct historical facts sharing a broad label', () => {
    const facts = [
      fact('clue-a', 1, { kind: 'clue', label: '密道线索' }),
      fact('clue-b', 2, { kind: 'clue', label: '密道线索' }),
      fact('event-a', 1, { memoryType: 'event', kind: 'fact', label: '会面' }),
      fact('event-b', 2, { memoryType: 'event', kind: 'fact', label: '会面' }),
    ]
    expect(projectWritingState(ledger(facts)).facts.map((f) => f.id)).toEqual(facts.map((f) => f.id))
  })

  it('does not treat different observations under a broad state label as replacements', () => {
    const facts = [
      fact('a', 1, { label: '调查现状', summary: '林舟仍然持有铜钥匙。' }),
      fact('b', 2, { label: '调查现状', summary: '林舟约定明日到南城调查。' }),
    ]
    expect(projectWritingState(ledger(facts)).facts.map((f) => f.id)).toEqual(['a', 'b'])
  })

  it('keeps old facts searchable without feeding every protagonist state to a new chapter', () => {
    const facts = Array.from({ length: 200 }, (_, i) => fact(`f${i}`, i + 1, { label: `旧主题${i}`, summary: '林舟完成过去的调查。'.repeat(30) }))
    facts.push(fact('key', 1, { kind: 'item', subjects: ['key', 'person'], label: '铜钥匙归属', summary: '铜钥匙由林舟持有。' }))
    const original = ledger(facts)
    const selected = selectWritingLedger(original, { context: '林舟继续走进书房。', instruction: '接续当前场景。' })
    expect(selected.state.facts.length).toBeLessThan(60)
    expect(selected.state.facts.some((f) => f.id === 'key')).toBe(true)
    expect(selected.omittedFacts).toBeGreaterThan(0)
    expect(original.facts).toHaveLength(201)
    const history = selectWritingLedger(original, { context: '林舟继续走进书房。', instruction: '回顾旧主题0的调查。' })
    expect(history.state.facts.some((f) => f.id === 'f0')).toBe(true)
  })

  it('never cuts evidence strings to fit a budget and keeps world constraints visible', () => {
    const rule = fact('rule', 1, { scope: 'global', quote: '完整世界规则。'.repeat(100), summary: '世界规则。' })
    const selected = selectWritingLedger(ledger([rule, fact('ordinary', 2)]), { context: '林舟', instruction: '', maxCharacters: 100 })
    expect(selected.state.facts[0]?.quote).toBe(rule.quote)
    expect(selected.overBudget).toBe(true)
  })

  it('labels historical state as history even when the new state does not fit the selection', () => {
    const state = ledger([fact('old', 1), fact('new', 2, { quote: '新地点证据。'.repeat(300) })])
    const selected = selectWritingLedger(state, { context: '林舟', instruction: '回顾当前位置的变化', maxCharacters: 300 })
    expect(selected.state.facts.map((f) => f.id)).toEqual(['old'])
    expect(renderLedger(selected.state, 'plot', true)).toContain('【历史记录，仅作回顾依据】')
  })
})
