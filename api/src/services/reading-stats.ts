import { READING_DAY_MS, READING_MIN_MS, READING_OFFSET_MS, readingDate, readingMidnight, type ReadingEvent, type ReadingStats } from '@shared/reading-stats'

export interface StatEvent extends ReadingEvent {
  title: string
  available?: boolean
}
/** Union overlapping device intervals; never sum parallel reading into total time. */
export function unionDuration(intervals: { start: number; end: number }[]): number {
  let end = -Infinity,
    total = 0
  for (const item of [...intervals].sort((a, b) => a.start - b.start)) {
    if (item.end <= end) continue
    total += item.end - Math.max(item.start, end)
    end = item.end
  }
  return total
}
export function aggregateReading(events: StatEvent[], start: number, end: number, recordedSince: number | null): ReadingStats {
  const sessions = new Map<string, StatEvent[]>()
  for (const event of events) {
    const list = sessions.get(event.sessionId) || []
    list.push(event)
    sessions.set(event.sessionId, list)
  }
  // Qualify whole sessions before clipping them to a calendar range.
  const qualified = new Set([...sessions].filter(([, rows]) => unionDuration(rows) >= READING_MIN_MS).map(([id]) => id))
  const eligible = events.filter((event) => qualified.has(event.sessionId))
  const clipped = eligible.map((e) => ({ ...e, start: Math.max(start, e.start), end: Math.min(end, e.end) })).filter((e) => e.end > e.start)
  const chapters = new Map<string, StatEvent[]>()
  const novels = new Map<string, StatEvent[]>()
  for (const e of clipped) {
    const chapter = `${e.novelId}:${e.chapterId}`
    const chapterRows = chapters.get(chapter) || []
    chapterRows.push(e)
    chapters.set(chapter, chapterRows)
    const novelRows = novels.get(e.novelId) || []
    novelRows.push(e)
    novels.set(e.novelId, novelRows)
  }
  const daily = new Map<string, StatEvent[]>()
  for (const e of clipped) {
    for (let cursor = e.start; cursor < e.end;) {
      const next = Math.min(e.end, readingMidnight(cursor) + READING_DAY_MS)
      const key = readingDate(cursor)
      const dayRows = daily.get(key) || []
      dayRows.push({ ...e, start: cursor, end: next })
      daily.set(key, dayRows)
      cursor = next
    }
  }
  const chapterCount = (rows: StatEvent[]) => {
    const groups = new Map<string, StatEvent[]>()
    for (const e of rows) {
      const group = groups.get(e.chapterId) || []
      group.push(e)
      groups.set(e.chapterId, group)
    }
    return [...groups.values()].filter((g) => unionDuration(g) >= READING_MIN_MS).length
  }
  const buckets = new Map<string, StatEvent[]>()
  const granularity = end - start <= READING_DAY_MS ? 'hour' : end - start > 90 * READING_DAY_MS ? 'month' : 'day'
  for (const e of clipped) {
    for (let cursor = e.start; cursor < e.end;) {
      const date = new Date(cursor + READING_OFFSET_MS)
      const key = granularity === 'hour' ? date.toISOString().slice(0, 13) : granularity === 'month' ? readingDate(cursor).slice(0, 7) : readingDate(cursor)
      const boundary =
        granularity === 'hour'
          ? (Math.floor(cursor / 3600000) + 1) * 3600000
          : granularity === 'month'
            ? Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) - READING_OFFSET_MS
            : readingMidnight(cursor) + READING_DAY_MS
      const next = Math.min(boundary, e.end)
      const rows = buckets.get(key) || []
      rows.push({ ...e, start: cursor, end: next })
      buckets.set(key, rows)
      cursor = next
    }
  }
  return {
    start,
    end,
    recordedSince,
    milliseconds: unionDuration(clipped),
    sessions: new Set(clipped.map((e) => e.sessionId)).size,
    chapters: [...chapters.values()].filter((g) => unionDuration(g) >= READING_MIN_MS).length,
    days: [...daily.values()].filter((g) => unionDuration(g) >= READING_MIN_MS).length,
    trend: [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, rows]) => ({ date, milliseconds: unionDuration(rows), sessions: new Set(rows.map((e) => e.sessionId)).size })),
    novels: [...novels.entries()]
      .map(([id, rows]) => ({
        id,
        title: rows[0]!.title,
        available: rows[0]!.available !== false,
        milliseconds: unionDuration(rows),
        chapters: chapterCount(rows),
        lastReadAt: rows.reduce((max, e) => Math.max(max, e.end), 0),
      }))
      .sort((a, b) => b.milliseconds - a.milliseconds),
  }
}
