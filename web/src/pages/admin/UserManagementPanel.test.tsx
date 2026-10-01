import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ directory: vi.fn(), setPassword: vi.fn(), changePassword: vi.fn(), toast: vi.fn() }))
vi.mock('@/lib/api', () => ({
  adminApi: { users: { directory: mocks.directory, setPassword: mocks.setPassword } },
  authApi: { changePassword: mocks.changePassword },
}))
vi.mock('@/components/feedback', () => ({ useToast: () => ({ toast: mocks.toast }) }))
import UserManagementPanel from './UserManagementPanel'
const users = [
  { id: 'self', username: 'admin', displayName: '管理员', role: 'admin', status: 'active', createdAt: 1, updatedAt: 1, lastLoginAt: 0, bio: '', avatarUrl: '' },
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
    avatarUrl: '',
  },
]
function mount(search = '') {
  return render(<UserManagementPanel search={search} selfId="self" onRole={vi.fn()} onStatus={vi.fn()} onReset={vi.fn()} onDelete={vi.fn()} />)
}
function fill(element: HTMLElement, value: string) {
  fireEvent.change(element, { target: { value } })
}
async function openReader() {
  await userEvent.click(await screen.findByRole('button', { name: '修改密码' }))
  return within(screen.getByRole('dialog'))
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.directory.mockResolvedValue({ users, total: 22 })
  mocks.setPassword.mockResolvedValue({ success: true })
  mocks.changePassword.mockResolvedValue({ token: 'new-token' })
})
describe('用户目录与直接修改密码', () => {
  it('校验短密码和确认不一致，保存成功后关闭并清空表单', async () => {
    mount()
    const dialog = await openReader()
    await userEvent.click(dialog.getByRole('button', { name: '保存新密码' }))
    expect(dialog.getByRole('alert')).toHaveTextContent('至少需要 8 位')
    fill(dialog.getByLabelText('新密码', { exact: true }), 'Reader-new-123')
    fill(dialog.getByLabelText('确认新密码'), 'different')
    await userEvent.click(dialog.getByRole('button', { name: '保存新密码' }))
    expect(dialog.getByRole('alert')).toHaveTextContent('不一致')
    expect(mocks.setPassword).not.toHaveBeenCalled()
    await userEvent.clear(dialog.getByLabelText('确认新密码'))
    fill(dialog.getByLabelText('确认新密码'), 'Reader-new-123')
    await userEvent.click(dialog.getByRole('button', { name: '保存新密码' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.setPassword).toHaveBeenCalledWith('reader', 'Reader-new-123')
    expect((await openReader()).getByLabelText('新密码', { exact: true })).toHaveValue('')
  })
  it('保存期间防止重复提交和关闭，失败后保留表单可重试', async () => {
    let reject!: (error: Error) => void
    mocks.setPassword.mockImplementationOnce(
      () =>
        new Promise((_, rejectPromise) => {
          reject = rejectPromise
        }),
    )
    mount()
    const dialog = await openReader()
    fill(dialog.getByLabelText('新密码', { exact: true }), 'Reader-new-123')
    fill(dialog.getByLabelText('确认新密码'), 'Reader-new-123')
    await userEvent.click(dialog.getByRole('button', { name: '保存新密码' }))
    expect(dialog.getByRole('button', { name: '保存中…' })).toBeDisabled()
    expect(dialog.getByRole('button', { name: '取消' })).toBeDisabled()
    await userEvent.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    reject(new Error('请求失败'))
    await waitFor(() => expect(dialog.getByRole('alert')).toHaveTextContent('请求失败'))
    expect(dialog.getByLabelText('新密码', { exact: true })).toHaveValue('Reader-new-123')
    await userEvent.click(dialog.getByRole('button', { name: '保存新密码' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.setPassword).toHaveBeenCalledTimes(2)
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
    expect(mocks.setPassword).not.toHaveBeenCalled()
  })
  it('翻页使用服务端 offset，搜索回到第一页；刷新失败保留已有用户', async () => {
    const view = mount()
    await screen.findByText('测试读者')
    await userEvent.click(screen.getByRole('button', { name: '下一页' }))
    await waitFor(() => expect(mocks.directory).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 15, limit: 15 })))
    view.rerender(<UserManagementPanel search="reader" selfId="self" onRole={vi.fn()} onStatus={vi.fn()} onReset={vi.fn()} onDelete={vi.fn()} />)
    await waitFor(() => expect(mocks.directory).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'reader', offset: 0 })))
    await waitFor(() => expect(screen.getByRole('button', { name: '刷新' })).toBeEnabled())
    mocks.directory.mockRejectedValueOnce(new Error('目录请求失败'))
    await userEvent.click(screen.getByRole('button', { name: '刷新' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('保留上次读取的数据')
    expect(screen.getByText('测试读者')).toBeInTheDocument()
  })
})
