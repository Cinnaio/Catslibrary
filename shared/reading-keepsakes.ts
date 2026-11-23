export interface KeepsakeMoment {
  id: string
  chapterTitle: string
  selectedText: string
  thoughtText: string
}

/** Immutable, private snapshots. Dates describe recorded activity, not a claim of completion. */
export interface ReadingKeepsake {
  id: string
  novelId: string
  title: string
  author: string
  coverUrl: string
  startedAt: number | null
  savedAt: number
  closing: string
  moments: KeepsakeMoment[]
}

export interface KeepsakeContext {
  novel: { title: string; author: string; coverUrl: string }
  latestId: string | null
  startedAt: number | null
  candidates: KeepsakeMoment[]
  candidatesLimited: boolean
}

export interface KeepsakeInput {
  id: string
  previousId: string | null
  momentIds: string[]
  closing: string
}

export interface KeepsakePage {
  items: ReadingKeepsake[]
  nextCursor: string | null
}
export const KEEPSAKE_MAX_MOMENTS = 3
export const KEEPSAKE_MAX_CLOSING = 280
