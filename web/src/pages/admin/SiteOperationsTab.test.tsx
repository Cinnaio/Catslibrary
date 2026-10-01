import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ traffic: vi.fn(), toast: vi.fn() }))
vi.mock('@/lib/api', () => ({ adminApi: { site: { traffic: mocks.traffic } } }))
vi.mock('@/components/feedback', () => ({ useToast: () => ({ toast: mocks.toast }) }))

import SiteOperationsTab from './SiteOperationsTab'

function RouteState() {
  return <output data-testid="operations-route">{useLocation().search}</output>
}

describe('站点运营保留流量分析', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mocks.traffic.mockResolvedValue({
      days: 7,
      timezone: 'Asia/Shanghai',
      generatedAt: Date.now(),
      current: { start: 0, end: Date.now(), pageViews: 42, visitors: 8, dailyTrend: [{ date: '2026-10-01', pageViews: 42, visitors: 8 }] },
      previous: { start: 0, end: 0, pageViews: 0, visitors: 0, dailyTrend: [{ date: '2026-09-24', pageViews: 0, visitors: 0 }] },
      countries: [],
      devices: [],
      sources: [],
      region: { unknownVisits: 42, knownVisits: 0, otherVisits: 0, coverage: 0 },
    })
  })

  it.each(['overview', 'content', 'traffic', 'missing', ''])('旧视图 %s 与历史记忆都进入流量分析', async (view) => {
    localStorage.setItem('site_operations_active_tab', JSON.stringify('content'))
    render(
      <MemoryRouter initialEntries={[`/admin/site-operations?origin=bookmark${view ? `&view=${view}` : ''}`]}>
        <SiteOperationsTab />
        <RouteState />
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.getByTestId('operations-route')).toHaveTextContent('origin=bookmark&view=traffic'))
    expect(screen.getByRole('heading', { name: '流量分析' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '访问地区' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '设备构成' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '访问来源' })).toBeInTheDocument()
    expect(await screen.findByText('42 PV · 8 UV')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '运营概览' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '内容分析' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '保存公告' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '导出 CSV' })).toBeEnabled()
  })

  it('保留流量数据刷新', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <SiteOperationsTab />
      </MemoryRouter>,
    )
    await screen.findByText('42 PV · 8 UV')
    await user.click(screen.getByRole('button', { name: '刷新' }))
    await waitFor(() => expect(mocks.traffic).toHaveBeenCalledTimes(2))
  })

  it('统一时间范围传给接口并保留其他 URL 参数', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/admin/site-operations?view=traffic&origin=bookmark']}>
        <SiteOperationsTab />
        <RouteState />
      </MemoryRouter>,
    )
    await screen.findByText('42 PV · 8 UV')
    await user.click(screen.getByRole('button', { name: '近 30 日' }))
    await waitFor(() => expect(mocks.traffic).toHaveBeenLastCalledWith(30))
    expect(screen.getByTestId('operations-route')).toHaveTextContent('origin=bookmark&days=30')
    expect(screen.queryByText('42 PV · 8 UV')).not.toBeInTheDocument()
  })

  it('刷新失败保留本期数据并提供重试', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <SiteOperationsTab />
      </MemoryRouter>,
    )
    await screen.findByText('42 PV · 8 UV')
    mocks.traffic.mockRejectedValueOnce(new Error('网络暂不可用'))
    await user.click(screen.getByRole('button', { name: '刷新' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('当前保留上次成功加载的数据')
    expect(screen.getByText('42 PV · 8 UV')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })

  it('未识别地区仍占全部访问，可打开真实统计详情', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <SiteOperationsTab />
      </MemoryRouter>,
    )
    await screen.findByText('42 PV · 8 UV')
    expect(screen.getByText('地区未识别')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /未识别地区.*100.0%/ }))
    expect(screen.getByRole('dialog')).toHaveTextContent('占全部浏览量 100.0%')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: '对比上一周期' }))
    expect(screen.getAllByText(/较上期 上期无访问/)).toHaveLength(2)
  })

  it('导出 CSV 触发带中文表头的真实文件下载', async () => {
    const user = userEvent.setup()
    const create = vi.fn((_blob: Blob) => 'blob:test-traffic')
    const revoke = vi.fn()
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(
      <MemoryRouter>
        <SiteOperationsTab />
      </MemoryRouter>,
    )
    await screen.findByText('42 PV · 8 UV')
    await user.click(screen.getByRole('button', { name: '导出 CSV' }))
    expect(create).toHaveBeenCalledOnce()
    expect(create.mock.calls[0]?.[0]).toBeInstanceOf(Blob)
    expect(click).toHaveBeenCalledOnce()
    click.mockRestore()
    vi.unstubAllGlobals()
  })

  it('零访问时禁用导出，识别率显示零且保留明细', async () => {
    const result = await mocks.traffic()
    result.current.pageViews = 0
    result.current.visitors = 0
    result.current.dailyTrend[0] = { date: '2026-10-01', pageViews: 0, visitors: 0 }
    result.region.unknownVisits = 0
    mocks.traffic.mockResolvedValue(result)
    render(
      <MemoryRouter>
        <SiteOperationsTab />
      </MemoryRouter>,
    )
    await screen.findByText('0 PV · 0 UV')
    expect(screen.getByRole('button', { name: '导出 CSV' })).toBeDisabled()
    expect(screen.getByText('识别率 0.0%')).toBeInTheDocument()
    expect(screen.queryByText('地区未识别')).not.toBeInTheDocument()
  })

  it('快速切换范围时迟到的旧响应不能覆盖新范围', async () => {
    const user = userEvent.setup()
    const result = await mocks.traffic()
    let resolveOld!: (value: typeof result) => void
    mocks.traffic.mockImplementation((days: number) =>
      days === 30
        ? new Promise((resolve) => {
            resolveOld = resolve
          })
        : Promise.resolve({ ...result, days, current: { ...result.current, pageViews: days === 90 ? 90 : 42 } }),
    )
    render(
      <MemoryRouter>
        <SiteOperationsTab />
      </MemoryRouter>,
    )
    await screen.findByText('42 PV · 8 UV')
    await user.click(screen.getByRole('button', { name: '近 30 日' }))
    await user.click(screen.getByRole('button', { name: '近 90 日' }))
    await screen.findByText('90 PV · 8 UV')
    resolveOld({ ...result, days: 30 })
    await waitFor(() => expect(screen.getByText('90 PV · 8 UV')).toBeInTheDocument())
    expect(screen.queryByText('42 PV · 8 UV')).not.toBeInTheDocument()
  })
})
