export interface PendingChapterCounts {
  pendingChapterCount?: number | null
  pendingProtectedChapterCount?: number | null
  pendingPublicChapterCount?: number | null
  pendingUnknownChapterCount?: number | null
}

export function pendingUpdateDisplay(novel: PendingChapterCounts & { chapterCount: number; remoteChapterCount: number }) {
  const total = novel.pendingChapterCount ?? Math.max(0, (novel.remoteChapterCount || 0) - (novel.chapterCount || 0))
  const protectedCount = novel.pendingProtectedChapterCount ?? 0
  const allProtected = total > 0 && protectedCount === total
  const unknown = novel.pendingUnknownChapterCount == null || novel.pendingUnknownChapterCount > 0
  return { total, protectedCount, allProtected, unknown }
}
