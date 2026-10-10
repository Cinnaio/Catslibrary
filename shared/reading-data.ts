export type ReadingDataKind = 'bookmark' | 'progress' | 'bookshelf'
export interface LegacyReadingEntry {
  novelId: string
  chapterId?: string
  note?: string
  scrollPercent?: number
  timestamp?: number
}
export interface LegacyReadingData {
  bookmarks: LegacyReadingEntry[]
  progress: LegacyReadingEntry[]
  bookshelf: LegacyReadingEntry[]
}
export interface ReadingDataItem {
  kind: ReadingDataKind
  novelId: string
  chapterId: string
  novelTitle: string
  chapterTitle: string
  action: 'remove' | 'clear' | 'refresh' | 'normalize' | 'restore' | 'skip'
  detail: string
}
export interface ReadingDataPreview {
  userId: string
  previewToken: string
  expiresAt: number
  items: ReadingDataItem[]
  hasMore: boolean
}
export interface ReadingDataResult {
  operationId: string
  kind: 'repair' | 'restore'
  changed: number
  skipped: number
  clearedNovelIds: string[]
  createdAt: number
}
export const LEGACY_READING_LIMIT = 500
export function readingId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 80 && value === value.trim() && !/[\x00-\x1f\x7f]/.test(value)
}
/** Only reading fields cross the API boundary; titles and foreign bookmark IDs are discarded. */
export function cleanLegacyEntry(value: unknown, kind: ReadingDataKind): LegacyReadingEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (!readingId(row.novelId) || (kind !== 'bookshelf' && !readingId(row.chapterId))) return null
  if (row.note !== undefined && typeof row.note !== 'string') return null
  for (const key of ['timestamp', 'scrollPercent']) {
    if (row[key] !== undefined && (typeof row[key] !== 'number' || !Number.isFinite(row[key]) || Number(row[key]) < 0)) return null
  }
  return {
    novelId: row.novelId,
    ...(kind !== 'bookshelf' ? { chapterId: row.chapterId as string } : {}),
    ...(kind === 'bookmark'
      ? {
          note: String(row.note || '')
            .replace(/[\x00-\x1f\x7f]/g, '')
            .slice(0, 300),
        }
      : {}),
    ...(kind === 'progress' ? { scrollPercent: Math.min(1, Number(row.scrollPercent) || 0) } : {}),
    timestamp: Math.floor(Number(row.timestamp) || 0),
  }
}
export function normalizeLegacyReadingData(value: unknown): LegacyReadingData | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const result: LegacyReadingData = { bookmarks: [], progress: [], bookshelf: [] }
  for (const [key, kind] of [
    ['bookmarks', 'bookmark'],
    ['progress', 'progress'],
    ['bookshelf', 'bookshelf'],
  ] as const) {
    const entries = raw[key]
    if (!Array.isArray(entries) || entries.length > LEGACY_READING_LIMIT) return null
    const unique = new Map<string, LegacyReadingEntry>()
    for (const entry of entries) {
      const cleaned = cleanLegacyEntry(entry, kind)
      if (!cleaned) return null
      const id = JSON.stringify([cleaned.novelId, kind === 'bookmark' ? cleaned.chapterId : ''])
      if ((unique.get(id)?.timestamp ?? -1) < (cleaned.timestamp || 0)) unique.set(id, cleaned)
    }
    result[key] = [...unique.values()]
  }
  return result
}
