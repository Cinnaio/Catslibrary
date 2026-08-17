import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ChapterMeta } from '@shared/types'
import { MobileLibrarySheet } from './MobileSheets'

const chapter: ChapterMeta = {
  id: 'chapter-1',
  novelId: 'novel-1',
  title: '第一章',
  order: 1,
  wordCount: 100,
  sourceUrl: '',
  createdAt: 0,
}

describe('MobileLibrarySheet', () => {
  it('tabs 与面板保持 aria 关联，Escape 可关闭弹层', () => {
    const onClose = vi.fn()
    render(
      <MobileLibrarySheet
        novelId="novel-1"
        currentChapterId="chapter-1"
        allChapters={[chapter]}
        tab="chapters"
        onTabChange={vi.fn()}
        query=""
        onQueryChange={vi.fn()}
        onGotoChapter={vi.fn()}
        onDeleteBookmark={vi.fn()}
        onClose={onClose}
      />,
    )

    const chaptersTab = screen.getByRole('tab', { name: '目录' })
    const chaptersPanel = screen.getByRole('tabpanel')
    expect(chaptersTab).toHaveAttribute('aria-selected', 'true')
    expect(chaptersTab).toHaveAttribute('aria-controls', 'mobileChapterList')
    expect(chaptersPanel).toHaveAttribute('id', 'mobileChapterList')
    expect(chaptersPanel).toHaveAttribute('aria-labelledby', 'mobileLibraryTabChapters')

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
