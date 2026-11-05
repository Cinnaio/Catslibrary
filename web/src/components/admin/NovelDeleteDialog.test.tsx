import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import type { Novel } from '@shared/types'
import NovelDeleteDialog from './NovelDeleteDialog'

const mocks = vi.hoisted(() => ({ remove: vi.fn(), batchDelete: vi.fn(), toast: vi.fn() }))
vi.mock('@/lib/api', () => ({ novelsApi: { remove: mocks.remove, batchDelete: mocks.batchDelete } }))
vi.mock('@/components/feedback', () => ({ useToast: () => ({ toast: mocks.toast }) }))

const novels = Array.from({ length: 6 }, (_, index) => ({
  id: `novel-${index}`,
  title: `检查作品${index + 1}`,
  author: '检查作者',
  chapterCount: 10,
})) as Novel[]

beforeEach(() => vi.resetAllMocks())

it('单项删除保留影响说明，请求期间阻止取消、Escape 与重复执行，成功后通知原作品 ID', async () => {
  let finish!: () => void
  mocks.remove.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  )
  const onClose = vi.fn(),
    onDeleted = vi.fn()
  render(<NovelDeleteDialog open novels={[novels[0]!]} onClose={onClose} onDeleted={onDeleted} />)
  const dialog = screen.getByRole('alertdialog', { name: '确认删除小说' })
  expect(dialog).toHaveAccessibleDescription(/10 章正文.*阅读进度与缓存/)
  await waitFor(() => expect(screen.getByRole('button', { name: '取消' })).toHaveFocus())
  await userEvent.click(screen.getByRole('button', { name: '确认删除' }))
  expect(mocks.remove).toHaveBeenCalledWith('novel-0')
  expect(screen.getByRole('button', { name: '正在删除…' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '取消' })).toBeDisabled()
  await userEvent.keyboard('{Escape}')
  await userEvent.click(screen.getByRole('button', { name: '正在删除…' }))
  expect(onClose).not.toHaveBeenCalled()
  expect(mocks.remove).toHaveBeenCalledTimes(1)
  await act(async () => {
    finish()
  })
  expect(onClose).toHaveBeenCalledTimes(1)
  expect(onDeleted).toHaveBeenCalledWith(['novel-0'])
})

it('批量删除显示完整对象清单，失败后保留原选择并允许重试', async () => {
  mocks.batchDelete.mockRejectedValueOnce(new Error('检查失败')).mockResolvedValueOnce({})
  const onClose = vi.fn(),
    onDeleted = vi.fn()
  render(<NovelDeleteDialog open novels={novels} onClose={onClose} onDeleted={onDeleted} />)
  expect(screen.getByRole('region', { name: '操作对象' })).toHaveTextContent('检查作品6')
  expect(screen.getByRole('alertdialog')).toHaveAccessibleDescription(/6 部小说.*60 章正文/)
  await userEvent.click(screen.getByRole('button', { name: '确认删除这 6 部小说' }))
  await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('删除失败: 检查失败', 'error'))
  expect(onClose).not.toHaveBeenCalled()
  expect(onDeleted).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: '确认删除这 6 部小说' }))
  await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(novels.map((novel) => novel.id)))
  expect(mocks.batchDelete).toHaveBeenNthCalledWith(
    1,
    novels.map((novel) => novel.id),
  )
  expect(mocks.batchDelete).toHaveBeenNthCalledWith(
    2,
    novels.map((novel) => novel.id),
  )
  expect(mocks.remove).not.toHaveBeenCalled()
})
