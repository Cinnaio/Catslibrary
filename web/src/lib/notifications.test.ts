import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const request = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({ request }))
import { enablePush } from './notifications'
const publicKey = 'B'.repeat(87)
const raw = atob(publicKey.replace(/-/g, '+').replace(/_/g, '/') + '=')
const key = Uint8Array.from(raw, (c) => c.charCodeAt(0)).buffer
const oldSubscription = { options: { applicationServerKey: key }, unsubscribe: vi.fn(), toJSON: () => ({ endpoint: 'https://web.push.apple.com/old' }) }
const newSubscription = { options: { applicationServerKey: key }, unsubscribe: vi.fn(), toJSON: () => ({ endpoint: 'https://web.push.apple.com/new' }) }
const manager = { getSubscription: vi.fn(), subscribe: vi.fn() }
beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  vi.stubGlobal('isSecureContext', true)
  vi.stubGlobal('PushManager', class {})
  vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn().mockResolvedValue('granted') })
  vi.stubGlobal('navigator', {
    userAgent: 'test browser',
    serviceWorker: { register: vi.fn().mockResolvedValue({ pushManager: manager }), ready: Promise.resolve() },
  })
  oldSubscription.options.applicationServerKey = key
  oldSubscription.unsubscribe.mockResolvedValue(true)
  manager.getSubscription.mockResolvedValue(oldSubscription)
  manager.subscribe.mockResolvedValue(newSubscription)
  request.mockResolvedValue({ id: 'device' })
  localStorage.setItem('library_push_owner', 'owner')
})
afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})
it('replaces a browser subscription when the application server key changes', async () => {
  oldSubscription.options.applicationServerKey = new Uint8Array(65).buffer
  expect(await enablePush(publicKey, 'owner', () => true)).toBe('device')
  expect(oldSubscription.unsubscribe).toHaveBeenCalledTimes(1)
  expect(manager.subscribe).toHaveBeenCalledTimes(1)
  expect(request).toHaveBeenCalledWith(
    'POST',
    '/notifications/subscriptions',
    expect.objectContaining({ applicationServerKey: publicKey, endpoint: 'https://web.push.apple.com/new' }),
    true,
  )
})
it('reuses a matching subscription for the same account', async () => {
  await enablePush(publicKey, 'owner', () => true)
  expect(oldSubscription.unsubscribe).not.toHaveBeenCalled()
  expect(manager.subscribe).not.toHaveBeenCalled()
})
