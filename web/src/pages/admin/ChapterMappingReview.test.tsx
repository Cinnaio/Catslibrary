import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  expect(screen.getByRole('heading', { name: '调整本地 2 · 本地第二章' })).toHaveFocus()
  expect(screen.getByRole('button', { name: '调整映射：本地 2' })).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByText(/本地前章：本地第一章/)).toBeInTheDocument()
  await user.click(screen.getByRole('combobox'))
  expect(screen.getByRole('option', { name: /源站第一章（选择后交换）/ })).not.toHaveAttribute('aria-disabled', 'true')
  await user.click(screen.getByRole('option', { name: '2 · 源站第二章' }))
  expect(screen.getByText(/源站前章：源站第一章/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '暂存映射调整' }))
  expect(onRemap).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '保存 1 项映射并重新预览' }))
  expect(onRemap).toHaveBeenCalledWith([{ localChapterId: 'b', sourceChapterKey: 's2' }])
  await waitFor(() => expect(screen.queryByText(/已暂存/)).not.toBeInTheDocument())
})

it('选择占用目标暂存双方交换，保存失败保留草稿可重试', async () => {
  const onRemap = vi.fn().mockResolvedValue(false), onPendingMappingsChange = vi.fn()
  const user = userEvent.setup()
  render(<ChapterMappingReview preview={preview} disabled={false} onRemap={onRemap} onPendingMappingsChange={onPendingMappingsChange} />)
  fireEvent.click(screen.getByText('核对与调整映射'))
  fireEvent.click(screen.getByRole('button', { name: '调整映射：本地 2' }))
  await user.click(screen.getByRole('combobox'))
  await user.click(screen.getByRole('option', { name: /源站第一章（选择后交换）/ }))
  expect(screen.getByText(/将与本地 1/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '暂存映射调整' }))
  expect(onPendingMappingsChange).toHaveBeenLastCalledWith(2)
  fireEvent.click(screen.getByRole('button', { name: '保存 2 项映射并重新预览' }))
  await waitFor(() => expect(onRemap).toHaveBeenCalledWith([
    { localChapterId: 'b', sourceChapterKey: 's1' }, { localChapterId: 'a', sourceChapterKey: null },
  ]))
  expect(screen.getByText(/已暂存 2/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '放弃暂存调整' }))
  expect(onPendingMappingsChange).toHaveBeenLastCalledWith(0)
})

it('有差异筛选保留序号偏移、标题不同及未匹配，忽略完整标题的标点差别', () => {
  const locals = [
    { id: 'same', order: 1, title: '第一章，标题' },
    { id: 'order', order: 53, title: '相同标题' },
    { id: 'title', order: 3, title: '原标题' },
    { id: 'missing', order: 4, title: '未匹配章' },
  ]
  const mappings = [
    { ...preview.mappings[0]!, localChapterIds: ['same'], sourceTitle: '第一章, 标题', sourceOrder: 1 },
    { ...preview.mappings[0]!, localChapterIds: ['order'], sourceTitle: '相同标题', sourceOrder: 52 },
    { ...preview.mappings[0]!, localChapterIds: ['title'], sourceTitle: '新标题', sourceOrder: 3, matchReason: 'sequence' as const },
  ]
  render(<ChapterMappingReview preview={{ ...preview, localChapters: locals, mappings }} disabled={false} onRemap={vi.fn()} />)
  fireEvent.click(screen.getByText('核对与调整映射'))
  fireEvent.click(screen.getByRole('button', { name: '有差异 3' }))
  expect(screen.queryByText('本地 1 · 第一章，标题')).not.toBeInTheDocument()
  expect(screen.getByText('本地 53 · 相同标题')).toBeInTheDocument()
  expect(screen.getByText('序号不同')).toBeInTheDocument()
  expect(screen.getByText('标题不同')).toBeInTheDocument()
  expect(screen.getByText('未匹配')).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('搜索本地章节映射'), { target: { value: '53' } })
  expect(screen.getAllByRole('button', { name: /调整映射：本地/ })).toHaveLength(1)
  fireEvent.change(screen.getByLabelText('搜索本地章节映射'), { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: '全部 4' }))
  expect(screen.getAllByRole('button', { name: /调整映射：本地/ })).toHaveLength(4)
})

