import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router-dom'
import Auth from './Auth'

const mocks = vi.hoisted(() => ({
  bootstrapStatus: vi.fn(),
  registerStatus: vi.fn(),
  register: vi.fn(),
  login: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('../lib/api', () => ({
  authApi: {
    bootstrapStatus: mocks.bootstrapStatus,
    registerStatus: mocks.registerStatus,
    register: mocks.register,
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

describe('Auth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.bootstrapStatus.mockResolvedValue({ needsBootstrap: false })
    mocks.registerStatus.mockResolvedValue({ mode: 'open' })
    mocks.register.mockResolvedValue({})
    mocks.refresh.mockResolvedValue(undefined)
    mocks.login.mockReset().mockResolvedValue(undefined)
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
    await user.click(screen.getByRole('button', { name: /^登录$/ }))
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
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('创建账号后继续阅读')
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
    await user.click(screen.getByRole('button', { name: /^登录$/ }))
    expect(screen.getByRole('button', { name: '处理中…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '去注册' })).toBeDisabled()
    fail(new Error('账号或密码错误，请重新输入'))
    expect(await screen.findByRole('alert')).toHaveTextContent('账号或密码错误，请重新输入')
    expect(screen.getByRole('button', { name: /^登录$/ })).toBeEnabled()
    expect(screen.getByLabelText('密码')).toHaveAttribute('aria-describedby', 'auth-message')
  })
})
