import { describe, expect, it } from 'vitest'
import { applyChapterMemory, emptyLedger, parseChapterMemory, relevantLedger, renderLedger, workingFacts, type MemoryEntity, type MemoryFact } from './story-ledger'
import { continuedGoalProblem, goalEndingProblem, summaryProblem } from './story-ledger-goals'
import { placePossessiveName } from './story-ledger-names'

const entities: MemoryEntity[] = [
  { id: 'yan', name: '燕棠', kind: 'person', aliases: [] },
  { id: 'tao', name: '陶策', kind: 'person', aliases: [] },
  { id: 'station', name: '山站', kind: 'place', aliases: [] },
]
const goal: MemoryFact = {
  id: 'goal-1', memoryType: 'state', kind: 'goal', subjects: ['tao'], label: '检修电闸', summary: '陶策计划检修电闸。',
  certainty: 'fact', status: 'active', scope: 'local', replaces: [], quote: '陶策计划检修电闸。', chapterId: 'c1', ordinal: 1,
}
const parse = (text: string, facts: unknown[] = [], goalReviews?: unknown[], previous = { entities, facts: [goal] }) => parseChapterMemory(
  { entities: [], facts, ...(goalReviews ? { goalReviews } : {}) },
  { novelId: 'book', chapterId: 'c2', ordinal: 2, part: 0, text, previous, supplied: relevantLedger(previous, text) },
)

describe('goal lifecycle contract', () => {
  it('requires review even when an event reports completion under a different category and label', () => {
    const text = '陶策完成检修电闸。'
    expect(() => parse(text, [{ ...goal, memoryType: 'event', kind: 'fact', label: '工作结束', summary: text, quote: text }])).toThrow('goalReviews 缺少')
    expect(() => parse(text, [], [{ id: goal.id, decision: 'continue' }])).toThrow('不能 continue')
  })
  it.each(['completed', 'cancelled'] as const)('closes a goal as %s with an immutable history link', (decision) => {
    const text = decision === 'completed' ? '陶策完成检修电闸。' : '陶策取消检修电闸。'
    const saved = parse(text, [], [{ id: goal.id, decision, quote: text }])
    const state = applyChapterMemory({ entities, facts: [goal] }, saved)
    expect(workingFacts(state)).toEqual([])
    expect(state.facts[0]).toEqual(goal)
    expect(saved.facts[0]).toMatchObject({ subjects: goal.subjects, label: goal.label, goalOutcome: decision, status: 'resolved', replaces: [goal.id] })
    expect(relevantLedger(state, '', ['检修电闸']).facts.find((fact) => fact.id === goal.id)?.stillActive).toBe(false)
    expect(renderLedger(state, 'plot')).toContain(decision === 'completed' ? '目标已完成' : '目标已取消')
  })
  it('keeps unmentioned goals visible and unchanged, including when their owner is absent', () => {
    const text = '燕棠来到客栈。'
    expect(relevantLedger({ entities, facts: [goal] }, text).facts).toContainEqual(goal)
    const saved = parse(text, [], [{ id: goal.id, decision: 'continue' }])
    expect(saved.facts).toEqual([])
    expect(workingFacts(applyChapterMemory({ entities, facts: [goal] }, saved))).toEqual([goal])
  })
  it('links a replacement goal without turning the old goal into a differently named state', () => {
    const text = '陶策将检修电闸改为更换水泵，新的工作尚未开始。'
    const next = { ...goal, label: '更换水泵', summary: '陶策计划更换水泵。', quote: text }
    const saved = parse(text, [next], [{ id: goal.id, decision: 'superseded', quote: text, successor: '更换水泵' }])
    const state = applyChapterMemory({ entities, facts: [goal] }, saved)
    expect(workingFacts(state).map((fact) => fact.label)).toEqual(['更换水泵'])
    expect(saved.facts[1]).toMatchObject({ goalOutcome: 'superseded', successor: saved.facts[0]!.id })
    expect(() => parse(text, [], [{ id: goal.id, decision: 'superseded', quote: text, successor: '更换水泵' }])).toThrow('唯一的新目标')
  })
  it('rejects unrelated, stale, duplicate and missing review targets atomically', () => {
    const text = '陶策完成检修电闸。'
    const review = { id: goal.id, decision: 'completed', quote: text }
    for (const list of [[{ ...review, id: 'foreign' }], [review, review]]) expect(() => parse(text, [], list)).toThrow('唯一')
    expect(() => parse(text, [], [review], { entities, facts: [{ ...goal, status: 'resolved' }] })).toThrow('当前目标')
    expect(() => parse(text, [{ ...goal, kind: 'fact', label: '工作结束', summary: text, quote: text, replaces: [goal.id] }], [review])).toThrow('只能通过 goalReviews')
    expect(goal.status).toBe('active')
  })
  it.each(['clue', 'boundary', 'state', 'relationship'])('rejects goals disguised as %s', (kind) => {
    expect(() => parse('陶策计划检修电闸。', [{ ...goal, subjects: kind === 'relationship' ? ['yan', 'tao'] : ['tao'], directed: false, kind, label: '检修计划' }], [], { entities, facts: [] })).toThrow('kind=goal')
  })
  it('keeps negated completion, future plans and memories from closing current goals', () => {
    for (const text of ['陶策尚未完成检修电闸。', '陶策准备完成检修电闸。', '陶策回忆完成检修电闸的那天。']) {
      expect(continuedGoalProblem(goal, text)).toBeUndefined()
      expect(goalEndingProblem('completed', text)).toBeDefined()
    }
    expect(goalEndingProblem('completed', '陶策在山站喝茶。')).toBeDefined()
    expect(goalEndingProblem('cancelled', '陶策完成检修电闸。')).toBeDefined()
    expect(goalEndingProblem('completed', '陶策完成整理档案。', goal)).toBeDefined()
    expect(() => parse('陶策尚未完成检修电闸。', [], [{ id: goal.id, decision: 'completed', quote: '完成检修电闸' }])).toThrow('明确的当前结束')
  })
  it('does not create the same goal again by changing only the lifecycle suffix', () => {
    const text = '陶策计划检修电闸。'
    expect(parse(text, [{ ...goal, label: '检修电闸计划' }], [{ id: goal.id, decision: 'continue' }]).facts).toEqual([])
    expect(() => parse(text, [{ ...goal, label: '检修电闸计划', summary: '陶策计划优先检修电闸。' }], [{ id: goal.id, decision: 'continue' }])).toThrow('不能另建重复状态')
  })
})

