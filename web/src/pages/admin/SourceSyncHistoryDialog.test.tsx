import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ history: vi.fn(), detail: vi.fn(), rollback: vi.fn(), confirm: vi.fn() }))
vi.mock('@/lib/api', () => ({ scrapeApi: { sourceSyncHistory: mocks.history, sourceSyncHistoryDetail: mocks.detail, sourceSyncRollback: mocks.rollback }, newOperationId: () => 'rollback-op' }))
vi.mock('@/components/feedback', () => ({ useConfirm: () => ({ confirm: mocks.confirm }) }))
import SourceSyncHistoryDialog from './SourceSyncHistoryDialog'
beforeEach(() => {
  vi.clearAllMocks()
  mocks.history.mockResolvedValue({ total: 1, items: [{ runId: 'run', status: 'applied', appliedAt: 1, canRollback: true, summary: { novelTitle: '本地作品', titleUpdated: 1 }, rollback: null }] })
  mocks.confirm.mockResolvedValue(true)
})
it('按需读取实际变化，撤回后展示保留的冲突并刷新列表', async () => {
  const completed = vi.fn()
  mocks.detail.mockResolvedValue({ runId: 'run', changes: [{ kind: 'chapter', id: 'c', before: { title: '原题', order: 46 }, after: { title: '新题', order: 45 } }] })
  mocks.rollback.mockResolvedValue({ runId: 'run', restored: 1, conflicts: [{ id: 'other', title: '人工改名章', reason: '已再次编辑，保留当前值' }] })
  render(<SourceSyncHistoryDialog open novelId="n" onOpenChange={vi.fn()} onCompleted={completed} />)
  fireEvent.click(await screen.findByRole('button', { name: '查看变化' }))
  await screen.findByText('原：46 · 原题')
  fireEvent.click(screen.getByRole('button', { name: '撤回此次融合' }))
  await screen.findByText(/已恢复 1 项，保留 1 项冲突/)
  expect(screen.getByText(/人工改名章：已再次编辑/)).toBeInTheDocument()
  expect(mocks.rollback).toHaveBeenCalledWith('run', 'rollback-op')
  expect(completed).toHaveBeenCalledOnce()
  await waitFor(() => expect(mocks.history).toHaveBeenCalledTimes(2))
})
it('撤回期间阻止关闭，重复点击只发送一次请求', async () => {
  let resolve!: (value: unknown) => void
  mocks.rollback.mockImplementation(() => new Promise(done => { resolve = done }))
  const closed = vi.fn()
  render(<SourceSyncHistoryDialog open novelId="n" onOpenChange={closed} onCompleted={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: '撤回此次融合' }))
  await waitFor(() => expect(mocks.rollback).toHaveBeenCalledOnce())
  fireEvent.keyDown(document, { key: 'Escape' })
  fireEvent.click(screen.getByRole('button', { name: '撤回此次融合' }))
  expect(closed).not.toHaveBeenCalled()
  expect(mocks.rollback).toHaveBeenCalledOnce()
  resolve({ runId: 'run', restored: 1, conflicts: [] })
  await screen.findByText(/已恢复 1 项，保留 0 项冲突/)
})
