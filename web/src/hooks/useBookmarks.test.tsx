import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { LocalBookmark } from '@shared/types'
const mocks = vi.hoisted(() => ({ list: vi.fn(), save: vi.fn(), remove: vi.fn(), user: { id: 'a' } as { id: string } | null }))
vi.mock('../lib/api', () => ({ bookmarksApi: { list: mocks.list, save: mocks.save, remove: mocks.remove }, getToken: () => sessionStorage.getItem('user_session_token') || '' }))
vi.mock('../context/SessionContext', () => ({ useSession: () => ({ user: mocks.user, loading: false }) }))
import { useBookmarks } from './useBookmarks'
import { getAllBookmarks, replaceAllBookmarks, setStorageUser } from '../lib/storage'
const cloud: LocalBookmark = { id: 'cloud', novelId: 'n', novelTitle: '', chapterId: 'cloud', chapterTitle: '', chapterOrder: 1, note: '', timestamp: 1 }
const target = { ...cloud, id: 'target', chapterId: 'target' }
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear()
  sessionStorage.setItem('user_session_token', 'a'); setStorageUser('a'); mocks.user = { id: 'a' }
  mocks.list.mockResolvedValue({ bookmarks: [cloud] })
  mocks.save.mockResolvedValue({ bookmark: { ...target, id: 'server-id' } })
  mocks.remove.mockResolvedValue({ success: true })
})
it('新设备直接读书先取云端，新增只发送单条，不覆盖其它云端书签', async () => {
  const { result } = renderHook(useBookmarks)
  await waitFor(() => expect(result.current.bookmarks).toEqual([cloud]))
  await act(() => result.current.change(target))
  expect(mocks.save).toHaveBeenCalledWith(target)
  expect(getAllBookmarks().map(b => b.id)).toEqual(['cloud', 'server-id'])
})
it('云端读取不合并旧缓存，避免复活已删除项', async () => {
  replaceAllBookmarks([target]); mocks.list.mockResolvedValue({ bookmarks: [] })
  const { result } = renderHook(useBookmarks)
  await waitFor(() => expect(result.current.bookmarks).toEqual([]))
  expect(mocks.save).not.toHaveBeenCalled()
  expect(mocks.remove).not.toHaveBeenCalled()
})
it('保存失败保留本地书签，重复点击只发一次请求', async () => {
  const { result } = renderHook(useBookmarks)
  await waitFor(() => expect(result.current.bookmarks).toHaveLength(1))
  let reject!: (e: Error) => void
  mocks.remove.mockReturnValue(new Promise((_resolve, r) => { reject = r }))
  let request!: ReturnType<typeof result.current.change>
  act(() => { request = result.current.change(cloud, true) })
  await act(() => result.current.change(cloud, true))
  expect(mocks.remove).toHaveBeenCalledTimes(1)
  await act(async () => { reject(new Error('offline')); await expect(request).rejects.toThrow('offline') })
  expect(getAllBookmarks()).toEqual([cloud])
})
it('账号切换后，旧账号的延迟保存响应不能写入新账号', async () => {
  const { result, rerender } = renderHook(useBookmarks)
  await waitFor(() => expect(result.current.bookmarks).toHaveLength(1))
  let resolve!: (v: { bookmark: LocalBookmark }) => void
  mocks.save.mockReturnValue(new Promise(r => { resolve = r }))
  let request!: ReturnType<typeof result.current.change>
  act(() => { request = result.current.change(target) })
  sessionStorage.setItem('user_session_token', 'b'); setStorageUser('b'); mocks.user = { id: 'b' }
  mocks.list.mockResolvedValue({ bookmarks: [] }); rerender()
  await waitFor(() => expect(result.current.bookmarks).toEqual([]))
  await act(async () => { resolve({ bookmark: target }); await request })
  expect(getAllBookmarks()).toEqual([])
})
