import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useSession: vi.fn(),
}))

vi.mock('../../context/SessionContext', () => ({
  useSession: mocks.useSession,
}))

vi.mock('./AdminSidebar', () => ({
  default: () => <aside data-testid="admin-sidebar" />,
}))

vi.mock('../../components/ThemeMenu', () => ({
  ThemeMenu: () => (
    <button type="button" data-testid="theme-menu">
      主题
    </button>
  ),
}))

vi.mock('@/components/ui/separator', () => ({
  Separator: () => <span data-testid="separator" />,
}))

vi.mock('@/components/ui/sidebar', () => ({
  SidebarInset: ({ children, ...props }: { children: ReactNode }) => <div {...props}>{children}</div>,
  SidebarProvider: ({ children, ...props }: { children: ReactNode }) => <div {...props}>{children}</div>,
  SidebarTrigger: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button type="button" {...props} />,
}))

import AdminShell from './AdminShell'

describe('AdminShell account controls', () => {
  beforeEach(() => {
    mocks.useSession.mockReturnValue({
      user: {
        id: 'user_1',
        username: 'cat',
        displayName: '猫',
        role: 'admin',
        status: 'active',
        createdAt: 0,
        updatedAt: 0,
        lastLoginAt: 0,
        bio: '',
        avatarUrl: 'https://example.com/avatar.png',
      },
    })
  })

  it('头像加载成功时不把首字母叠加到图片上', () => {
    render(
      <MemoryRouter>
        <AdminShell active="jobs" activeLabel="任务管理">
          <div />
        </AdminShell>
      </MemoryRouter>,
    )

    const avatar = screen.getByRole('link', { name: '我的账户：猫' }).querySelector('.admin-shell__account-avatar')!
    expect(avatar.querySelector('img')).toHaveAttribute('src', 'https://example.com/avatar.png')
    expect(avatar.querySelector('span')).not.toBeInTheDocument()
  })

  it('头像加载失败时显示首字母兜底', () => {
    render(
      <MemoryRouter>
        <AdminShell active="jobs" activeLabel="任务管理">
          <div />
        </AdminShell>
      </MemoryRouter>,
    )

    const account = screen.getByRole('link', { name: '我的账户：猫' })
    const avatar = account.querySelector('.admin-shell__account-avatar')!
    fireEvent.error(avatar.querySelector('img')!)

    expect(avatar).toHaveTextContent('猫')
    expect(avatar.querySelector('img')).not.toBeInTheDocument()
  })
})
