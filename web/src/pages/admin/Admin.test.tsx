import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./AdminGate', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock('./AdminShell', () => ({
  default: ({ active, activeLabel, children }: { active: string; activeLabel: string; children: ReactNode }) => (
    <main data-testid="admin-shell" data-active={active}>
      <h1>{activeLabel}</h1>
      {children}
    </main>
  ),
}))

vi.mock('./admin-registry', () => {
  const ids = ['dashboard', 'novels', 'scrape'] as const
  const labels: Record<(typeof ids)[number], string> = {
    dashboard: '总览',
    novels: '小说管理',
    scrape: '爬虫抓取',
  }
  const component = (name: string) => () => <div>{name}</div>
  return {
    TAB_KEY: 'admin_active_tab',
    TAB_COMPONENTS: {
      dashboard: component('dashboard-content'),
      novels: component('novels-content'),
      scrape: component('scrape-content'),
    },
    isAdminTab: (id: string | undefined) => !!id && ids.includes(id as (typeof ids)[number]),
    adminTabPath: (id: string) => `/admin/${encodeURIComponent(id)}`,
    getTabLabel: (id: string) => labels[id as (typeof ids)[number]] || '',
  }
})

import Admin from './Admin'

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname}</output>
}

function renderAdmin(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/admin/:tab?" element={<Admin />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  )
}

describe('Admin URL navigation', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('可通过深链接直接打开指定模块并记住位置', async () => {
    renderAdmin('/admin/novels')

    expect(screen.getByTestId('admin-shell')).toHaveAttribute('data-active', 'novels')
    expect(screen.getByRole('heading', { name: '小说管理' })).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/admin/novels')
    await waitFor(() => expect(localStorage.getItem('admin_active_tab')).toBe('novels'))
  })

  it('旧入口 /admin 会恢复上次访问模块', async () => {
    localStorage.setItem('admin_active_tab', 'scrape')
    renderAdmin('/admin')

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/admin/scrape'))
    expect(screen.getByTestId('admin-shell')).toHaveAttribute('data-active', 'scrape')
  })

  it('无效模块回退到总览', async () => {
    renderAdmin('/admin/not-a-tab')

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/admin/dashboard'))
    expect(screen.getByTestId('admin-shell')).toHaveAttribute('data-active', 'dashboard')
  })
})
