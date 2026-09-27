import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

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

describe('AdminShell topbar controls', () => {
  it('将账户入口交给侧栏，并保留顶栏主题入口', () => {
    render(
      <MemoryRouter>
        <AdminShell active="jobs" activeLabel="任务管理">
          <div />
        </AdminShell>
      </MemoryRouter>,
    )

    expect(screen.getByTestId('theme-menu')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '账户菜单：猫' })).not.toBeInTheDocument()
  })
})
