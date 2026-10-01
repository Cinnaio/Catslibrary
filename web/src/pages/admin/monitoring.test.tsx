import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { aiApi, scrapeApi, downloadLogsApi, adminApi, authFetch } from '@/lib/api'
import { monitoringRedirect } from './monitoring-routes'
import TaskCenterTab from './TaskCenterTab'
import CallsTab from './CallsTab'

const feedback = vi.hoisted(() => ({ confirm: vi.fn(), toast: vi.fn() }))
vi.mock('@/components/feedback', () => ({ useToast: () => ({ toast: feedback.toast }), useConfirm: () => ({ confirm: feedback.confirm }) }))
vi.mock('@/lib/api', () => ({
  aiApi: { status: vi.fn(), tasks: vi.fn(), cancelTask: vi.fn(), deleteTask: vi.fn(), retryTask: vi.fn(), audit: { calls: vi.fn(), trend: vi.fn() } },
  scrapeApi: { jobs: vi.fn(), proxyLogs: vi.fn() },
  downloadLogsApi: { list: vi.fn() },
  adminApi: { novelIndex: vi.fn() },
  authFetch: vi.fn(),
  newOperationId: () => 'test-operation',
}))

function LocationProbe() {
  const location = useLocation()
  return (
    <output data-testid="location">
      {location.pathname}
      {location.search}
    </output>
  )
}
function mount(element: React.ReactNode, entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      {element}
      <LocationProbe />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  feedback.confirm.mockResolvedValue(true)
  vi.mocked(authFetch).mockResolvedValue({ ok: true, json: async () => ({ jobId: 'new-job' }) } as Response)
  vi.mocked(aiApi.status).mockResolvedValue({ configured: true } as never)
  vi.mocked(aiApi.tasks).mockResolvedValue({ items: [], total: 0 } as never)
  vi.mocked(aiApi.audit.calls).mockResolvedValue({ calls: [], total: 0 } as never)
  vi.mocked(aiApi.audit.trend).mockResolvedValue({ trend: [] } as never)
  vi.mocked(scrapeApi.jobs).mockResolvedValue({ jobs: [] } as never)
  vi.mocked(scrapeApi.proxyLogs).mockResolvedValue({ logs: [] } as never)
  vi.mocked(downloadLogsApi.list).mockResolvedValue({ logs: [] } as never)
  vi.mocked(adminApi.novelIndex).mockResolvedValue({ novels: [] } as never)
})
afterEach(cleanup)

