import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import Auth from './Auth'

const mocks = vi.hoisted(() => ({
  bootstrapStatus: vi.fn(),
  registerStatus: vi.fn(),
  passkeyConfig: vi.fn(),
  register: vi.fn(),
  login: vi.fn(),
  forgotPassword: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('../lib/api', () => ({
  authApi: {
    bootstrapStatus: mocks.bootstrapStatus,
    registerStatus: mocks.registerStatus,
    passkeyConfig: mocks.passkeyConfig,
    register: mocks.register,
    forgotPassword: mocks.forgotPassword,
  },
  getToken: () => '',
}))

vi.mock('../context/SessionContext', () => ({
  useSession: () => ({
    user: null,
    login: mocks.login,
    refresh: mocks.refresh,
  }),
}))

vi.mock('../components/ThemeMenu', () => ({
  ThemeMenu: () => <button type="button">主题设置</button>,
}))

describe('Auth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.bootstrapStatus.mockResolvedValue({ needsBootstrap: false })
    mocks.registerStatus.mockResolvedValue({ mode: 'open' })
    mocks.passkeyConfig.mockResolvedValue({ enabled: false, registrationEnabled: true, configured: true, rpName: '知舟' })
    mocks.register.mockResolvedValue({})
    mocks.refresh.mockResolvedValue(undefined)
    mocks.login.mockReset().mockResolvedValue(undefined)
    mocks.forgotPassword.mockReset().mockResolvedValue({ message: '如果账号已绑定可用邮箱，你将收到密码重置邮件。' })
  })

  it('注册表单支持在密码输入框按 Enter 提交', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={[{ pathname: '/auth', state: { mode: 'register' } }]}>
        <Auth />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.queryByLabelText('邀请码')).not.toBeInTheDocument())
    await user.type(screen.getByLabelText('账号'), ' reader ')
    await user.type(screen.getByLabelText('密码'), 'secret{Enter}')

    await waitFor(() => expect(mocks.register).toHaveBeenCalledWith('reader', 'secret', ''))
  })

  it('登录保留保持登录选择和来源页回跳', async () => {
    function Destination() {
      const location = useLocation()
      return <output>{location.pathname + location.search}</output>
    }
    const user = userEvent.setup()
    render(<MemoryRouter initialEntries={[{ pathname: '/auth', state: { from: '/novel/test?source=reader' } }]}><Auth /><Destination /></MemoryRouter>)
    await user.type(screen.getByLabelText('账号'), ' reader ')
    await user.type(screen.getByLabelText('密码'), 'secret')
    await user.click(screen.getByRole('checkbox', { name: '保持登录' }))
    await user.click(screen.getByRole('button', { name: '进入阅读空间' }))
    await waitFor(() => expect(mocks.login).toHaveBeenCalledWith('reader', 'secret', false))
    expect(screen.getByText('/novel/test?source=reader')).toBeInTheDocument()
  })

  it('密码显隐可操作，切换注册时恢复隐藏和新密码自动填充语义', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><Auth /></MemoryRouter>)
    await user.click(screen.getByRole('button', { name: '显示密码' }))
    expect(screen.getByLabelText('密码')).toHaveAttribute('type', 'text')
    await user.click(screen.getByRole('button', { name: '去注册' }))
    expect(screen.getByLabelText('密码')).toHaveAttribute('type', 'password')
    expect(screen.getByLabelText('密码')).toHaveAttribute('autocomplete', 'new-password')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('创建你的阅读空间')
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('关闭注册时保留提示与登录出口，禁止填写和提交', async () => {
    mocks.registerStatus.mockResolvedValue({ mode: 'closed' })
    const user = userEvent.setup()
    render(<MemoryRouter initialEntries={[{ pathname: '/auth', state: { mode: 'register' } }]}><Auth /></MemoryRouter>)
    expect(await screen.findByRole('status')).toHaveTextContent('已关闭注册')
    expect(screen.getByLabelText('账号')).toBeDisabled()
    expect(screen.getByLabelText('密码')).toBeDisabled()
    expect(screen.getByRole('button', { name: '创建账号' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '去登录' }))
    expect(screen.getByLabelText('账号')).toBeEnabled()
  })

  it('处理中禁用重复提交与模式切换，失败后展示真实错误并可继续操作', async () => {
    let fail!: (reason: Error) => void
    mocks.login.mockImplementation(() => new Promise((_resolve, reject) => { fail = reject }))
    const user = userEvent.setup()
    render(<MemoryRouter><Auth /></MemoryRouter>)
    await user.type(screen.getByLabelText('账号'), 'reader')
    await user.type(screen.getByLabelText('密码'), 'wrong')
    await user.click(screen.getByRole('button', { name: '进入阅读空间' }))
    expect(screen.getByRole('button', { name: '处理中…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '去注册' })).toBeDisabled()
    fail(new Error('账号或密码错误，请重新输入'))
    expect(await screen.findByRole('alert')).toHaveTextContent('账号或密码错误，请重新输入')
    expect(screen.getByRole('button', { name: '进入阅读空间' })).toBeEnabled()
    expect(screen.getByLabelText('密码')).toHaveAttribute('aria-describedby', 'auth-message')
  })
  it('反复切换保留输入节点和值，键盘操作保持切换按钮焦点', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><Auth /></MemoryRouter>)
    const account = screen.getByLabelText('账号')
    const password = screen.getByLabelText('密码')
    await user.type(account, 'reader')
    await user.type(password, 'keep-password')
    const toggle = screen.getByRole('button', { name: '去注册' }); toggle.focus()
    await user.keyboard('{Enter}')
    await screen.findByRole('button', { name: '去登录' })
    expect(screen.getByLabelText('账号')).toBe(account)
    expect(screen.getByLabelText('密码')).toBe(password)
    expect(password).toHaveValue('keep-password')
    expect(screen.getByRole('button', { name: '去登录' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(screen.getByLabelText('账号')).toHaveValue('reader')
    expect(screen.getByLabelText('密码')).toHaveValue('keep-password')
  })
  it('找回密码复用 auth 页面并保留登录草稿、焦点和来源页', async () => {
    function Destination() { const location = useLocation(); return <output>{location.pathname + location.search}</output> }
    const user = userEvent.setup()
    render(<MemoryRouter initialEntries={[{ pathname: '/auth', state: { from: '/novel/return?source=reader' } }]}><Auth /><Destination /></MemoryRouter>)
    const account = screen.getByLabelText('账号')
    const password = screen.getByLabelText('密码')
    await user.type(account, 'reader')
    await user.type(password, 'keep-password')
    await user.click(screen.getByRole('button', { name: '忘记密码' }))
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('找回密码')
    expect(screen.getByText('/auth?mode=forgot-password')).toBeInTheDocument()
    expect(screen.getByLabelText('用户名或邮箱')).toHaveValue('reader')
    expect(screen.getByLabelText('用户名或邮箱')).toHaveFocus()
    expect(password).not.toBeVisible()
    await user.click(screen.getByRole('button', { name: '返回登录' }))
    expect(screen.getByLabelText('账号')).toBe(account)
    expect(password).toHaveValue('keep-password')
    expect(account).toHaveFocus()
    await user.click(screen.getByRole('button', { name: '进入阅读空间' }))
    await waitFor(() => expect(screen.getByText('/novel/return?source=reader')).toBeInTheDocument())
  })
  it('找回密码失败保留输入可重试，Enter 提交后展示统一响应并可重新填写', async () => {
    mocks.forgotPassword.mockRejectedValueOnce(new Error('请求过于频繁'))
    const user = userEvent.setup()
    render(<MemoryRouter initialEntries={['/auth?mode=forgot-password']}><Auth /></MemoryRouter>)
    await user.type(screen.getByLabelText('用户名或邮箱'), ' reader@example.test{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('请求过于频繁')
    expect(screen.getByLabelText('用户名或邮箱')).toHaveValue(' reader@example.test')
    await user.click(screen.getByRole('button', { name: '发送重置邮件' }))
    expect(await screen.findByRole('status')).toHaveTextContent('如果账号已绑定可用邮箱')
    expect(mocks.forgotPassword).toHaveBeenLastCalledWith('reader@example.test')
    expect(mocks.login).not.toHaveBeenCalled()
    expect(mocks.register).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '返回登录' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: '重新填写' }))
    expect(screen.getByLabelText('用户名或邮箱')).toHaveFocus()
    expect(screen.getByLabelText('用户名或邮箱')).toHaveValue(' reader@example.test')
  })
  it('找回密码处理中锁定发送和返回，避免重复申请', async () => {
    let finish!: (value: { message: string }) => void
    mocks.forgotPassword.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const user = userEvent.setup()
    render(<MemoryRouter initialEntries={['/auth?mode=forgot-password']}><Auth /></MemoryRouter>)
    await user.type(screen.getByLabelText('用户名或邮箱'), 'reader')
    await user.click(screen.getByRole('button', { name: '发送重置邮件' }))
    expect(screen.getByRole('button', { name: '正在申请…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '返回登录' })).toBeDisabled()
    expect(screen.getByLabelText('用户名或邮箱')).toBeDisabled()
    expect(mocks.forgotPassword).toHaveBeenCalledTimes(1)
    finish({ message: '如果账号已绑定可用邮箱，你将收到密码重置邮件。' })
    expect(await screen.findByRole('status')).toHaveTextContent('如果账号已绑定可用邮箱')
  })
  it('浏览器前进后退同步找回密码视图，注册关闭也不影响找回', async () => {
    function HistoryControls() {
      const navigate = useNavigate()
      return <><button onClick={() => navigate(-1)}>后退</button><button onClick={() => navigate(1)}>前进</button></>
    }
    mocks.registerStatus.mockResolvedValue({ mode: 'closed' })
    const user = userEvent.setup()
    render(<MemoryRouter initialEntries={['/auth?mode=register']}><Auth /><HistoryControls /></MemoryRouter>)
    expect(await screen.findByRole('status')).toHaveTextContent('已关闭注册')
    await user.click(screen.getByRole('button', { name: '去登录' }))
    await user.click(screen.getByRole('button', { name: '忘记密码' }))
    await user.type(screen.getByLabelText('用户名或邮箱'), 'reader')
    await user.click(screen.getByRole('button', { name: '后退' }))
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('欢迎回来')
    await user.click(screen.getByRole('button', { name: '前进' }))
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('找回密码')
    expect(screen.getByLabelText('用户名或邮箱')).toHaveValue('reader')
    expect(screen.getByRole('button', { name: '发送重置邮件' })).toBeEnabled()
  })
})
