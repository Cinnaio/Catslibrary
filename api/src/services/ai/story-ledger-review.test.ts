import { describe, expect, it, vi } from 'vitest'
import { parseSemanticReview as parseReview, REVIEW_ASPECTS, reviewChapterMemory, reviewTargets, semanticReviewMessages } from './story-ledger-review'
import type { ChapterMemory, MemoryFact } from './story-ledger'

const state: MemoryFact = {
  id: 'state', memoryType: 'state', kind: 'state', subjects: ['person'], label: '收拢工具进度', summary: '岑遥收拢工具尚未结束。',
  certainty: 'fact', status: 'active', scope: 'local', replaces: [], quote: '岑遥仍在收拢工具。', chapterId: 'c1', ordinal: 1,
}
const draft: ChapterMemory = { version: 1, entities: [], facts: [{ ...state, id: 'new', replaces: [state.id] }], goalReviews: [{ id: 'goal', decision: 'continue' }] }
const parseSemanticReview = (raw: unknown, targets: MemoryFact[], draft: ChapterMemory) => parseReview(raw, targets, draft, state.quote)
const accepted = () => ({
  checks: [{ id: 'new', verdict: 'supported', reason: '原文明确工作尚未结束。' }],
  goalChecks: [{ id: 'goal', verdict: 'supported', reason: '没有完成或取消证据。' }],
  coverage: REVIEW_ASPECTS.map((aspect) => ({ aspect, verdict: 'none', reason: '本段没有此项变化。', claims: [] as Array<{ statement: string; sourceQuote: string; matches: Array<{ id: string; summarySpan: string }> }> })),
})

