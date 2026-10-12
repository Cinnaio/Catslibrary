import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { DashboardFollowupBook } from '@shared/admin-dashboard'
const mocks = vi.hoisted(() => ({ stats: vi.fn(), status: vi.fn() }))
vi.mock('@/lib/api', () => ({ url: (p: string) => p, authHeaders: () => ({}), adminApi: { stats: mocks.stats }, scrapeApi: { status: mocks.status } }))
import DashboardTab from './DashboardTab'
const now = Date.now()
const book = (title: string, result = 'idle'): DashboardFollowupBook => ({
  novelId: 'book/id',
  title,
  result,
  enabled: true,
  intervalHours: 6,
  nextCheckAt: now + 3600000,
  checkedAt: now - 10000,
  message: '检查结果说明',
  addedCount: 3,
})
const fixture = () => ({
  snapshotAt: now,
  followups: {
    enabled: 12,
    waiting: 2,
    running: 1,
    attention: 1,
    issues: [book('异常作品', 'protected')],
    scheduled: [book('安排作品')],
    recent: [book('有新章的作品', 'updated')],
  },
  totals: { novels: 416, chapters: 38828, users: 3, covers: 416, failedJobs: 41, todayChapters: 1231, dbSize: null },
  contentRating: { general: 1, restricted: 375, unknown: 40 },
  jobStatus: { running: 1, completed: 406, failed: 41 },
  recentJobs: [{ id: 'j', novelId: 'n', novelTitle: '失败抓取', status: 'failed', error: '源站返回 403', step: '', updatedAt: now }],
  recentNovels: [{ id: 'n', title: '更新作品', author: '作者', chapterCount: 90, updatedAt: now }],
})
beforeEach(() => {
  vi.clearAllMocks()
  mocks.stats.mockResolvedValue(fixture())
})
const show = () =>
  render(
    <MemoryRouter>
      <DashboardTab />
    </MemoryRouter>,
  )
