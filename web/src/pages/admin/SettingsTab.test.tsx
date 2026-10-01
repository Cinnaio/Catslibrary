import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  login: vi.fn(),
  operations: vi.fn(),
  save: vi.fn(),
  disable: vi.fn(),
  clear: vi.fn(),
  confirm: vi.fn(),
  toast: vi.fn(),
  me: vi.fn(),
}))
vi.mock('@/lib/api', () => ({
  adminApi: {
    users: { list: mocks.list, loginAudit: mocks.login, setRegisterMode: mocks.save, disableInvite: mocks.disable, clearInvites: mocks.clear },
    operationAudit: { list: mocks.operations },
  },
  authApi: { me: mocks.me },
  newOperationId: () => 'cleanup-operation',
}))
vi.mock('@/components/feedback', () => ({ useToast: () => ({ toast: mocks.toast }), useConfirm: () => ({ confirm: mocks.confirm }) }))
import SettingsTab from './SettingsTab'
const invites = Array.from({ length: 18 }, (_, i) => ({
  code: `INVITE-${i}`,
  createdAt: 1790820000000,
  usedAt: i === 16 ? 1 : 0,
  disabledAt: i === 17 ? 1 : 0,
  usedBy: '',
  usedByName: '',
}))
function mount(view = 'registration') {
  return render(
    <MemoryRouter initialEntries={[`/admin/settings?view=${view}`]}>
      <SettingsTab />
    </MemoryRouter>,
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  mocks.list.mockResolvedValue({ settings: { registerMode: 'invite' }, invites, users: [] })
  mocks.me.mockResolvedValue({ user: { id: 'self', username: 'admin', displayName: '管理员', role: 'admin' } })
  mocks.login.mockResolvedValue({ audits: [], total: 0 })
  mocks.operations.mockResolvedValue({ operations: [], total: 0 })
  mocks.save.mockResolvedValue({ success: true })
  mocks.confirm.mockResolvedValue(false)
  mocks.clear.mockResolvedValue({ removed: 2 })
})
describe('账户剩余页面接入', () => {
  it('注册设置仅保存有变化的草稿，并更新生效方式', async () => {
    mount()
    await waitFor(() => expect(screen.getByRole('radio', { name: '开放注册 任何人都可以注册' })).toBeEnabled())
    expect(screen.getByRole('button', { name: '保存设置' })).toBeDisabled()
    await userEvent.click(screen.getByRole('radio', { name: '开放注册 任何人都可以注册' }))
    await userEvent.click(screen.getByRole('button', { name: '保存设置' }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith('open'))
    await waitFor(() => expect(screen.getByText('当前：开放注册')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: '保存设置' })).toBeDisabled()
  })
  it('邀请码搜索覆盖完整集合而非当前页，取消停用不发送请求', async () => {
    mount()
    await screen.findByText('INVITE-0')
    expect(screen.queryByText('INVITE-16')).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: '搜索邀请码' }), { target: { value: 'INVITE-16' } })
    expect(screen.getByText('INVITE-16')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: '搜索邀请码' }), { target: { value: 'INVITE-0' } })
    await userEvent.click(screen.getByRole('button', { name: '停用' }))
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: '停用邀请码', items: expect.arrayContaining(['INVITE-0']) }))
    expect(mocks.disable).not.toHaveBeenCalled()
  })
  it('清理使用全量失效记录的确认快照，保留可用邀请码', async () => {
    mocks.confirm.mockResolvedValue(true)
    mount()
    await screen.findByText('INVITE-0')
    fireEvent.change(screen.getByRole('textbox', { name: '搜索邀请码' }), { target: { value: 'INVITE-0' } })
    await userEvent.click(screen.getByRole('button', { name: '清理失效邀请码' }))
    await waitFor(() => expect(mocks.clear).toHaveBeenCalledWith(['INVITE-16', 'INVITE-17'], 'cleanup-operation'))
  })
  it('操作审计用户名搜索提交服务端并回到第一页', async () => {
    mount('operation-audit')
    await waitFor(() => expect(mocks.operations).toHaveBeenCalled())
    fireEvent.change(screen.getByRole('textbox', { name: '搜索操作用户名' }), { target: { value: 'admin_one' } })
    await waitFor(() => expect(mocks.operations).toHaveBeenLastCalledWith(expect.objectContaining({ username: 'admin_one', offset: 0, limit: 15 })))
  })
})
