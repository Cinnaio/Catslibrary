import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_TEMPO_SETTINGS, mergeTempoHistory, readTempoData, tempoReducer, tempoStorageKey, writeTempoData, type TempoRecord, type TempoSession } from './tempo'

function start(): TempoSession {
  return tempoReducer(null, { type: 'start', id: 'one', settings: { ...DEFAULT_TEMPO_SETTINGS, minutes: 1 }, now: 0 })!
}

const record: TempoRecord = { id: 'one', finishedAt: 1, minutes: 1, bpm: 60, elapsedMs: 1000, completed: false }

beforeEach(() => { localStorage.clear(); vi.restoreAllMocks() })

describe('tempo elapsed time', () => {
  it('excludes paused time and resumes from the previous elapsed time', () => {
    const paused = tempoReducer(start(), { type: 'pause', now: 1500, reason: 'manual' })!
    expect(paused.elapsedMs).toBe(1500)
    expect(tempoReducer(paused, { type: 'tick', now: 90000 })).toBe(paused)
    const resumed = tempoReducer(paused, { type: 'resume', now: 90000 })!
    expect(tempoReducer(resumed, { type: 'tick', now: 90500 })?.elapsedMs).toBe(2000)
  })

  it('does not count sleep or a long main-thread stall as practice', () => {
    const next = tempoReducer(start(), { type: 'tick', now: 60000 })!
    expect(next).toMatchObject({ status: 'paused', elapsedMs: 0, pauseReason: 'interrupted' })
  })

  it('finishes exactly once and does not resume or end a completed session', () => {
    let session = start()
    for (let now = 1000; now <= 60000; now += 1000) session = tempoReducer(session, { type: 'tick', now })!
    expect(session).toMatchObject({ status: 'completed', elapsedMs: 60000 })
    expect(tempoReducer(session, { type: 'end', now: 61000 })).toBe(session)
    expect(tempoReducer(session, { type: 'resume', now: 61000 })).toBe(session)
  })

  it('preserves a running session on duplicate starts and resets', () => {
    const session = start()
    expect(tempoReducer(session, { type: 'start', id: 'two', settings: DEFAULT_TEMPO_SETTINGS, now: 10 })).toBe(session)
    expect(tempoReducer(session, { type: 'reset' })).toBe(session)
    const ended = tempoReducer(session, { type: 'end', now: 1500 })!
    expect(ended).toMatchObject({ status: 'ended', elapsedMs: 1500 })
    expect(tempoReducer(ended, { type: 'reset' })).toBeNull()
  })
})

describe('tempo local records', () => {
  it('keeps guest and different accounts separate', () => {
    writeTempoData('user:a', { settings: DEFAULT_TEMPO_SETTINGS, history: [record] })
    expect(readTempoData('user:a').data.history).toHaveLength(1)
    expect(readTempoData('user:b').data.history).toEqual([])
    expect(readTempoData('guest').data.history).toEqual([])
  })

  it('bounds settings and discards invalid records from stored data', () => {
    localStorage.setItem(tempoStorageKey('guest'), JSON.stringify({ settings: { minutes: -9, bpm: 500, sound: 'true' }, history: [record, { ...record, id: 'invalid', elapsedMs: -1 }, null] }))
    expect(readTempoData('guest').data).toEqual({ settings: { minutes: 1, bpm: 180, sound: false, speech: false }, history: [record] })
  })

  it('preserves corrupt storage and reports read and write failures', () => {
    localStorage.setItem(tempoStorageKey('guest'), '{broken')
    expect(readTempoData('guest').error).toBeTruthy()
    expect(localStorage.getItem(tempoStorageKey('guest'))).toBe('{broken')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota exceeded') })
    expect(writeTempoData('guest', { settings: DEFAULT_TEMPO_SETTINGS, history: [] })).toBe(false)
  })

  it('deduplicates sessions and keeps only the latest thirty records', () => {
    const records = Array.from({ length: 40 }, (_, index) => ({ ...record, id: String(index), finishedAt: index + 1 }))
    const history = mergeTempoHistory(records, [records[39]!])
    expect(history).toHaveLength(30)
    expect(history[0]?.id).toBe('39')
    expect(history[29]?.id).toBe('10')
  })
})
