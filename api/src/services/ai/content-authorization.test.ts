import { describe, expect, it } from 'vitest'
import { CONTENT_RULES_CORE, writingAuthorizationCore } from './content-authorization'
import type { WritingContentPreferencesV1 } from './writing-preferences'

const explicit: WritingContentPreferencesV1 = {
  version: 1,
  adultContentMode: 'explicit',
  intimacyWeight: 'high',
  adultCharactersConfirmed: true,
  consentRuleTier: 'default',
}

const closed: WritingContentPreferencesV1 = {
  version: 1,
  adultContentMode: 'off',
  intimacyWeight: 'none',
  adultCharactersConfirmed: false,
  consentRuleTier: 'default',
}

describe('writing authorization core', () => {
  it('always hands over a direct-writing mandate', () => {
    for (const preferences of [explicit, closed, undefined]) {
      const core = writingAuthorizationCore(preferences)
      expect(core).toContain('按作者本次给出的创作要求直接写作')
      expect(core).toContain('不以题材为由拒写')
    }
  })

  it('keeps the closed and explicit cores mutually exclusive', () => {
    const closedCore = writingAuthorizationCore(closed)
    expect(closedCore).toContain('本次任务未开启露骨模式')
    expect(closedCore).not.toContain('成人场景是本章的主体情节')
    expect(closedCore).not.toContain('露骨模式，且已确认全部参与角色为成年人')

    const explicitCore = writingAuthorizationCore(explicit)
    expect(explicitCore).toContain('成人场景是本章的主体情节')
    expect(explicitCore).not.toContain('本次任务未开启露骨模式')
  })

  it('omitting preferences is treated as closed, never as explicit', () => {
    expect(writingAuthorizationCore()).toBe(writingAuthorizationCore(closed))
  })

  it('writes content rules as short imperatives without self-justification', () => {
    expect(CONTENT_RULES_CORE).toContain('全部参与角色必须是成年人')
    // 授权内核不应出现「因为…所以…」「既然…」这类论证：论证的存在本身
    // 就会让模型把这件事读成需要裁量的争议点。
    expect(CONTENT_RULES_CORE).not.toMatch(/因为|所以|既然/)
    expect(writingAuthorizationCore(explicit)).not.toMatch(/因为|所以|既然/)
  })
})