describe('traceable name normalization', () => {
  const text = '山站的电闸已经断电。燕棠和唐燕是不同的人。'
  const run = (declarations: unknown[], prose = text) => parseChapterMemory({ entities: declarations, facts: [] }, {
    novelId: 'book', chapterId: 'c1', ordinal: 1, part: 0, text: prose, previous: emptyLedger(), supplied: emptyLedger(),
  })
  it('preserves a verified source mapping and reuses it on subsequent references', () => {
    const saved = run([{ name: '山站', kind: 'place' }, { name: '山站电闸', kind: 'item', sourceName: '山站的电闸' }])
    const item = saved.entities[1]!
    expect(item.sourceNames).toEqual([{ text: '山站的电闸', rule: 'place-possessive', chapterId: 'c1', ordinal: 1 }])
    expect(item.aliases).toEqual([])
    const state = applyChapterMemory(emptyLedger(), saved)
    const next = parseChapterMemory({ entities: [], facts: [{ ...goal, kind: 'item', subjects: ['山站的电闸'], label: '供电状态', summary: '山站电闸已经断电。', quote: text.split('。')[0] }] }, {
      novelId: 'book', chapterId: 'c2', ordinal: 2, part: 0, text, previous: state, supplied: state,
    })
    expect(next.facts[0]!.subjects).toEqual([item.id])
    const combined = applyChapterMemory(state, next)
    expect(renderLedger(combined, 'plot')).toContain('山站的电闸 → 山站电闸')
    expect(relevantLedger(combined, '山站的电闸').facts).toHaveLength(1)
  })
  it('canonicalizes the exact possessive spelling to the same id', () => {
    const a = run([{ name: '山站', kind: 'place' }, { name: '山站电闸', kind: 'item' }])
    const b = run([{ name: '山站', kind: 'place' }, { name: '山站的电闸', kind: 'item' }])
    expect(a.entities[1]!.id).toBe(b.entities[1]!.id)
  })
  it('does not strip arbitrary particles, combine people or infer undeclared places', () => {
    expect(placePossessiveName('燕棠母亲', 'person', '燕棠的母亲来了。', ['燕棠'])).toBeUndefined()
    expect(placePossessiveName('山站神秘电闸', 'item', '山站的神秘电闸。', ['山站'])).toBeUndefined()
    expect(placePossessiveName('山站电闸', 'item', text, [])).toBeUndefined()
    expect(() => run([{ name: '山站电闸', kind: 'item', sourceName: '山站的电闸' }])).toThrow('sourceName')
    const people = run([{ name: '燕棠', kind: 'person' }, { name: '唐燕', kind: 'person' }])
    expect(new Set(people.entities.map((person) => person.id)).size).toBe(2)
  })
  it('does not merge two separately named objects when both spellings occur', () => {
    const prose = '山站的电闸已经断电。山站电闸是另一件展品。'
    const saved = run([{ name: '山站', kind: 'place' }, { name: '山站的电闸', kind: 'item' }, { name: '山站电闸', kind: 'item' }], prose)
    expect(saved.entities[1]!.id).not.toBe(saved.entities[2]!.id)
    expect(saved.entities.every((entity) => !entity.sourceNames)).toBe(true)
  })
})

describe('summary scope and supported details', () => {
  const map = new Map(entities.map((entity) => [entity.id, entity]))
  it('rejects progress and plans embedded in position, and position embedded in knowledge', () => {
    expect(summaryProblem({ ...goal, kind: 'state', label: '当前位置', summary: '陶策在山站修好了电闸，准备明日下山。' }, map)).toContain('拆开')
    expect(summaryProblem({ ...goal, kind: 'state', certainty: 'belief', perspective: 'yan', label: '会议内容', summary: '燕棠仍在城门等候，因此不知道会议内容。' }, map)).toContain('混入')
    expect(summaryProblem({ ...goal, kind: 'state', certainty: 'belief', perspective: 'yan', label: '陶策去向', summary: '燕棠知道陶策在山站。' }, map)).toBeUndefined()
  })
  it('rejects new gendered pronouns and numbers even with a valid quotation', () => {
    expect(summaryProblem({ ...goal, summary: '陶策回来后，她完成检修。', quote: '陶策完成检修。' }, map)).toContain('代词')
    expect(summaryProblem({ ...goal, summary: '陶策修好3台水泵。', quote: '陶策修好了水泵。' }, map)).toContain('数字')
    expect(summaryProblem({ ...goal, summary: '其他事项没有变化。', quote: '其他事项没有变化。' }, map)).toBeUndefined()
  })
})
