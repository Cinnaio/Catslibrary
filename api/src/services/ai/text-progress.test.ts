import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Db } from '../../db/pool'
import { parseAiTextProgress } from '@shared/ai-text-progress'
import { createTextProgressReporter } from './text-progress'
import { updateAiTask } from './tasks'

vi.mock('./tasks', () => ({ updateAiTask: vi.fn() }))
const db = {} as Db
beforeEach(() => { vi.mocked(updateAiTask).mockReset().mockResolvedValue(true) })
describe('unfinished text progress', () => {
  it('bounds preview storage, throttles writes, and records time to first content', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000)
    try {
      const reporter = createTextProgressReporter(db, 'task')
      await reporter.start()
      await reporter.onProgress({ phase: 'thinking', reasoningCharacters: 99 })
      clock.mockReturnValue(1500)
      await reporter.onDelta('甲'.repeat(5000))
      expect(updateAiTask).toHaveBeenCalledTimes(2)
      clock.mockReturnValue(2100)
      await reporter.onDelta('乙')
      const patch = vi.mocked(updateAiTask).mock.calls.at(-1)![2]
      const preview = parseAiTextProgress(patch.result)
      expect(preview).toMatchObject({ phase: 'writing', generatedCharacters: 5001, reasoningCharacters: 99 })
      expect(preview?.preview).toHaveLength(4000)
      expect(preview?.preview.endsWith('乙')).toBe(true)
      expect(reporter.metrics()).toMatchObject({ firstContentMs: 500, firstReasoningMs: 0 })
      expect(patch).not.toHaveProperty('status')
    } finally { clock.mockRestore() }
  })
  it('stops updates when the task has been cancelled', async () => {
    vi.mocked(updateAiTask).mockResolvedValue(false)
    const reporter = createTextProgressReporter(db, 'cancelled')
    await expect(reporter.start()).rejects.toMatchObject({ code: 'cancelled' })
    await expect(reporter.onDelta('未完成正文')).rejects.toMatchObject({ code: 'cancelled' })
  })
  it.each(['null', '{}', '[]', '{"kind":"cover"}', JSON.stringify({ kind: 'text-progress', phase: 'writing', preview: 'x'.repeat(4001) })])('ignores unrelated or malformed task results: %s', raw => {
    expect(parseAiTextProgress(raw)).toBeNull()
  })
})
