import { describe, expect, it } from 'vitest'
import { normalizeAiSettings } from './settings'

describe('text generation controls', () => {
  it('defaults and normalizes independent graph settings without changing archive controls', () => {
    expect(normalizeAiSettings({})).toMatchObject({ storyGraphMaxTokens: 16000, storyGraphReasoningMode: 'disabled', storyMemoryReasoningMode: 'inherit' })
    expect(normalizeAiSettings({ storyGraphMaxTokens: 24000, storyGraphReasoningMode: 'high' })).toMatchObject({ storyGraphMaxTokens: 24000, storyGraphReasoningMode: 'high' })
    expect(normalizeAiSettings({ storyGraphMaxTokens: 1, storyGraphReasoningMode: 'bogus' })).toMatchObject({ storyGraphMaxTokens: 1000, storyGraphReasoningMode: 'disabled' })
    expect(normalizeAiSettings({ storyGraphMaxTokens: 'invalid' })).toHaveProperty('storyGraphMaxTokens', 16000)
    expect(normalizeAiSettings({ storyGraphMaxTokens: 2000000 })).toHaveProperty('storyGraphMaxTokens', 1000000)
  })
  it('defaults to streaming and respects explicit opt-outs', () => {
    expect(normalizeAiSettings({})).toMatchObject({ writingReasoningMode: 'inherit', storyMemoryReasoningMode: 'inherit', writingStreamEnabled: true, storyMemoryStreamEnabled: true })
  })
  it('keeps explicitly disabled streams disabled', () => {
    expect(normalizeAiSettings({ writingStreamEnabled: false, storyMemoryStreamEnabled: false })).toMatchObject({ writingStreamEnabled: false, storyMemoryStreamEnabled: false })
  })
  it('persists independent writing and archive choices and rejects unknown modes', () => {
    expect(normalizeAiSettings({ writingReasoningMode: 'disabled', storyMemoryReasoningMode: 'low', writingStreamEnabled: true, storyMemoryStreamEnabled: true })).toMatchObject({ writingReasoningMode: 'disabled', storyMemoryReasoningMode: 'low', writingStreamEnabled: true, storyMemoryStreamEnabled: true })
    expect(normalizeAiSettings({ writingReasoningMode: 'bogus', storyMemoryReasoningMode: 'bogus' })).toMatchObject({ writingReasoningMode: 'inherit', storyMemoryReasoningMode: 'inherit' })
  })
  it('defaults and normalizes content rating settings', () => {
    expect(normalizeAiSettings({})).toMatchObject({ contentRatingMaxTokens: 4096, contentRatingReasoningMode: 'inherit' })
    expect(normalizeAiSettings({ contentRatingMaxTokens: 8192, contentRatingReasoningMode: 'disabled' })).toMatchObject({ contentRatingMaxTokens: 8192, contentRatingReasoningMode: 'disabled' })
    expect(normalizeAiSettings({ contentRatingMaxTokens: 100, contentRatingReasoningMode: 'unknown' })).toMatchObject({ contentRatingMaxTokens: 500, contentRatingReasoningMode: 'inherit' })
    expect(normalizeAiSettings({ contentRatingMaxTokens: 2000000 })).toHaveProperty('contentRatingMaxTokens', 1000000)
  })
})

describe('story memory timeout settings', () => {
  it('keeps incremental extraction and paid background preparation opt-in', () => {
    expect(normalizeAiSettings({})).toMatchObject({ storyMemoryEngine: 'legacy', storyMemoryAutoUpdate: false, storyMemoryChapterMaxTokens: 16000 })
    expect(normalizeAiSettings({ storyMemoryEngine: 'incremental', storyMemoryAutoUpdate: true, storyMemoryChapterMaxTokens: 24000 })).toMatchObject({ storyMemoryEngine: 'incremental', storyMemoryAutoUpdate: true, storyMemoryChapterMaxTokens: 24000 })
  })
  it.each([
    [{}, 300],
    [{ storyMemoryTimeoutSeconds: 450 }, 450],
    [{ storyMemoryTimeoutSeconds: 1 }, 30],
    [{ storyMemoryTimeoutSeconds: 9999 }, 600],
    [{ storyMemoryTimeoutSeconds: 'invalid' }, 300],
  ])('normalizes persisted settings %j to %s seconds', (settings, seconds) => {
    expect(normalizeAiSettings(settings)).toHaveProperty('storyMemoryTimeoutSeconds', seconds)
  })
})
