import type { ReadingHistoryEntry } from '@shared/types'
import { clearHistory, getNovelHistory, saveHistory } from './storage'

export interface ProgressState {
  progress: { novelId?: string; chapterId: string; scrollPercent?: number; updatedAt: number } | null
  tombstone?: { deletedAt: number; updatedAt?: number } | null
}

/** 所有入口共享云端位置和墓碑的版本比较；调用方须先确认账号及请求目标。 */
export function applyProgressState(novelId: string, state: ProgressState, metadata: Partial<ReadingHistoryEntry> = {}): ReadingHistoryEntry | null {
  const local = getNovelHistory(novelId)
  const deletedAt = Number(state.tombstone?.updatedAt || state.tombstone?.deletedAt || 0)
  if (deletedAt && (!local || deletedAt >= local.timestamp)) {
    clearHistory(novelId)
    return null
  }
  const remote = state.progress
  if (!remote?.chapterId || (local && local.timestamp > remote.updatedAt)) return local
  const samePosition = local?.chapterId === remote.chapterId && local.scrollPercent === remote.scrollPercent
  saveHistory(novelId, {
    novelTitle: local?.novelTitle,
    ...(local?.chapterId === remote.chapterId ? { chapterTitle: local.chapterTitle } : {}),
    ...(samePosition ? local : {}), ...metadata,
    chapterId: remote.chapterId, scrollPercent: remote.scrollPercent || 0, timestamp: remote.updatedAt,
  })
  return getNovelHistory(novelId)
}
