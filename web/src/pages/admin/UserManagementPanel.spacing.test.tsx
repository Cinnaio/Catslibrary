import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
/**
 * 用户管理工具栏的垂直节奏契约。
 *
 * 起因（2026-10-17 反馈）：截图里筛选轨与数据面板之间空出一大段，操作员读不出
 *「这条筛选轨属于下面这张表」。根因是三处叠加 —— rail 自带 40px min-height，
 * 每个控件自己也只有 40px 高，控件底边之下还挂着一截看不见的空白；外层的
 * margin-bottom: 0.875rem 又叠在页网格 20px 之上。设计规范 Tier 3 要求
 *「筛选轨到数据面板净距 20px」，因此间距交还页网格 gap，轨道自己不写。
 *
 * jsdom 不排版，量不到像素，所以这里断言"谁拥有间距"的结构契约。
 */
import UserManagementPanel from './UserManagementPanel'

const mocks = vi.hoisted(() => ({ directory: vi.fn(), mutateAccount: vi.fn(), changePassword: vi.fn(), toast: vi.fn() }))
vi.mock('@/lib/api', () => ({
  url: (path: string) => path,
  adminApi: { users: { directory: mocks.directory, mutateAccount: mocks.mutateAccount } },
  authApi: { changePassword: mocks.changePassword },
}))
vi.mock('@/components/feedback', () => ({ useToast: () => ({ toast: mocks.toast }) }))

const users = [
  { id: 'self', username: 'admin', displayName: '管理员', role: 'admin', status: 'active', createdAt: 1, updatedAt: 1, lastLoginAt: 0, bio: '', avatarUrl: '' },
]

function mount() {
  mocks.directory.mockResolvedValue({ users, total: users.length })
  return render(<UserManagementPanel search="" selfId="self" selfRole="super_admin" />)
}

describe('用户管理筛选轨的间距归属', () => {
  it('筛选轨与数据面板互为兄弟，中间不夹间距占位元素', () => {
    const { container } = mount()
    const rail = container.querySelector('.admin-toolbar')
    const panel = container.querySelector('.account-users-panel')
    expect(rail).toBeTruthy()
    expect(panel).toBeTruthy()
    expect(rail?.nextElementSibling).toBe(panel)
  })

  it('筛选轨是 inline 轨道，不自建表面（无内间距与描边的卡片）', () => {
    const { container } = mount()
    const rail = container.querySelector('.admin-toolbar')
    expect(rail).toHaveClass('admin-toolbar--inline')
    expect(rail).toHaveClass('admin-filter-rail')
  })
})
