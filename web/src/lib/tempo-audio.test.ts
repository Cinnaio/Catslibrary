import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TempoMetronome } from './tempo-audio'

function context() {
  return {
    state: 'running', currentTime: 0, destination: {},
    resume: vi.fn<() => Promise<void>>().mockResolvedValue(), close: vi.fn().mockResolvedValue(undefined),
    createOscillator: vi.fn(() => ({ frequency: { value: 0 }, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null as unknown })),
    createGain: vi.fn(() => ({ gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() })),
  }
}
let audio: ReturnType<typeof context>

beforeEach(() => {
  vi.useFakeTimers()
  audio = context()
  vi.stubGlobal('AudioContext', class { constructor() { return audio } })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

it('does not restart audio when a pending resume resolves after a pause', async () => {
  let resume!: () => void
  audio.resume.mockReturnValueOnce(new Promise<void>(resolve => { resume = resolve }))
  const metronome = new TempoMetronome()
  const started = metronome.start(60)
  metronome.stop()
  resume()
  await started
  expect(audio.createOscillator).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
  metronome.dispose()
})

it('skips missed beats after a clock jump rather than playing a burst', async () => {
  const metronome = new TempoMetronome()
  expect(await metronome.start(60)).toBe(true)
  audio.currentTime = 60
  vi.advanceTimersByTime(25)
  expect(audio.createOscillator).toHaveBeenCalledTimes(2)
  metronome.dispose()
  expect(vi.getTimerCount()).toBe(0)
  expect(audio.close).toHaveBeenCalledOnce()
})

it('disconnects already-scheduled audio when stopping', async () => {
  const metronome = new TempoMetronome()
  await metronome.start(90)
  const oscillator = audio.createOscillator.mock.results[0]!.value
  metronome.stop()
  expect(oscillator.disconnect).toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
  metronome.dispose()
})

it('reports denied audio activation without leaving a timer running', async () => {
  audio.resume.mockRejectedValueOnce(new Error('Not allowed'))
  const metronome = new TempoMetronome()
  expect(await metronome.start(60)).toBe(false)
  expect(vi.getTimerCount()).toBe(0)
  metronome.dispose()
})
