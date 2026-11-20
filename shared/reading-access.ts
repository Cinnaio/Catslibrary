export const READING_ACCESS_SUBJECTS = ['guest', 'account', 'ip'] as const
export const READING_ACCESS_WINDOWS = [10, 60, 1440] as const
export const READING_ACCESS_MAX_QUOTA = 100000
export type ReadingAccessSubject = typeof READING_ACCESS_SUBJECTS[number]
export type ReadingAccessMode = 'observe' | 'enforce'
export type ReadingAccessWindow = typeof READING_ACCESS_WINDOWS[number]
export type ReadingAccessQuotaKey = `${ReadingAccessSubject}:${1 | ReadingAccessWindow}`
export const READING_ACCESS_QUOTAS = READING_ACCESS_SUBJECTS.flatMap(subject =>
  ([1, ...READING_ACCESS_WINDOWS] as const).map(window => `${subject}:${window}` as const),
)

export interface ReadingAccessPolicy {
  mode: ReadingAccessMode
  minuteLimits: Record<ReadingAccessSubject, number>
  limits: Record<ReadingAccessSubject, Array<{ minutes: ReadingAccessWindow; chapters: number; novels: number }>>
}

export interface ReadingAccessOverrides {
  mode: ReadingAccessMode | null
  quotas: Partial<Record<ReadingAccessQuotaKey, number>>
}

export interface ReadingAccessSettings extends ReadingAccessPolicy {
  revision: string | null
  overrides: ReadingAccessOverrides
  managedByEnv: Array<'mode' | ReadingAccessQuotaKey>
}

export interface ReadingAccessHour {
  hour: number
  subjectKind: ReadingAccessSubject
  requests: number
  uniqueChapterReads: number
  uniqueNovelReads: number
  rateLimited: number
  flagged: number
  blocked: number
}

export interface ReadingAccessSignal {
  windowMinutes: ReadingAccessWindow
  windowStart: number
  subjectKind: ReadingAccessSubject
  subjects: number
  flagged: number
  blocked: number
}

export interface ReadingAccessSummary extends ReadingAccessPolicy {
  hours: number
  generatedAt: number
  countsAreCapped: boolean
  byHour: ReadingAccessHour[]
  signals: ReadingAccessSignal[]
}
