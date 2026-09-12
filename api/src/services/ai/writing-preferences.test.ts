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
    expect(formatted).toContain('叙事强调程度')
  })

  it('does not hand the explicit decision back to the upstream policy', () => {
    const formatted = formatWritingContentPreferences({ version: 1, adultContentMode: 'explicit', intimacyWeight: 'medium', adultCharactersConfirmed: true })
    expect(formatted).not.toContain('上游供应商内容政策')
    expect(formatted).not.toContain('绕过')
    expect(formatted).not.toContain('仍须遵守')
  })
})
