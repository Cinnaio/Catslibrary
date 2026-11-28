/** External discussion is read-only and never carries local account permissions. */
export interface SourceThought {
  id: string
  displayName: string
  avatarUrl: string
  text: string
  createdAt: number
  likeCount: number
  replyCount: number
  images: string[]
  replyToName?: string
}
export interface SourceThoughtPage {
  items: SourceThought[]
  total: number
  cursor: string
  hasMore: boolean
}
export interface SourceThoughtCounts {
  available: boolean
  source?: { id: string; label: string }
  paragraphs: Array<{ paragraphIndex: number; paragraphHash: string; count: number }>
  unmatchedCount: number
}
