import { describe, expect, it } from 'vitest'
import { OPERATOR_PROMPT_RULES, patchOperatorPrompt, shouldPatchOperatorPrompt } from './writing-prompt-patches'
import type { WritingContentPreferencesV1 } from './writing-preferences'

const base: WritingContentPreferencesV1 = {
  version: 1,
  adultContentMode: 'explicit',
  intimacyWeight: 'high',
  adultCharactersConfirmed: true,
  consentRuleTier: 'default',
}
const relaxed: WritingContentPreferencesV1 = { ...base, consentRuleTier: 'fictional_nonconsent' }

const OPERATOR_PROMPT = [
  '你是中文网络小说作者。',
  '8. 不得对强迫、下药、迷醉、睡眠等情境作直接描写。',
  '9. 亲密内容权重只表示叙事强调程度，不代表固定字数、段落数量或出现频率。',
  '10. 不得为了满足权重而强行加入亲密场景。',
  '11. 保持人物动机与叙事视角一致，章节标题不得超过 30 字。',
].join('\n')

describe('operator prompt patches', () => {
  it('only unlocks under the explicit fictional tier', () => {
    expect(shouldPatchOperatorPrompt(relaxed)).toBe(true)
    expect(shouldPatchOperatorPrompt(base)).toBe(false)
    expect(shouldPatchOperatorPrompt({ ...relaxed, adultContentMode: 'off' })).toBe(false)
    expect(shouldPatchOperatorPrompt(undefined)).toBe(false)
  })

  it('leaves the operator prompt byte-identical when the tier is strict', () => {
    const result = patchOperatorPrompt(OPERATOR_PROMPT, base)
    expect(result.applied).toBe(false)
    expect(result.removed).toEqual([])
    expect(result.text).toBe(OPERATOR_PROMPT)
  })

  it('removes the suppressive clauses instead of arguing with them', () => {
    const result = patchOperatorPrompt(OPERATOR_PROMPT, relaxed)
    expect(result.applied).toBe(true)
    expect(result.text).not.toContain('不得对强迫、下药、迷醉、睡眠等情境作直接描写')
    expect(result.text).not.toContain('权重只表示叙事强调程度')
    expect(result.text).not.toContain('不得为了满足权重而强行加入亲密场景')
  })

  it('keeps unrelated clauses intact', () => {
    const result = patchOperatorPrompt(OPERATOR_PROMPT, relaxed)
    expect(result.text).toContain('你是中文网络小说作者')
    expect(result.text).toContain('保持人物动机与叙事视角一致')
    expect(result.text).toContain('章节标题不得超过 30 字')
  })

  it('reports every removed clause so the change stays auditable', () => {
    const result = patchOperatorPrompt(OPERATOR_PROMPT, relaxed)
    expect(result.removed.length).toBeGreaterThanOrEqual(3)
    expect(result.removed.some((hit) => hit.id === 'consent-scene-suppression')).toBe(true)
    expect(result.removed.some((hit) => hit.id === 'length-quota-suppression')).toBe(true)
    for (const hit of result.removed) expect(hit.hit.length).toBeGreaterThan(0)
  })

  it('is idempotent: patching an already patched prompt removes nothing more', () => {
    const once = patchOperatorPrompt(OPERATOR_PROMPT, relaxed)
    const twice = patchOperatorPrompt(once.text, relaxed)
    expect(twice.text).toBe(once.text)
    expect(twice.removed).toEqual([])
  })

  it('tolerates an operator prompt with none of the known clauses', () => {
    const result = patchOperatorPrompt('你是中文网络小说作者，写正文。', relaxed)
    expect(result.text).toBe('你是中文网络小说作者，写正文。')
    expect(result.removed).toEqual([])
  })

  it('keeps every rule reachable through the exported rule table', () => {
    // 规则表是运营侧可读的契约：新增抑制写法要能在这里看到，而不是藏在函数体里。
    const ids = OPERATOR_PROMPT_RULES.map((rule) => rule.id)
    expect(ids).toEqual(['consent-scene-suppression', 'length-quota-suppression'])
    for (const rule of OPERATOR_PROMPT_RULES) {
      expect(rule.markers.length).toBeGreaterThan(0)
      for (const marker of rule.markers) expect(marker.global).toBe(true)
    }
  })
})
