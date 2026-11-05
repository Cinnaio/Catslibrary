import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
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
  const ids = ['dashboard', 'novels', 'scrape', 'content-policy', 'site-settings', 'ai'] as const
  const labels: Record<(typeof ids)[number], string> = {
    dashboard: '总览',
    novels: '小说管理',
    scrape: '爬虫抓取',
    'content-policy': '内容安全',
    'site-settings': '站点设置',
    ai: '创作工作区',
  }
  const component = (name: string) => () => <div>{name}</div>
  return {
    TAB_KEY: 'admin_active_tab',
    TAB_COMPONENTS: {
      dashboard: component('dashboard-content'),
      novels: ({ highlightNovelId, onHighlightConsumed }: { highlightNovelId?: string; onHighlightConsumed?: () => void }) => (
        <div>novels-content<output data-testid="highlight">{highlightNovelId}</output><button onClick={onHighlightConsumed}>消耗高亮</button></div>
      ),
      scrape: component('scrape-content'),
      'content-policy': component('legacy-policy-content'),
      'site-settings': component('site-settings-content'),
      ai: component('ai-content'),
    },
    isAdminTab: (id: string | undefined) => !!id && ids.includes(id as (typeof ids)[number]),
    adminTabPath: (id: string) => `/admin/${encodeURIComponent(id)}`,
    getTabLabel: (id: string) => labels[id as (typeof ids)[number]] || '',
    getAdminViewLabel: (id: string, search: string) => new URLSearchParams(search).get('view') === 'content-policy' ? '内容安全' : labels[id as (typeof ids)[number]] || '',
  }
})

import Admin from './Admin'

function LocationProbe() {
  const location = useLocation()
  const navigate = useNavigate()
  return <><output data-testid="location">{location.pathname}{location.search}{location.hash}</output><button onClick={() => navigate('/admin/ai?sub=config&keep=1#models')}>打开旧 AI 设置地址</button><button onClick={() => navigate('/admin/site-settings?view=branding')}>返回站点信息</button></>
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
  it('跨旧 AI 配置地址保留同一个站点设置容器，AI 创作仍独立呈现', async () => {
    const user = (await import('@testing-library/user-event')).default.setup()
    renderAdmin('/admin/site-settings?view=branding')
    const settings = await screen.findByText('site-settings-content')
    await user.click(screen.getByRole('button', { name: '打开旧 AI 设置地址' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/admin/ai?sub=config&keep=1#models')
    expect(screen.getByText('site-settings-content')).toBe(settings)
    expect(screen.queryByText('ai-content')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '返回站点信息' }))
    expect(screen.getByText('site-settings-content')).toBe(settings)
  })

  it('旧内容安全地址进入站点设置，保留其他参数与锚点并更新上次位置', async () => {
    renderAdmin('/admin/content-policy?keep=1#access')
    await screen.findByText('site-settings-content')
    expect(screen.getByTestId('location')).toHaveTextContent('/admin/site-settings?keep=1&view=content-policy#access')
    expect(screen.getByTestId('admin-shell')).toHaveAttribute('data-active', 'site-settings')
    expect(screen.getByRole('heading', { name: '内容安全' })).toBeInTheDocument()
    await waitFor(() => expect(localStorage.getItem('admin_active_tab')).toBe('site-settings'))
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

  it('管理深链接传递目标书籍，消耗后只移除目标参数', async () => {
    const user = (await import('@testing-library/user-event')).default.setup()
    localStorage.setItem('admin_active_tab', 'scrape')
    renderAdmin('/admin/novels?novelId=target-book&keep=1')
    expect(screen.getByTestId('highlight')).toHaveTextContent('target-book')
    await user.click(screen.getByRole('button', { name: '消耗高亮' }))
    expect(screen.getByTestId('highlight')).toBeEmptyDOMElement()
    expect(screen.getByTestId('location')).toHaveTextContent('/admin/novels?keep=1')
  })

  it('兼容旧 sessionStorage 管理入口', async () => {
    sessionStorage.setItem('adminEditNovel', JSON.stringify({ id: 'legacy-book' }))
    renderAdmin('/admin/scrape')
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/admin/novels'))
    expect(screen.getByTestId('highlight')).toHaveTextContent('legacy-book')
    expect(sessionStorage.getItem('adminEditNovel')).toBeNull()
  })
})
