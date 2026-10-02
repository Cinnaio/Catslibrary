import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ list: vi.fn(), replace: vi.fn(), shelf: vi.fn(), add: vi.fn(), remove: vi.fn(), recent: vi.fn(), toast: vi.fn(), user: { id: 'a' } }))
vi.mock('../lib/api', () => ({ url: (p: string) => p, getToken: () => sessionStorage.getItem('user_session_token') || '', bookmarksApi: { list: mocks.list, replace: mocks.replace }, bookshelfApi: { get: mocks.shelf, add: mocks.add, remove: mocks.remove }, progressApi: { recent: mocks.recent } }))
vi.mock('../context/SessionContext', () => ({ useSession: () => ({ user: mocks.user, loading: false }) }))
vi.mock('../components/feedback', () => ({ useToast: () => ({ toast: mocks.toast }) }))
import Bookshelf from './Bookshelf'
import { addBookmark, addToBookshelf, getAllBookmarks, getBookshelf, setStorageUser } from '../lib/storage'
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear()
  sessionStorage.setItem('user_session_token', 'a'); setStorageUser('a')
  mocks.list.mockResolvedValue({ bookmarks: [] })
  mocks.shelf.mockResolvedValue({ favorites: [], thoughts: [] })
  mocks.recent.mockResolvedValue({ progress: [], tombstones: [] })
})
it('打开或手动同步书架只读云端，不回传旧设备收藏或复活书签', async () => {
  addBookmark('old', '旧书签', 'c', '', 1)
  addToBookshelf({ id: 'old', title: '旧收藏', author: '', chapterCount: 1 })
  render(<MemoryRouter><Bookshelf /></MemoryRouter>)
  await screen.findByText(/上次同步/)
  expect(getAllBookmarks()).toEqual([])
  expect(getBookshelf()).toEqual([])
  expect(mocks.replace).not.toHaveBeenCalled()
  expect(mocks.add).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '立即同步' }))
  await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2))
  expect(mocks.replace).not.toHaveBeenCalled()
  expect(mocks.add).not.toHaveBeenCalled()
})
it('云端删除失败时保留收藏并展示错误', async () => {
  mocks.shelf.mockResolvedValue({ favorites: [{ novelId: 'n', title: '云端书', author: '', chapterCount: 1 }], thoughts: [] })
  mocks.remove.mockRejectedValue(new Error('offline'))
  render(<MemoryRouter><Bookshelf /></MemoryRouter>)
  await screen.findByText('云端书')
  fireEvent.click(screen.getByRole('button', { name: '取消收藏' }))
  await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('offline', 'error'))
  expect(getBookshelf()).toHaveLength(1)
  expect(screen.getByText('云端书')).toBeInTheDocument()
})
