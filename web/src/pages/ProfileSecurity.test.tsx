import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { User } from '@shared/types'

const mock = vi.hoisted(() => ({
  sessions: vi.fn(), passkeyConfig: vi.fn(), passkeys: vi.fn(), mailStatus: vi.fn(), requestEmail: vi.fn(),
  changePassword: vi.fn(), registerPasskey: vi.fn(), renamePasskey: vi.fn(), deletePasskey: vi.fn(),
  refresh: vi.fn(), confirm: vi.fn(),
}))
const reader: User = { id: 'reader', username: 'reader', displayName: '读者', role: 'reader', status: 'active',
  email: '', emailVerified: false, bio: '', avatarUrl: '', createdAt: 1, updatedAt: 1, lastLoginAt: 1 }
vi.mock('@/lib/api', () => ({ authApi: mock, url: (value: string) => value }))
vi.mock('@/context/SessionContext', () => ({ useSession: () => ({ user: reader, loading: false, refresh: mock.refresh }) }))
vi.mock('@/context/ContentPolicyContext', () => ({ useContentPolicy: () => ({ safeMode: true }) }))
vi.mock('@/components/feedback', () => ({ useConfirm: () => ({ confirm: mock.confirm }) }))
vi.mock('@/components/ReadingDataPanel', () => ({ ReadingDataPanel: () => null }))
vi.mock('@/components/ReadingStatsPanel', () => ({ ReadingStatsPanel: () => null }))
import Profile from './Profile'

const credential = { id: 'key-one', name: '我的电脑', deviceName: 'Windows · Chrome', createdAt: 1, lastUsedAt: 0 }
beforeEach(() => {
  vi.resetAllMocks()
  mock.sessions.mockResolvedValue({ sessions: [] })
  mock.passkeyConfig.mockResolvedValue({ enabled: true, registrationEnabled: true, configured: true })
  mock.passkeys.mockResolvedValue({ passkeys: [credential] })
  mock.mailStatus.mockResolvedValue({ ready: true })
  mock.refresh.mockResolvedValue(undefined)
  mock.confirm.mockResolvedValue(true)
})
async function show() {
  render(<MemoryRouter initialEntries={['/profile?tab=security']}><Profile /></MemoryRouter>)
  await screen.findByText('我的电脑')
}
const region = (name: string) => within(screen.getByRole('region', { name }))

describe('账户安全卡片', () => {
  it('修改密码提交期间锁定操作，重复提交被拦截，完成后清空输入', async () => {
    await show()
    const password = region('修改密码')
    const user = userEvent.setup()
    await user.type(password.getByLabelText('当前密码'), 'current-fixture')
    await user.type(password.getByLabelText('新密码'), 'New-fixture-123')
    let resolve!: () => void
    mock.changePassword.mockImplementation(() => new Promise<void>(done => { resolve = done }))
    await user.click(password.getByRole('button', { name: '保存新密码' }))
    expect(password.getByRole('button', { name: '保存中…' })).toBeDisabled()
    expect(password.getByLabelText('当前密码')).toBeDisabled()
    fireEvent.submit(password.getByLabelText('新密码').closest('form')!)
    expect(mock.changePassword).toHaveBeenCalledTimes(1)
    resolve()
    await waitFor(() => expect(password.getByRole('button', { name: '保存新密码' })).toBeEnabled())
    expect(mock.changePassword).toHaveBeenCalledWith('current-fixture', 'New-fixture-123')
    expect(password.getByLabelText('新密码')).toHaveValue('')
  })
  it('邮箱绑定失败保留草稿，重试后只清空密码并展示服务端结果', async () => {
    await show()
    const email = region('邮箱与密码找回')
    const user = userEvent.setup()
    await user.type(email.getByLabelText('邮箱地址'), 'reader@example.test')
    await user.type(email.getByLabelText('当前密码'), 'current-fixture')
    mock.requestEmail.mockRejectedValueOnce(new Error('邮件暂时发送失败'))
    await user.click(email.getByRole('button', { name: '发送验证邮件' }))
    expect(await email.findByRole('alert')).toHaveTextContent('邮件暂时发送失败')
    expect(email.getByLabelText('当前密码')).toHaveValue('current-fixture')
    mock.requestEmail.mockResolvedValueOnce({ message: '验证邮件已发送，请查收。' })
    await user.click(email.getByRole('button', { name: '发送验证邮件' }))
    expect(await email.findByRole('status')).toHaveTextContent('验证邮件已发送')
    expect(email.getByLabelText('当前密码')).toHaveValue('')
    expect(email.getByLabelText('邮箱地址')).toHaveValue('reader@example.test')
  })
  it('通行密钥保留改名和移除，新增表单按需展开，注册后恢复入口焦点', async () => {
    await show()
    const keys = region('Passkey')
    const user = userEvent.setup()
    const toggle = keys.getByRole('button', { name: '添加通行密钥' })
    expect(keys.getByLabelText('设备名称')).not.toBeVisible()
    await user.click(keys.getByRole('button', { name: '改名' }))
    await user.clear(keys.getByRole('textbox', { name: 'Passkey 名称' }))
    await user.type(keys.getByRole('textbox', { name: 'Passkey 名称' }), '新设备名称')
    mock.renamePasskey.mockResolvedValueOnce({})
    await user.click(keys.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(mock.renamePasskey).toHaveBeenCalledWith('key-one', '新设备名称'))
    await waitFor(() => expect(keys.getByRole('button', { name: '移除' })).toBeEnabled())
    mock.deletePasskey.mockResolvedValueOnce({ success: true })
    await user.click(keys.getByRole('button', { name: '移除' }))
    await waitFor(() => expect(mock.deletePasskey).toHaveBeenCalledWith('key-one'))
    expect(mock.confirm).toHaveBeenCalled()
    await user.click(toggle)
    await user.type(keys.getByLabelText('当前密码'), 'current-fixture')
    await user.type(keys.getByLabelText('设备名称'), '阅读设备')
    mock.registerPasskey.mockResolvedValueOnce({})
    await user.click(keys.getByRole('button', { name: '注册 Passkey' }))
    await waitFor(() => expect(mock.registerPasskey).toHaveBeenCalledWith('current-fixture', '阅读设备'))
    await waitFor(() => expect(keys.queryByRole('button', { name: '注册 Passkey' })).not.toBeInTheDocument())
    expect(toggle).toHaveFocus()
  })
  it('通行密钥读取失败不伪装为空列表，重试可恢复；站点关闭新增时保留管理', async () => {
    mock.passkeys.mockRejectedValueOnce(new Error('offline'))
    mock.passkeyConfig.mockResolvedValueOnce({ enabled: true, registrationEnabled: false, configured: true })
    render(<MemoryRouter initialEntries={['/profile?tab=security']}><Profile /></MemoryRouter>)
    const keys = within(await screen.findByRole('region', { name: 'Passkey' }))
    expect(await keys.findByRole('alert')).toHaveTextContent('读取失败')
    expect(keys.queryByText('尚未添加通行密钥。')).not.toBeInTheDocument()
    await userEvent.click(keys.getByRole('button', { name: '重试' }))
    await keys.findByText('我的电脑')
    expect(keys.queryByRole('button', { name: '添加通行密钥' })).not.toBeInTheDocument()
    expect(keys.getByText(/管理员暂时关闭/)).toBeInTheDocument()
    expect(keys.getByRole('button', { name: '改名' })).toBeEnabled()
  })
})
