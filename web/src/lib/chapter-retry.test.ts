import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { withChapterRetry } from './chapter-retry'
import { chaptersApi, clearToken, setToken } from './api'
const limited = (seconds: number, code = 'content_rate_limited') => Object.assign(new Error('slow'),
  { status: 429, data: { code, retryAfter: seconds } })
beforeEach(() => { vi.useFakeTimers(); clearToken() })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); clearToken() })

it('等待 Retry-After 后恢复，两个相邻章节共享冷却时间', async () => {
  const first = vi.fn().mockRejectedValueOnce(limited(2)).mockResolvedValue('chapter-a')
  const second = vi.fn().mockResolvedValue('chapter-b')
  const a = withChapterRetry(first, () => true, 'shared-cooldown')
  await vi.advanceTimersByTimeAsync(0)
  const b = withChapterRetry(second, () => true, 'shared-cooldown')
  await vi.advanceTimersByTimeAsync(1999)
  expect(second).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(102)
  expect(await a).toBe('chapter-a')
  expect(await b).toBe('chapter-b')
  expect(first).toHaveBeenCalledTimes(2)
})
it('持续限流最多重试两次，小时额度不会长期挂起页面', async () => {
  const operation = vi.fn().mockRejectedValue(limited(1))
  const result = withChapterRetry(operation, () => true, 'bounded-retry')
  const rejected = expect(result).rejects.toMatchObject({ status: 429 })
  await vi.runAllTimersAsync()
  await rejected
  expect(operation).toHaveBeenCalledTimes(3)
  const long = vi.fn().mockRejectedValue(limited(3600))
  await expect(withChapterRetry(long, () => true, 'long-window')).rejects.toMatchObject({ status: 429 })
  expect(long).toHaveBeenCalledTimes(1)
})
it('等待期间换号不再请求，不重试其他错误', async () => {
  let current = true
  const operation = vi.fn().mockRejectedValue(limited(1))
  const result = withChapterRetry(operation, () => current, 'account-changed')
  const rejected = expect(result).rejects.toThrow('账号已变化')
  await vi.advanceTimersByTimeAsync(0)
  current = false
  await vi.runAllTimersAsync()
  await rejected
  expect(operation).toHaveBeenCalledTimes(1)
  for (const failure of [new Error('network'), limited(1, 'mail_limited'), Object.assign(new Error('denied'), { status: 403 })]) {
    const request = vi.fn().mockRejectedValue(failure)
    await expect(withChapterRetry(request, () => true, 'other-error')).rejects.toBe(failure)
    expect(request).toHaveBeenCalledTimes(1)
  }
})
it('章节客户端实际读取响应头并重试，跨域 JSON 等待时间同样有效', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ code: 'content_rate_limited', error: 'slow' }),
    { status: 429, headers: { 'Retry-After': '1' } })).mockResolvedValue(new Response(JSON.stringify({ chapter: { id: 'a' } })))
  vi.stubGlobal('fetch', fetch)
  const result = chaptersApi.get('a')
  await vi.advanceTimersByTimeAsync(0)
  expect(fetch).toHaveBeenCalledTimes(1)
  await vi.runAllTimersAsync()
  expect(await result).toMatchObject({ chapter: { id: 'a' } })
  expect(fetch).toHaveBeenCalledTimes(2)
})
it('章节等待期间真实登录标记改变后不重发旧读取', async () => {
  setToken('before')
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 'content_rate_limited', retryAfter: 1 }), { status: 429 }))
  vi.stubGlobal('fetch', fetch)
  const result = chaptersApi.get('a')
  const rejected = expect(result).rejects.toThrow('账号已变化')
  await vi.advanceTimersByTimeAsync(0)
  setToken('after')
  await vi.runAllTimersAsync()
  await rejected
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('并发响应延长冷却后，已经等待的读取遵守最新期限', async () => {
  const first = vi.fn().mockRejectedValueOnce(limited(1)).mockResolvedValue('first')
  let rejectPending!: (error: Error) => void
  const pending = new Promise<string>((_resolve, reject) => { rejectPending = reject })
  const second = vi.fn().mockReturnValueOnce(pending).mockResolvedValue('second')
  const a = withChapterRetry(first, () => true, 'extended-cooldown')
  const b = withChapterRetry(second, () => true, 'extended-cooldown')
  await vi.advanceTimersByTimeAsync(500)
  rejectPending(limited(2))
  await vi.advanceTimersByTimeAsync(1000)
  expect(first).toHaveBeenCalledTimes(1)
  expect(second).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1101)
  expect(await a).toBe('first')
  expect(await b).toBe('second')
})
it('连续短限流不能突破累计等待预算', async () => {
  const operation = vi.fn().mockRejectedValue(limited(64))
  const result = withChapterRetry(operation, () => true, 'total-wait-budget')
  const rejected = expect(result).rejects.toMatchObject({ status: 429 })
  await vi.advanceTimersByTimeAsync(64_101)
  await rejected
  expect(operation).toHaveBeenCalledTimes(2)
})
