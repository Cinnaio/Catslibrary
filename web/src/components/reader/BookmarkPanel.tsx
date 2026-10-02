/** 桌面端书签面板：当前小说的书签列表，支持跳转与删除。 */
import { getNovelBookmarks } from '../../lib/storage'
import { Bookmark, X } from 'lucide-react'

interface BookmarkPanelProps {
  novelId: string
  currentChapterId: string
  onJump: (chapterId: string, novelId: string) => void
  onDelete: (bookmarkId: string) => void
  onClose?: () => void
}

export function BookmarkPanel({ novelId, currentChapterId, onJump, onDelete, onClose }: BookmarkPanelProps) {
  const bookmarks = getNovelBookmarks(novelId)
  return (
    <div className="bookmark-panel" onClick={(e) => e.stopPropagation()}>
      <div className="bookmark-panel__header">
        <h2>书签 <span className="text-muted">{bookmarks.length} 个</span></h2>
        {onClose && <button type="button" className="bookmark-panel__close" aria-label="关闭书签列表" onClick={onClose}><X size={16} aria-hidden="true" /></button>}
      </div>
      <div className="bookmark-panel__list">
        {bookmarks.length === 0 ? (
          <div className="bookmark-panel__empty"><Bookmark size={24} aria-hidden="true" /><span>暂无书签</span><small>阅读时点击书签图标，留下想回来的位置。</small></div>
        ) : (
          bookmarks.map((bm) => (
            <div className={`bookmark-panel__item${bm.chapterId === currentChapterId ? ' bookmark-panel__item--current' : ''}`} key={bm.id}>
              <button className="bookmark-panel__jump" onClick={() => onJump(bm.chapterId, novelId)}>
                <span className="bookmark-panel__title">{bm.chapterTitle || `第 ${bm.chapterOrder || '?'} 章`}</span>
                {bm.note && <span className="bookmark-panel__note">{bm.note}</span>}
              </button>
              <button className="bookmark-panel__del" aria-label="删除书签" title="删除书签" onClick={() => onDelete(bm.id)}>
                <svg viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><line x1="1" y1="1" x2="13" y2="13" /><line x1="13" y1="1" x2="1" y2="13" /></svg>
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
