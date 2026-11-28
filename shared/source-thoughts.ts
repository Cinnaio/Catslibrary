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
export interface SourceThoughtSync {
  state: 'queued' | 'syncing' | 'partial' | 'completed' | 'unavailable'
  savedCount: number
  updatedAt: number
  complete: boolean
}
export interface SourceThoughtPage {
  sync?: SourceThoughtSync
  /** 仅使用来源明确确认的删除标记；缺页或空页不代表删除。 */
  deletedIds?: string[]
  items: SourceThought[]
  total: number
  cursor: string
  hasMore: boolean
}
export interface SourceThoughtCounts {
  sync?: SourceThoughtSync
  available: boolean
  source?: { id: string; label: string }
  paragraphs: Array<{ paragraphIndex: number; paragraphHash: string; count: number }>
  unmatchedCount: number
}

export function sourceThoughtSyncText(sync: SourceThoughtSync): string {
  const saved = `已保存 ${sync.savedCount} 条`
  switch (sync.state) {
    case 'queued':
      return `${saved} · 等待同步`
    case 'syncing':
      return `${saved} · 正在同步`
    case 'partial':
      return `${saved} · 同步暂缓，稍后重试`
    case 'unavailable':
      return `${saved} · 来源暂不可用`
    case 'completed':
      return `${saved} · 已同步`
  }
}
