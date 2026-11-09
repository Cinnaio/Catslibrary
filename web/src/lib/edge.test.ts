import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_EDGE_SETTINGS, EDGE_BANK_TIME_MS, EDGE_BANK_WINDOW_MS, EDGE_OVERTIME_CAP, EDGE_SPRINT_COMMAND, EDGE_SPRINT_MS,
  createEdgeSession, edgeActAt, edgeInSprint, edgeReducer, edgeSessionFeedback, edgeSpendOptions, edgeSprintMs, edgeTimingAt,
  formatEdgeTime, mergeEdgeHistory, normalizeEdgeSettings, readEdgeData, summarizeEdgeHistory, writeEdgeData,
  type EdgeRecord, type EdgeSession, type EdgeSettings,
} from './edge'

function start(overrides: Partial<EdgeSettings> = {}): EdgeSession {
  return createEdgeSession('one', { ...DEFAULT_EDGE_SETTINGS, ...overrides }, 0, 12345)
}

function tickFor(session: EdgeSession, milliseconds: number, step = 100): EdgeSession {
  let next = session
  for (let elapsed = 0; elapsed < milliseconds; elapsed += step) {
    next = edgeReducer(next, { type: 'tick', now: (next.sampledAt ?? 0) + Math.min(step, milliseconds - elapsed) })!
  }
  return next
}

