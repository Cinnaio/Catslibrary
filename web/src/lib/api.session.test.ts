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
it('记住登录传给服务端，改密码仍保留持久会话偏好', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response('{"token":"a","user":{"id":"a"}}')).mockResolvedValueOnce(new Response('{"token":"b"}'))
  vi.stubGlobal('fetch', fetch)
  await authApi.login('a', 'password', true)
  expect(JSON.parse(fetch.mock.calls[0]![1].body)).toMatchObject({ remember: true })
  await authApi.changePassword('password', 'newpassword')
  expect(localStorage.getItem('user_session_token')).toBe('b')
})
it('资料更新失效身份缓存，后续刷新返回实际新资料', async () => {
  setToken('a')
  const fetch = vi.fn().mockResolvedValueOnce(new Response('{"user":{"id":"a","displayName":"旧"}}')).mockResolvedValueOnce(new Response('{"user":{"id":"a","displayName":"新"}}')).mockResolvedValueOnce(new Response('{"user":{"id":"a","displayName":"新"}}'))
  vi.stubGlobal('fetch', fetch)
  await authApi.meCached(); await authApi.update({ displayName: '新' })
  expect((await authApi.meCached()).user?.displayName).toBe('新')
})
it('退出所有设备失败不能当成功，也不能清除当前 token', async () => {
  setToken('a')
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":"offline"}', { status: 503 })))
  await expect(authApi.logoutAll()).rejects.toThrow('offline')
  expect(sessionStorage.getItem('user_session_token')).toBe('a')
})
