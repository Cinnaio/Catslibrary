import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const session = vi.hoisted(() => ({ user: null as null | { id: string; username: string; role: string } }))
vi.mock('../../context/SessionContext', () => ({ useSession: () => ({ user: session.user, loading: false }) }))
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

beforeEach(() => { session.user = null })

describe('AdminShell topbar controls', () => {
  it('普通管理员保留安全中心并进入邮件记录，仅显示有权限的子入口', () => {
    session.user = { id: 'manager', username: 'manager', role: 'admin' }
    render(
      <MemoryRouter initialEntries={['/admin/security?view=mail']}>
        <AdminShell active="security" activeLabel="邮件记录"><div /></AdminShell>
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: '安全与风控' })).toHaveAttribute('href', '/admin/security?view=mail')
    expect(screen.getByRole('link', { name: '邮件记录' })).toHaveAttribute('href', '/admin/security?view=mail')
    expect(screen.getByRole('link', { name: '风控事件' })).toHaveAttribute('href', '/admin/security?view=events')
    for (const name of ['安全概览', '邮件服务', '防护策略', '封禁与例外', '站点设置']) {
      expect(screen.queryByRole('link', { name })).not.toBeInTheDocument()
    }
  })

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