it('恢复自动匹配清除覆盖，拆分组不能被单章重映射', () => {
  const onRemap = vi.fn()
  render(<ChapterMappingReview preview={{ ...preview, manualMappings: [{ localChapterId: 'b', sourceChapterKey: null }], mappings: [{ ...preview.mappings[0]!, relation: 'split' }] }} disabled={false} onRemap={onRemap} />)
  fireEvent.click(screen.getByText('核对与调整映射'))
  expect(screen.getByRole('button', { name: '调整映射：本地 1' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: '恢复自动匹配' }))
  expect(onRemap).toHaveBeenCalledWith([])
})

it('全选覆盖筛选结果所有页，跨筛选保留选择，逐项取消和清空可用', () => {
  const localChapters = Array.from({ length: 25 }, (_, i) => ({ id: `local-${i}`, order: i + 1, title: `章节 ${i + 1}` }))
  render(<ChapterMappingReview preview={{ ...preview, localChapters, mappings: [] }} disabled={false} onRemap={vi.fn()} />)
  fireEvent.click(screen.getByText('核对与调整映射'))
  fireEvent.change(screen.getByLabelText('搜索本地章节映射'), { target: { value: '章节 25' } })
  fireEvent.click(screen.getByRole('button', { name: '全选当前筛选结果 1 项' }))
  expect(screen.getByText('已选 1 项映射')).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('搜索本地章节映射'), { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: '全选当前筛选结果 25 项' }))
  expect(screen.getByText('已选 25 项映射')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '下一页' }))
  expect(screen.getByRole('checkbox', { name: '选择映射：本地 25' })).toBeChecked()
  fireEvent.click(screen.getByRole('checkbox', { name: '选择映射：本地 25' }))
  expect(screen.getByText('已选 24 项映射')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '清空映射选择' }))
  expect(screen.getByText('已选 0 项映射')).toBeInTheDocument()
  expect(screen.getByRole('checkbox', { name: '选择映射：本地 21' })).not.toBeChecked()
})

it('选择和清空立即通知同步流程，禁用时不能操作', () => {
  const onSelectedMappingsChange = vi.fn()
  const props = { preview, onRemap: vi.fn(), onSelectedMappingsChange }
  const { rerender } = render(<ChapterMappingReview {...props} disabled={false} />)
  fireEvent.click(screen.getByText('核对与调整映射'))
  fireEvent.click(screen.getByRole('button', { name: '全选当前筛选结果 2 项' }))
  expect(onSelectedMappingsChange).toHaveBeenLastCalledWith(new Set(['a', 'b']))
  fireEvent.click(screen.getByRole('checkbox', { name: '选择映射：本地 1' }))
  expect(onSelectedMappingsChange).toHaveBeenLastCalledWith(new Set(['b']))
  rerender(<ChapterMappingReview {...props} disabled={true} />)
  expect(screen.getByRole('checkbox', { name: '选择映射：本地 1' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '清空映射选择' })).toBeDisabled()
  rerender(<ChapterMappingReview {...props} disabled={false} />)
  fireEvent.click(screen.getByRole('button', { name: '清空映射选择' }))
  expect(onSelectedMappingsChange).toHaveBeenLastCalledWith(new Set())
})

it('查看阻塞章节跨越筛选与分页定位到实际占用章节，不改变同步选择', () => {
  const locals = Array.from({ length: 25 }, (_, index) => ({ id: `l${index}`, order: index + 1, title: `目录章节${index + 1}` }))
  const onSelectedMappingsChange = vi.fn()
  render(<ChapterMappingReview preview={{ ...preview,
    localChapters: locals,
    orderRepairSkipped: [{ localChapterId: 'l0', reason: '目标序号的移动依赖受阻：本地 25', blockingChapterIds: ['l24'] }],
  }} disabled={false} onRemap={vi.fn()} onSelectedMappingsChange={onSelectedMappingsChange} />)
  fireEvent.click(screen.getByText('核对与调整映射'))
  fireEvent.click(screen.getByRole('button', { name: /查看阻塞章节：本地 25/ }))
  expect(screen.getByText('本地 25 · 目录章节25')).toHaveFocus()
  expect(screen.queryByRole('region', { name: '人工映射编辑' })).not.toBeInTheDocument()
  expect(screen.getByText('本地 25 · 目录章节25')).toBeInTheDocument()
  expect(onSelectedMappingsChange).not.toHaveBeenCalled()
})
