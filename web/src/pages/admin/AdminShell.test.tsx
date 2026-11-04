import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../context/SessionContext', () => ({ useSession: () => ({ user: null, loading: false }) }))
vi.mock('../../context/ContentPolicyContext', () => ({ useContentPolicy: () => ({ mode: 'safe', adultContentEnabled: false }) }))
vi.mock('../../components/feedback', () => ({ useToast: () => ({ toast: vi.fn() }) }))

vi.mock('../../components/ThemeMenu', () => ({
  ThemeMenu: () => (
    <button type="button" data-testid="theme-menu">
      主题
    </button>
  ),
}))

import AdminShell from './AdminShell'

describe('AdminShell topbar controls', () => {
  it('共享工作区保留主题入口，并且不显示未登录账户菜单', () => {
    render(
      <MemoryRouter>
        <AdminShell active="jobs" activeLabel="任务管理">
          <div />
        </AdminShell>
      </MemoryRouter>,
    )

    expect(screen.getAllByTestId('theme-menu').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: '账户菜单：猫' })).not.toBeInTheDocument()
  })
})
