/** Saved positions share the same reader panel and shared action controls. */
import { Bookmark, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import EmptyState from '@/components/shared/EmptyState'
import { getNovelBookmarks } from '../../lib/storage'
import styles from './BookmarkPanel.module.css'

interface BookmarkPanelProps {
  novelId: string
  currentChapterId: string
  onJump: (chapterId: string, novelId: string) => void
  onDelete: (bookmarkId: string) => void
  onClose?: () => void
}

export function BookmarkPanel({ novelId, currentChapterId, onJump, onDelete, onClose }: BookmarkPanelProps) {
  const bookmarks = getNovelBookmarks(novelId)
  return <div className={`bookmark-panel ${styles.panel}`} onClick={event => event.stopPropagation()}>
    <div className={styles.header}>
      <h2>书签 <span>{bookmarks.length} 个</span></h2>
      {onClose && <Button variant="ghost" size="icon" type="button" aria-label="关闭书签列表" onClick={onClose}><X size={16} aria-hidden="true" /></Button>}
    </div>
    {bookmarks.length === 0 ? <EmptyState icon={<Bookmark />} message="暂无书签" hint="阅读时添加书签，留下想回来的位置。" /> :
      <div className={styles.list}>{bookmarks.map(bm => <div className={styles.item} data-current={bm.chapterId === currentChapterId} key={bm.id}>
        <button type="button" className={styles.jump} onClick={() => onJump(bm.chapterId, novelId)} title={bm.chapterTitle || `第 ${bm.chapterOrder || '?'} 章`}>
          <span className={styles.title}>{bm.chapterTitle || `第 ${bm.chapterOrder || '?'} 章`}</span>
          {bm.note && <span className={styles.note}>{bm.note}</span>}
        </button>
        <Button variant="ghost" size="icon" type="button" className={styles.remove} aria-label="删除书签" title="删除书签" onClick={() => onDelete(bm.id)}><Trash2 size={14} aria-hidden="true" /></Button>
      </div>)}</div>}
  </div>
}