it('优先展示追更异常，提供明确的管理入口及实际失败原因', async () => {
  show()
  expect(await screen.findByRole('button', { name: '查看追更事件：异常作品' })).toBeVisible()
  expect(screen.getByText('章节受保护')).toBeVisible()
  expect(screen.getByText('源站返回 403')).toBeVisible()
  expect(screen.getByRole('link', { name: '任务中心' })).toHaveAttribute('href', '/admin/tasks?view=scrape')
  expect(screen.getByText('数据库 未统计')).toBeVisible()
  expect(screen.queryByText('任务状态')).not.toBeInTheDocument()
})
it('切换检查安排与最近结果，区分调度时间和新增章节', async () => {
  show()
  await screen.findByText('异常作品')
  fireEvent.mouseDown(screen.getByRole('tab', { name: '检查安排' }), { button: 0 })
  expect(await screen.findByText('安排作品')).toBeVisible()
  expect(screen.getByText('下次检查')).toBeVisible()
  fireEvent.mouseDown(screen.getByRole('tab', { name: '最近结果' }), { button: 0 })
  expect(await screen.findByText('有新章的作品')).toBeVisible()
  expect(screen.getByText(/新增 3 章/)).toBeVisible()
})
it('没有异常时默认展示安排，空结果说明状态而非显示故障', async () => {
  const data = fixture()
  data.followups.attention = 0
  data.followups.issues = []
  data.followups.scheduled = []
  mocks.stats.mockResolvedValue(data)
  show()
  expect(await screen.findByText('暂无自动追更安排')).toBeVisible()
  expect(screen.getByRole('tab', { name: '检查安排' })).toHaveAttribute('data-state', 'active')
})
it('刷新失败保留上次快照并可再次刷新，成功更新数据', async () => {
  show()
  await screen.findByText('异常作品')
  mocks.stats.mockRejectedValueOnce(new Error('offline'))
  fireEvent.click(screen.getByRole('button', { name: '刷新总览' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('当前显示上次成功读取的数据')
  expect(screen.getByText('异常作品')).toBeVisible()
  const next = fixture()
  next.followups.issues = [book('刷新后的异常', 'failed')]
  mocks.stats.mockResolvedValueOnce(next)
  fireEvent.click(screen.getByRole('button', { name: '刷新总览' }))
  expect(await screen.findByText('刷新后的异常')).toBeVisible()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})
it('首屏读取失败可重试，缺少追更数据时不伪装成零', async () => {
  mocks.stats.mockRejectedValueOnce(new Error('offline'))
  show()
  expect(await screen.findByRole('alert')).toHaveTextContent('总览加载失败')
  mocks.stats.mockResolvedValueOnce({ ...fixture(), followups: undefined })
  fireEvent.click(screen.getByRole('button', { name: '重试' }))
  await waitFor(() => expect(screen.getByText('追更概况暂不可用')).toBeVisible())
})

afterEach(() => vi.unstubAllGlobals())
it('追更事件打开最新详情，管理小说作为辅助入口，关闭后刷新总览', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        enabled: true,
        intervalHours: 6,
        nextCheckAt: now + 1000,
        checkedAt: now,
        result: 'failed',
        message: '完整失败原因：源站 403',
        failures: 2,
        sourceUrl: 'https://example.com/book',
        hasConfig: true,
        ongoing: true,
      }),
    }),
  )
  show()
  fireEvent.click(await screen.findByRole('button', { name: '查看追更事件：异常作品' }))
  expect(await screen.findByRole('heading', { name: '追更事件详情' })).toBeVisible()
  expect(await screen.findByText('完整失败原因：源站 403')).toBeVisible()
  expect(screen.getByRole('link', { name: '管理这本小说 →' })).toHaveAttribute('href', '/admin/novels?novelId=book%2Fid')
  expect(screen.getByRole('button', { name: '检查更新' })).toBeEnabled()
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  await waitFor(() => expect(mocks.stats).toHaveBeenCalledTimes(2))
})
it('抓取事件直接读取该任务完整详情，不依赖任务列表', async () => {
  mocks.status.mockResolvedValueOnce({
    id: 'j',
    status: 'failed',
    error: '任务完整原因',
    recentLogs: [{ id: 'log', message: '请求目录失败', detail: 'HTTP 403', createdAt: now }],
    failedItems: [{ id: 'item', chapterTitle: '第一章', error: '超时' }],
  })
  show()
  fireEvent.click(await screen.findByRole('button', { name: '查看抓取任务：失败抓取' }))
  expect(await screen.findByText('任务完整原因')).toBeVisible()
  expect(mocks.status).toHaveBeenCalledWith('j')
  expect(screen.getByText('请求目录失败')).toBeVisible()
  expect(screen.getByText('第一章')).toBeVisible()
})
it('事件内调整追更先保留草稿，取消不写入，保存才提交暂停设置', async () => {
  let state = {
    enabled: true,
    intervalHours: 6,
    nextCheckAt: now + 1000,
    checkedAt: now,
    result: 'failed',
    message: '检查失败',
    hasConfig: true,
    ongoing: true,
  }
  const fetch = vi.fn().mockImplementation(async (_url, options) => {
    if (options.method === 'POST') state = { ...state, ...JSON.parse(options.body) }
    return { ok: true, json: async () => state }
  })
  vi.stubGlobal('fetch', fetch)
  show()
  fireEvent.click(await screen.findByRole('button', { name: '查看追更事件：异常作品' }))
  fireEvent.click(await screen.findByRole('button', { name: '调整追更设置' }))
  fireEvent.click(screen.getByRole('checkbox', { name: '自动追更' }))
  fireEvent.click(screen.getByRole('button', { name: '取消调整' }))
  expect(fetch.mock.calls.some((call) => call[1].method === 'POST')).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: '调整追更设置' }))
  expect(screen.getByRole('checkbox', { name: '自动追更' })).toBeChecked()
  fireEvent.click(screen.getByRole('checkbox', { name: '自动追更' }))
  fireEvent.click(screen.getByRole('button', { name: '保存设置' }))
  await screen.findByText('追更设置已保存')
  expect(JSON.parse(fetch.mock.calls.find((call) => call[1].method === 'POST')![1].body)).toEqual({
    novelId: 'book/id',
    action: 'followup-save',
    enabled: false,
    intervalHours: 6,
  })
})
it('任务已清理或读取失败时显示错误，可在详情内重试', async () => {
  mocks.status.mockRejectedValueOnce(new Error('Job not found or expired')).mockResolvedValueOnce({ id: 'j', status: 'completed', recentLogs: [] })
  show()
  fireEvent.click(await screen.findByRole('button', { name: '查看抓取任务：失败抓取' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('记录可能已清理')
  fireEvent.click(screen.getByRole('button', { name: '重试' }))
  expect(await screen.findByText('暂无日志记录。')).toBeVisible()
  expect(mocks.status).toHaveBeenCalledTimes(2)
})
