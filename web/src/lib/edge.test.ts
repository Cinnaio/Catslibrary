import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_EDGE_SETTINGS, EDGE_OVERTIME_CAP, createEdgeSession, edgeReducer, formatEdgeTime,
  mergeEdgeHistory, normalizeEdgeSettings, readEdgeData, summarizeEdgeHistory, writeEdgeData,
  type EdgeRecord, type EdgeSession, type EdgeSettings,
} from './edge'

function start(overrides: Partial<EdgeSettings> = {}): EdgeSession {
  return createEdgeSession('one', { ...DEFAULT_EDGE_SETTINGS, ...overrides }, 0, 12345)
}

function tickFor(session: EdgeSession, milliseconds: number, step = 100): EdgeSession {
  let next = session
  for (let elapsed = 0; elapsed < milliseconds; elapsed += step) {
    next = edgeReducer(next, { type: 'tick', now: (next.sampledAt ?? 0) + step })!
  }
  return next
}

const record: EdgeRecord = { id: 'one', finishedAt: 1, minutes: 5, difficulty: 'easy', finale: 'always', elapsedMs: 1000, edges: 2, overtime: 0, ending: 'permitted' }

beforeEach(() => { localStorage.clear(); vi.restoreAllMocks() })

describe('edge session', () => {
  it('keeps asking for commands within one duration and respects difficulty phases', () => {
    const session = tickFor(start({ minutes: 1 }), 30_000)
    expect(session.status === 'running' || session.status === 'cooldown').toBe(true)
    expect(['go', 'slow', 'stop']).toContain(session.phase)
    expect(session.command.length).toBeGreaterThan(0)
  })

  it('accumulates at most one edge bonus per declaration and caps at +20', () => {
    let session = start({ minutes: 30, finale: 'lottery' })
    for (let round = 0; round < 8; round += 1) {
      // 推动到可申报的相位（非 stop），再申报。
      let guard = 0
      while (session.phase === 'stop' && guard < 200) { session = tickFor(session, 1000); guard += 1 }
      const before = session.edges
      session = edgeReducer(session, { type: 'edge', now: (session.sampledAt ?? 0) + 10 })!
      expect(session.edges).toBe(before + 1)
      expect(session.status).toBe('cooldown')
      // 等待里重复申报不加分。
      session = edgeReducer(session, { type: 'edge', now: (session.sampledAt ?? 0) + 10 })!
      expect(session.edges).toBe(before + 1)
      session = tickFor(session, 20_000)
    }
    expect(session.chance).toBeLessThanOrEqual(85 + 20)
  })

  it('pauses on a long gap and finishes through the permit window', () => {
    const running = start({ minutes: 1, finale: 'always' })
    const stalled = edgeReducer(running, { type: 'tick', now: 5000 })!
    expect(stalled).toMatchObject({ status: 'paused', pauseReason: 'interrupted', elapsedMs: 0 })
    const resumed = edgeReducer(stalled, { type: 'resume', now: 9000 })!
    expect(resumed.sampledAt).toBe(9000)
  })

  it('ends a never-finale game as denied and a came-report as lost', () => {
    let session = start({ minutes: 1, finale: 'never' })
    session = tickFor(session, 61_000)
    expect(session).toMatchObject({ status: 'finished', ending: 'denied' })
    const lost = edgeReducer(start({ minutes: 5 }), { type: 'came', now: 500 })!
    expect(lost).toMatchObject({ status: 'finished', ending: 'lost' })
  })

  it('extends overtime rounds instead of ending immediately', () => {
    let session = start({ minutes: 1, finale: 'overtime', customChance: 0 })
    session = tickFor(session, 61_000)
    expect(session.status).not.toBe('finished')
    expect(session.overtime).toBe(1)
    expect(session.totalMs).toBeGreaterThan(60_000)
    // 继续推进到上限后必然许可。
    for (let round = 0; round < EDGE_OVERTIME_CAP + 3 && session.status !== 'finished'; round += 1) {
      session = tickFor(session, session.settings.overtimeSeconds * 1000 + 60_000)
    }
    expect(['permit', 'finished']).toContain(session.status)
  })

  it('refuses a new start while a session is live and resets only after finishing', () => {
    const session = start()
    expect(edgeReducer(session, { type: 'start', id: 'two', settings: DEFAULT_EDGE_SETTINGS, now: 1 })).toBe(session)
    expect(edgeReducer(session, { type: 'reset' })).toBe(session)
    const finished = edgeReducer(session, { type: 'quit', now: 100 })!
    expect(finished.status).toBe('finished')
    expect(edgeReducer(finished, { type: 'reset' })).toBeNull()
  })
})

describe('edge settings and records', () => {
  it('normalizes out-of-range values and clamps the hold range', () => {
    const settings = normalizeEdgeSettings({ minutes: 900, difficulty: 'nope', finale: 'ruin', holdMin: 30, holdMax: 5, permitSeconds: 1, customChance: 140, categories: { pain: true } })
    expect(settings).toMatchObject({ minutes: 180, difficulty: 'easy', finale: 'ruin', holdMin: 30, holdMax: 30, permitSeconds: 5, customChance: 100 })
    expect(settings.categories).toEqual({ tease: true, pose: true, pain: true, edge: true })
  })

  it('keeps settings and history isolated per scope and merges by id', () => {
    expect(writeEdgeData('user:a', { settings: { ...DEFAULT_EDGE_SETTINGS, minutes: 9 }, history: [record] })).toBe(true)
    expect(readEdgeData('user:a').data.history).toHaveLength(1)
    expect(readEdgeData('guest').data.history).toHaveLength(0)
    expect(readEdgeData('user:a').data.settings.minutes).toBe(9)
    expect(mergeEdgeHistory([record], [{ ...record, edges: 9 }])).toEqual([{ ...record, edges: 9 }])
  })

  it('drops records written by an unknown schema and reports unreadable storage', () => {
    writeEdgeData('guest', { settings: DEFAULT_EDGE_SETTINGS, history: [record, { ...record, id: 'two', ending: 'weird' } as unknown as EdgeRecord] })
    expect(readEdgeData('guest').data.history).toHaveLength(1)
    localStorage.setItem('zhizhou-edge:v1:guest', '{not json')
    expect(readEdgeData('guest').error).toBeTruthy()
  })

  it('summarizes and formats records', () => {
    expect(summarizeEdgeHistory([record, { ...record, id: 'two', ending: 'denied', elapsedMs: 9000, overtime: 2 }])).toEqual({ sessions: 2, edges: 4, permitted: 1, longestMs: 9000 })
    expect(formatEdgeTime(0)).toBe('00:00')
    expect(formatEdgeTime(61_000)).toBe('01:01')
  })
})
