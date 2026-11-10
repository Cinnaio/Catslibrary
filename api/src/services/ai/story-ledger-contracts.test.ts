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
const parse = (text: string, facts: unknown[] = [], goalReviews?: unknown[], previous = { entities, facts: [goal] }, goals: unknown[] = []) => parseChapterMemory(
  { entities: [], facts, goals, ...(goalReviews ? { goalReviews } : {}) },
  { novelId: 'book', chapterId: 'c2', ordinal: 2, part: 0, text, previous, supplied: relevantLedger(previous, text) },
)

describe('goal lifecycle contract', () => {
  it('builds stable intentions from the goals input while keeping execution in a separate state', () => {
    const text = '陶策决定检修电闸，尚未动工。'
    const saved = parse(text, [{ ...goal, kind: 'state', label: '检修电闸进度', summary: '陶策检修电闸尚未动工。', quote: text }], [], { entities, facts: [] }, [
      { subjects: ['陶策'], objective: '检修电闸', quote: text },
    ])
    expect(saved.facts.find((fact) => fact.kind === 'goal')).toMatchObject({ summary: '陶策计划检修电闸。', label: '检修电闸', status: 'active', subjects: ['tao'] })
    expect(saved.facts.find((fact) => fact.kind === 'state')?.summary).toContain('尚未动工')
    expect(() => parse(text, [{ ...goal, quote: text }], [], { entities, facts: [] })).toThrow('新目标只填 goals')
    expect(() => parse(text, [], [], { entities, facts: [] }, [{ subjects: ['tao'], objective: '检修电闸，尚未动工', quote: text }])).toThrow('不夹带执行进度')
    for (const objective of ['检修电闸，陶策在山站', '检修电闸。整理工具', '检修电闸\n整理工具'])
      expect(() => parse(text, [], [], { entities, facts: [] }, [{ subjects: ['tao'], objective, quote: text }])).toThrow('不夹带执行进度')
    expect(() => parse(text, [], [], { entities, facts: [] }, [{ subjects: ['station'], objective: '检修电闸', quote: text }])).toThrow('人物执行者')
  })
  it('keeps alias identity separate from two-entity relations and never merges similar names', () => {
    const text = '陶策也叫阿策。陶侧与陶策一同来到山站。'
    const previous = { entities: [...entities, { id: 'other', name: '陶侧', kind: 'person' as const, aliases: [] }], facts: [] }
    const input = { entities: [{ name: '陶策', kind: 'person', aliases: ['阿策'] }], facts: [{ ...goal, kind: 'relationship', directed: false, subjects: ['陶策', '阿策'], label: '同一人', summary: '陶策也叫阿策。', quote: '陶策也叫阿策。' }] }
    const opts = { novelId: 'book', chapterId: 'c2', ordinal: 2, part: 0, text, previous, supplied: previous }
    expect(() => parseChapterMemory(input, opts)).toThrow('两个不同实体')
    expect(parseChapterMemory({ ...input, facts: [] }, opts).entities[0]?.aliases).toEqual(['阿策'])
    const two = parseChapterMemory({ entities: [], facts: [{ ...input.facts[0], subjects: ['陶侧', '陶策'], label: '同行', summary: '陶侧与陶策同行。', quote: '陶侧与陶策一同来到山站。' }] }, opts)
    expect(two.facts[0]?.subjects).toEqual(['other', 'tao'])
    expect(previous.entities.find((entity) => entity.id === 'tao')?.aliases).toEqual([])
  })
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
    const next = { subjects: ['tao'], objective: '更换水泵', quote: text }
    const saved = parse(text, [], [{ id: goal.id, decision: 'superseded', quote: text, successor: '更换水泵' }], { entities, facts: [goal] }, [next])
    const state = applyChapterMemory({ entities, facts: [goal] }, saved)
    expect(workingFacts(state).map((fact) => fact.label)).toEqual(['更换水泵'])
    expect(saved.facts[1]).toMatchObject({ goalOutcome: 'superseded', successor: saved.facts[0]!.id })
    expect(parse(text, [], [{ id: goal.id, decision: 'superseded', quote: text, successor: '更换水泵计划' }], { entities, facts: [goal] }, [{ ...next, objective: '更换水泵计划' }]).facts[1]?.successor).toBe(saved.facts[0]!.id)
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
    expect(() => parse('陶策计划检修电闸。', [{ ...goal, subjects: kind === 'relationship' ? ['yan', 'tao'] : ['tao'], directed: false, kind, label: '检修计划' }], [], { entities, facts: [] })).toThrow('必须填写 goals')
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
    expect(parse(text, [], [{ id: goal.id, decision: 'continue' }], { entities, facts: [goal] }, [{ subjects: ['tao'], objective: '检修电闸计划', quote: text }]).facts).toEqual([])
    expect(() => parse(text, [], [{ id: goal.id, decision: 'continue' }], { entities, facts: [goal] }, [{ subjects: ['tao'], objective: '检修电闸', summary: '优先执行', quote: text }])).toThrow('只接受')
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
  it('keeps intentions stable while progress and position change independently', () => {
    const text = '陶策开始检修电闸，仍在山站。'
    const saved = parse(text, [
      { ...goal, kind: 'state', label: '检修电闸进度', summary: '陶策已开始检修电闸。', quote: text },
      { ...goal, kind: 'place', label: '当前位置', summary: '陶策在山站。', quote: text },
    ], [{ id: goal.id, decision: 'continue' }])
    const current = workingFacts(applyChapterMemory({ entities, facts: [goal] }, saved))
    expect(current.find((fact) => fact.kind === 'goal')).toEqual(goal)
    expect(current.map((fact) => fact.summary)).toEqual([goal.summary, '陶策已开始检修电闸。', '陶策在山站。'])
    for (const summary of ['陶策计划检修电闸，今天尚未执行。', '陶策计划检修电闸，目前正在检修。'])
      expect(summaryProblem({ ...goal, summary, quote: text }, map)).toContain('稳定意图')
    expect(summaryProblem({ ...goal, summary: '陶策计划前往山站检修电闸。' }, map)).toBeUndefined()
    expect(summaryProblem({ ...goal, summary: '陶策计划今天找到尚未归还的钥匙。' }, map)).toBeUndefined()
  })
  it('rejects actor location in progress without confusing a work site with actor position', () => {
    const progress = { ...goal, kind: 'state' as const, label: '收拢工具进度' }
    expect(summaryProblem({ ...progress, summary: '陶策仍在山站收拢工具，尚未结束。' }, map)).toContain('混入人物位置')
    expect(summaryProblem({ ...progress, summary: '陶策收拢工具尚未结束。' }, map)).toBeUndefined()
    expect(summaryProblem({ ...progress, summary: '山站的工具已经收拢完毕。' }, map)).toBeUndefined()
    expect(summaryProblem({ ...progress, summary: '陶策的工具准备已经完成。' }, map)).toBeUndefined()
  })
  it('retains completed current values instead of treating completed actions as expired state', () => {
    const text = '陶策已将山站水池排空。'
    const next = { ...goal, kind: 'state', label: '水池状态', summary: '山站水池已排空。', quote: text }
    expect(() => parse(text, [{ ...next, status: 'resolved' }], [], { entities, facts: [] })).toThrow('当前值仍用 active')
    const saved = parse(text, [next], [], { entities, facts: [] })
    expect(workingFacts(applyChapterMemory({ entities, facts: [] }, saved))).toHaveLength(1)
    expect(parse(text, [{ ...next, memoryType: 'event', status: 'resolved' }], [], { entities, facts: [] }).facts).toHaveLength(1)
  })
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
