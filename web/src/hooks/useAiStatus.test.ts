import { afterEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ status: vi.fn(), token: 'status-test' }))
vi.mock('../lib/api', () => ({ aiApi: { status: mocks.status }, getToken: () => mocks.token }))
import { loadAiStatus } from './useAiStatus'
afterEach(() => vi.useRealTimers())
it('探测失败后下次进入重试，成功状态有有效期', async () => {
  vi.useFakeTimers()
  mocks.status.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ configured: true })
  expect((await loadAiStatus()).configured).toBe(false)
  expect((await loadAiStatus()).configured).toBe(true)
  expect(mocks.status).toHaveBeenCalledTimes(2)
  await loadAiStatus(); expect(mocks.status).toHaveBeenCalledTimes(2)
  vi.advanceTimersByTime(60001)
  await loadAiStatus(); expect(mocks.status).toHaveBeenCalledTimes(3)
})
