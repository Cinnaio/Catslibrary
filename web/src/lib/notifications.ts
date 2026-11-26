import type { LibraryNotification, NotificationConfiguration, NotificationSettings } from '@shared/notifications'
import { request } from './api'
export interface MessagePage {
  items: LibraryNotification[]
  unread: number
  hasMore: boolean
}
export interface MessageDetail {
  item: LibraryNotification
  text: string
  href: string
  linkLabel: string
  novelId: string
  taskId: string
}
export interface WatchedBook {
  novelId: string
  title: string
  enabled: boolean
  checksEnabled: boolean
}
export const notificationsApi = {
  watches: (query = '') => request<{ items: WatchedBook[]; hasMore: boolean }>('GET', '/notifications/watches' + query, null, true),
  watch: (id: string, enabled: boolean) => request('PUT', '/notifications/watches/' + encodeURIComponent(id), { enabled }, true),
  list: (query = '') => request<MessagePage>('GET', '/notifications' + query, null, true),
  detail: (id: string) => request<MessageDetail>('GET', '/notifications/' + encodeURIComponent(id), null, true),
  read: (id?: string) => request('POST', '/notifications/read', id ? { id } : { all: true }, true),
  settings: () => request<NotificationConfiguration>('GET', '/notifications/settings', null, true),
  save: (settings: NotificationSettings) => request<{ settings: NotificationSettings }>('PUT', '/notifications/settings', settings, true),
  subscribe: (body: unknown) => request<{ id: string }>('POST', '/notifications/subscriptions', body, true),
  remove: (id: string) => request('DELETE', '/notifications/subscriptions/' + encodeURIComponent(id), null, true),
  test: (deviceId: string) => request('POST', '/notifications/test', { deviceId }, true),
}
export function pushSupport() {
  if (!window.isSecureContext) return '推送需要通过 HTTPS 打开网站。'
  if (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
    if (!matchMedia('(display-mode: standalone)').matches && !(navigator as Navigator & { standalone?: boolean }).standalone)
      return '在 Safari 分享菜单中选择「添加到主屏幕」，从主屏幕打开后开启推送。需要 iOS / iPadOS 16.4 或以上。'
  }
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return '当前浏览器不支持推送，仍可在消息中心查看通知。'
  if (Notification.permission === 'denied') return '系统已关闭通知权限，请在系统或浏览器设置中允许通知后重试。'
  return ''
}
export async function enablePush(publicKey: string, userId: string, isCurrent: () => boolean) {
  const reason = pushSupport()
  if (reason) throw new Error(reason)
  // Permission must be requested directly from the user's click, before asynchronous network work.
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('尚未允许通知，你仍可以使用消息中心。')
  if (!isCurrent()) throw new Error('账号已变化，请重新操作')
  const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
  await navigator.serviceWorker.ready
  let subscription = await registration.pushManager.getSubscription()
  const raw = atob(publicKey.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (publicKey.length % 4)) % 4))
  const expectedKey = Uint8Array.from(raw, (c) => c.charCodeAt(0))
  const existingKey = subscription?.options.applicationServerKey
  const sameKey =
    existingKey && new Uint8Array(existingKey).length === expectedKey.length && new Uint8Array(existingKey).every((byte, i) => byte === expectedKey[i])
  if (subscription && (localStorage.getItem('library_push_owner') !== userId || !sameKey)) {
    await subscription.unsubscribe()
    subscription = null
  }
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: expectedKey })
  }
  if (!isCurrent()) {
    await subscription.unsubscribe()
    throw new Error('账号已变化，请重新操作')
  }
  try {
    const result = await notificationsApi.subscribe({
      ...subscription.toJSON(),
      applicationServerKey: publicKey,
      name: /iPhone|iPad/.test(navigator.userAgent) ? 'iPhone / iPad 网页' : '网页浏览器',
    })
    if (!isCurrent()) {
      await subscription.unsubscribe()
      throw new Error('账号已变化，请重新操作')
    }
    localStorage.setItem('library_push_owner', userId)
    localStorage.setItem('library_push_device', result.id)
    return result.id
  } catch (error) {
    await subscription.unsubscribe()
    throw error
  }
}
export async function clearBrowserPush() {
  localStorage.removeItem('library_push_owner')
  localStorage.removeItem('library_push_device')
  if (!('serviceWorker' in navigator)) return
  const registration = await navigator.serviceWorker.getRegistration('/')
  await (await registration?.pushManager.getSubscription())?.unsubscribe()
  for (const notification of (await registration?.getNotifications()) || []) notification.close()
}
