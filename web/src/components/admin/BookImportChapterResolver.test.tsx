import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import BookImportChapterResolver from './BookImportChapterResolver'
import type { BookImportChapterDiff } from '@shared/types'

const first: BookImportChapterDiff = { id: 'new-1', incomingTitle: '第一段补章', incomingOrder: 58, incomingContent: '补章正文', status: 'new', selected: true, confidence: 'high', reason: '已确认新增' }
const second: BookImportChapterDiff = { ...first, id: 'new-2', incomingTitle: '第二段补章', incomingOrder: 59, status: 'conflict', selected: false }

it('第二个插章的候选包含本轮已确认新增章，并提交独立的导入锚点', () => {
  const onSave = vi.fn()
  render(<BookImportChapterResolver chapter={second} local={[{ id: 'a', title: '本地起点', order: 57 }, { id: 'b', title: '本地终点', order: 58 }]} chapters={[first, second]} resolutions={[{ chapterId: first.id, action: 'insert', afterChapterId: 'a' }]} busy={false} onSave={onSave} onCancel={vi.fn()} />)
  fireEvent.click(screen.getByRole('radio', { name: '这是新增章节' }))
  const anchor = screen.getByRole('option', { name: /58.*第一段补章.*本轮新增/ }) as HTMLOptionElement
  fireEvent.change(screen.getByLabelText('插入位置'), { target: { value: anchor.value } })
  expect(screen.getByText(/预计新增序号：59/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '保存确认并更新预览' }))
  expect(onSave).toHaveBeenCalledWith({ action: 'insert', afterChapterId: null, afterIncomingChapterId: 'new-1' })
})

it('编辑前章时排除自身及后继，切换处理方式后仍可重新选择位置', () => {
  render(<BookImportChapterResolver chapter={first} local={[{ id: 'a', title: '本地起点', order: 57 }]} chapters={[first, { ...second, status: 'new', selected: true }]} resolutions={[{ chapterId: first.id, action: 'insert', afterChapterId: 'a' }, { chapterId: second.id, action: 'insert', afterChapterId: null, afterIncomingChapterId: first.id }]} busy={false} onSave={vi.fn()} onCancel={vi.fn()} />)
  expect(screen.queryByRole('option', { name: /补章.*本轮新增/ })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('radio', { name: '对应已有章节' }))
  expect(screen.getByLabelText('对应的本地章节')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('radio', { name: '这是新增章节' }))
  expect(screen.getByLabelText('插入位置')).toHaveValue('')
  fireEvent.change(screen.getByLabelText('插入位置'), { target: { value: '__start__' } })
  expect(screen.getByText(/预计新增序号：1/)).toBeInTheDocument()
  expect(screen.queryByRole('option', { name: /补章.*本轮新增/ })).not.toBeInTheDocument()
})
