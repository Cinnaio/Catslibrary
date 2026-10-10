import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { ReauthenticationDialog } from './ReauthenticationDialog'
import { requestReauthentication } from '../lib/reauthentication'
const mocks = vi.hoisted(() => ({ request: vi.fn(), marker: 'a' }))
vi.mock('../lib/api', () => ({ request: mocks.request, getToken: () => mocks.marker }))
beforeEach(() => {
  vi.clearAllMocks()
  mocks.marker = 'a'
  mocks.request.mockResolvedValue({ success: true })
})
it('确认密码后继续，取消时不提交验证，密码不写入浏览器存储', async () => {
  render(<ReauthenticationDialog />)
  let pending!: Promise<boolean>
  act(() => {
    pending = requestReauthentication()
  })
  fireEvent.change(await screen.findByLabelText('当前密码'), { target: { value: 'fixturepass123' } })
  fireEvent.click(screen.getByRole('button', { name: '验证并继续' }))
  expect(await pending).toBe(true)
  expect(mocks.request).toHaveBeenCalledWith('POST', '/auth/reauthenticate', { password: 'fixturepass123' }, true)
  expect(JSON.stringify(localStorage)).not.toContain('fixturepass123')
  act(() => {
    pending = requestReauthentication()
  })
  fireEvent.click(await screen.findByRole('button', { name: '取消' }))
  expect(await pending).toBe(false)
  expect(mocks.request).toHaveBeenCalledOnce()
})
it('密码验证期间换账号，旧验证结果不能授权新账号继续操作', async () => {
  let finish!: (value: unknown) => void
  mocks.request.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  render(<ReauthenticationDialog />)
  let pending!: Promise<boolean>
  act(() => {
    pending = requestReauthentication()
  })
  fireEvent.change(await screen.findByLabelText('当前密码'), { target: { value: 'fixturepass123' } })
  fireEvent.click(screen.getByRole('button', { name: '验证并继续' }))
  mocks.marker = 'b'
  await act(async () => {
    finish({ success: true })
    expect(await pending).toBe(false)
  })
})
