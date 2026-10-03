import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SITE_BRANDING } from '@shared/site-settings'
import type { TurnstileSettings } from '@shared/site-settings'

const mock = vi.hoisted(() => ({
  branding: vi.fn(), turnstile: vi.fn(), saveBranding: vi.fn(), saveTurnstile: vi.fn(),
  upload: vi.fn(), resetAsset: vi.fn(), testTurnstile: vi.fn(), refreshPolicy: vi.fn(), toast: vi.fn(), confirm: vi.fn(),
}))
vi.mock('@/lib/api', () => ({ siteSettingsApi: mock, url: (path: string) => `/api${path}` }))
vi.mock('@/context/ContentPolicyContext', () => ({ useContentPolicy: () => ({ refreshPolicy: mock.refreshPolicy }) }))
vi.mock('@/components/feedback', () => ({ useToast: () => ({ toast: mock.toast }), useConfirm: () => ({ confirm: mock.confirm }) }))
vi.mock('@/components/TurnstileTestWidget', () => ({ default: ({ onToken }: { onToken: (token: string) => void }) => <button type="button" onClick={() => onToken('test-token')}>完成小组件</button> }))
import SiteSettingsTab from './SiteSettingsTab'

const settings: TurnstileSettings = { siteKey: 'public-key', hostnames: ['read.example.com'], secretSet: true, configured: true, encryptionReady: true, secretReadable: true, sources: { siteKey: 'database', secret: 'database', hostnames: 'database' } }
async function show(security = false) {
  render(<MemoryRouter initialEntries={[`/admin/site-settings?view=${security ? 'security' : 'branding'}`]}><SiteSettingsTab /></MemoryRouter>)
  await screen.findByRole('button', { name: '保存设置' })
}
beforeEach(() => {
  vi.resetAllMocks()
  mock.branding.mockResolvedValue({ ...DEFAULT_SITE_BRANDING })
  mock.turnstile.mockResolvedValue({ ...settings })
  mock.refreshPolicy.mockResolvedValue(undefined)
})
describe('SiteSettingsTab', () => {
  it('保存文字并更新预览；失败保留草稿', async () => {
    await show()
    const name = screen.getByLabelText('站点名称')
    expect(screen.getByRole('button', { name: '保存设置' })).toBeDisabled()
    fireEvent.change(name, { target: { value: '新书库' } })
    mock.saveBranding.mockRejectedValueOnce(new Error('网络失败'))
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('网络失败')
    expect(name).toHaveValue('新书库')
    mock.saveBranding.mockResolvedValueOnce({ ...DEFAULT_SITE_BRANDING, name: '新书库' })
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '保存设置' })).toBeDisabled())
    expect(mock.saveBranding).toHaveBeenLastCalledWith(expect.objectContaining({ name: '新书库' }))
  })
  it('图片立即更新但保留未保存的文字', async () => {
    await show()
    fireEvent.change(screen.getByLabelText('站点名称'), { target: { value: '未保存名称' } })
    mock.upload.mockResolvedValue({ ...DEFAULT_SITE_BRANDING, logoUrl: '/api/site-settings/assets/logo?v=fixture' })
    fireEvent.change(screen.getByLabelText('Logo'), { target: { files: [new File(['image'], 'logo.png', { type: 'image/png' })] } })
    await waitFor(() => expect(mock.upload).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByRole('button', { name: '保存设置' })).toBeEnabled())
    expect(screen.getByLabelText('站点名称')).toHaveValue('未保存名称')
    expect(mock.saveBranding).not.toHaveBeenCalled()
  })
  it('环境变量字段锁定，私钥不回显且未配置主密钥时不能输入', async () => {
    mock.turnstile.mockResolvedValue({ ...settings, encryptionReady: false, sources: { siteKey: 'environment', secret: 'environment', hostnames: 'environment' } })
    await show(true)
    expect(screen.getByLabelText('Site Key')).toBeDisabled()
    expect(screen.getByLabelText('Secret Key')).toBeDisabled()
    expect(screen.getByLabelText('Secret Key')).toHaveValue('')
    expect(screen.getByLabelText('允许验证的域名')).toBeDisabled()
  })
  it('私钥留空不替换，未保存修改禁止测试', async () => {
    mock.saveTurnstile.mockResolvedValue({ ...settings, hostnames: ['new.example.com'] })
    await show(true)
    fireEvent.change(screen.getByLabelText('允许验证的域名'), { target: { value: 'new.example.com' } })
    expect(screen.getByRole('button', { name: '开始 / 重新验证' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }))
    await waitFor(() => expect(mock.saveTurnstile).toHaveBeenCalledWith({ siteKey: 'public-key', hostnames: ['new.example.com'], clearSecret: false }))
    await waitFor(() => expect(screen.getByRole('button', { name: '开始 / 重新验证' })).toBeEnabled())
    expect(mock.refreshPolicy).toHaveBeenCalled()
  })
  it('测试仅消费组件 token，完成后清空 token', async () => {
    mock.testTurnstile.mockResolvedValue({ ok: true, message: '通过，不授予访问权' })
    await show(true)
    fireEvent.click(screen.getByRole('button', { name: '开始 / 重新验证' }))
    expect(screen.getByRole('button', { name: '检查服务端验证' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '完成小组件' }))
    fireEvent.click(screen.getByRole('button', { name: '检查服务端验证' }))
    expect(await screen.findByText('通过，不授予访问权')).toBeInTheDocument()
    expect(mock.testTurnstile).toHaveBeenCalledWith('test-token')
    expect(screen.getByRole('button', { name: '检查服务端验证' })).toBeDisabled()
  })
  it('加载失败提供重试', async () => {
    mock.branding.mockRejectedValueOnce(new Error('读取失败'))
    render(<MemoryRouter><SiteSettingsTab /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: '重新加载' }))
    await screen.findByLabelText('站点名称')
  })
})
