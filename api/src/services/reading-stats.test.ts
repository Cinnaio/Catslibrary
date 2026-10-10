import { expect, it } from 'vitest'
import { aggregateReading, unionDuration, type StatEvent } from './reading-stats'
import { parseReadingDate, readingRange, READING_DAY_MS } from '@shared/reading-stats'
const event = (start: number, end: number, sessionId = 's', chapterId = 'c'): StatEvent => ({
  id: `${start}`,
  sessionId,
  novelId: 'n',
  chapterId,
  title: '书',
  start,
  end,
})
it('merges overlapping devices and repeated intervals without double counting time', () => {
  expect(
    unionDuration([
      { start: 0, end: 30 },
      { start: 10, end: 20 },
      { start: 20, end: 40 },
    ]),
  ).toBe(40)
  const result = aggregateReading([event(0, 30000), event(10000, 40000, 'other')], 0, 50000, 0)
  expect(result).toMatchObject({ milliseconds: 40000, sessions: 2, chapters: 1, days: 1 })
})
it('qualifies complete sessions before clipping; short sessions and visits are excluded', () => {
  const result = aggregateReading([event(0, 30000), event(31000, 40000, 'brief')], 20000, 50000, 0)
  expect(result).toMatchObject({ milliseconds: 10000, sessions: 1, chapters: 0, days: 0 })
})
it('splits time at Shanghai midnight and deduplicates chapters across days', () => {
  const midnight = parseReadingDate('2026-10-10')!
  const rows = [event(midnight - 30000, midnight), event(midnight, midnight + 30000)]
  const result = aggregateReading(rows, midnight - READING_DAY_MS, midnight + READING_DAY_MS, midnight - 30000)
  expect(result).toMatchObject({ milliseconds: 60000, sessions: 1, chapters: 1, days: 2 })
  expect(result.trend.map((r) => r.date)).toEqual(['2026-10-09', '2026-10-10'])
})
it('uses hour and month buckets, preserving session deduplication inside each bucket', () => {
  const midnight = parseReadingDate('2026-10-10')!
  const rows = [event(midnight, midnight + 30000), event(midnight + 3600000, midnight + 3630000)]
  expect(aggregateReading(rows, midnight, midnight + 7200000, midnight).trend.map((r) => r.date)).toEqual(['2026-10-10T00', '2026-10-10T01'])
  const annual = aggregateReading(rows, parseReadingDate('2026-01-01')!, parseReadingDate('2027-01-01')!, midnight)
  expect(annual.trend).toEqual([{ date: '2026-10', milliseconds: 60000, sessions: 1 }])
})
it('uses natural month, Monday weeks and inclusive trailing dates', () => {
  const now = Date.parse('2026-10-10T12:00:00+08:00')
  expect(readingRange('week', now).start).toBe(parseReadingDate('2026-10-05'))
  expect(readingRange('month', now, -1)).toEqual({ start: parseReadingDate('2026-09-01'), end: parseReadingDate('2026-10-01') })
  expect(readingRange('7', now).start).toBe(parseReadingDate('2026-10-04'))
  expect(parseReadingDate('2026-02-30')).toBeNull()
})
