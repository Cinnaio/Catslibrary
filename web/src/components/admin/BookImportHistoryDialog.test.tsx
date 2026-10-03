import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ history: vi.fn(), rollback: vi.fn(), confirm: vi.fn() }))
vi.mock('@/lib/api', () => ({ bookImportApi: { history: mocks.history, rollback: mocks.rollback }, newOperationId: () => 'stable-operation' }))
vi.mock('@/components/feedback', () => ({ useConfirm: () => ({ confirm: mocks.confirm }) }))
import BookImportHistoryDialog from './BookImportHistoryDialog'
beforeEach(() => {
  vi.clearAllMocks()
  mocks.confirm.mockResolvedValue(true)
  mocks.history.mockResolvedValue({ items: [{ runId: 'run', novelTitle: '历史书', status: 'applied', createdAt: 1, created: 2, updated: 0, canRollback: true }], total: 21 })
})
it('历史可翻页、确认后回滚，展示冲突并刷新小说列表', async () => {
  const completed = vi.fn()
  mocks.rollback.mockResolvedValue({ runId: 'run', rolledBack: 1, conflicts: [{ id: 'c', title: '章节二', reason: '已有后续修改' }] })
  render(<BookImportHistoryDialog open onOpenChange={vi.fn()} onCompleted={completed} />)
  await screen.findByText('历史书')
  fireEvent.click(screen.getByRole('button', { name: '下一页' }))
  await waitFor(() => expect(mocks.history).toHaveBeenLastCalledWith(20, 20))
  await screen.findByText('历史书')
  fireEvent.click(screen.getByRole('button', { name: '撤回此次导入' }))
  await screen.findByText('章节二：已有后续修改')
  expect(mocks.rollback).toHaveBeenCalledWith('run', 'stable-operation')
  expect(completed).toHaveBeenCalledTimes(1)
})
it('回滚失败保留入口和错误，下次重试保持操作 ID', async () => {
  mocks.rollback.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ runId: 'run', rolledBack: 2, conflicts: [] })
  render(<BookImportHistoryDialog open onOpenChange={vi.fn()} onCompleted={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: '撤回此次导入' }))
  await screen.findByRole('alert')
  expect(screen.getByRole('alert')).toHaveTextContent('offline')
  fireEvent.click(screen.getByRole('button', { name: '撤回此次导入' }))
  await screen.findByText('已撤回 2 项变更，保留 0 项冲突。')
  expect(mocks.rollback.mock.calls.map(c => c[1])).toEqual(['stable-operation', 'stable-operation'])
})
