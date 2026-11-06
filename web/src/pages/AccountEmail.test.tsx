import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ verify: vi.fn(), reset: vi.fn(), refresh: vi.fn() }))
vi.mock('@/lib/api', () => ({ authApi: { verifyEmail: mocks.verify, resetPassword: mocks.reset } }))
vi.mock('@/context/SessionContext', () => ({ useSession: () => ({ refresh: mocks.refresh }) }))
vi.mock('@/hooks/useDocumentTitle', () => ({ useDocumentTitle: vi.fn() }))
import AccountEmail from './AccountEmail'
beforeEach(() => {
  vi.clearAllMocks()
  mocks.verify.mockResolvedValue({ success: true }); mocks.reset.mockResolvedValue({ success: true })
  mocks.refresh.mockResolvedValue(undefined)
  window.history.replaceState(null, '', '/verify-email#token=fixture-token')
})
function mount(entry: string) { return render(<MemoryRouter initialEntries={[entry]}><AccountEmail /></MemoryRouter>) }
it('读取后清理 fragment，打开页面不会自动验证邮箱，需用户确认', async () => {
  mount('/verify-email#token=fixture-token')
  expect(window.location.hash).toBe('')
  expect(mocks.verify).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '确认验证邮箱' }))
  await waitFor(() => expect(mocks.verify).toHaveBeenCalledWith('fixture-token'))
  expect(await screen.findByRole('status')).toHaveTextContent('邮箱已验证')
  expect(mocks.refresh).toHaveBeenCalledTimes(1)
})
it('缺少链接令牌时不能提交', () => {
  mount('/reset-password')
  expect(screen.getByRole('alert')).toHaveTextContent('缺少有效令牌')
  expect(screen.queryByRole('button', { name: '保存新密码' })).not.toBeInTheDocument()
  expect(mocks.reset).not.toHaveBeenCalled()
})
it('密码不一致不能提交；成功后清空表单并提示重新登录', async () => {
  mount('/reset-password#token=fixture-token')
  fireEvent.change(screen.getByLabelText('新密码', { exact: true }), { target: { value: 'New-password-123' } })
  fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: 'Other-password-123' } })
  fireEvent.click(screen.getByRole('button', { name: '保存新密码' }))
  expect(screen.getByRole('alert')).toHaveTextContent('不一致')
  expect(mocks.reset).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: 'New-password-123' } })
  fireEvent.click(screen.getByRole('button', { name: '保存新密码' }))
  expect(await screen.findByRole('status')).toHaveTextContent('请使用新密码登录')
  expect(mocks.reset).toHaveBeenCalledWith('fixture-token', 'New-password-123')
  expect(screen.queryByLabelText('新密码', { exact: true })).not.toBeInTheDocument()
})
