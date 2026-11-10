import { describe, expect, it, vi } from 'vitest'
import { parseSemanticReview, REVIEW_ASPECTS, reviewChapterMemory, reviewTargets } from './story-ledger-review'
import type { ChapterMemory, MemoryFact } from './story-ledger'

const state: MemoryFact = {
  id: 'state', memoryType: 'state', kind: 'state', subjects: ['person'], label: '收拢工具进度', summary: '岑遥收拢工具尚未结束。',
  certainty: 'fact', status: 'active', scope: 'local', replaces: [], quote: '岑遥仍在收拢工具。', chapterId: 'c1', ordinal: 1,
}
const draft: ChapterMemory = { version: 1, entities: [], facts: [{ ...state, id: 'new', replaces: [state.id] }], goalReviews: [{ id: 'goal', decision: 'continue' }] }
const accepted = () => ({
  checks: [{ id: 'new', verdict: 'supported', reason: '原文明确工作尚未结束。' }],
  goalChecks: [{ id: 'goal', verdict: 'supported', reason: '没有完成或取消证据。' }],
  coverage: REVIEW_ASPECTS.map((aspect) => ({ aspect, verdict: 'none', reason: '本段没有此项变化。' })),
})

describe('independent semantic review contract', () => {
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
    raw.coverage[0] = { aspect: 'location', verdict: 'missing', reason: '正文说岑遥到了库房，草稿没有段末位置。' }
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
    expect(JSON.parse(request.mock.calls[0]![0][1].content)).toMatchObject({ text: state.quote, draft, retained: [] })
    request.mockResolvedValue({ text: '{broken' })
    await expect(reviewChapterMemory(context, request)).rejects.toThrow('不是有效 JSON')
  })
})
