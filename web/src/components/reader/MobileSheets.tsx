/** 移动端底部弹层：阅读设置 sheet 与阅读面板（目录/书签）sheet。 */
import { useRef } from 'react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import type { ChapterMeta } from '@shared/types'
import { getNovelBookmarks } from '../../lib/storage'
import { chapterLabel, filterChapters } from '../../lib/reader-utils'
import { VirtualList } from './VirtualList'
import { SettingsControls } from './SettingsControls'
import type { ReaderSettingKey } from '../../hooks/useReaderSettings'

const MOBILE_ROW_H = 46

interface MobileSettingsSheetProps {
  settings: Record<string, string>
  set: (key: ReaderSettingKey, value: string) => void
  wakeLockSupported: boolean
  onClose: () => void
}

export function MobileSettingsSheet({ settings, set, wakeLockSupported, onClose }: MobileSettingsSheetProps) {
  const restoreFocusRef = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null)
  return (
    <DialogPrimitive.Root open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="mobile-settings-overlay" />
        <DialogPrimitive.Content
          className="mobile-settings-sheet"
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            restoreFocusRef.current?.focus()
          }}
        >
          <div className="mobile-settings-sheet__handle" aria-hidden="true"></div>
          <div className="mobile-settings-sheet__header">
            <DialogPrimitive.Title asChild>
              <h2>阅读设置</h2>
            </DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <button type="button" className="mobile-settings-sheet__close" aria-label="关闭阅读设置">×</button>
            </DialogPrimitive.Close>
          </div>
          <div className="mobile-settings-sheet__body">
            <SettingsControls settings={settings} set={set} wakeLockSupported={wakeLockSupported} />
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

interface MobileLibrarySheetProps {
  novelId: string
  currentChapterId: string
  allChapters: ChapterMeta[]
  tab: 'chapters' | 'bookmarks'
  onTabChange: (tab: 'chapters' | 'bookmarks') => void
  query: string
  onQueryChange: (query: string) => void
  onGotoChapter: (chapterId: string, novelId?: string) => void
  onDeleteBookmark: (bookmarkId: string) => void
  onClose: () => void
}

export function MobileLibrarySheet({
  novelId,
  currentChapterId,
  allChapters,
  tab,
  onTabChange,
  query,
  onQueryChange,
  onGotoChapter,
  onDeleteBookmark,
  onClose,
}: MobileLibrarySheetProps) {
  const matches = filterChapters(allChapters, query)
  const bookmarks = getNovelBookmarks(novelId)
  const restoreFocusRef = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null)
  return (
    <DialogPrimitive.Root open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="mobile-library-overlay" />
        <DialogPrimitive.Content
          className="mobile-library-sheet"
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            restoreFocusRef.current?.focus()
          }}
        >
          <div className="mobile-settings-sheet__handle" aria-hidden="true"></div>
          <div className="mobile-settings-sheet__header">
            <DialogPrimitive.Title asChild>
              <h2>阅读面板</h2>
            </DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <button type="button" className="mobile-settings-sheet__close" aria-label="关闭阅读面板">×</button>
            </DialogPrimitive.Close>
          </div>
          <div className="mobile-library-tabs" role="tablist" aria-label="阅读面板">
            <button id="mobileLibraryTabChapters" type="button" role="tab" aria-selected={tab === 'chapters'} aria-controls="mobileChapterList" tabIndex={tab === 'chapters' ? 0 : -1} className={tab === 'chapters' ? 'active' : ''} onClick={() => onTabChange('chapters')}>目录</button>
            <button id="mobileLibraryTabBookmarks" type="button" role="tab" aria-selected={tab === 'bookmarks'} aria-controls="mobileBookmarkList" tabIndex={tab === 'bookmarks' ? 0 : -1} className={tab === 'bookmarks' ? 'active' : ''} onClick={() => onTabChange('bookmarks')}>书签</button>
          </div>
          {tab === 'chapters' ? (
            <div id="mobileChapterList" className="mobile-library-panel" role="tabpanel" aria-labelledby="mobileLibraryTabChapters" tabIndex={0}>
              <div className="mobile-library-search">
                <input type="search" className="mobile-library-search__input" placeholder="搜索章节号或标题…" autoComplete="off" aria-label="搜索章节" value={query} onChange={(e) => onQueryChange(e.target.value)} />
                <span className="mobile-library-search__count">{query ? `${matches.length} / ${allChapters.length}` : `${allChapters.length} 章`}</span>
              </div>
              {matches.length === 0 ? (
                <div className="mobile-library-empty">{allChapters.length === 0 ? '暂无章节' : '没有匹配的章节'}</div>
              ) : (
                <VirtualList
                  className="mobile-library-scroll"
                  ariaLabel="章节列表"
                  items={matches}
                  rowHeight={MOBILE_ROW_H}
                  scrollToIndex={Math.max(0, matches.findIndex((c) => c.id === currentChapterId))}
                  renderRow={(ch, i) => {
                    const isCurrent = ch.id === currentChapterId
                    return (
                      <button
                        type="button"
                        className={`mobile-library-item${isCurrent ? ' mobile-library-item--current' : ''}`}
                        role="option"
                        aria-selected={isCurrent}
                        onClick={() => onGotoChapter(ch.id, ch.novelId || novelId)}
                      >
                        <span className="mobile-library-item__title">{chapterLabel(ch, i)}</span>
                        {isCurrent && <span className="mobile-library-item__badge">在读</span>}
                      </button>
                    )
                  }}
                />
              )}
            </div>
          ) : (
            <div id="mobileBookmarkList" className="mobile-library-panel" role="tabpanel" aria-labelledby="mobileLibraryTabBookmarks" tabIndex={0}>
              {bookmarks.length === 0 ? (
                <div className="mobile-library-empty">暂无书签</div>
              ) : (
                bookmarks.map((bm) => (
                  <div className={`mobile-library-bookmark${bm.chapterId === currentChapterId ? ' mobile-library-item--current' : ''}`} key={bm.id}>
                    <button type="button" className="mobile-library-bookmark__jump" onClick={() => onGotoChapter(bm.chapterId, novelId)}>
                      <span className="mobile-library-item__title">{bm.chapterTitle || `第${bm.chapterOrder}章`}</span>
                      {bm.note && <span className="mobile-library-item__meta">{bm.note}</span>}
                    </button>
                    <button type="button" className="mobile-library-bookmark__delete" aria-label="删除书签" onClick={() => onDeleteBookmark(bm.id)}>×</button>
                  </div>
                ))
              )}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
