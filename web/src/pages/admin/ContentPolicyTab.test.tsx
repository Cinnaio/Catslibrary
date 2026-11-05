import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ settings: vi.fn(), update: vi.fn(), confirm: vi.fn(), toast: vi.fn(), refresh: vi.fn() }))
vi.mock('@/lib/api', () => ({ adminApi: { contentPolicy: { settings: mocks.settings, update: mocks.update } } }))
vi.mock('@/components/feedback', () => ({ useToast: () => ({ toast: mocks.toast }), useConfirm: () => ({ confirm: mocks.confirm }) }))
vi.mock('@/context/ContentPolicyContext', () => ({ useContentPolicy: () => ({ refreshPolicy: mocks.refresh }) }))
import ContentPolicyTab from './ContentPolicyTab'

beforeEach(() => {
  vi.resetAllMocks()
  mocks.refresh.mockResolvedValue(undefined)
})

function renderPolicy() {
  return render(<MemoryRouter initialEntries={['/admin/site-settings?view=content-policy']}><ContentPolicyTab /></MemoryRouter>)
}

it('首次读取失败不显示关闭状态，重试后显示服务端真实设置', async () => {
  mocks.settings.mockRejectedValueOnce(new Error('连接失败')).mockResolvedValueOnce({ adultContentEnabled: true, turnstileConfigured: false })
  renderPolicy()
  await screen.findByRole('alert')
  expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  expect(screen.queryByText(/已关闭成人模式入口/)).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: '重试' }))
  expect(await screen.findByRole('switch')).toBeChecked()
  expect(screen.getByText(/新的解锁请求暂无法通过/)).toBeInTheDocument()
})

it('保存失败保留原开关状态，不误报已保存或同步阅读模式', async () => {
  mocks.settings.mockResolvedValue({ adultContentEnabled: false, turnstileConfigured: true })
  mocks.update.mockRejectedValue(new Error('保存连接失败'))
  renderPolicy()
  await userEvent.click(await screen.findByRole('switch'))
  await screen.findByRole('alert')
  expect(screen.getByRole('switch')).not.toBeChecked()
  expect(screen.queryByText('已保存')).not.toBeInTheDocument()
  expect(mocks.refresh).not.toHaveBeenCalled()
})

it('关闭确认期间禁用重复操作，取消后保留已开启状态', async () => {
  let finish!: (value: boolean) => void
  mocks.settings.mockResolvedValue({ adultContentEnabled: true, turnstileConfigured: false })
  mocks.confirm.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  renderPolicy()
  const control = await screen.findByRole('switch')
  await userEvent.click(control)
  expect(control).toBeDisabled()
  await userEvent.click(control)
  expect(mocks.confirm).toHaveBeenCalledTimes(1)
  finish(false)
  await waitFor(() => expect(control).not.toBeDisabled())
  expect(control).toBeChecked()
  expect(mocks.update).not.toHaveBeenCalled()
})

it('保存仅回传开关时保留验证配置，成功后同步阅读模式', async () => {
  mocks.settings.mockResolvedValue({ adultContentEnabled: false, turnstileConfigured: true })
  mocks.update.mockResolvedValue({ adultContentEnabled: true })
  renderPolicy()
  await screen.findByRole('switch')
  await userEvent.click(screen.getByText('允许读者切换成人内容模式'))
  await screen.findByText('已保存')
  expect(screen.getByRole('switch')).toBeChecked()
  expect(screen.getByText('已配置')).toBeInTheDocument()
  expect(mocks.refresh).toHaveBeenCalledTimes(1)
})

it('接口缺少验证配置状态时明确显示未确认，不推断为未配置', async () => {
  mocks.settings.mockResolvedValue({ adultContentEnabled: true })
  renderPolicy()
  await screen.findByRole('switch')
  expect(screen.getByText('状态未确认')).toBeInTheDocument()
  expect(screen.queryByText('未配置')).not.toBeInTheDocument()
})
