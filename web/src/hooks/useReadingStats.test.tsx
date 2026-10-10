import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useReadingStats } from './useReadingStats'
const mocks = vi.hoisted(() => ({ owner: 'a', token: 'token-a', events: vi.fn() }))
vi.mock('../lib/api', () => ({ getToken: () => mocks.token, authHeaders: () => ({}), url: (p: string) => p, readingStatsApi: { events: mocks.events } }))
vi.mock('../lib/storage', () => ({ getStorageUser: () => mocks.owner }))
const ready = () => true
const options = { userId: 'a', novelId: 'n', chapterId: 'c', enabled: true, contentMode: 'safe', ready }
beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  mocks.owner = 'a'
  mocks.token = 'token-a'
  mocks.events.mockReset().mockResolvedValue({ success: true })
  vi.useFakeTimers({ toFake: ['Date', 'performance', 'setInterval', 'clearInterval'] })
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
it('records foreground static reading, preserves the session across chapters, and pauses behind panels', async () => {
  const hook = renderHook((props) => useReadingStats(props), { initialProps: options })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(31000)
  })
  const first = mocks.events.mock.calls.flatMap((call) => call[1])
  expect(first.reduce((ms, e) => ms + e.end - e.start, 0)).toBeGreaterThanOrEqual(30000)
  const id = first[0].sessionId
  hook.rerender({ ...options, chapterId: 'next' })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(31000)
  })
  const next = mocks.events.mock.calls.flatMap((call) => call[1]).filter((e) => e.chapterId === 'next')
  expect(next.length).toBeGreaterThan(0)
  expect(next.every((e) => e.sessionId === id)).toBe(true)
  hook.rerender({ ...options, enabled: false })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000)
  })
  mocks.events.mockClear()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60000)
  })
  expect(mocks.events).not.toHaveBeenCalled()
  hook.unmount()
})
it('retries offline events with stable IDs and does not send an old queue as a different account', async () => {
  mocks.events.mockRejectedValue(new Error('offline'))
  const hook = renderHook(() => useReadingStats(options))
  await act(async () => {
    await vi.advanceTimersByTimeAsync(31000)
  })
  const firstId = mocks.events.mock.calls[0]![1][0].id
  const keys = Object.keys(localStorage).filter((key) => key.startsWith('zz_reading_events:a:'))
  expect(JSON.parse(localStorage.getItem(keys[0]!)!)).not.toHaveLength(0)
  mocks.events.mockResolvedValue({ success: true })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(31000)
  })
  expect(mocks.events.mock.calls.some((call) => call[1].some((e: { id: string }) => e.id === firstId))).toBe(true)
  mocks.owner = 'b'
  mocks.token = 'token-b'
  mocks.events.mockClear()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(31000)
  })
  hook.unmount()
  expect(mocks.events).not.toHaveBeenCalled()
})
it('does not start counting in a second tab while the first owns the account lease', async () => {
  localStorage.setItem('zz_reading_owner:a', JSON.stringify({ owner: 'another-tab', until: Date.now() + 60000 }))
  const hook = renderHook(() => useReadingStats(options))
  await act(async () => {
    await vi.advanceTimersByTimeAsync(31000)
  })
  expect(mocks.events).not.toHaveBeenCalled()
  hook.unmount()
})

it('recovers an offline queue left by a closed tab for the same account', async () => {
  const now = Date.now()
  const event = { id: 'old-event', sessionId: 'old-session', novelId: 'n', chapterId: 'c', start: now - 30000, end: now }
  localStorage.setItem('zz_reading_events:a:closed-tab', JSON.stringify([event]))
  localStorage.setItem('zz_reading_events:b:other-account', JSON.stringify([event]))
  const hook = renderHook(() => useReadingStats({ ...options, enabled: false }))
  await act(async () => {})
  expect(mocks.events).toHaveBeenCalledWith('a', [event], 'safe')
  expect(JSON.parse(localStorage.getItem('zz_reading_events:b:other-account')!)).toHaveLength(1)
  hook.unmount()
})
