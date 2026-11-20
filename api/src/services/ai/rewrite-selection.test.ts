import { describe, expect, it } from 'vitest'
import { compareAgentText, mergeAgentText } from '@shared/ai-text-diff'
import { resolveRewriteSelection, rewriteSelectionRevision } from './rewrite-selection'

const before = '开头。\r\n旧段🐱。\r\n共同段。\r\n删去的段。\r\n结尾。'
const after = '开头。\r\n新段🐈。\r\n共同段。\r\n结尾。\r\n新增的段。'
const choose = (acceptedChanges: number[]) => ({ version: 1, revision: rewriteSelectionRevision(before, after), acceptedChanges })

describe('versioned rewrite choices', () => {
  it('retains every source character when accepting all or none, including repeated paragraphs', () => {
    for (const [left, right] of [[before, after], ['重复\n重复\n尾', '重复\n新增\n重复\n尾'], ['', '新增\n'], ['删去\n', '']]) {
      const differences = compareAgentText(left!, right!)
      const all = differences.filter(part => part.kind !== 'equal').map((_, index) => index)
      expect(mergeAgentText(differences, all)).toBe(right)
      expect(mergeAgentText(differences, [])).toBe(left)
    }
  })

  it('merges only a selected edit and keeps rejected deletion and addition unchanged', () => {
    const result = resolveRewriteSelection(before, after, choose([0]))
    expect(result.text).toBe(before.replace('旧段🐱', '新段🐈'))
    expect(result.selection.acceptedChanges).toEqual([0])
    expect(resolveRewriteSelection(before, after).text).toBe(after)
  })

  it('chooses adjacent rewritten paragraphs independently when their counts match', () => {
    const original = '旧一。\n旧二。\n旧三。'
    const proposed = '新一。\n新二。\n新三。'
    const revision = rewriteSelectionRevision(original, proposed)
    expect(resolveRewriteSelection(original, proposed, { version: 1, revision, acceptedChanges: [1] }).text).toBe('旧一。\n新二。\n旧三。')
    expect(resolveRewriteSelection(original, proposed).total).toBe(3)
  })

  it('allows an isolated removal or insertion without touching the other change', () => {
    const original = '开头\r\n移除\r\n中间\r\n结尾'
    const proposed = '开头\r\n中间\r\n新增\r\n结尾'
    const revision = rewriteSelectionRevision(original, proposed)
    expect(resolveRewriteSelection(original, proposed, { version: 1, revision, acceptedChanges: [0] }).text).toBe('开头\r\n中间\r\n结尾')
    expect(resolveRewriteSelection(original, proposed, { version: 1, revision, acceptedChanges: [1] }).text).toBe('开头\r\n移除\r\n中间\r\n新增\r\n结尾')
  })

  it.each([null, {}, { ...choose([0]), version: 2 }, choose([]), choose([-1]), choose([0.5]), choose([0, 0]), choose([10000]), { ...choose([0]), acceptedChanges: ['0'] }])('rejects malformed choices without adopting the whole proposal (%j)', input => {
    expect(() => resolveRewriteSelection(before, after, input)).toThrow()
  })

  it('rejects choices for another snapshot and normalizes order for retry identity', () => {
    expect(() => resolveRewriteSelection(before, after, { ...choose([0]), revision: 'stale' })).toThrow('改写建议已变化')
    expect(resolveRewriteSelection(before, after, choose([1, 0])).selection.acceptedChanges).toEqual([0, 1])
    expect(rewriteSelectionRevision(before + ' ', after)).not.toBe(choose([0]).revision)
  })
})
