import { beforeEach, expect, it } from 'vitest'
import { addBookmark, addToBookshelf, getAllBookmarks, getBookshelf, getHistory, saveHistory, setStorageUser } from './storage'

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); setStorageUser(null) })
function account(id: string) {
  sessionStorage.setItem('user_session_token', 'token-' + id)
  setStorageUser(id)
}
it('阅读历史、书签、书架按账号隔离，切回账号可恢复自己的缓存', () => {
  account('a')
  saveHistory('n', { chapterId: 'c' })
  addBookmark('n', 'A的书', 'c', '第一章', 1)
  addToBookshelf({ id: 'n', title: 'A的书', author: '', chapterCount: 1 })
  account('b')
  expect(getHistory()).toEqual({})
  expect(getAllBookmarks()).toEqual([])
  expect(getBookshelf()).toEqual([])
  account('a')
  expect(getHistory().n?.chapterId).toBe('c')
  expect(getAllBookmarks()).toHaveLength(1)
  expect(getBookshelf()).toHaveLength(1)
})
it('游客与账号隔离，不自动归属或删除旧的全局缓存', () => {
  const legacy = '[{"novelId":"old","chapterId":"old"}]'
  localStorage.setItem('novel_bookmarks', legacy)
  addBookmark('guest', '', 'guest', '', 1)
  account('a')
  expect(getAllBookmarks()).toEqual([])
  sessionStorage.removeItem('user_session_token')
  setStorageUser(null)
  expect(getAllBookmarks()[0]?.novelId).toBe('guest')
  expect(localStorage.getItem('novel_bookmarks')).toBe(legacy)
})
it('token 变化但身份未确认时不能读取旧账号或写入待确认缓存', () => {
  account('a')
  addBookmark('n', '', 'c', '', 1)
  sessionStorage.setItem('user_session_token', 'new-token')
  expect(getAllBookmarks()).toEqual([])
  addBookmark('other', '', 'other', '', 1)
  expect(getAllBookmarks()).toEqual([])
})
