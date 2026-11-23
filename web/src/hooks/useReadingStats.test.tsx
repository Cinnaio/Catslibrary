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

function event(id: string) {
  return { id, sessionId: 'stored-session', novelId: 'n', chapterId: id, start: Date.now() - 30000, end: Date.now() }
}
it('defers adult records while sending safe records behind them, including closed tabs', async () => {
  const adult = event('adult'), safe = event('safe')
  const key = 'zz_reading_events:a:closed-tab'
  localStorage.setItem(key, JSON.stringify([{ ...adult, contentMode: 'adult' }, { ...safe, contentMode: 'safe' }]))
  const hook = renderHook(props => useReadingStats(props), { initialProps: { ...options, enabled: false } })
  await act(async () => {})
  expect(mocks.events).toHaveBeenCalledWith('a', [safe], 'safe')
  expect(JSON.parse(localStorage.getItem(key)!)).toEqual([{ ...adult, contentMode: 'adult' }])
  mocks.events.mockClear()
  hook.rerender({ ...options, enabled: false, contentMode: 'adult' })
  await act(async () => {})
  expect(mocks.events).toHaveBeenCalledWith('a', [adult], 'adult')
  expect(JSON.parse(localStorage.getItem(key)!)).toEqual([])
  hook.unmount()
})
it('retains deferred legacy events and tags them for a later adult-mode retry', async () => {
  const legacy = event('legacy')
  const key = 'zz_reading_events:a:closed-tab'
  localStorage.setItem(key, JSON.stringify([legacy]))
  mocks.events.mockResolvedValue({ success: true, deferredIds: [legacy.id] })
  const hook = renderHook(props => useReadingStats(props), { initialProps: { ...options, enabled: false } })
  await act(async () => {})
  expect(JSON.parse(localStorage.getItem(key)!)).toEqual([{ ...legacy, contentMode: 'adult' }])
  mocks.events.mockClear().mockResolvedValue({ success: true, deferredIds: [] })
  await act(async () => { await vi.advanceTimersByTimeAsync(31000) })
  expect(mocks.events).not.toHaveBeenCalled()
  hook.rerender({ ...options, enabled: false, contentMode: 'adult' })
  await act(async () => {})
  expect(mocks.events).toHaveBeenCalledWith('a', [legacy], 'adult')
  hook.unmount()
})
it('keeps offline adult events across a safe-mode switch and does not leak them through keepalive', async () => {
  mocks.events.mockRejectedValue(new Error('offline'))
  const hook = renderHook(props => useReadingStats(props), { initialProps: { ...options, contentMode: 'adult' } })
  await act(async () => { await vi.advanceTimersByTimeAsync(31000) })
  const key = 'zz_reading_events:a:' + sessionStorage.getItem('zz_reading_tab')
  const queued = JSON.parse(localStorage.getItem(key)!)
  expect(queued.length).toBeGreaterThan(0)
  expect(queued.every((e: { contentMode: string }) => e.contentMode === 'adult')).toBe(true)
  mocks.events.mockClear()
  hook.rerender({ ...options, enabled: false, contentMode: 'safe' })
  await act(async () => {})
  firePageHide()
  await act(async () => { await vi.advanceTimersByTimeAsync(31000) })
  expect(mocks.events).not.toHaveBeenCalled()
  expect(fetch).not.toHaveBeenCalled()
  expect(JSON.parse(localStorage.getItem(key)!).map((e: { id: string }) => e.id)).toEqual(expect.arrayContaining(queued.map((e: { id: string }) => e.id)))
  mocks.events.mockResolvedValue({ success: true })
  hook.rerender({ ...options, enabled: false, contentMode: 'adult' })
  await act(async () => {})
  expect(mocks.events.mock.calls.every(call => call[2] === 'adult')).toBe(true)
  expect(JSON.parse(localStorage.getItem(key)!)).toEqual([])
  hook.unmount()
})
function firePageHide() { window.dispatchEvent(new Event('pagehide')) }
it('sends homogeneous keepalive batches using the recorded mode and retains them until acknowledged', async () => {
  const safe = event('safe'), adult = event('adult')
  sessionStorage.setItem('zz_reading_tab', 'active-tab')
  const key = 'zz_reading_events:a:active-tab'
  localStorage.setItem(key, JSON.stringify([{ ...safe, contentMode: 'safe' }, { ...adult, contentMode: 'adult' }]))
  mocks.events.mockRejectedValue(new Error('offline'))
  const hook = renderHook(() => useReadingStats({ ...options, enabled: false, contentMode: 'adult' }))
  await act(async () => {})
  firePageHide()
  expect(fetch).toHaveBeenCalledWith('/reading-stats/events?contentMode=safe', expect.objectContaining({ keepalive: true, body: JSON.stringify({ userId: 'a', events: [safe] }) }))
  expect(JSON.parse(localStorage.getItem(key)!)).toHaveLength(2)
  hook.unmount()
})

it('retains untagged records when an older server cannot acknowledge filtered IDs', async () => {
  const legacy = event('legacy-server')
  const key = 'zz_reading_events:a:closed-tab'
  localStorage.setItem(key, JSON.stringify([legacy]))
  mocks.events.mockResolvedValue({ success: true })
  const hook = renderHook(() => useReadingStats({ ...options, enabled: false }))
  await act(async () => {})
  expect(JSON.parse(localStorage.getItem(key)!)).toEqual([legacy])
  mocks.events.mockResolvedValue({ success: true, deferredIds: [] })
  await act(async () => { window.dispatchEvent(new Event('online')) })
  expect(JSON.parse(localStorage.getItem(key)!)).toEqual([])
  hook.unmount()
})
