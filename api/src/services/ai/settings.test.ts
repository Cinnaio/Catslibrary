import { describe, expect, it } from 'vitest'
import { normalizeAiSettings } from './settings'

describe('text generation controls', () => {
  it('preserves legacy provider behavior until explicitly enabled', () => {
    expect(normalizeAiSettings({})).toMatchObject({ writingReasoningMode: 'inherit', storyMemoryReasoningMode: 'inherit', writingStreamEnabled: false, storyMemoryStreamEnabled: false })
  })
  it('persists independent writing and archive choices and rejects unknown modes', () => {
    expect(normalizeAiSettings({ writingReasoningMode: 'disabled', storyMemoryReasoningMode: 'low', writingStreamEnabled: true, storyMemoryStreamEnabled: true })).toMatchObject({ writingReasoningMode: 'disabled', storyMemoryReasoningMode: 'low', writingStreamEnabled: true, storyMemoryStreamEnabled: true })
    expect(normalizeAiSettings({ writingReasoningMode: 'bogus', storyMemoryReasoningMode: 'bogus' })).toMatchObject({ writingReasoningMode: 'inherit', storyMemoryReasoningMode: 'inherit' })
  })
})

describe('story memory timeout settings', () => {
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
