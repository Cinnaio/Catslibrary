import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import BookImportChapterResolver from './BookImportChapterResolver'
import type { BookImportChapterDiff } from '@shared/types'

// 共享下拉走 Popover + cmdk，jsdom 缺这两个浏览器 API，逐个测试文件自行兜底。
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as typeof ResizeObserver
}
Element.prototype.scrollIntoView = () => undefined

const first: BookImportChapterDiff = { id: 'new-1', incomingTitle: '第一段补章', incomingOrder: 58, incomingContent: '补章正文', status: 'new', selected: true, confidence: 'high', reason: '已确认新增' }
const second: BookImportChapterDiff = { ...first, id: 'new-2', incomingTitle: '第二段补章', incomingOrder: 59, status: 'conflict', selected: false }

it('第二个插章的候选包含本轮已确认新增章，并提交独立的导入锚点', () => {
  const onSave = vi.fn()
  render(<BookImportChapterResolver chapter={second} local={[{ id: 'a', title: '本地起点', order: 57 }, { id: 'b', title: '本地终点', order: 58 }]} chapters={[first, second]} resolutions={[{ chapterId: first.id, action: 'insert', afterChapterId: 'a' }]} busy={false} onSave={onSave} onCancel={vi.fn()} />)
  fireEvent.click(screen.getByRole('radio', { name: '这是新增章节' }))
  // 触发器只展示占位，候选在浮层里按 role=option 断言
  expect(screen.getByRole('combobox', { name: '插入位置' })).toHaveTextContent('请选择插入在哪一章之后')
  fireEvent.click(screen.getByRole('combobox', { name: '插入位置' }))
  const anchor = screen.getByRole('option', { name: /58.*第一段补章.*本轮新增/ })
  fireEvent.click(anchor)
  expect(screen.getByRole('combobox', { name: '插入位置' })).toHaveTextContent(/58.*第一段补章.*本轮新增/)
  expect(screen.getByText(/预计新增序号：59/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '保存确认并更新预览' }))
  expect(onSave).toHaveBeenCalledWith({ action: 'insert', afterChapterId: null, afterIncomingChapterId: 'new-1' })
})

it('编辑前章时排除自身及后继，切换处理方式后仍可重新选择位置', () => {
  render(<BookImportChapterResolver chapter={first} local={[{ id: 'a', title: '本地起点', order: 57 }]} chapters={[first, { ...second, status: 'new', selected: true }]} resolutions={[{ chapterId: first.id, action: 'insert', afterChapterId: 'a' }, { chapterId: second.id, action: 'insert', afterChapterId: null, afterIncomingChapterId: first.id }]} busy={false} onSave={vi.fn()} onCancel={vi.fn()} />)
  // 已保存的插入确认让表单落在「这是新增章节」，插入候选里不能再出现自己或自己的后继
  fireEvent.click(screen.getByRole('combobox', { name: '插入位置' }))
  expect(screen.queryByRole('option', { name: /补章.*本轮新增/ })).not.toBeInTheDocument()
  fireEvent.keyDown(screen.getAllByRole('option')[0]!, { key: 'Escape' })
  fireEvent.click(screen.getByRole('radio', { name: '对应已有章节' }))
  expect(screen.getByRole('combobox', { name: '对应的本地章节' })).toHaveTextContent('请选择并核对本地章节')
  fireEvent.click(screen.getByRole('radio', { name: '这是新增章节' }))
  // 未选位置时触发器只显示占位，没有空的 option 冒充选中项
  expect(screen.getByRole('combobox', { name: '插入位置' })).toHaveTextContent('请选择插入在哪一章之后')
  fireEvent.click(screen.getByRole('combobox', { name: '插入位置' }))
  fireEvent.click(screen.getByRole('option', { name: '放在本书第一章之前' }))
  expect(screen.getByText(/预计新增序号：1/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('combobox', { name: '插入位置' }))
  expect(screen.queryByRole('option', { name: /补章.*本轮新增/ })).not.toBeInTheDocument()
})
