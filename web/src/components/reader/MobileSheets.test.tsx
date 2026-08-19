import { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ChapterMeta } from '@shared/types'
import { MobileLibrarySheet, MobileSettingsSheet } from './MobileSheets'

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
        open
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

  it('焦点保持在弹层内，并在关闭后返回触发按钮', async () => {
    const user = userEvent.setup()

    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>打开阅读设置</button>
          <MobileSettingsSheet
            open={open}
            settings={{
              fontSize: '1',
              readerLineHeight: '1.95',
              readerParagraphSpacing: '1.4',
              readerPageWidth: 'standard',
              fontFamily: 'serif',
              readerPageMode: 'scroll',
              readerTheme: 'default',
              readerAutoScrollSpeed: 'off',
              readerClickPaging: 'off',
              readerWakeLock: 'off',
            }}
            set={vi.fn()}
            wakeLockSupported={false}
            onClose={() => setOpen(false)}
          />
        </>
      )
    }

    render(<Harness />)
    const trigger = screen.getByRole('button', { name: '打开阅读设置' })
    await user.click(trigger)

    const dialog = screen.getByRole('dialog', { name: '阅读设置' })
    await waitFor(() => expect(screen.getByRole('button', { name: '关闭阅读设置' })).toHaveFocus())
    expect(screen.getByRole('button', { name: '18' })).toHaveAttribute('aria-pressed', 'true')
    await user.tab({ shift: true })
    expect(dialog).toContainElement(document.activeElement as HTMLElement)

    await user.keyboard('{Escape}')
    await waitFor(() => expect(trigger).toHaveFocus())
  })
})
