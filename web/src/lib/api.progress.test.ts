import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { progressApi, setToken, clearToken } from './api'
import { setStorageUser } from './storage'
import { enqueueProgress, pendingProgress } from './progress-outbox'

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); setToken(''); setStorageUser('a')
})
afterEach(() => { vi.unstubAllGlobals(); clearToken() })

it.each([
  { success: true },
  { success: false, progress: null, tombstone: null },
  { success: true, tombstone: { novelId: 'other', deletedAt: 123 } },
  { success: true, tombstone: {} },
  { success: true, acknowledged: { userId: 'other', novelId: 'n', clientUpdatedAt: 1 } },
])('缺失或不属于当前操作的删除回执不能清空队列：%j', async response => {
  enqueueProgress({ novelId: 'n', chapterId: 'c', scrollPercent: .5, clientUpdatedAt: Date.now() - 1000 })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(response))))
  await expect(progressApi.remove('n')).rejects.toThrow('尚未得到服务端确认')
  expect(pendingProgress()).toHaveLength(1)
})

it('确认当前账号、作品和请求版本后删除旧队列', async () => {
  enqueueProgress({ novelId: 'n', chapterId: 'c', scrollPercent: .5, clientUpdatedAt: Date.now() - 1000 })
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: string) => {
    const version = Number(new URL(input, 'http://localhost').searchParams.get('clientUpdatedAt'))
    return new Response(JSON.stringify({ success: true, acknowledged: { userId: 'a', novelId: 'n', clientUpdatedAt: version } }))
  }))
  await progressApi.remove('n')
  expect(pendingProgress()).toHaveLength(0)
})

it('删除成功清理旧上传，但删除失败保留可重试进度', async () => {
  const uploadedAt = Date.now() - 1000
  enqueueProgress({ novelId: 'n', chapterId: 'c', scrollPercent: .5, clientUpdatedAt: uploadedAt })
  const fetch = vi.fn().mockResolvedValueOnce(new Response('{"error":"unavailable"}', { status: 503 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, progress: null, tombstone: { deletedAt: uploadedAt + 1 } })))
  vi.stubGlobal('fetch', fetch)
  await expect(progressApi.remove('n')).rejects.toThrow('unavailable')
  expect(pendingProgress()).toHaveLength(1)
  await progressApi.remove('n')
  expect(pendingProgress()).toEqual([])
})

it('没有墓碑的已删书确认同样清理此前排队内容', async () => {
  enqueueProgress({ novelId: 'n', chapterId: 'c', scrollPercent: .5, clientUpdatedAt: Date.now() - 1000 })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"success":true,"progress":null,"tombstone":null}')))
  await progressApi.remove('n')
  expect(pendingProgress()).toEqual([])
})

it('删除确认被服务器校正时间后仍清理旧队列，保留删除期间的新阅读', async () => {
  const now = Date.now()
  enqueueProgress({ novelId: 'n', chapterId: 'old', scrollPercent: .1, clientUpdatedAt: now - 1000 })
  enqueueProgress({ novelId: 'other', chapterId: 'old', scrollPercent: .1, clientUpdatedAt: now - 1000 })
  let finish!: (value: Response) => void
  const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ success: true, progress: null, tombstone: { deletedAt: now - 60_000 } })))
    .mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  vi.stubGlobal('fetch', fetch)
  await progressApi.remove('n')
  expect(pendingProgress().map(entry => entry.payload.novelId)).toEqual(['other'])
  const response = progressApi.remove('other')
  enqueueProgress({ novelId: 'other', chapterId: 'new', scrollPercent: .5, clientUpdatedAt: Date.now() + 1 })
  finish(new Response(JSON.stringify({ success: true, progress: null, tombstone: { deletedAt: now - 60_000 } })))
  await response
  expect(pendingProgress()[0]?.payload.chapterId).toBe('new')
})

it('账号切换后迟到的删除结果不能清除新账号的队列', async () => {
  let finish!: (value: Response) => void
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise(r => { finish = r })))
  const response = progressApi.remove('n')
  setToken(''); setStorageUser('b')
  enqueueProgress({ novelId: 'n', chapterId: 'b', scrollPercent: .5, clientUpdatedAt: Date.now() - 1000 })
  finish(new Response(JSON.stringify({ success: true, progress: null, tombstone: { deletedAt: Date.now() } })))
  await response
  expect(pendingProgress()[0]?.payload.chapterId).toBe('b')
})

it('keepalive 保留账号及 CSRF 头，HTTP 失败向队列报告', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('{"error":"unavailable"}', { status: 503 }))
  vi.stubGlobal('fetch', fetch)
  await expect(progressApi.saveOnExit({ novelId: 'n', chapterId: 'c' })).rejects.toMatchObject({ status: 503 })
  const init = fetch.mock.calls[0]![1] as RequestInit
  expect(init.keepalive).toBe(true)
  expect(init.credentials).toBe('include')
  const headers = new Headers(init.headers)
  expect(headers.get('X-ZZ-Account')).toBe('a')
  expect(headers.get('X-ZZ-CSRF')).toBe('1')
})
