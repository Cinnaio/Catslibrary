import userEvent from '@testing-library/user-event'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AccentProvider } from '../context/AccentContext'
import { ThemeProvider } from '../context/ThemeContext'

const mocks = vi.hoisted(() => ({
  useSession: vi.fn(),
  useToast: vi.fn(),
}))

vi.mock('../context/SessionContext', () => ({
  useSession: mocks.useSession,
}))

vi.mock('./feedback', () => ({
  useToast: mocks.useToast,
}))

import { AccountMenu } from './AccountMenu'
import { ThemeMenu } from './ThemeMenu'

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname}</output>
}

function renderMenu(initialEntry = '/novel/demo') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="*" element={<AccountMenu variant="site" />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  )
}

describe('AccountMenu', () => {
  const logout = vi.fn()

  beforeEach(() => {
    logout.mockReset().mockResolvedValue(undefined)
    mocks.useSession.mockReturnValue({
      user: {
        id: 'user_1',
        username: 'cat',
        displayName: '猫',
        role: 'reader',
        status: 'active',
        createdAt: 0,
        updatedAt: 0,
        lastLoginAt: 0,
        avatarUrl: '',
      },
      logout,
    })
    mocks.useToast.mockReturnValue({ toast: vi.fn() })
  })

  it('点击头像显示个人中心与退出登录选项，并支持 Escape 关闭', async () => {
    const user = userEvent.setup()
    renderMenu()

    await user.click(screen.getByRole('button', { name: '账户菜单：猫' }))

    expect(screen.getByRole('menuitem', { name: '个人中心' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '退出登录' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menuitem', { name: '个人中心' })).not.toBeInTheDocument()
  })

  it('选择个人中心跳转到个人中心，退出登录后回到首页', async () => {
    const user = userEvent.setup()
    renderMenu()

    await user.click(screen.getByRole('button', { name: '账户菜单：猫' }))
    await user.click(screen.getByRole('menuitem', { name: '个人中心' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/profile')

    await user.click(screen.getByRole('button', { name: '账户菜单：猫' }))
    await user.click(screen.getByRole('menuitem', { name: '退出登录' }))
    await waitFor(() => expect(logout).toHaveBeenCalledOnce())
    expect(screen.getByTestId('location')).toHaveTextContent('/')
  })

  it('头像菜单与主题菜单互斥，只保持一个弹层打开', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/novel/demo']}>
        <AccentProvider>
          <ThemeProvider>
            <AccountMenu variant="site" />
            <ThemeMenu className="theme-btn" />
          </ThemeProvider>
        </AccentProvider>
      </MemoryRouter>,
    )

    const accountTrigger = screen.getByRole('button', { name: '账户菜单：猫' })
    const themeTrigger = screen.getByRole('button', { name: /主题设置，当前/ })

    await user.click(accountTrigger)
    expect(screen.getByRole('menuitem', { name: '个人中心' })).toBeInTheDocument()

    await user.click(themeTrigger)
    expect(screen.queryByRole('menuitem', { name: '个人中心' })).not.toBeInTheDocument()
    expect(screen.getByRole('menu', { name: '主题设置' })).toBeVisible()
    expect(themeTrigger).toHaveAttribute('data-state', 'open')

    await user.click(accountTrigger)
    expect(screen.queryByRole('menu', { name: '主题设置' })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '个人中心' })).toBeInTheDocument()
  })
})
