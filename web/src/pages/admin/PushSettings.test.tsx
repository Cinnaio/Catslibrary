import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import type { PushAdminSettings } from '@shared/push-settings'
const mocks = vi.hoisted(() => ({ request: vi.fn(), toast: vi.fn(), confirm: vi.fn() }))
vi.mock('@/lib/api', () => ({ request: mocks.request }))
vi.mock('@/components/feedback', () => ({ useToast: () => ({ toast: mocks.toast }), useConfirm: () => ({ confirm: mocks.confirm }) }))
import PushSettings from './PushSettings'
const saved: PushAdminSettings = {
  revision: 1,
  source: 'local',
  enabled: true,
  configured: true,
  subject: 'mailto:owner@example.com',
  publicKey: 'B'.repeat(87),
  privateKeySet: true,
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.request.mockResolvedValue(saved)
  mocks.confirm.mockResolvedValue(true)
})
async function show(value = saved) {
  mocks.request.mockResolvedValueOnce(value)
  render(
    <MemoryRouter>
      <PushSettings />
    </MemoryRouter>,
  )
  await screen.findByLabelText('联系邮箱或地址')
}
async function select(label: string) {
  fireEvent.click(screen.getByRole('combobox', { name: 'VAPID 密钥' }))
  fireEvent.click(await screen.findByRole('option', { name: label }))
}
it('generates and saves using an ordinary email without receiving a private key', async () => {
  await show({ ...saved, revision: 0, source: 'environment', configured: false, publicKey: '', privateKeySet: false, subject: '' })
  fireEvent.change(screen.getByLabelText('联系邮箱或地址'), { target: { value: 'owner@example.com' } })
  fireEvent.click(screen.getByRole('button', { name: '生成并保存' }))
  await waitFor(() =>
    expect(mocks.request).toHaveBeenCalledWith(
      'PUT',
      '/admin/site-settings/push',
      expect.objectContaining({ subject: 'mailto:owner@example.com', keyAction: 'generate', revision: 0, privateKey: undefined }),
      true,
    ),
  )
  await waitFor(() => expect(screen.queryByRole('button', { name: '生成并保存' })).not.toBeInTheDocument())
  expect(screen.getByLabelText('当前公钥')).toHaveValue(saved.publicKey)
  expect(screen.getByRole('link', { name: '打开消息中心' })).toHaveAttribute('href', '/messages?settings=1')
})
it('keeps failed imports as drafts and clears the private key only after a successful save', async () => {
  await show()
  await select('导入现有密钥')
  fireEvent.change(screen.getByLabelText('导入公钥'), { target: { value: saved.publicKey } })
  fireEvent.change(screen.getByLabelText('导入私钥'), { target: { value: 'A'.repeat(43) } })
  mocks.request.mockRejectedValueOnce(new Error('配置已更新，请重新读取'))
  fireEvent.click(screen.getByRole('button', { name: '保存配置' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('配置已更新')
  expect(screen.getByLabelText('导入私钥')).toHaveValue('A'.repeat(43))
  mocks.request.mockResolvedValueOnce({ ...saved, revision: 2 })
  fireEvent.click(screen.getByRole('button', { name: '保存配置' }))
  await waitFor(() => expect(screen.queryByLabelText('导入私钥')).not.toBeInTheDocument())
})
it('requires rotation confirmation and cancels without sending a mutation', async () => {
  await show()
  await select('自动生成新密钥')
  mocks.confirm.mockResolvedValueOnce(false)
  fireEvent.click(screen.getByRole('button', { name: '生成并保存' }))
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalled())
  expect(mocks.request.mock.calls.filter((call) => call[0] === 'PUT')).toHaveLength(0)
  await waitFor(() => expect(screen.getByRole('button', { name: '生成并保存' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '生成并保存' }))
  await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('PUT', '/admin/site-settings/push', expect.objectContaining({ confirmRotation: true }), true))
})
it('retains the private key when editing contact and pausing delivery', async () => {
  await show()
  fireEvent.change(screen.getByLabelText('联系邮箱或地址'), { target: { value: 'new@example.com' } })
  fireEvent.click(screen.getByRole('checkbox', { name: '启用站点推送' }))
  fireEvent.click(screen.getByRole('button', { name: '保存配置' }))
  await waitFor(() =>
    expect(mocks.request).toHaveBeenCalledWith(
      'PUT',
      '/admin/site-settings/push',
      expect.objectContaining({ enabled: false, keyAction: 'keep', subject: 'mailto:new@example.com', privateKey: undefined }),
      true,
    ),
  )
  expect(mocks.confirm).not.toHaveBeenCalled()
})
