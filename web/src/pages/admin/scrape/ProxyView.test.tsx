import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ProxyView from './ProxyView'

const mocks = vi.hoisted(() => ({
  proxyConfig: vi.fn(),
  saveProxyConfig: vi.fn(),
  proxyRoute: vi.fn(),
  testProxy: vi.fn(),
  toast: vi.fn(),
}))

vi.mock('@/lib/api', () => ({ scrapeApi: mocks }))
vi.mock('@/components/feedback', () => ({ useToast: () => ({ toast: mocks.toast }) }))

const runtimeConfig = {
  config: { proxyBase: 'http://127.0.0.1:7890', proxyBypass: 'localhost' },
  effective: { proxyBase: 'http://127.0.0.1:7890', proxyBypass: 'localhost' },
  noProxy: '',
  effectiveHost: '127.0.0.1:7890',
  configured: true,
  source: 'runtime',
}

async function loaded() {
  render(<ProxyView />)
  await waitFor(() => expect(screen.getByLabelText('代理地址')).toBeEnabled())
}

describe('代理设置的生效配置与诊断状态', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.proxyConfig.mockResolvedValue(runtimeConfig)
  })

  it('草稿修改不改变生效地址；保存环境覆盖配置后仍显示环境来源', async () => {
    const environment = { ...runtimeConfig, effective: { proxyBase: '', proxyBypass: '' }, effectiveHost: 'proxy.internal:7890', source: 'environment' }
    mocks.proxyConfig.mockResolvedValue(environment)
    mocks.saveProxyConfig.mockResolvedValue({ ...environment, config: { ...runtimeConfig.config, proxyBase: 'http://127.0.0.1:7891' } })
    await loaded()
    expect(screen.getByRole('button', { name: '保存配置' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('代理地址'), { target: { value: 'http://127.0.0.1:7891' } })
    expect(screen.getByText('proxy.internal:7890')).toBeInTheDocument()
    expect(screen.getByText('有未保存的修改')).toBeInTheDocument()
    expect(screen.getByText(/配置尚未保存/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }))
    await waitFor(() => expect(mocks.saveProxyConfig).toHaveBeenCalledWith({ proxyBase: 'http://127.0.0.1:7891', proxyBypass: 'localhost' }))
    expect(await screen.findByText('配置已保存；当前仍优先使用部署环境变量')).toBeInTheDocument()
    expect(screen.getByText('proxy.internal:7890')).toBeInTheDocument()
    expect(screen.getByText('来源：环境变量优先')).toBeInTheDocument()
    expect(screen.queryByText(/配置尚未保存/)).not.toBeInTheDocument()
  })

  it('未启用时允许检查路由，禁用强制代理连接测试', async () => {
    mocks.proxyConfig.mockResolvedValue({
      ...runtimeConfig,
      config: { proxyBase: '', proxyBypass: '' },
      effective: { proxyBase: '', proxyBypass: '' },
      effectiveHost: '',
      configured: false,
      source: 'none',
    })
    mocks.proxyRoute.mockResolvedValue({ usesProxy: false, bypassed: false, reason: '未配置代理，将直连' })
    await loaded()
    expect(screen.getByRole('button', { name: '测试代理连接' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '检查路由' }))
    expect(await screen.findByText('将直接连接')).toBeInTheDocument()
    expect(mocks.proxyRoute).toHaveBeenCalledWith('https://czbooks.net')
    expect(screen.queryByText('路由检查失败')).not.toBeInTheDocument()
  })

  it('跳过规则直连是中性结果；更换目标后清除旧结果', async () => {
    mocks.proxyRoute.mockResolvedValue({ usesProxy: false, bypassed: true, bypassRule: 'localhost' })
    await loaded()
    fireEvent.change(screen.getByLabelText('测试目标网址'), { target: { value: 'https://localhost' } })
    fireEvent.click(screen.getByRole('button', { name: '检查路由' }))
    expect(await screen.findByText('将直接连接')).toHaveClass('proxy-result-row__title--muted')
    expect(screen.getByText(/直连属于正常路由结果/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('测试目标网址'), { target: { value: 'https://example.com' } })
    expect(screen.queryByText('将直接连接')).not.toBeInTheDocument()
  })

  it('诊断期间锁定目标和配置；失败结束后恢复操作', async () => {
    let finish!: (value: { ok: boolean; error: string }) => void
    mocks.testProxy.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: '测试代理连接' }))
    expect(screen.getByLabelText('测试目标网址')).toBeDisabled()
    expect(screen.getByLabelText('代理地址')).toBeDisabled()
    expect(screen.getByRole('button', { name: '检查路由' })).toBeDisabled()
    finish({ ok: false, error: '目标 TLS 握手中断' })
    expect(await screen.findByText('代理请求失败')).toHaveClass('proxy-result-row__title--error')
    expect(screen.getByText('目标 TLS 握手中断')).toBeInTheDocument()
    expect(screen.getByLabelText('测试目标网址')).toBeEnabled()
  })

  it('读取失败时不把未知状态显示为直连；重新读取成功后恢复操作', async () => {
    mocks.proxyConfig.mockRejectedValueOnce(new Error('配置服务不可用')).mockResolvedValue(runtimeConfig)
    render(<ProxyView />)
    expect(await screen.findByText('配置服务不可用')).toBeInTheDocument()
    expect(screen.queryByText('未配置 · 出站请求直连')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '检查路由' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '重新读取' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '检查路由' })).toBeEnabled())
    expect(screen.getByText('http://127.0.0.1:7890')).toBeInTheDocument()
  })
})
