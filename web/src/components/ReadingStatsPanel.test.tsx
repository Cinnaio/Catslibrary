import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { ReadingStatsPanel } from './ReadingStatsPanel'
const mocks = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('../lib/api', () => ({ readingStatsApi: { get: mocks.get } }))
vi.mock('../context/ContentPolicyContext', () => ({ useContentPolicy: () => ({ mode: 'safe' }) }))
vi.mock('recharts', () => ({
  ResponsiveContainer: () => <div>趋势图</div>,
  Bar: () => null,
  BarChart: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}))
const data = {
  start: Date.parse('2026-10-05T00:00:00+08:00'),
  end: Date.parse('2026-10-10T12:00:00+08:00'),
  recordedSince: 1,
  milliseconds: 120000,
  sessions: 2,
  chapters: 1,
  days: 1,
  trend: [{ date: '2026-10-10', milliseconds: 120000, sessions: 2 }],
  novels: [{ id: 'n', title: '作品', milliseconds: 120000, chapters: 1, lastReadAt: Date.now() }],
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.get.mockResolvedValue(data)
})
it('shows actual stats and supports period switching with content-policy filtering', async () => {
  render(
    <MemoryRouter initialEntries={['/profile?tab=stats&period=week']}>
      <ReadingStatsPanel />
    </MemoryRouter>,
  )
  await screen.findByRole('link', { name: '作品' })
  expect(screen.getByText('阅读时长', { selector: 'dt' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '下一周期' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: '今日' }))
  await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2))
  expect(mocks.get.mock.calls[1]![2]).toBe('safe')
  expect(screen.getByRole('button', { name: '今日' })).toHaveAttribute('aria-pressed', 'true')
})
it('distinguishes failed requests from zero reading and permits retry', async () => {
  mocks.get.mockRejectedValueOnce(new Error('网络异常'))
  render(
    <MemoryRouter>
      <ReadingStatsPanel />
    </MemoryRouter>,
  )
  await screen.findByRole('alert')
  expect(screen.queryByText('0 分钟')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '重试' }))
  await screen.findByRole('link', { name: '作品' })
})
it('shows an honest new-account empty state and rejects invalid custom ranges', async () => {
  mocks.get.mockResolvedValue({ ...data, milliseconds: 0, sessions: 0, chapters: 0, days: 0, recordedSince: null, novels: [], trend: [] })
  render(
    <MemoryRouter initialEntries={['/profile?tab=stats&period=custom&from=2026-10-10&to=2026-10-01']}>
      <ReadingStatsPanel />
    </MemoryRouter>,
  )
  expect(screen.getByRole('alert')).toHaveTextContent('有效的起止日期')
  expect(mocks.get).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '本周' }))
  await screen.findByText('开始阅读后，你的统计会出现在这里。')
})

it('keeps the previous results visible while changing periods, including failed refreshes', async () => {
  let rejectRefresh!: (error: Error) => void
  mocks.get.mockResolvedValueOnce(data).mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        rejectRefresh = reject
      }),
  )
  render(
    <MemoryRouter>
      <ReadingStatsPanel />
    </MemoryRouter>,
  )
  await screen.findByRole('link', { name: '作品' })
  fireEvent.click(screen.getByRole('button', { name: '今日' }))
  await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2))
  expect(screen.getByRole('link', { name: '作品' })).toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('暂时显示上次统计')
  expect(screen.getByRole('region', { name: '阅读统计' })).toHaveAttribute('aria-busy', 'true')
  await act(async () => rejectRefresh(new Error('网络异常')))
  expect(screen.getByRole('alert')).toHaveTextContent('网络异常')
  expect(screen.getByRole('status')).toHaveTextContent('更新失败，暂时显示上次统计')
  expect(screen.getByRole('link', { name: '作品' })).toBeInTheDocument()
})
it('ignores older responses when periods change quickly', async () => {
  let resolveOlder!: (result: typeof data) => void
  mocks.get
    .mockResolvedValueOnce(data)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOlder = resolve
        }),
    )
    .mockResolvedValueOnce({ ...data, sessions: 9 })
  render(
    <MemoryRouter>
      <ReadingStatsPanel />
    </MemoryRouter>,
  )
  await screen.findByRole('link', { name: '作品' })
  fireEvent.click(screen.getByRole('button', { name: '今日' }))
  await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2))
  fireEvent.click(screen.getByRole('button', { name: '本月' }))
  await screen.findByText('9 次')
  await act(async () => resolveOlder({ ...data, sessions: 3 }))
  expect(screen.getByText('9 次')).toBeInTheDocument()
  expect(screen.queryByText('3 次')).not.toBeInTheDocument()
})
