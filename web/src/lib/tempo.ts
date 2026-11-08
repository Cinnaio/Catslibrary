export interface TempoSettings {
  minutes: number
  bpm: number
  sound: boolean
  speech: boolean
}

export const DEFAULT_TEMPO_SETTINGS: TempoSettings = { minutes: 5, bpm: 60, sound: false, speech: false }
export const TEMPO_HISTORY_LIMIT = 30

export interface TempoRecord {
  id: string
  finishedAt: number
  minutes: number
  bpm: number
  elapsedMs: number
  completed: boolean
}

export interface TempoData {
  settings: TempoSettings
  history: TempoRecord[]
}

export interface TempoSession {
  id: string
  minutes: number
  bpm: number
  elapsedMs: number
  sampledAt: number | null
  status: 'running' | 'paused' | 'completed' | 'ended'
  pauseReason: 'manual' | 'background' | 'interrupted' | null
}

export type TempoAction =
  | { type: 'start'; id: string; settings: TempoSettings; now: number }
  | { type: 'reset' }
  | { type: 'tick' | 'resume' | 'end'; now: number }
  | { type: 'pause'; now: number; reason: 'manual' | 'background' }

function integer(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function normalizeTempoSettings(value: unknown): TempoSettings {
  const input = object(value)
  return {
    minutes: integer(input.minutes, 1, 180, DEFAULT_TEMPO_SETTINGS.minutes),
    bpm: integer(input.bpm, 30, 180, DEFAULT_TEMPO_SETTINGS.bpm),
    sound: input.sound === true,
    speech: input.speech === true,
  }
}

function sample(session: TempoSession, now: number): TempoSession {
  if (session.status !== 'running' || session.sampledAt === null) return session
  const delta = now - session.sampledAt
  // Do not turn a sleeping device or a long main-thread stall into elapsed practice.
  if (!Number.isFinite(delta) || delta < 0 || delta > 2000) {
    return { ...session, status: 'paused', sampledAt: null, pauseReason: 'interrupted' }
  }
  const elapsedMs = Math.min(session.minutes * 60_000, session.elapsedMs + delta)
  return elapsedMs >= session.minutes * 60_000
    ? { ...session, elapsedMs, status: 'completed', sampledAt: null, pauseReason: null }
    : { ...session, elapsedMs, sampledAt: now }
}

export function tempoReducer(session: TempoSession | null, action: TempoAction): TempoSession | null {
  if (action.type === 'reset') return session?.status === 'running' || session?.status === 'paused' ? session : null
  if (action.type === 'start') {
    if (session?.status === 'running' || session?.status === 'paused') return session
    const settings = normalizeTempoSettings(action.settings)
    return { id: action.id, minutes: settings.minutes, bpm: settings.bpm, elapsedMs: 0, sampledAt: action.now, status: 'running', pauseReason: null }
  }
  if (!session) return null
  if (action.type === 'resume') {
    return session.status === 'paused' ? { ...session, sampledAt: action.now, status: 'running', pauseReason: null } : session
  }
  const next = sample(session, action.now)
  if (action.type === 'tick' || next.status === 'completed' || next.status === 'ended') return next
  if (action.type === 'pause') {
    return session.status === 'running' ? { ...next, status: 'paused', sampledAt: null, pauseReason: action.reason } : next
  }
  return { ...next, status: 'ended', sampledAt: null, pauseReason: null }
}

export function tempoStorageKey(scope: string): string {
  return `zhizhou-tempo:v1:${scope}`
}

export function readTempoData(scope: string): { data: TempoData; error: string | null } {
  const fallback: TempoData = { settings: { ...DEFAULT_TEMPO_SETTINGS }, history: [] }
  try {
    const raw = localStorage.getItem(tempoStorageKey(scope))
    if (!raw) return { data: fallback, error: null }
    const input = object(JSON.parse(raw))
    if (!input.settings || !Array.isArray(input.history)) throw new Error('Invalid tempo data')
    const history = input.history.filter((entry: unknown): entry is TempoRecord => {
      const record = object(entry)
      return typeof record.id === 'string' && record.id.length > 0 && record.id.length <= 100
        && typeof record.finishedAt === 'number' && Number.isFinite(record.finishedAt) && record.finishedAt > 0 && record.finishedAt <= 8.64e15
        && typeof record.minutes === 'number' && Number.isInteger(record.minutes) && record.minutes >= 1 && record.minutes <= 180
        && typeof record.bpm === 'number' && Number.isInteger(record.bpm) && record.bpm >= 30 && record.bpm <= 180
        && typeof record.elapsedMs === 'number' && Number.isFinite(record.elapsedMs) && record.elapsedMs >= 0 && record.elapsedMs <= record.minutes * 60_000
        && typeof record.completed === 'boolean'
    })
    return { data: { settings: normalizeTempoSettings(input.settings), history: mergeTempoHistory(history) }, error: null }
  } catch {
    return { data: fallback, error: '暂时无法读取本机设置和记录，当前使用默认设置。' }
  }
}

export function mergeTempoHistory(...lists: TempoRecord[][]): TempoRecord[] {
  return [...new Map(lists.flat().map(record => [record.id, record])).values()]
    .sort((a, b) => b.finishedAt - a.finishedAt)
    .slice(0, TEMPO_HISTORY_LIMIT)
}

export function writeTempoData(scope: string, data: TempoData): boolean {
  try {
    localStorage.setItem(tempoStorageKey(scope), JSON.stringify(data))
    return true
  } catch {
    return false
  }
}

export function formatTempoTime(milliseconds: number): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000))
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`
}
