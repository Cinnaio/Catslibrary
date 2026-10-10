/** Reading statistics use a stable account calendar (Asia/Shanghai). */
export const READING_DAY_MS = 86_400_000
export const READING_IDLE_MS = 300_000
export const READING_MIN_MS = 30_000
export const READING_OFFSET_MS = 8 * 3_600_000
export interface ReadingEvent {
  id: string
  sessionId: string
  novelId: string
  chapterId: string
  start: number
  end: number
}
export interface ReadingStats {
  start: number
  end: number
  recordedSince: number | null
  milliseconds: number
  sessions: number
  chapters: number
  days: number
  novels: { id: string; title: string; available: boolean; milliseconds: number; chapters: number; lastReadAt: number }[]
  trend: { date: string; milliseconds: number; sessions: number }[]
}
export function readingDate(timestamp: number): string {
  return new Date(timestamp + READING_OFFSET_MS).toISOString().slice(0, 10)
}
export function readingMidnight(timestamp: number): number {
  return Math.floor((timestamp + READING_OFFSET_MS) / READING_DAY_MS) * READING_DAY_MS - READING_OFFSET_MS
}
export function parseReadingDate(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const timestamp = Date.parse(`${value}T00:00:00+08:00`)
  return Number.isFinite(timestamp) && readingDate(timestamp) === value ? timestamp : null
}
export type ReadingPeriod = 'today' | 'week' | 'month' | 'year' | '7' | '30' | '90' | 'all' | 'custom'
export function readingRange(period: ReadingPeriod, now: number, offset = 0): { start: number; end: number } {
  const today = readingMidnight(now)
  const date = new Date(today + READING_OFFSET_MS)
  let start = today,
    end = today + READING_DAY_MS
  if (period === 'week') {
    start = today - ((date.getUTCDay() + 6) % 7) * READING_DAY_MS + offset * 7 * READING_DAY_MS
    end = start + 7 * READING_DAY_MS
  } else if (period === 'month' || period === 'year') {
    const year = date.getUTCFullYear(),
      month = date.getUTCMonth()
    start = Date.UTC(year + (period === 'year' ? offset : 0), period === 'year' ? 0 : month + offset, 1) - READING_OFFSET_MS
    end = Date.UTC(year + (period === 'year' ? offset + 1 : 0), period === 'year' ? 0 : month + offset + 1, 1) - READING_OFFSET_MS
  } else if (['7', '30', '90'].includes(period)) {
    start = today - (Number(period) - 1) * READING_DAY_MS + offset * Number(period) * READING_DAY_MS
    end = start + Number(period) * READING_DAY_MS
  } else if (period === 'all') start = 0
  else {
    start += offset * READING_DAY_MS
    end = start + READING_DAY_MS
  }
  return { start, end: Math.min(end, now) }
}