describe('monitoring navigation', () => {
  it('旧任务、统计、审计链接保留查询上下文，显式 AI 子页优先于历史值', () => {
    expect(monitoringRedirect('jobs', '?novel=n')).toBe('/admin/tasks?novel=n&view=scrape')
    expect(monitoringRedirect('ai', '?sub=tasks&batch=b')).toBe('/admin/tasks?batch=b&view=ai')
    expect(monitoringRedirect('ai', '?sub=usage')).toBe('/admin/calls?view=ai')
    expect(monitoringRedirect('ai', '?sub=audit')).toBe('/admin/calls?view=ai')
    expect(monitoringRedirect('ai', '', 'tasks')).toBe('/admin/tasks?view=ai')
    expect(monitoringRedirect('ai', '?sub=writing', 'tasks')).toBeNull()
    expect(monitoringRedirect('calls', '?view=ai')).toBeNull()
  })

  it('抓取和下载视图只加载各自的数据，切换写入 URL', async () => {
    mount(<TaskCenterTab />, '/admin/tasks')
    await waitFor(() => expect(scrapeApi.jobs).toHaveBeenCalled())
    expect(downloadLogsApi.list).not.toHaveBeenCalled()
    fireEvent.mouseDown(screen.getByRole('tab', { name: '下载记录' }), { button: 0, ctrlKey: false })
    await waitFor(() => expect(downloadLogsApi.list).toHaveBeenCalled())
    expect(screen.getByTestId('location')).toHaveTextContent('view=downloads')
    expect(screen.queryByRole('heading', { name: '抓取任务' })).not.toBeInTheDocument()
  })

  it('AI 任务深链接直接显示任务面板', async () => {
    mount(<TaskCenterTab />, '/admin/tasks?view=ai')
    await waitFor(() => expect(aiApi.tasks).toHaveBeenCalled())
    expect(scrapeApi.jobs).not.toHaveBeenCalled()
    expect(screen.getByRole('tab', { name: 'AI 任务' })).toHaveAttribute('aria-selected', 'true')
  })

  it('AI 与抓取任务首次读取失败复用同一空态，摘要显示原因且不重复重试入口', async () => {
    vi.mocked(aiApi.tasks).mockRejectedValue(new Error('需要管理员登录'))
    vi.mocked(scrapeApi.jobs).mockRejectedValue(new Error('需要管理员登录'))
    mount(<TaskCenterTab />, '/admin/tasks?view=ai')
    const aiError = await screen.findByRole('alert')
    expect(aiError).toHaveClass('admin-read-error', 'admin-empty-state')
    expect(aiError).toHaveTextContent('AI 任务加载失败：需要管理员登录')
    expect(screen.getByText('需要管理员登录', { selector: '.task-workspace-summary p' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^重试$/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^刷新$/ })).toBeEnabled()

    fireEvent.mouseDown(screen.getByRole('tab', { name: '抓取任务' }))
    fireEvent.click(screen.getByRole('tab', { name: '抓取任务' }))
    const scrapeError = await screen.findByRole('alert')
    expect(scrapeError).toHaveClass('admin-read-error', 'admin-empty-state')
    expect(scrapeError).toHaveTextContent('任务队列加载失败：需要管理员登录')
  })

  it('下载记录读取失败展示原因，不显示正常摘要', async () => {
    vi.mocked(downloadLogsApi.list).mockRejectedValueOnce(new Error('需要管理员登录'))
    mount(<TaskCenterTab />, '/admin/tasks?view=downloads')
    expect(await screen.findByRole('alert')).toHaveTextContent('下载日志加载失败：需要管理员登录')
    expect(screen.getByRole('heading', { name: '下载日志读取失败' })).toBeInTheDocument()
    expect(screen.getByText('需要管理员登录', { selector: '.task-workspace-summary p' })).toBeInTheDocument()
  })

  it('用量趋势与调用明细共享时间范围，切换后重置分页', async () => {
    mount(<CallsTab />, '/admin/calls?days=7')
    await waitFor(() => expect(aiApi.audit.calls).toHaveBeenCalled())
    expect(aiApi.audit.trend).toHaveBeenLastCalledWith(7)
    const first = vi.mocked(aiApi.audit.calls).mock.calls.at(-1)![0]!
    expect(first.from).toBeGreaterThan(Date.now() - 8 * 86_400_000)
    fireEvent.click(screen.getByRole('button', { name: '90 天' }))
    await waitFor(() => expect(aiApi.audit.trend).toHaveBeenLastCalledWith(90))
    const next = vi.mocked(aiApi.audit.calls).mock.calls.at(-1)![0]!
    expect(next.from).toBeLessThan(first.from!)
    expect(next.offset).toBe(0)
    expect(screen.getByTestId('location')).toHaveTextContent('days=90')
  })

  it('出站请求失败可刷新恢复，并且不加载 AI 用量', async () => {
    vi.mocked(scrapeApi.proxyLogs).mockRejectedValueOnce(new Error('请求失败'))
    mount(<CallsTab />, '/admin/calls?view=outbound')
    expect(await screen.findByRole('alert')).toHaveClass('admin-read-error')
    expect(screen.queryByText('暂无出站请求记录')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '刷新日志' }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(aiApi.audit.calls).not.toHaveBeenCalled()
    expect(scrapeApi.proxyLogs).toHaveBeenLastCalledWith(100)
  })

  it('用量首次读取失败不显示零读数，面板刷新恢复两张趋势', async () => {
    vi.mocked(aiApi.audit.trend).mockRejectedValueOnce(new Error('需要管理员登录'))
    mount(<CallsTab />, '/admin/calls?days=30')
    await screen.findByText('用量趋势加载失败：需要管理员登录')
    expect(screen.queryByText('总调用')).not.toBeInTheDocument()
    expect(screen.queryByText('总 Token')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^重试$/ })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '刷新用量趋势' }))
    await waitFor(() => expect(screen.queryByText('用量趋势加载失败：需要管理员登录')).not.toBeInTheDocument())
    expect(screen.queryByText('用量统计加载失败：需要管理员登录')).not.toBeInTheDocument()
    expect(aiApi.audit.trend).toHaveBeenCalledTimes(2)
  })

  it('调用记录刷新失败保留已有记录，刷新只读取明细', async () => {
    vi.mocked(aiApi.audit.calls).mockResolvedValue({
      calls: [
        {
          id: 'call-1',
          type: 'continue',
          displayName: '林舟',
          novelTitle: '长风渡月',
          promptTokens: 1200,
          completionTokens: 300,
          imageCount: 0,
          costMillicents: 200,
          createdAt: Date.now(),
        },
      ],
      total: 81,
    } as never)
    mount(<CallsTab />, '/admin/calls')
    await screen.findByText('长风渡月')
    expect(screen.getByText('共 81 条')).toBeInTheDocument()
    vi.mocked(aiApi.audit.calls).mockRejectedValueOnce(new Error('网络超时'))
    fireEvent.click(screen.getByRole('button', { name: '刷新调用记录' }))
    await screen.findByText('网络超时')
    expect(screen.getByText('长风渡月')).toBeInTheDocument()
    expect(aiApi.audit.calls).toHaveBeenCalledTimes(2)
    expect(aiApi.audit.trend).toHaveBeenCalledTimes(1)
  })
  it('抓取详情中的终止保留确认与真实请求，数值零不被旧章节数替代', async () => {
    vi.mocked(scrapeApi.jobs).mockResolvedValue({
      jobs: [{ id: 'job-running', status: 'scraping_chapters', current: 0, total: 10, successCount: 0, chapterCount: 99 }],
    } as never)
    mount(<TaskCenterTab />, '/admin/tasks')
    await screen.findByText(/成功 0/)
    fireEvent.click(screen.getByRole('button', { name: '详情' }))
    fireEvent.click(screen.getByRole('button', { name: '终止任务' }))
    await waitFor(() => expect(authFetch).toHaveBeenCalled())
    expect(feedback.confirm).toHaveBeenCalledWith(expect.objectContaining({ danger: true, items: ['job-running'] }))
    expect(JSON.parse(vi.mocked(authFetch).mock.calls[0]![1]!.body as string)).toMatchObject({
      action: 'cancel',
      jobId: 'job-running',
      operationId: 'test-operation',
    })
  })

  it('AI 详情删除仍保留审计与草稿提示，Prompt 入口保持完整文本', async () => {
    vi.mocked(aiApi.tasks).mockResolvedValue({
      items: [
        {
          id: 'task-failed',
          kind: 'write_chapter',
          status: 'failed',
          novelTitle: '测试作品',
          current: 0,
          total: 1,
          prompt: '完整输入内容',
          params: '{}',
          error: '网络超时',
          step: '',
          result: '',
          createdAt: 1,
        },
      ],
      total: 1,
      counts: { all: 1, failed: 1 },
    } as never)
    vi.mocked(aiApi.deleteTask).mockResolvedValue({} as never)
    mount(<TaskCenterTab />, '/admin/tasks?view=ai')
    fireEvent.click(await screen.findByRole('button', { name: '查看输入' }))
    expect(screen.getByText('完整输入内容')).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '详情' }))
    fireEvent.click(screen.getByRole('button', { name: '删除记录' }))
    await waitFor(() => expect(aiApi.deleteTask).toHaveBeenCalledWith('task-failed'))
    expect(feedback.confirm).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('用量审计') }))
  })

  it('AI 外置筛选仍传递独立的排队状态并回到首页', async () => {
    mount(<TaskCenterTab />, '/admin/tasks?view=ai')
    await waitFor(() => expect(aiApi.tasks).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: '排队中' }))
    await waitFor(() => expect(aiApi.tasks).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'queued', offset: 0, limit: 15 })))
  })
})
