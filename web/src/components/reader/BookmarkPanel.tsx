/** 桌面端书签面板：当前小说的书签列表，支持跳转与删除。 */
import { getNovelBookmarks } from '../../lib/storage'

interface BookmarkPanelProps {
  novelId: string
  currentChapterId: string
  onJump: (chapterId: string, novelId: string) => void
  onDelete: (bookmarkId: string) => void
}

export function BookmarkPanel({ novelId, currentChapterId, onJump, onDelete }: BookmarkPanelProps) {
  const bookmarks = getNovelBookmarks(novelId)
  return (
    <div className="bookmark-panel" onClick={(e) => e.stopPropagation()}>
      <div className="bookmark-panel__header">
        <span>书签</span>
        <span className="text-muted">{bookmarks.length ? `共 ${bookmarks.length} 个` : ''}</span>
      </div>
      <div className="bookmark-panel__list">
        {bookmarks.length === 0 ? (
          <div className="bookmark-panel__empty">暂无书签</div>
        ) : (
          bookmarks.map((bm) => (
            <div className={`bookmark-panel__item${bm.chapterId === currentChapterId ? ' bookmark-panel__item--current' : ''}`} key={bm.id}>
              <button className="bookmark-panel__jump" onClick={() => onJump(bm.chapterId, novelId)}>
                <span className="bookmark-panel__title">{bm.chapterTitle || `第 ${bm.chapterOrder || '?'} 章`}</span>
                {bm.note && <span className="bookmark-panel__note">{bm.note}</span>}
              </button>
              <button className="bookmark-panel__del" title="删除书签" onClick={() => onDelete(bm.id)}>
                <svg viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><line x1="1" y1="1" x2="13" y2="13" /><line x1="13" y1="1" x2="1" y2="13" /></svg>
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
