import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MailSettings as Settings } from '@shared/mail-settings'
const mock = vi.hoisted(() => ({ mailSettings: vi.fn(), saveMailSettings: vi.fn(), testMailConnection: vi.fn(), toast: vi.fn() }))
vi.mock('@/lib/api', () => ({ authApi: mock }))
vi.mock('@/components/feedback', () => ({ useToast: () => ({ toast: mock.toast }) }))
import MailSettings from './MailSettings'

const settings: Settings = { ready: true, mode: 'smtp', source: 'environment', revision: 0, host: 'smtp.example.test', port: 465,
  security: 'tls', username: 'user', passwordSet: true, from: 'Cat’s Library <account@example.test>', publicOrigin: 'https://reader.example.test' }
beforeEach(() => {
  vi.resetAllMocks()
  mock.mailSettings.mockResolvedValue({ ...settings })
})
async function show() { render(<MailSettings />); await screen.findByLabelText('SMTP 服务器') }

describe('邮件配置表单', () => {
  it('密码不回显，留空保存；修改时禁用测试和刷新，保存后清除密码草稿', async () => {
    await show()
    expect(screen.getByLabelText('SMTP 密码 / 授权码')).toHaveValue('')
    expect(screen.queryByRole('button', { name: '保存配置' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('发件身份'), { target: { value: 'new@example.test' } })
    expect(screen.getByRole('button', { name: '测试已保存的连接' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '刷新状态' })).toBeDisabled()
    mock.saveMailSettings.mockResolvedValue({ ...settings, from: 'new@example.test', source: 'local', revision: 1 })
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }))
    await waitFor(() => expect(mock.saveMailSettings).toHaveBeenCalledWith(expect.objectContaining({ revision: 0, password: '', clearPassword: false, from: 'new@example.test' })))
    await waitFor(() => expect(screen.queryByRole('button', { name: '保存配置' })).not.toBeInTheDocument())
    expect(screen.getByLabelText('SMTP 密码 / 授权码')).toHaveValue('')
  })
  it('冲突保留草稿，撤销读取最新修订；加载失败保留旧快照', async () => {
    await show()
    fireEvent.change(screen.getByLabelText('SMTP 服务器'), { target: { value: 'draft.example.test' } })
    mock.saveMailSettings.mockRejectedValueOnce(new Error('配置已更新'))
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('配置已更新')
    expect(screen.getByLabelText('SMTP 服务器')).toHaveValue('draft.example.test')
    mock.mailSettings.mockResolvedValueOnce({ ...settings, revision: 2, host: 'latest.example.test' })
    fireEvent.click(screen.getByRole('button', { name: '撤销' }))
    await waitFor(() => expect(screen.getByLabelText('SMTP 服务器')).toHaveValue('latest.example.test'))
    mock.mailSettings.mockRejectedValueOnce(new Error('网络失败'))
    fireEvent.click(screen.getByRole('button', { name: '刷新状态' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('网络失败')
    expect(screen.getByLabelText('SMTP 服务器')).toHaveValue('latest.example.test')
  })
  it('只测试已保存修订；清除密码为明确操作', async () => {
    await show()
    mock.testMailConnection.mockResolvedValue({ success: true, message: '连接通过，未发送邮件' })
    fireEvent.click(screen.getByRole('button', { name: '测试已保存的连接' }))
    expect(await screen.findByText('连接通过，未发送邮件')).toBeInTheDocument()
    expect(mock.testMailConnection).toHaveBeenCalledWith(0)
    fireEvent.click(screen.getByRole('button', { name: '刷新状态' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '刷新状态' })).toBeEnabled())
    expect(screen.queryByText('连接通过，未发送邮件')).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('清除已保存密码'))
    expect(screen.getByLabelText('SMTP 密码 / 授权码')).toBeDisabled()
    expect(screen.queryByText('连接通过，未发送邮件')).not.toBeInTheDocument()
  })
  it('隐藏分区保留草稿并收起保存条，有修改时刷新页面触发离开提示', async () => {
    const view = render(<MailSettings />)
    await screen.findByLabelText('SMTP 服务器')
    fireEvent.change(screen.getByLabelText('SMTP 服务器'), { target: { value: 'draft.example.test' } })
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    view.rerender(<MailSettings active={false} />)
    expect(screen.queryByRole('button', { name: '保存配置' })).not.toBeInTheDocument()
    view.rerender(<MailSettings active />)
    expect(screen.getByLabelText('SMTP 服务器')).toHaveValue('draft.example.test')
  })
})
