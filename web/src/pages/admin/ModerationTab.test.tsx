import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ thoughts: vi.fn(), comments: vi.fn(), reports: vi.fn(), toast: vi.fn() }))
vi.mock('../../lib/api', () => ({ thoughtsApi: { adminList: mocks.thoughts }, adminApi: { comments: { list: mocks.comments }, commentReports: { list: mocks.reports } } }))
vi.mock('../../components/feedback', () => ({ useToast: () => ({ toast: mocks.toast }), useConfirm: () => ({ confirm: vi.fn() }) }))
import ModerationTab from './ModerationTab'
beforeEach(() => vi.clearAllMocks())
const row = (id: string, text: string) => ({ id, thoughtText: text, createdAt: 1, novelId: 'n', chapterId: 'c', status: 'visible' })
it('第 81 条审核内容可通过下一页读取，并传入 offset', async () => {
  mocks.thoughts.mockResolvedValueOnce({ thoughts: [row('first', '第一页想法')], total: 81 }).mockResolvedValueOnce({ thoughts: [row('last', '第81条想法')], total: 81 })
  render(<MemoryRouter><ModerationTab /></MemoryRouter>)
  await screen.findByText('第一页想法')
  fireEvent.click(screen.getByRole('button', { name: '下一页' }))
  await screen.findByText('第81条想法')
  expect(mocks.thoughts).toHaveBeenLastCalledWith(expect.objectContaining({ offset: '80' }))
})
it('读取过程中切换搜索不会丢查询，旧请求迟到不能回退列表', async () => {
  let resolve!: (data: unknown) => void
  mocks.thoughts.mockImplementationOnce(() => new Promise(r => { resolve = r })).mockResolvedValueOnce({ thoughts: [row('new', '新查询结果')], total: 1 })
  render(<MemoryRouter><ModerationTab /></MemoryRouter>)
  fireEvent.change(screen.getByLabelText('搜索审核内容'), { target: { value: '新' } })
  await screen.findByText('新查询结果')
  resolve({ thoughts: [row('old', '旧查询结果')], total: 1 })
  await waitFor(() => expect(mocks.thoughts).toHaveBeenCalledTimes(2))
  expect(screen.queryByText('旧查询结果')).not.toBeInTheDocument()
  expect(mocks.thoughts).toHaveBeenLastCalledWith(expect.objectContaining({ search: '新', offset: '0' }))
})
