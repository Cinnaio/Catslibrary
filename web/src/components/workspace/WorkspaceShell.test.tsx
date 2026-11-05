import userEvent from '@testing-library/user-event'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useSession: vi.fn(),
  useSearch: vi.fn(),
  useContentPolicy: vi.fn(),
  useToast: vi.fn(),
  useConfirm: vi.fn(),
}))

vi.mock('../../context/SessionContext', () => ({
  useSession: mocks.useSession,
}))

vi.mock('../../context/SearchContext', () => ({
  useSearch: mocks.useSearch,
}))

vi.mock('../../context/ContentPolicyContext', () => ({
  useContentPolicy: mocks.useContentPolicy,
}))

vi.mock('../feedback', () => ({
  useToast: mocks.useToast,
  useConfirm: mocks.useConfirm,
}))

vi.mock('../ThemeMenu', () => ({
  ThemeMenu: () => <button type="button">主题设置</button>,
}))

import WorkspaceShell from './WorkspaceShell'

describe('WorkspaceShell account and navigation', () => {
  beforeEach(() => {
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
    })
    mocks.useSearch.mockReturnValue({ query: '', setQuery: vi.fn() })
    mocks.useContentPolicy.mockReturnValue({ mode: 'safe', setMode: vi.fn(), adultContentEnabled: false })
    mocks.useToast.mockReturnValue({ toast: vi.fn() })
    mocks.useConfirm.mockReturnValue({ confirm: vi.fn() })
  })

  it('登录后的手机页头同时保留主题和导航入口', () => {
    const { container } = render(<MemoryRouter><WorkspaceShell><main>内容</main></WorkspaceShell></MemoryRouter>)
    const mobileHeader = container.querySelector('header')!
    expect(within(mobileHeader).getByRole('button', { name: '主题设置' })).toBeInTheDocument()
    expect(within(mobileHeader).getByRole('button', { name: '打开导航' })).toBeInTheDocument()
  })

  it('站点页头的头像也打开共享账户菜单', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/novel/demo']}>
        <WorkspaceShell>
          <main>内容</main>
        </WorkspaceShell>
      </MemoryRouter>,
    )

    await user.click(screen.getAllByRole('button', { name: '账户菜单：猫' })[0]!)

    expect(screen.getByRole('menuitem', { name: '个人中心' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '退出登录' })).toBeInTheDocument()
  })

  it('书库导航保留书架、阅读记录和账户入口，搜索由页面内容承担', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <WorkspaceShell>
          <main>内容</main>
        </WorkspaceShell>
      </MemoryRouter>,
    )
    expect(screen.queryByRole('link', { name: '书库' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '刷新页面' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: '我的书架' }).every((link) => link.getAttribute('href') === '/bookshelf')).toBe(true)
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('button', { name: '搜索' })).toBeNull()
    expect(screen.getAllByRole('link', { name: '阅读记录' }).every((link) => link.getAttribute('href') === '/bookshelf?view=recent')).toBe(true)
    expect(screen.getAllByRole('button', { name: '账户菜单：猫' })[0]!).toBeInTheDocument()
  })

  it('站点开放 R18 时游客的桌面和移动导航都没有模式开关', async () => {
    mocks.useSession.mockReturnValue({ user: null })
    mocks.useContentPolicy.mockReturnValue({ mode: 'safe', setMode: vi.fn(), adultContentEnabled: true })
    render(
      <MemoryRouter>
        <WorkspaceShell>
          <main>内容</main>
        </WorkspaceShell>
      </MemoryRouter>,
    )
    expect(screen.queryByRole('button', { name: /内容访问设置|切回安全模式/ })).toBeNull()
    await userEvent.setup().click(screen.getByRole('button', { name: '打开导航' }))
    expect(screen.queryByRole('button', { name: /内容访问设置|切回安全模式/ })).toBeNull()
    expect(screen.queryByRole('button', { name: '刷新页面' })).not.toBeInTheDocument()
  })
})
