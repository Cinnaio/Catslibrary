import { describe, expect, it } from 'vitest'
import { parseProfileSource, type ProfileSource } from './profile-source'

describe('profile source extraction version compatibility', () => {
  const base: ProfileSource = {
    version: 1,
    chapterId: 'chapter-1',
    chapterTitle: '第一章',
    sortOrder: 1,
    chapterOrdinal: 1,
    sampleCount: 3,
    samplePolicyVersion: 1,
    fingerprint: 'fingerprint-1',
  }

  it('round-trips extractionPromptVersion without changing source identity fields', () => {
    const parsed = parseProfileSource({ ...base, extractionPromptVersion: 2 })
    expect(parsed).toEqual({ ...base, extractionPromptVersion: 2 })
    expect(parsed?.fingerprint).toBe(base.fingerprint)
    expect(parsed?.samplePolicyVersion).toBe(base.samplePolicyVersion)
  })

  it('keeps old source rows readable and does not invent a missing version', () => {
    expect(parseProfileSource(JSON.stringify(base))).toEqual(base)
    expect(parseProfileSource({ ...base, extractionPromptVersion: '2' })).toEqual({ ...base, extractionPromptVersion: 2 })
    expect(parseProfileSource({ ...base, extractionPromptVersion: 2.5 })).toEqual(base)
  })
})
