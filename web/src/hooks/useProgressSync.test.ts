import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ token: 'a', save: vi.fn(), exit: vi.fn() }))
vi.mock('../lib/api', () => ({ getToken: () => mocks.token, progressApi: { save: mocks.save, saveOnExit: mocks.exit } }))
import { useProgressSync } from './useProgressSync'
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); mocks.token = 'a' })
it('账号切换后不把上一账号的延迟进度发给新账号', () => {
  vi.useFakeTimers(); mocks.save.mockResolvedValue({})
  const { result } = renderHook(useProgressSync)
  act(() => result.current.queue('n', 'c1', 0.1))
  expect(mocks.save).toHaveBeenCalledTimes(1)
  act(() => result.current.queue('n', 'c2', 0.2))
  mocks.token = 'b'
  act(() => vi.advanceTimersByTime(10000))
  expect(mocks.save).toHaveBeenCalledTimes(1)
  expect(mocks.exit).not.toHaveBeenCalled()
})
