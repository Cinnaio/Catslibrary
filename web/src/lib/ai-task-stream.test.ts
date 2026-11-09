import { afterEach, describe, expect, it, vi } from 'vitest'
import { watchAiTask } from './ai-task-stream'

const api = vi.hoisted(() => ({ task: vi.fn(), owner: 'owner' }))
vi.mock('./api', () => ({ aiApi: { task: api.task }, getToken: () => api.owner, authHeaders: (headers: unknown) => headers, url: (path: string) => path }))
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  api.owner = 'owner'
  api.task.mockReset()
})
const task = (status: string, result = '') => ({ id: 't1', status, result })
const stream = (value: unknown) =>
  new Response(`data: ${JSON.stringify({ type: 'update', task: value })}\n\n`, { headers: { 'content-type': 'text/event-stream' } })

describe('task subscription', () => {
  it('recovers a disconnected read from its snapshot and only reconnects GET', async () => {
    vi.useFakeTimers()
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(stream(task('running', 'partial')))
      .mockResolvedValueOnce(stream(task('completed', 'saved')))
    vi.stubGlobal('fetch', fetcher)
    api.task.mockResolvedValue({ task: task('running', 'checkpoint') })
    const listener = vi.fn()
    const connection = vi.fn()
    const stop = watchAiTask('t1', listener, connection)
    expect(connection).toHaveBeenLastCalledWith('connecting')
    await vi.advanceTimersByTimeAsync(0)
    expect(connection).toHaveBeenLastCalledWith('reconnecting')
    expect(listener).toHaveBeenCalledWith(task('running', 'checkpoint'))
    await vi.advanceTimersByTimeAsync(2000)
    expect(listener).toHaveBeenLastCalledWith(task('completed', 'saved'))
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(connection).toHaveBeenLastCalledWith('connected')
    expect(fetcher.mock.calls.every(([, init]) => !init.method || init.method === 'GET')).toBe(true)
    stop()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('does not regress newer progress to an older fallback snapshot', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(stream({ ...task('running', 'new'), updatedAt: 20 })))
    api.task.mockResolvedValue({ task: { ...task('running', 'old'), updatedAt: 10 } })
    const listener = vi.fn()
    const stop = watchAiTask('t1', listener)
    await vi.advanceTimersByTimeAsync(0)
    expect(listener).toHaveBeenCalledExactlyOnceWith({ ...task('running', 'new'), updatedAt: 20 })
    stop()
  })
  it('marks a rejected subscription unavailable without scheduling another request', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 403 }))
    vi.stubGlobal('fetch', fetcher)
    const connection = vi.fn()
    const stop = watchAiTask('t1', vi.fn(), connection)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(connection).toHaveBeenLastCalledWith('unavailable')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(api.task).not.toHaveBeenCalled()
    stop()
  })
  it('ignores packets after account changes and releases the connection on unmount', async () => {
    let send!: ReadableStreamDefaultController<Uint8Array>
    const cancelled = vi.fn()
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        send = c
      },
      cancel: cancelled,
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { headers: { 'content-type': 'text/event-stream' } })))
    const listener = vi.fn()
    const stop = watchAiTask('t1', listener)
    api.owner = 'new-owner'
    send.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ task: task('running', 'private') })}\n\n`))
    await vi.waitFor(() => expect(cancelled).toHaveBeenCalled())
    expect(listener).not.toHaveBeenCalled()
    stop()
  })
})
