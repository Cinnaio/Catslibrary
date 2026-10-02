import userEvent from '@testing-library/user-event'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useSession: vi.fn(),
  useSearch: vi.fn(),
  useContentPolicy: vi.fn(),
  useToast: vi.fn(),
  useConfirm: vi.fn(),
}))

vi.mock('../context/SessionContext', () => ({
  useSession: mocks.useSession,
}))

vi.mock('../context/SearchContext', () => ({
  useSearch: mocks.useSearch,
}))

vi.mock('../context/ContentPolicyContext', () => ({
  useContentPolicy: mocks.useContentPolicy,
}))

vi.mock('./feedback', () => ({
  useToast: mocks.useToast,
  useConfirm: mocks.useConfirm,
}))

vi.mock('./ThemeMenu', () => ({
  ThemeMenu: () => <button type="button">主题设置</button>,
}))

import SiteHeader from './SiteHeader'

describe('SiteHeader account menu', () => {
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

  it('站点页头的头像也打开共享账户菜单', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/novel/demo']}>
        <SiteHeader />
      </MemoryRouter>,
    )

    await user.click(screen.getByRole('button', { name: '账户菜单：猫' }))

    expect(screen.getByRole('menuitem', { name: '个人中心' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '退出登录' })).toBeInTheDocument()
  })

  it('首页导航保留书架与账户入口，搜索由页面中央承担', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <SiteHeader />
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: '书库' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: '我的书架' })).toHaveAttribute('href', '/bookshelf')
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('button', { name: '搜索' })).toBeNull()
    expect(screen.getByRole('button', { name: '账户菜单：猫' })).toBeInTheDocument()
  })
})
