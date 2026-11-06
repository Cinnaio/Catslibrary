import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { startPolling } from './polling'

beforeEach(() => { vi.useFakeTimers(); vi.spyOn(document, 'hidden', 'get').mockReturnValue(false) })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

it('慢请求未结束时不重入，结束后等待完整间隔；停止后迟到响应不续订', async () => {
  let finish!: () => void
  const work = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
  const stop = startPolling(work, 1500)
  await vi.advanceTimersByTimeAsync(10_000)
  expect(work).toHaveBeenCalledOnce()
  finish()
  await vi.advanceTimersByTimeAsync(1499)
  expect(work).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(1)
  expect(work).toHaveBeenCalledTimes(2)
  stop(); finish()
  await vi.advanceTimersByTimeAsync(10_000)
  expect(work).toHaveBeenCalledTimes(2)
})

it('隐藏页面暂停，连续可见事件不能叠加请求，终态停止', async () => {
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
  let finish!: (result: boolean) => void
  const work = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve }))
  const stop = startPolling(work, 1500)
  await vi.advanceTimersByTimeAsync(5000)
  expect(work).not.toHaveBeenCalled()
  hidden.mockReturnValue(false)
  document.dispatchEvent(new Event('visibilitychange'))
  document.dispatchEvent(new Event('visibilitychange'))
  expect(work).toHaveBeenCalledOnce()
  finish(false)
  await vi.advanceTimersByTimeAsync(5000)
  document.dispatchEvent(new Event('visibilitychange'))
  expect(work).toHaveBeenCalledOnce()
  stop()
})

it('失败后按间隔重试', async () => {
  const work = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(false)
  const stop = startPolling(work, 1000)
  await vi.advanceTimersByTimeAsync(1000)
  expect(work).toHaveBeenCalledTimes(2)
  stop()
})