describe('independent semantic review contract', () => {
  it('allows an omitted empty goal check list and rejects reviews invented for new goals', () => {
    const raw = accepted()
    const withoutGoals = { ...draft, goalReviews: [] }
    expect(parseSemanticReview({ ...raw, goalChecks: undefined }, draft.facts, withoutGoals).goalChecks).toEqual([])
    expect(parseSemanticReview({ ...raw, goalChecks: [] }, draft.facts, withoutGoals).goalChecks).toEqual([])
    expect(() => parseSemanticReview(raw, draft.facts, withoutGoals)).toThrow('空清单')
  })
  it('rejects covered claims copied from the source quote rather than the saved summary', () => {
    const raw = accepted()
    raw.coverage[3] = { aspect: 'progress', verdict: 'covered', reason: '已保存进度', claims: [{
      statement: '岑遥仍在收拢工具', sourceQuote: state.quote, matches: [{ id: 'new', summarySpan: '岑遥仍在收拢工具' }],
    }] }
    expect(() => parseSemanticReview(raw, draft.facts, draft)).toThrow('不能把引文内容当成摘要')
    raw.coverage[3]!.claims[0]!.matches[0]!.summarySpan = '岑遥收拢工具尚未结束'
    expect(parseSemanticReview(raw, draft.facts, draft).coverage[3]!.claims).toHaveLength(1)
  })
  it('requires grounded claims and saved links rather than an unexplained covered verdict', () => {
    const raw = accepted()
    raw.coverage[3]!.verdict = 'covered'
    expect(() => parseSemanticReview(raw, draft.facts, draft)).toThrow('不能为空')
    raw.coverage[3]!.claims = [{ statement: '仍在收拢工具', sourceQuote: '原文没有这句话', matches: [] }]
    expect(() => parseSemanticReview(raw, draft.facts, draft)).toThrow('本段原文')
    raw.coverage[3]!.claims[0]!.sourceQuote = state.quote
    expect(() => parseSemanticReview(raw, draft.facts, draft)).toThrow('缺少实际保存')
    raw.coverage[3]!.claims[0]!.matches = [{ id: 'hidden-history', summarySpan: state.summary }]
    expect(() => parseSemanticReview(raw, draft.facts, draft)).toThrow('历史或重复 ID')
  })
  it('does not count a historical event as a current progress state', () => {
    const raw = accepted()
    raw.coverage[3] = { aspect: 'progress', verdict: 'covered', reason: '已覆盖', claims: [{
      statement: '岑遥收拢工具尚未结束', sourceQuote: state.quote, matches: [{ id: 'new', summarySpan: state.summary }],
    }] }
    expect(() => parseSemanticReview(raw, [{ ...draft.facts[0]!, memoryType: 'event' }], draft)).toThrow('缺少仍有效')
  })
  it('accepts an explicitly linked ended constraint without pretending it remains active', () => {
    const text = '检修前须排水的规定已经作废。'
    const closed = { ...state, id: 'new', kind: 'boundary' as const, summary: text, quote: text, status: 'resolved' as const, replaces: ['rule'] }
    const raw = accepted()
    raw.coverage[6] = { aspect: 'constraints', verdict: 'covered', reason: '旧约束已作废', claims: [{ statement: text, sourceQuote: text, matches: [{ id: 'new', summarySpan: text }] }] }
    expect(parseReview(raw, [closed], draft, text).coverage[6]!.verdict).toBe('covered')
    expect(() => parseReview(raw, [{ ...closed, replaces: [] }], draft, text)).toThrow('缺少仍有效')
  })
  it('requires judgments for every fact, goal and coverage aspect', () => {
    expect(parseSemanticReview(accepted(), draft.facts, draft).checks).toHaveLength(1)
    for (const field of ['checks', 'goalChecks', 'coverage'] as const) {
      expect(() => parseSemanticReview({ ...accepted(), [field]: [] }, draft.facts, draft)).toThrow('逐项覆盖')
      const raw = accepted()
      delete (raw as Record<string, unknown>)[field]
      expect(() => parseSemanticReview(raw, draft.facts, draft)).toThrow('逐项覆盖')
    }
  })
  it('rejects invented IDs, duplicated dimensions and unsupported approval values', () => {
    const raw = accepted()
    raw.checks[0]!.id = 'foreign'
    expect(() => parseSemanticReview(raw, draft.facts, draft)).toThrow('未知或重复')
    const duplicate = accepted()
    duplicate.coverage[1]!.aspect = 'location'
    expect(() => parseSemanticReview(duplicate, draft.facts, draft)).toThrow('未知或重复')
    const invalid = accepted()
    invalid.checks[0]!.verdict = 'true'
    expect(() => parseSemanticReview(invalid, draft.facts, draft)).toThrow('有效判断')
  })
  it.each([
    ['unsupported', '封箱未打开，不能断言里面有信件。'],
    ['mixed', '进度摘要还写入执行者所在库房，应拆开位置。'],
    ['stale', '本段已经开始更换，旧摘要的尚未执行已过时。'],
  ])('rejects a %s summary even when its quote exists verbatim', (verdict, reason) => {
    const raw = accepted()
    raw.checks[0] = { id: 'new', verdict, reason }
    expect(() => parseSemanticReview(raw, draft.facts, draft)).toThrow(reason)
  })
  it('rejects missing important state even when all emitted facts are supported', () => {
    const raw = accepted()
    raw.coverage[0] = { aspect: 'location', verdict: 'missing', reason: '正文说岑遥到了库房，草稿没有段末位置。', claims: [{ statement: '位置未保存', sourceQuote: state.quote, matches: [] }] }
    expect(() => parseSemanticReview(raw, draft.facts, draft)).toThrow('location 漏记')
    raw.checks = []
    expect(() => parseSemanticReview(raw, [], { ...draft, facts: [] })).toThrow('location 漏记')
  })
  it('rejects a missed goal ending expressed with different wording', () => {
    const raw = accepted()
    raw.goalChecks[0] = { id: 'goal', verdict: 'unsupported', reason: '水泵已经换妥，不能继续更换水泵目标。' }
    expect(() => parseSemanticReview(raw, draft.facts, draft)).toThrow('不能继续')
  })
  it('audits retained current state and new events while excluding displaced and historical state', () => {
    const kept = { ...state, id: 'kept' }
    const ended = { ...state, id: 'ended', status: 'resolved' as const }
    const old = { ...state, id: 'old', stillActive: false }
    const targets = reviewTargets(draft, { entities: [], facts: [state, kept, ended, old] })
    expect(targets.retained).toEqual([kept])
    expect(targets.targets.map((fact) => fact.id)).toEqual(['new', 'kept'])
    expect(state.status).toBe('active')
  })
  it('passes text and draft to one independent request and fails closed on malformed output', async () => {
    const request = vi.fn().mockResolvedValue({ text: JSON.stringify(accepted()) })
    const context = { text: state.quote, previous: { entities: [], facts: [state] }, draft }
    await expect(reviewChapterMemory(context, request)).resolves.toMatchObject({ checks: accepted().checks })
    expect(request).toHaveBeenCalledOnce()
    expect(JSON.parse(request.mock.calls[0]![0][1].content)).toMatchObject({ text: state.quote, goalReviewTargets: [{ id: 'goal', decision: 'continue' }] })
    expect(JSON.parse(request.mock.calls[0]![0][1].content).targets.every((target: Record<string, unknown>) => !('quote' in target))).toBe(true)
    request.mockResolvedValue({ text: '{broken' })
    await expect(reviewChapterMemory(context, request)).rejects.toThrow('不是有效 JSON')
  })
  it('preserves historical visibility and replacement links in review context', () => {
    const historical = { ...state, stillActive: false }
    const input = JSON.parse(semanticReviewMessages({ text: state.quote, previous: { entities: [], facts: [historical] }, draft })[1]!.content)
    expect(input.previous[0]).toMatchObject({ id: state.id, stillActive: false })
    expect(input.targets.map((fact: MemoryFact) => fact.id)).toEqual(['new'])
    expect(input.targets[0].replaces).toEqual([state.id])
  })
})
