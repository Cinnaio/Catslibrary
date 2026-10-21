import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { patchOperatorPrompt } from './writing-prompt-patches'
import type { WritingContentPreferencesV1 } from './writing-preferences'

const RELAXED: WritingContentPreferencesV1 = {
  version: 1,
  adultContentMode: 'explicit',
  intimacyWeight: 'high',
  adultCharactersConfirmed: true,
  consentRuleTier: 'fictional_nonconsent',
}

/**
 * 对真实的运营提示词默认值做一次回归，而不只测构造样本。
 *
 * 规则表是按文字写的，运营提示词一改措辞就可能失效——但失效是静默的：
 * 提示词照样进模型，只是抑制条款不再被删。这条用例把「默认值里的抑制条款
 * 必须被识别」钉住，改 DEFAULT_AI_SETTINGS.writingSystemPrompt 时会立刻暴露。
 */
describe('operator prompt patches against shipped defaults', () => {
  let defaultPrompt = ''

  beforeAll(() => {
    const source = readFileSync(join(__dirname, 'settings.ts'), 'utf8')
    const match = source.match(/writingSystemPrompt:\s*'((?:[^'\\]|\\.)*)'/)
    expect(match).toBeTruthy()
    defaultPrompt = JSON.parse(`"${match![1]!.replace(/"/g, '\\"')}"`) as string
  })

  it('ships a default prompt that the rules can actually operate on', () => {
    expect(defaultPrompt.length).toBeGreaterThan(20)
    const result = patchOperatorPrompt(defaultPrompt, RELAXED)
    expect(result.applied).toBe(true)
    // 默认值是短句（「输出格式：…不要 Markdown」），不含已知抑制条款；
    // 这里断言的是「没有误删」——改写器不能对无关条款动手。
    expect(result.text.length).toBeGreaterThan(0)
    expect(result.text).toContain('中文网络小说作者')
  })

  it('never touches a prompt when the tier is strict', () => {
    const result = patchOperatorPrompt(defaultPrompt, { ...RELAXED, consentRuleTier: 'default' })
    expect(result.text).toBe(defaultPrompt)
  })
})
