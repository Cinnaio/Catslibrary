import { describe, expect, it } from 'vitest'
import { resolveStoredPipelineVersion } from './prompt-version'

describe('stored prompt pipeline version compatibility', () => {
  it('maps only missing values to legacy and accepts current/legacy versions', () => {
    expect(resolveStoredPipelineVersion(undefined, 3, 2)).toEqual({ version: 2 })
    expect(resolveStoredPipelineVersion('', 3, 2)).toEqual({ version: 2 })
    expect(resolveStoredPipelineVersion(2, 3, 2)).toEqual({ version: 2 })
    expect(resolveStoredPipelineVersion('3', 3, 2)).toEqual({ version: 3 })
  })

  it('rejects unknown or non-integer persisted versions instead of guessing', () => {
    expect(resolveStoredPipelineVersion(99, 3, 2).error).toContain('99')
    expect(resolveStoredPipelineVersion(2.5, 3, 2).error).toContain('2.5')
    expect(resolveStoredPipelineVersion('future', 3, 2).error).toContain('future')
  })
})
