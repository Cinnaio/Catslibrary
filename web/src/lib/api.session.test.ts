import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { authApi, clearToken, setToken } from './api'
import { addBookmark, getAllBookmarks, getStorageScope } from './storage'
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); clearToken() })
afterEach(() => { vi.unstubAllGlobals(); clearToken() })
it('登录响应和刷新身份都绑定用户缓存，刷新页面后可恢复同一用户缓存', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ token: 'token-a', user: { id: 'a' } }))))
  await authApi.login('a', 'password')
  expect(getStorageScope()).toBe('user:a')
  addBookmark('n', '', 'c', '', 1)
  clearToken(); setToken('token-a')
  expect(getAllBookmarks()).toEqual([])
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ user: { id: 'a' } }))))
  await authApi.meCached()
  expect(getAllBookmarks()).toHaveLength(1)
})
it('另一窗口改变 token 后 meCached 不复用旧身份', async () => {
  setToken('a')
  const fetch = vi.fn().mockResolvedValueOnce(new Response('{"user":{"id":"a"}}')).mockResolvedValueOnce(new Response('{"user":{"id":"b"}}'))
  vi.stubGlobal('fetch', fetch)
  await authApi.meCached()
  sessionStorage.setItem('user_session_token', 'b')
  expect((await authApi.meCached()).user?.id).toBe('b')
  expect(getStorageScope()).toBe('user:b')
  expect(fetch).toHaveBeenCalledTimes(2)
})
it('旧身份请求迟到不能覆盖新身份的存储归属', async () => {
  let resolve!: (value: Response) => void
  vi.stubGlobal('fetch', vi.fn().mockImplementationOnce(() => new Promise(r => { resolve = r })).mockResolvedValueOnce(new Response('{"user":{"id":"b"}}')))
  setToken('a'); const old = authApi.meCached()
  setToken('b'); await authApi.meCached()
  resolve(new Response('{"user":{"id":"a"}}')); await old
  expect(getStorageScope()).toBe('user:b')
})
