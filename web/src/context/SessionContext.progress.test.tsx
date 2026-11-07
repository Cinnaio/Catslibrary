import { render, waitFor, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SessionProvider } from './SessionContext'
import { clearToken, setToken } from '../lib/api'
import { setStorageUser } from '../lib/storage'
import { enqueueProgress, pendingProgress } from '../lib/progress-outbox'

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); setToken(''); setStorageUser('a')
  enqueueProgress({ novelId: 'n', chapterId: 'c', scrollPercent: .5, clientUpdatedAt: Date.now() - 1000 })
  setStorageUser(null) // 模拟重新打开应用，标记存在但身份尚未确认。
})
afterEach(() => { cleanup(); clearToken(); vi.unstubAllGlobals() })

it('启动身份确认后自动补传，普通页面无需打开阅读器', async () => {
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    if (url.endsWith('/auth/me')) return new Response('{"user":{"id":"a","username":"reader","role":"reader"}}')
    expect(url).toMatch(/\/progress$/)
    const body = JSON.parse(String(init.body))
    return new Response(JSON.stringify({ success: true, progress: { chapterId: body.chapterId, scrollPercent: body.scrollPercent, updatedAt: body.clientUpdatedAt } }))
  })
  vi.stubGlobal('fetch', fetch)
  render(<SessionProvider><div>普通页面</div></SessionProvider>)
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(pendingProgress()).toEqual([]))
})

it('身份确认失败不上传缓存，账号队列仍保留', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('{"error":"unauthorized"}', { status: 401 }))
  vi.stubGlobal('fetch', fetch)
  render(<SessionProvider><div>普通页面</div></SessionProvider>)
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
  expect(fetch.mock.calls[0]![0]).toMatch(/\/auth\/me$/)
  setToken(''); setStorageUser('a')
  expect(pendingProgress()).toHaveLength(1)
})
