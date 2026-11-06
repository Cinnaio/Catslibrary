import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ directory: vi.fn(), mutateAccount: vi.fn(), changePassword: vi.fn(), toast: vi.fn() }))
vi.mock('@/lib/api', () => ({
  url: (path: string) => path,
  adminApi: { users: { directory: mocks.directory, mutateAccount: mocks.mutateAccount } },
  authApi: { changePassword: mocks.changePassword },
}))
vi.mock('@/components/feedback', () => ({ useToast: () => ({ toast: mocks.toast }) }))
import UserManagementPanel from './UserManagementPanel'
const users = [
  { id: 'self', username: 'admin', displayName: '管理员', role: 'super_admin', status: 'active', createdAt: 1, updatedAt: 1, lastLoginAt: 0, bio: '', avatarUrl: '' },
  {
    id: 'reader',
    username: 'reader',
    displayName: '测试读者',
    role: 'reader',
    status: 'active',
    createdAt: 1,
    updatedAt: 1,
    lastLoginAt: 0,
    bio: '',
    avatarUrl: '/api/avatars/reader.png',
    email: 'reader@example.test', emailVerified: true,
  },
]
function mount(search = '') {
  return render(<UserManagementPanel search={search} selfId="self" selfRole="super_admin" />)
}
function fill(element: HTMLElement, value: string) {
  fireEvent.change(element, { target: { value } })
}
async function openReader() {
  await userEvent.click(await screen.findByRole('button', { name: '更多操作：reader' }))
  await userEvent.click(screen.getByRole('menuitem', { name: '发送密码重置邮件' }))
  return within(screen.getByRole('dialog'))
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.directory.mockResolvedValue({ users, total: 22 })
  mocks.mutateAccount.mockResolvedValue({ success: true })
  mocks.changePassword.mockResolvedValue({ token: 'new-token' })
})
describe('用户目录与邮件密码管理', () => {
  it('发送邮件提交原因与目标快照，不展示或提交临时密码', async () => {
    mount()
    const dialog = await openReader()
    expect(dialog.getByRole('button', { name: '确认操作' })).toBeDisabled()
    fill(dialog.getByLabelText('操作原因'), '用户申请找回密码')
    await userEvent.click(dialog.getByRole('button', { name: '确认操作' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.mutateAccount).toHaveBeenCalledWith(users[1], 'reset-password', '用户申请找回密码', {})
    expect(screen.queryByText('临时密码')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: '更多操作：reader' })).toHaveFocus())
  })
  it('请求期间阻止重复提交和关闭，失败保留原因可重试', async () => {
    let reject!: (error: Error) => void
    mocks.mutateAccount.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail }))
    mount()
    const dialog = await openReader()
    fill(dialog.getByLabelText('操作原因'), '用户申请')
    await userEvent.click(dialog.getByRole('button', { name: '确认操作' }))
    expect(dialog.getByRole('button', { name: '处理中…' })).toBeDisabled()
    expect(dialog.getByRole('button', { name: '取消' })).toBeDisabled()
    await userEvent.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    reject(new Error('邮件发送失败'))
    await waitFor(() => expect(dialog.getByRole('alert')).toHaveTextContent('邮件发送失败'))
    expect(dialog.getByLabelText('操作原因')).toHaveValue('用户申请')
    await userEvent.click(dialog.getByRole('button', { name: '确认操作' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.mutateAccount).toHaveBeenCalledTimes(2)
  })
  it('普通管理员不能调整管理权或操作管理员', async () => {
    mocks.directory.mockResolvedValue({ users: [...users, { ...users[1], id: 'other', username: 'other', role: 'admin' }], total: 3 })
    render(<UserManagementPanel search="" selfId="self" selfRole="admin" />)
    await userEvent.click(await screen.findByRole('button', { name: '更多操作：reader' }))
    expect(screen.queryByRole('menuitem', { name: '调整角色' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '更多操作：other' })).not.toBeInTheDocument()
  })
  it('本人必须填写当前密码并使用已有认证接口', async () => {
    mount()
    await userEvent.click(await screen.findByRole('button', { name: '修改我的密码' }))
    const dialog = within(screen.getByRole('dialog'))
    await userEvent.click(dialog.getByRole('button', { name: '保存新密码' }))
    expect(dialog.getByRole('alert')).toHaveTextContent('请输入当前密码')
    fill(dialog.getByLabelText('当前密码'), 'Current-test-123')
    fill(dialog.getByLabelText('新密码', { exact: true }), 'Own-new-123')
    fill(dialog.getByLabelText('确认新密码'), 'Own-new-123')
    await userEvent.click(dialog.getByRole('button', { name: '保存新密码' }))
    await waitFor(() => expect(mocks.changePassword).toHaveBeenCalledWith('Current-test-123', 'Own-new-123'))
    expect(mocks.mutateAccount).not.toHaveBeenCalled()
  })
  it('翻页使用服务端 offset，搜索回到第一页；刷新失败保留已有用户', async () => {
    const view = mount()
    await screen.findByText('测试读者')
    await userEvent.click(screen.getByRole('button', { name: '下一页' }))
    await waitFor(() => expect(mocks.directory).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 15, limit: 15 })))
    view.rerender(<UserManagementPanel search="reader" selfId="self" selfRole="super_admin" />)
    await waitFor(() => expect(mocks.directory).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'reader', offset: 0 })))
    await waitFor(() => expect(screen.getByRole('button', { name: '刷新' })).toBeEnabled())
    mocks.directory.mockRejectedValueOnce(new Error('目录请求失败'))
    await userEvent.click(screen.getByRole('button', { name: '刷新' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('保留上次读取的数据')
    expect(screen.getByText('测试读者')).toBeInTheDocument()
  })
})
