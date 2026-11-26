/* Push only: do not cache authenticated pages, API responses, or book content. */
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      let id = ''
      try {
        id = String(event.data.json().id || '')
      } catch {
        /* show a safe generic notification */
      }
      let title = 'Cat’s Library',
        body = '你有一条新消息',
        url = '/messages'
      if (/^[a-zA-Z0-9-]{1,100}$/.test(id)) {
        try {
          const response = await fetch('/api/notifications/' + encodeURIComponent(id) + '/preview', {
            credentials: 'include',
            cache: 'no-store',
            headers: { 'X-Session-Transport': 'cookie' },
            signal: AbortSignal.timeout(8000),
          })
          if (response.ok) {
            const preview = await response.json()
            title = preview.title
            body = preview.body
            if (typeof preview.url === 'string' && preview.url.startsWith('/messages?')) url = preview.url
          }
        } catch {
          /* Offline or logged out: display no private metadata. */
        }
      }
      await self.registration.showNotification(title, { body, icon: '/images/logo-circle.png', tag: id || 'library-message', data: { url } })
    })(),
  )
})
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    (async () => {
      const raw = event.notification.data?.url
      const url = new URL(typeof raw === 'string' && /^\/messages(?:\?|$)/.test(raw) ? raw : '/messages', self.location.origin)
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of windows) {
        if (new URL(client.url).origin === url.origin) {
          await client.navigate(url.href)
          await client.focus()
          return
        }
      }
      await self.clients.openWindow(url.href)
    })(),
  )
})
