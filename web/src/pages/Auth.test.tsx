import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
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
})
