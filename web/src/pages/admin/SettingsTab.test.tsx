import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
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
  create: vi.fn(),
  directory: vi.fn(),
}))
vi.mock('@/lib/api', () => ({
  adminApi: {
    users: {
      list: mocks.list,
      directory: mocks.directory,
      loginAudit: mocks.login,
      createInvites: mocks.create,
      setRegisterMode: mocks.save,
      disableInvite: mocks.disable,
      clearInvites: mocks.clear,
    },
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
function LocationProbe() {
  const location = useLocation()
  const navigate = useNavigate()
  return (
    <>
      <output aria-label="当前地址">{location.search}</output>
      <button onClick={() => navigate(-1)}>返回上页</button>
    </>
  )
}
function mount(view = 'registration') {
  return render(
    <MemoryRouter initialEntries={[`/admin/settings?view=${view}`]}>
      <SettingsTab />
      <LocationProbe />
    </MemoryRouter>,
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  mocks.list.mockResolvedValue({ settings: { registerMode: 'invite' }, invites, users: [] })
  mocks.me.mockResolvedValue({ user: { id: 'self', username: 'admin', displayName: '管理员', role: 'super_admin' } })
  mocks.login.mockResolvedValue({ audits: [], total: 0 })
  mocks.operations.mockResolvedValue({ operations: [], total: 0 })
  mocks.directory.mockResolvedValue({ users: [], total: 0 })
  mocks.create.mockResolvedValue({ codes: ['NEW-INVITE'] })
  mocks.save.mockResolvedValue({ success: true })
  mocks.confirm.mockResolvedValue(false)
  mocks.clear.mockResolvedValue({ removed: 2 })
})
describe('账户剩余页面接入', () => {
  it('生成邀请码入口更新 URL 并聚焦数量，浏览器返回恢复用户管理', async () => {
    mount('users')
    await screen.findByRole('searchbox', { name: '搜索用户' })
    expect(mocks.list).not.toHaveBeenCalled()
    expect(mocks.login).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: '生成邀请码' }))
    expect(screen.getByLabelText('当前地址')).toHaveTextContent('view=registration')
    await waitFor(() => expect(screen.getByRole('spinbutton', { name: '生成邀请码数量' })).toHaveFocus())
    expect(mocks.create).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: '返回上页' }))
    expect(await screen.findByRole('searchbox', { name: '搜索用户' })).toBeInTheDocument()
    expect(screen.getByLabelText('当前地址')).toHaveTextContent('view=users')
  })
  it('首次读取失败不伪造注册方式，重试后才开放设置', async () => {
    mocks.list.mockRejectedValueOnce(new Error('注册设置读取失败'))
    mount()
    expect(await screen.findByRole('alert')).toHaveTextContent('注册设置读取失败')
    expect(screen.queryByText('当前：邀请注册')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '保存设置' })).not.toBeInTheDocument()
    expect(screen.queryByText('尚未生成邀请码')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByText('当前：邀请注册')).toBeInTheDocument()
  })
  it('刷新失败保留邀请码和注册草稿，生成邀请码后也不覆盖草稿', async () => {
    mount()
    await screen.findByText('INVITE-0')
    await userEvent.click(screen.getByRole('radio', { name: '开放注册 任何人都可以注册' }))
    mocks.list.mockRejectedValueOnce(new Error('刷新失败'))
    await userEvent.click(screen.getByRole('button', { name: '刷新' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('保留上次读取的数据与未保存修改')
    expect(screen.getByText('INVITE-0')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '开放注册 任何人都可以注册' })).toBeChecked()
    await userEvent.click(screen.getByRole('button', { name: '生成邀请码' }))
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith(1))
    await waitFor(() => expect(screen.getByRole('button', { name: '保存设置' })).toBeEnabled())
    expect(screen.getByRole('radio', { name: '开放注册 任何人都可以注册' })).toBeChecked()
    expect(screen.getByText('未保存修改')).toBeInTheDocument()
    expect(screen.getByText('当前：邀请注册')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '取消修改' }))
    expect(screen.getByRole('radio', { name: '邀请注册 注册必须使用邀请码' })).toBeChecked()
  })
  it('审计首次失败与空记录分开，失败后可以就地重试', async () => {
    mocks.login.mockRejectedValueOnce(new Error('审计读取失败'))
    mount('audit')
    expect(await screen.findByRole('alert')).toHaveTextContent('审计读取失败')
    expect(screen.queryByText('暂无登录记录')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByText('暂无登录记录')).toBeInTheDocument()
    expect(mocks.list).not.toHaveBeenCalled()
  })
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
  it('注册设置切换模式即时提示未保存，成功保存后同步状态', async () => {
    mount()
    await screen.findByText('当前：邀请注册')
    expect(screen.queryByText('未保存修改')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: '开放注册 任何人都可以注册' }))
    expect(screen.getByText('未保存修改')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存设置' })).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: '保存设置' }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith('open'))
    await waitFor(() => expect(screen.getByText('当前：开放注册')).toBeInTheDocument())
    expect(screen.queryByText('未保存修改')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存设置' })).toBeDisabled()
  })
  it('邀请码搜索覆盖完整集合而非当前页，取消停用不发送请求', async () => {
    mount()
    await screen.findByText('INVITE-0')
    expect(screen.queryByText('INVITE-16')).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索邀请码' }), { target: { value: 'INVITE-16' } })
    expect(screen.getByText('INVITE-16')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索邀请码' }), { target: { value: 'INVITE-0' } })
    await userEvent.click(screen.getByRole('button', { name: '停用' }))
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: '停用邀请码', items: expect.arrayContaining(['INVITE-0']) }))
    expect(mocks.disable).not.toHaveBeenCalled()
  })
  it('清理使用全量失效记录的确认快照，保留可用邀请码', async () => {
    mocks.confirm.mockResolvedValue(true)
    mount()
    await screen.findByText('INVITE-0')
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索邀请码' }), { target: { value: 'INVITE-0' } })
    await userEvent.click(screen.getByRole('button', { name: '清理失效邀请码' }))
    await waitFor(() => expect(mocks.clear).toHaveBeenCalledWith(['INVITE-16', 'INVITE-17'], 'cleanup-operation'))
  })
  it('操作审计用户名搜索提交服务端并回到第一页', async () => {
    mount('operation-audit')
    await waitFor(() => expect(mocks.operations).toHaveBeenCalled())
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索操作用户名' }), { target: { value: 'admin_one' } })
    await waitFor(() => expect(mocks.operations).toHaveBeenLastCalledWith(expect.objectContaining({ username: 'admin_one', offset: 0, limit: 15 })))
  })
})
