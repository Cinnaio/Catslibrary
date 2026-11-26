import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { expect, it, vi } from 'vitest'
import { createWebRoutes } from '../routes/web'
const source = await readFile(new URL('../../../web/public/sw.js', import.meta.url), 'utf8')
function worker() {
  const handlers = new Map<string, (event: any) => void>()
  const fetch = vi.fn(),
    show = vi.fn().mockResolvedValue(undefined),
    open = vi.fn().mockResolvedValue(undefined)
  const self = {
    location: { origin: 'https://library.test' },
    addEventListener: (name: string, fn: (event: any) => void) => handlers.set(name, fn),
    registration: { showNotification: show },
    clients: { matchAll: vi.fn().mockResolvedValue([]), openWindow: open },
  }
  runInNewContext(source, { self, fetch, URL, AbortSignal })
  const dispatch = async (name: string, data: object) => {
    let pending: Promise<void> | undefined
    handlers.get(name)!({
      ...data,
      waitUntil: (promise: Promise<void>) => {
        pending = promise
      },
    })
    await pending
  }
  return { fetch, show, open, dispatch, self }
}
it('obtains previews with the current cookie and never trusts content embedded in an old push', async () => {
  const w = worker()
  w.fetch.mockResolvedValue({ ok: false, status: 401 })
  await w.dispatch('push', { data: { json: () => ({ id: 'message-id', title: 'private old title', body: 'private old body' }) } })
  expect(w.show).toHaveBeenCalledWith('Cat’s Library', expect.objectContaining({ body: '你有一条新消息', data: { url: '/messages' } }))
  expect(w.fetch.mock.calls[0]![1]).toMatchObject({ credentials: 'include', cache: 'no-store' })
})
it('keeps successful previews same-origin and opens only the message center', async () => {
  const w = worker()
  w.fetch.mockResolvedValue({ ok: true, json: async () => ({ title: '新回复', body: '书名', url: 'https://evil.test' }) })
  await w.dispatch('push', { data: { json: () => ({ id: 'message-id' }) } })
  expect(w.show).toHaveBeenCalledWith('新回复', expect.objectContaining({ data: { url: '/messages' } }))
  await w.dispatch('notificationclick', { notification: { close: vi.fn(), data: { url: 'https://evil.test' } } })
  expect(w.open).toHaveBeenCalledWith('https://library.test/messages')
})
it('serves actual push assets and never returns the application HTML as a worker', async () => {
  const routes = createWebRoutes({ root: fileURLToPath(new URL('../../../web/public', import.meta.url)), configured: () => false })
  const sw = await routes.request('/sw.js')
  expect(sw.status).toBe(200)
  expect(sw.headers.get('Cache-Control')).toBe('no-cache')
  expect(sw.headers.get('Content-Type')).toContain('javascript')
  expect(await sw.text()).toContain("addEventListener('push'")
  const manifest = await routes.request('/manifest.webmanifest')
  expect(manifest.status).toBe(200)
  expect(((await manifest.json()) as { start_url: string }).start_url).toBe('/messages')
})
