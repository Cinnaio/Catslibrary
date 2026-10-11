import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import type { SourceSyncPreview } from '@/lib/api'
import ChapterMappingReview from './ChapterMappingReview'

const preview = {
  mappings: [{ sourceChapterKey: 's1', sourceOrder: 1, sourceTitle: '源站第一章', localChapterIds: ['a'], relation: 'one_to_one', confidence: 'high', matchReason: 'exact-title', matchEvidence: '完整标题一致。' }],
  localChapters: [{ id: 'a', order: 1, title: '本地第一章' }, { id: 'b', order: 2, title: '本地第二章' }],
  sourceChapters: [{ key: 's1', order: 1, title: '源站第一章' }, { key: 's2', order: 2, title: '源站第二章' }],
  manualMappings: [],
} as unknown as SourceSyncPreview

it('展示匹配依据与相邻章节，保存未匹配章的人工对应关系', async () => {
  const onRemap = vi.fn()
  // jsdom 不实现指针捕获，Radix Select 在打开菜单时会读取这些浏览器 API。
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
  const user = userEvent.setup()
  render(<ChapterMappingReview preview={preview} disabled={false} onRemap={onRemap} />)
  fireEvent.click(screen.getByText('核对与调整映射'))
  expect(screen.getByText(/完整标题一致 · 置信度高/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '调整映射：本地 2' }))
  expect(screen.getByText(/本地前章：本地第一章/)).toBeInTheDocument()
  await user.click(screen.getByRole('combobox'))
  expect(screen.getByRole('option', { name: /源站第一章（已占用）/ })).toHaveAttribute('aria-disabled', 'true')
  await user.click(screen.getByRole('option', { name: '2 · 源站第二章' }))
  expect(screen.getByText(/源站前章：源站第一章/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '保存映射并重新预览' }))
  expect(onRemap).toHaveBeenCalledWith([{ localChapterId: 'b', sourceChapterKey: 's2' }])
})

it('恢复自动匹配清除覆盖，拆分组不能被单章重映射', () => {
  const onRemap = vi.fn()
  render(<ChapterMappingReview preview={{ ...preview, manualMappings: [{ localChapterId: 'b', sourceChapterKey: null }], mappings: [{ ...preview.mappings[0]!, relation: 'split' }] }} disabled={false} onRemap={onRemap} />)
  fireEvent.click(screen.getByText('核对与调整映射'))
  expect(screen.getByRole('button', { name: '调整映射：本地 1' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: '恢复自动匹配' }))
  expect(onRemap).toHaveBeenCalledWith([])
})
