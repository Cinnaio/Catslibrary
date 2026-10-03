import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import AdminGate from './AdminGate'

const mocks = vi.hoisted(() => ({
  session: { user: null as null | { role: string; displayName: string; username: string }, loading: false, logout: vi.fn() },
  status: vi.fn(),
}))
vi.mock('../../context/SessionContext', () => ({ useSession: () => mocks.session }))
vi.mock('../../lib/api', () => ({ setupApi: { status: mocks.status } }))

beforeEach(() => {
  mocks.session.user = null
  mocks.session.loading = false
  mocks.session.logout.mockReset().mockResolvedValue(undefined)
  mocks.status.mockReset().mockResolvedValue({ needsBootstrap: false })
})

function AuthDestination() {
  const location = useLocation()
  return <output>{JSON.stringify(location.state)}</output>
}
function mountGate() {
  render(<MemoryRouter initialEntries={['/admin/novels?novelId=test']}><Routes>
    <Route path="/admin/:tab" element={<AdminGate><p>管理内容</p></AdminGate>} />
    <Route path="/auth" element={<AuthDestination />} />
  </Routes></MemoryRouter>)
}

it('游客门禁使用共享整页状态且不展示后台内容', async () => {
  mountGate()
  expect(screen.getByRole('main')).toHaveClass('page-state')
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('需要管理员身份')
  expect(screen.queryByText('管理内容')).not.toBeInTheDocument()
  await waitFor(() => expect(mocks.status).toHaveBeenCalled())
  expect(screen.queryByText('首次使用？创建管理员')).not.toBeInTheDocument()
})

it('非管理员切换账号先登出，等待期间禁用，再携带原地址登录', async () => {
  mocks.session.user = { role: 'user', displayName: '读者', username: 'reader' }
  let completeLogout!: () => void
  mocks.session.logout.mockImplementation(() => new Promise<void>(resolve => { completeLogout = resolve }))
  mountGate()
  fireEvent.click(screen.getByRole('button', { name: '切换账号' }))
  expect(screen.getByRole('button', { name: '正在退出…' })).toBeDisabled()
  expect(mocks.session.logout).toHaveBeenCalledOnce()
  completeLogout()
  expect(await screen.findByText(/"from":"\/admin\/novels\?novelId=test"/)).toBeInTheDocument()
})

it('管理员直接展示原管理内容', () => {
  mocks.session.user = { role: 'admin', displayName: '管理员', username: 'admin' }
  mountGate()
  expect(screen.getByText('管理内容')).toBeInTheDocument()
  expect(screen.queryByRole('main')).not.toBeInTheDocument()
  expect(mocks.status).not.toHaveBeenCalled()
})
