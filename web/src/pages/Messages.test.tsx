import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  user: { id: 'a' } as { id: string } | null,
  list: vi.fn(),
  detail: vi.fn(),
  read: vi.fn(),
  settings: vi.fn(),
  save: vi.fn(),
  watches: vi.fn(),
  watch: vi.fn(),
  subscribe: vi.fn(),
  remove: vi.fn(),
  test: vi.fn(),
}))
vi.mock('../context/SessionContext', () => ({ useSession: () => ({ user: mocks.user, loading: false }) }))
vi.mock('../context/ContentPolicyContext', () => ({ useContentPolicy: () => ({ safeMode: true }) }))
vi.mock('../lib/notifications', () => ({ notificationsApi: mocks, pushSupport: () => '', enablePush: vi.fn(), clearBrowserPush: vi.fn() }))
vi.mock('../lib/api', () => ({ API_BASE: '/api' }))
import Messages from './Messages'
const item = { id: 'message', kind: 'reply', title: '你的评论有了新回复', body: '雨天的书', createdAt: 1700000000000, readAt: null }
const preferences = {
  replies: true,
  tasks: true,
  preview: false,
  quietEnabled: false,
  quietStart: '22:00',
  quietEnd: '08:00',
  timeZone: 'Asia/Shanghai',
  revision: 0,
}
function show(path = '/messages') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Messages />
    </MemoryRouter>,
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.user = { id: 'a' }
  mocks.list.mockResolvedValue({ items: [item], unread: 1, hasMore: false })
  mocks.detail.mockResolvedValue({ item, text: '我也喜欢这段', href: '/novel/n?comment=p', linkLabel: '查看评论对话' })
  mocks.read.mockResolvedValue({ ok: true })
  mocks.settings.mockResolvedValue({ settings: preferences, devices: [], pushConfigured: false, publicKey: '' })
  mocks.watches.mockResolvedValue({ items: [], hasMore: false })
})
it('opens the exact notification and updates the shared read state', async () => {
  show()
  fireEvent.click(await screen.findByRole('button', { name: '未读，你的评论有了新回复，雨天的书' }))
  expect(await screen.findByText('我也喜欢这段')).toBeVisible()
  expect(screen.getByRole('link', { name: '查看评论对话' })).toHaveAttribute('href', '/novel/n?comment=p')
  await waitFor(() => expect(mocks.read).toHaveBeenCalledWith('message'))
})
it('keeps settings edits when a concurrent save fails and offers reload', async () => {
  mocks.save.mockRejectedValue(new Error('设置已在其他设备修改'))
  show('/messages?settings=1')
  fireEvent.click(await screen.findByLabelText('锁屏显示消息类型和书名'))
  fireEvent.click(screen.getByRole('button', { name: '保存设置' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('设置已在其他设备修改')
  expect(screen.getByLabelText('锁屏显示消息类型和书名')).toBeChecked()
  expect(mocks.save).toHaveBeenCalledWith({ ...preferences, preview: true })
  expect(screen.getByRole('button', { name: '开启推送' })).toBeDisabled()
})
it('isolates late responses after an account change', async () => {
  let finish!: (value: unknown) => void
  mocks.list
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    .mockResolvedValue({ items: [], unread: 0, hasMore: false })
  const view = show()
  mocks.user = { id: 'b' }
  view.rerender(
    <MemoryRouter>
      <Messages />
    </MemoryRouter>,
  )
  await act(async () => {
    finish({ items: [item], unread: 1, hasMore: false })
  })
  expect(screen.queryByText('雨天的书')).not.toBeInTheDocument()
})
it('retains a deep link through the login entry', () => {
  mocks.user = null
  show('/messages?message=message')
  expect(screen.getByRole('link', { name: '登录' })).toHaveAttribute('href', '/auth')
  expect(mocks.list).not.toHaveBeenCalled()
})
it('marks all visible messages as read without removing the list on failure', async () => {
  mocks.read.mockRejectedValue(new Error('暂时无法连接'))
  show()
  fireEvent.click(await screen.findByRole('button', { name: '全部已读' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法连接')
  expect(screen.getByText('雨天的书')).toBeVisible()
})
it('changes book subscriptions only after the server confirms', async () => {
  mocks.watches.mockResolvedValue({ items: [{ novelId: 'n', title: '追更的书', enabled: false, checksEnabled: false }], hasMore: false })
  mocks.watch.mockRejectedValue(new Error('这本书已不可访问'))
  show('/messages?settings=1')
  fireEvent.click(await screen.findByRole('button', { name: '订阅更新' }))
  expect(await screen.findByText('这本书已不可访问')).toBeVisible()
  expect(screen.getByRole('button', { name: '订阅更新' })).toHaveAttribute('aria-pressed', 'false')
})