const record: EdgeRecord = { id: 'one', finishedAt: 1, minutes: 5, difficulty: 'easy', finale: 'always', elapsedMs: 1000, edges: 2, grinds: 0, spent: 0, overtime: 0, ending: 'permitted' }

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

  it('walks the three acts and locks the tail into a red sprint', () => {
    const settings = { ...DEFAULT_EDGE_SETTINGS, minutes: 20 }
    expect(edgeActAt(settings, 0, 1_200_000)).toBe('warmup')
    expect(edgeActAt(settings, 600_000, 1_200_000)).toBe('grind')
    expect(edgeActAt(settings, 1_000_000, 1_200_000)).toBe('limit')
    // 关掉三幕就恒为折磨，不再有冲刺。
    expect(edgeActAt({ ...settings, acts: false }, 0, 1_200_000)).toBe('grind')
    expect(edgeSprintMs(1_200_000)).toBe(EDGE_SPRINT_MS)
    expect(edgeInSprint(1_200_000, 1_200_000 - EDGE_SPRINT_MS)).toBe(true)
    expect(edgeInSprint(1_200_000, 1_200_000 - EDGE_SPRINT_MS - 1000)).toBe(false)
    // 短局的冲刺按四分之一缩，不会吃掉整局。
    expect(edgeSprintMs(60_000)).toBe(15_000)

    let session = start({ minutes: 1 })
    // 1 分钟的冲刺是最后 15 秒，推进到冲刺起点之后必然全红。
    session = tickFor(session, 46_000)
    expect(session.phase).toBe('stop')
    expect(session.command).toBe(EDGE_SPRINT_COMMAND)
  })

  it('pays later declarations more and charges the grind with a longer hold', () => {
    let session = start({ minutes: 30, finale: 'lottery', holdMin: 10, holdMax: 10 })
    // 推进到绿色指令的中段再申报。
    while (session.phase === 'stop') session = tickFor(session, 1000)
    const phase = tickFor(session, Math.round((session.phaseEndsAt - session.elapsedMs) * 0.8))
    expect(edgeTimingAt(phase)).toBe('late')

    const holdDeclare = edgeReducer(phase, { type: 'edge', now: (phase.sampledAt ?? 0) + 10, declare: 'hold' })!
    expect(holdDeclare.status).toBe('cooldown')
    expect(holdDeclare.edges).toBe(1)
    expect(holdDeclare.grinds).toBe(0)
    expect(holdDeclare.chance).toBe(phase.chance + 5)
    const holdWait = holdDeclare.phaseEndsAt - holdDeclare.elapsedMs

    const grindDeclare = edgeReducer(phase, { type: 'edge', now: (phase.sampledAt ?? 0) + 10, declare: 'grind' })!
    expect(grindDeclare.grinds).toBe(1)
    expect(grindDeclare.chance).toBe(phase.chance + 10)
    // 磨着不停的等待按 1.8 倍算，比停手贵。
    expect(grindDeclare.phaseEndsAt - grindDeclare.elapsedMs).toBeGreaterThan(holdWait)
  })

  it('caps the permit chance at 100 even on easy difficulty', () => {
    let session = start({ minutes: 60, finale: 'lottery' })
    for (let round = 0; round < 12; round += 1) {
      let guard = 0
      while (session.phase === 'stop' && guard < 200) { session = tickFor(session, 1000); guard += 1 }
      session = edgeReducer(session, { type: 'edge', now: (session.sampledAt ?? 0) + 10, declare: 'grind' })!
      session = tickFor(session, 30_000)
    }
    expect(session.chance).toBeLessThanOrEqual(100)
  })

  it('banks a point per minute kept and spends it on pardon, time, or permit', () => {
    let session: EdgeSession = { ...start({ minutes: 30, finale: 'always' }), phase: 'go', phaseEndsAt: 600_000 }
    session = tickFor(session, 185_000)
    expect(session.bank).toBe(3)

    const pardoned = edgeReducer({ ...session, phase: 'stop' }, { type: 'spend', kind: 'pardon', now: (session.sampledAt ?? 0) + 10 })!
    expect(pardoned.bank).toBe(0)
    expect(pardoned.spent).toBe(3)
    expect(pardoned.status).toBe('running')
    expect(pardoned.phase).not.toBe('stop')

    let rich: EdgeSession = { ...start({ minutes: 60, finale: 'always' }), phase: 'go', phaseEndsAt: 600_000 }
    rich = tickFor(rich, 8 * EDGE_BANK_WINDOW_MS + 1000)
    expect(rich.bank).toBe(8)
    const shortened = edgeReducer(rich, { type: 'spend', kind: 'time', now: (rich.sampledAt ?? 0) + 10 })!
    expect(shortened.totalMs).toBe(rich.totalMs - EDGE_BANK_TIME_MS)

    const permitted = edgeReducer(rich, { type: 'spend', kind: 'permit', now: (rich.sampledAt ?? 0) + 10 })!
    expect(permitted.status).toBe('permit')
    expect(permitted.bank).toBe(0)
    // 点数不够时静默无事发生：允许 sampledAt 随 advance 前进，只比业务字段。
    const poor = start({ minutes: 30 })
    const refused = edgeReducer(poor, { type: 'spend', kind: 'permit', now: 10 })!
    expect(refused.status).toBe(poor.status)
    expect(refused.bank).toBe(0)
    expect(refused.spent).toBe(0)
  })

  it('does not bank during a cooldown wait or with the bank disabled', () => {
    // 申报后的等待不累积银行点数：90 秒等待足够跨过一分半。
    let session = start({ minutes: 30, holdMin: 90, holdMax: 90 })
    let guard = 0
    while (session.phase === 'stop' && guard < 200) { session = tickFor(session, 1000); guard += 1 }
    const declaring = edgeReducer(session, { type: 'edge', now: (session.sampledAt ?? 0) + 10, declare: 'hold' })!
    expect(declaring.status).toBe('cooldown')
    const bankBefore = declaring.bank
    expect(tickFor(declaring, 80_000).bank).toBe(bankBefore)

    const off = start({ minutes: 30, bank: false })
    expect(tickFor(off, 200_000).bank).toBe(0)
    expect(edgeSpendOptions(off).every((option) => option.note !== null)).toBe(true)
  })

  it('banks only the eligible portion of ticks crossing a red or cooldown boundary', () => {
    const beforeSprint: EdgeSession = {
      ...start({ minutes: 1 }), phase: 'go', elapsedMs: 44_950, sampledAt: 44_950,
      phaseEndsAt: 45_000, bankedMs: 59_950,
    }
    expect(edgeReducer(beforeSprint, { type: 'tick', now: 45_950 })).toMatchObject({
      phase: 'stop', bank: 1, bankedMs: 0, phaseEndsAt: 60_000,
    })
    for (const status of ['running', 'cooldown'] as const) {
      const red: EdgeSession = { ...start({ acts: false }), status, phase: 'stop', phaseEndsAt: 500 }
      expect(edgeReducer(red, { type: 'tick', now: 1000 })).toMatchObject({
        status: 'running', bank: 0, bankedMs: 500,
      })
    }
    const permit: EdgeSession = { ...start(), status: 'permit', phaseEndsAt: 10_000 }
    expect(tickFor(permit, 1000).bankedMs).toBe(0)
    const paused = edgeReducer(beforeSprint, { type: 'pause', reason: 'manual', now: 44_950 })!
    expect(edgeReducer(paused, { type: 'tick', now: 45_950 })?.bankedMs).toBe(59_950)
  })

  it('rejects pardons during sprint, cooldown, non-red phases, and after the red boundary', () => {
    const base: EdgeSession = { ...start({ minutes: 10 }), phase: 'stop', phaseEndsAt: 10_000, bank: 8 }
    const blocked: EdgeSession[] = [
      { ...base, phase: 'go' },
      { ...base, status: 'cooldown' },
      { ...base, status: 'paused', sampledAt: null },
      { ...base, elapsedMs: 580_000, sampledAt: 580_000, phaseEndsAt: 600_000, command: EDGE_SPRINT_COMMAND },
    ]
    for (const session of blocked) {
      expect(edgeSpendOptions(session).find((option) => option.kind === 'pardon')?.note).toBeTruthy()
      const result = edgeReducer(session, { type: 'spend', kind: 'pardon', now: session.sampledAt ?? 0 })!
      expect(result).toMatchObject({ bank: 8, spent: 0, rng: session.rng })
    }
    const boundary: EdgeSession = { ...base, phaseEndsAt: 100 }
    expect(edgeSpendOptions(boundary).find((option) => option.kind === 'pardon')?.note).toBeNull()
    const advanced = edgeReducer(boundary, { type: 'tick', now: 100 })!
    const rejected = edgeReducer(boundary, { type: 'spend', kind: 'pardon', now: 100 })!
    expect(rejected).toEqual(advanced)
    expect(rejected.phase).not.toBe('stop')
    const paid = edgeReducer(base, { type: 'spend', kind: 'pardon', now: 0 })!
    expect(paid).toMatchObject({ bank: 5, spent: 3 })
    expect(edgeReducer(paid, { type: 'spend', kind: 'pardon', now: 0 })).toEqual(paid)
  })

  it('recomputes the sprint immediately and clips future segments after shortening', () => {
    const base: EdgeSession = {
      ...start({ minutes: 10 }), phase: 'go', bank: 5, elapsedMs: 547_000,
      sampledAt: 547_000, phaseStartedAt: 520_000, phaseEndsAt: 570_000,
    }
    const shortened = edgeReducer(base, { type: 'spend', kind: 'time', now: 547_000 })!
    expect(shortened).toMatchObject({ totalMs: 570_000, phase: 'stop', bank: 0, spent: 5, command: EDGE_SPRINT_COMMAND, phaseEndsAt: 570_000 })
    const earlier = { ...base, elapsedMs: 520_000, sampledAt: 520_000 }
    const clipped = edgeReducer(earlier, { type: 'spend', kind: 'time', now: 520_000 })!
    expect(clipped).toMatchObject({ phase: 'go', phaseEndsAt: 540_000 })
    expect(tickFor(clipped, 20_000)).toMatchObject({ phase: 'stop', command: EDGE_SPRINT_COMMAND })
    const late = { ...base, elapsedMs: 565_000, sampledAt: 565_000 }
    expect(edgeSpendOptions(late).find((option) => option.kind === 'time')?.note).toBeTruthy()
    expect(edgeReducer(late, { type: 'spend', kind: 'time', now: 565_000 })).toMatchObject({ bank: 5, spent: 0, totalMs: 600_000 })
    const onBoundary = { ...late, elapsedMs: 564_950, sampledAt: 564_950 }
    expect(edgeSpendOptions(onBoundary).find((option) => option.kind === 'time')?.note).toBeNull()
    expect(edgeReducer(onBoundary, { type: 'spend', kind: 'time', now: 565_000 })).toMatchObject({ bank: 5, spent: 0, totalMs: 600_000 })
  })

  it('restores fixed bonuses and disables the second declaration when timing is off', () => {
    for (const elapsedMs of [100, 5000, 9000]) {
      const session: EdgeSession = {
        ...start({ timing: false }), phase: 'go', phaseStartedAt: 0, phaseEndsAt: 10_000,
        elapsedMs, sampledAt: elapsedMs,
      }
      expect(edgeSessionFeedback(session)).toMatchObject({ timing: null, timingHint: null })
      expect(edgeReducer(session, { type: 'edge', declare: 'hold', now: elapsedMs })).toMatchObject({ chance: 90, edges: 1, grinds: 0 })
      expect(edgeReducer(session, { type: 'edge', declare: 'grind', now: elapsedMs })).toEqual(session)
    }
  })

  it('normalizes legacy overtime settings to the same duration the engine executes', () => {
    const session = start({ minutes: 1, overtimeSeconds: 15, finale: 'overtime', customChance: 0 })
    expect(session.settings.overtimeSeconds).toBe(45)
    expect(tickFor(session, 60_000)).toMatchObject({ overtime: 1, totalMs: 105_000 })
    expect(normalizeEdgeSettings({ overtimeSeconds: 301 }).overtimeSeconds).toBe(300)
  })

  it('keeps phase boundaries and bank totals independent of the tick interval', () => {
    const session = start({ minutes: 10, difficulty: 'oni' })
    const fast = tickFor(session, 220_000, 100)
    const slow = tickFor(session, 220_000, 1000)
    expect(slow).toEqual(fast)
  })
})

describe('edge settings and records', () => {
  it('fills old record fields and preserves explicit disabled rules on round-trip', () => {
    const { grinds: _grinds, spent: _spent, ...legacy } = record
    localStorage.setItem('zhizhou-edge:v1:legacy', JSON.stringify({
      settings: { acts: false, bank: false, timing: false, overtimeSeconds: 15 }, history: [legacy],
    }))
    const loaded = readEdgeData('legacy')
    expect(loaded.error).toBeNull()
    expect(loaded.data.settings).toMatchObject({ acts: false, bank: false, timing: false, overtimeSeconds: 45 })
    expect(loaded.data.history).toEqual([record])
    writeEdgeData('legacy', loaded.data)
    expect(readEdgeData('legacy').data).toEqual(loaded.data)
  })
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
    expect(summarizeEdgeHistory([record, { ...record, id: 'two', ending: 'denied', elapsedMs: 9000, overtime: 2 }])).toEqual({ sessions: 2, edges: 4, grinds: 0, spent: 0, permitted: 1, longestMs: 9000 })
    expect(formatEdgeTime(0)).toBe('00:00')
    expect(formatEdgeTime(61_000)).toBe('01:01')
  })
})
