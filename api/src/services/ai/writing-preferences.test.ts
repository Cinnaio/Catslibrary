import { describe, expect, it } from 'vitest'
import { DEFAULT_WRITING_CONTENT_PREFERENCES, formatWritingContentPreferences, validateWritingContentPreferences } from './writing-preferences'

describe('writing content preferences', () => {
  it('uses a safe closed default for omitted values', () => {
    expect(validateWritingContentPreferences(undefined).preferences).toEqual(DEFAULT_WRITING_CONTENT_PREFERENCES)
  })

  it('normalizes closed mode and clears stale adult settings', () => {
    expect(validateWritingContentPreferences({
      version: 1,
      adultContentMode: 'off',
      intimacyWeight: 'high',
      adultCharactersConfirmed: true,
    }).preferences).toEqual(DEFAULT_WRITING_CONTENT_PREFERENCES)
  })

  it('requires adult confirmation and a non-empty weight for explicit mode', () => {
    expect(validateWritingContentPreferences({ version: 1, adultContentMode: 'explicit', intimacyWeight: 'high', adultCharactersConfirmed: false }).error).toContain('成年人')
    expect(validateWritingContentPreferences({ version: 1, adultContentMode: 'explicit', intimacyWeight: 'none', adultCharactersConfirmed: true }).error).toContain('权重')
    expect(validateWritingContentPreferences({ version: 1, adultContentMode: 'explicit', intimacyWeight: 'medium', adultCharactersConfirmed: true }).preferences).toEqual({
      version: 1,
      adultContentMode: 'explicit',
      intimacyWeight: 'medium',
      adultCharactersConfirmed: true,
      consentRuleTier: 'default',
    })
  })

  it('rejects unknown versions and enum values', () => {
    expect(validateWritingContentPreferences({ version: 2 }).error).toContain('version')
    expect(validateWritingContentPreferences({ version: 1, adultContentMode: 'custom', intimacyWeight: 'low', adultCharactersConfirmed: true }).error).toContain('adultContentMode')
    expect(validateWritingContentPreferences({ version: 1, adultContentMode: 'explicit', intimacyWeight: 'custom', adultCharactersConfirmed: true }).error).toContain('intimacyWeight')
  })

  it('formats the closed and explicit settings as a task-scoped material block', () => {
    expect(formatWritingContentPreferences()).toContain('不得主动加入成人露骨内容')
    const formatted = formatWritingContentPreferences({ version: 1, adultContentMode: 'explicit', intimacyWeight: 'high', adultCharactersConfirmed: true })
    expect(formatted).toContain('允许处理露骨 R18')
    expect(formatted).toContain('成人场景至少 2 个')
  })

  // 线上实测：早期措辞把亲密内容定义为「叙事强调程度、不是配额」，并把成人内容
  // 描述为「服务于剧情推进」，模型据此把 R18 降级成剧情之外的点缀，
  // 十章续写密度仅 2.2 次/千字，而原作基线是 23.0。
  // 改为可执行的结构化要求后实测 18.7 次/千字。
  it('states executable density requirements instead of a vague emphasis hint', () => {
    const formatted = formatWritingContentPreferences({ version: 1, adultContentMode: 'explicit', intimacyWeight: 'high', adultCharactersConfirmed: true })
    expect(formatted).toContain('占据主体篇幅')
    expect(formatted).toContain('不得用留白、省略号、时间跳跃或概述替代')
    expect(formatted).toContain('过渡累计不超过全章 30%')
    expect(formatted).not.toContain('服务于人物关系与剧情推进')
  })

  it('keeps the anti-padding constraint so density is not reached by filler scenes', () => {
    const formatted = formatWritingContentPreferences({ version: 1, adultContentMode: 'explicit', intimacyWeight: 'high', adultCharactersConfirmed: true })
    expect(formatted).toContain('不为了凑篇幅硬塞与本章情节无关的场景')
  })

  it('does not hand the explicit decision back to the upstream policy', () => {
    const formatted = formatWritingContentPreferences({ version: 1, adultContentMode: 'explicit', intimacyWeight: 'medium', adultCharactersConfirmed: true })
    expect(formatted).not.toContain('上游供应商内容政策')
    expect(formatted).not.toContain('绕过')
    expect(formatted).not.toContain('仍须遵守')
  })

  it('defaults consentRuleTier to the strict tier so old clients keep the strict rules', () => {
    const result = validateWritingContentPreferences({ version: 1, adultContentMode: 'explicit', intimacyWeight: 'high', adultCharactersConfirmed: true })
    expect(result.error).toBeUndefined()
    expect(result.preferences?.consentRuleTier).toBe('default')
  })

  it('rejects an unknown consentRuleTier instead of silently falling back', () => {
    const result = validateWritingContentPreferences({ version: 1, adultContentMode: 'explicit', intimacyWeight: 'high', adultCharactersConfirmed: true, consentRuleTier: 'relaxed' })
    expect(result.error).toContain('consentRuleTier')
  })

  it('keeps the strict tier free of the fictional-scenario relaxation block', () => {
    const strict = formatWritingContentPreferences({ version: 1, adultContentMode: 'explicit', intimacyWeight: 'high', adultCharactersConfirmed: true, consentRuleTier: 'default' })
    expect(strict).not.toContain('本档位附加规则')
    expect(strict).toContain('角色均为成年人')
  })

  it('adds the relaxation block only for the explicit fictional tier', () => {
    const relaxed = formatWritingContentPreferences({ version: 1, adultContentMode: 'explicit', intimacyWeight: 'high', adultCharactersConfirmed: true, consentRuleTier: 'fictional_nonconsent' })
    expect(relaxed).toContain('本档位附加规则')
    expect(relaxed).toContain('可以对这类场景作直接、具体的描写')
    // 篇幅约束与同意规则并列，两处都要解除，否则量化要求会被系统层抵消。
    expect(relaxed).toContain('篇幅约束以本任务参数的量化要求为准')
    // 放宽档只解除写法与篇幅限制，成年前提不变。
    expect(relaxed).toContain('角色均为成年人')
  })
})
