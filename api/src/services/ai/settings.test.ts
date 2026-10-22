import { describe, expect, it } from 'vitest'
import { normalizeAiSettings } from './settings'

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
