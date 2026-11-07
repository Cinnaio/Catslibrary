import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { authApi, authFetch, clearToken, setToken, getToken, siteSettingsApi } from './api'
import { addBookmark, getAllBookmarks, getStorageScope, setStorageUser } from './storage'
beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  clearToken()
})
afterEach(() => {
  vi.unstubAllGlobals()
  clearToken()
})
it('登录响应和刷新身份都绑定用户缓存，刷新页面后可恢复同一用户缓存', async () => {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => new Response(JSON.stringify(url.includes('/security/challenge') ? {action:'login',mode:'off',configured:false} : {token:'token-a',user:{id:'a'}}))))
  await authApi.login('a', 'password')
  expect(getStorageScope()).toBe('user:a')
  addBookmark('n', '', 'c', '', 1)
  clearToken()
  setToken('token-a')
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
  localStorage.setItem('user_session_marker', 'b')
  expect((await authApi.meCached()).user?.id).toBe('b')
  expect(getStorageScope()).toBe('user:b')
  expect(fetch).toHaveBeenCalledTimes(2)
})
it('旧身份请求迟到不能覆盖新身份的存储归属', async () => {
  let resolve!: (value: Response) => void
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolve = r
          }),
      )
      .mockResolvedValueOnce(new Response('{"user":{"id":"b"}}')),
  )
  setToken('a')
  const old = authApi.meCached()
  setToken('b')
  await authApi.meCached()
  resolve(new Response('{"user":{"id":"a"}}'))
  await old
  expect(getStorageScope()).toBe('user:b')
})
it('记住登录传给服务端，改密码仍保留持久会话偏好', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response('{"action":"login","mode":"off","configured":false}')).mockResolvedValueOnce(new Response('{"token":"a","user":{"id":"a"}}')).mockResolvedValueOnce(new Response('{"token":"b"}'))
  vi.stubGlobal('fetch', fetch)
  await authApi.login('a', 'password', true)
  expect(JSON.parse(fetch.mock.calls[1]![1].body)).toMatchObject({ remember: true })
  await authApi.changePassword('password', 'newpassword')
  expect(localStorage.getItem('user_session_token')).toBeNull()
  expect(localStorage.getItem('user_session_persist')).toBe('1')
  expect(getToken()).toBeTruthy()
})
it('资料更新失效身份缓存，后续刷新返回实际新资料', async () => {
  setToken('a')
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response('{"user":{"id":"a","displayName":"旧"}}'))
    .mockResolvedValueOnce(new Response('{"user":{"id":"a","displayName":"新"}}'))
    .mockResolvedValueOnce(new Response('{"user":{"id":"a","displayName":"新"}}'))
  vi.stubGlobal('fetch', fetch)
  await authApi.meCached()
  await authApi.update({ displayName: '新' })
  expect((await authApi.meCached()).user?.displayName).toBe('新')
})
it('退出所有设备失败不能当成功，也不能清除当前 token', async () => {
  setToken('a')
  const marker = getToken()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":"offline"}', { status: 503 })))
  await expect(authApi.logoutAll()).rejects.toThrow('offline')
  expect(getToken()).toBe(marker)
})
it('网页登录不保存返回的秘密，写入与上传自动携带 Cookie 和来源校验头', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response('{"action":"login","mode":"off","configured":false}')).mockResolvedValueOnce(new Response('{"user":{"id":"a"}}'))
  vi.stubGlobal('fetch', fetcher)
  await authApi.login('a', 'password')
  expect(localStorage.getItem('user_session_token')).toBeNull()
  expect(sessionStorage.getItem('user_session_token')).toBeNull()
  expect(getToken()).toBeTruthy()
  const options = fetcher.mock.calls[1]![1] as RequestInit
  expect(options.credentials).toBe('include')
  expect(new Headers(options.headers).get('X-ZZ-CSRF')).toBe('1')
  expect(new Headers(options.headers).get('Authorization')).toBeNull()
})
it('旧凭据只用于一次轮换，随后清除，后续身份查询不发送 Bearer', async () => {
  localStorage.setItem('user_session_token', 'legacy-secret')
  const fetcher = vi.fn().mockResolvedValueOnce(new Response('{"user":{"id":"a"}}')).mockResolvedValueOnce(new Response('{"user":{"id":"a"}}'))
  vi.stubGlobal('fetch', fetcher)
  await authApi.meCached()
  expect(new Headers(fetcher.mock.calls[0]![1].headers).get('Authorization')).toBe('Bearer legacy-secret')
  expect(new Headers(fetcher.mock.calls[1]![1].headers).get('Authorization')).toBeNull()
  expect(localStorage.getItem('user_session_token')).toBeNull()
  expect(getStorageScope()).toBe('user:a')
})
it('没有本地登录标记时也检查服务端 Cookie；退出网络失败不会假装成功', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(new Response('{"user":{"id":"a"}}'))
    .mockResolvedValueOnce(new Response('{"error":"offline"}', { status: 503 }))
  vi.stubGlobal('fetch', fetcher)
  expect((await authApi.meCached()).user?.id).toBe('a')
  const marker = getToken()
  await expect(authApi.logout()).rejects.toThrow('offline')
  expect(getToken()).toBe(marker)
})
it('管理写入直接使用当前会话，保留操作标识且只提交一次', async () => {
  const { request } = await import('./api')
  setToken('a'); setStorageUser('a')
  const fetcher = vi.fn().mockResolvedValue(new Response('{"success":true}'))
  vi.stubGlobal('fetch', fetcher)
  expect(await request('PUT', '/admin/backups/settings', { revision: 1 }, true, { 'Idempotency-Key': 'settings-operation' })).toEqual({ success: true })
  expect(fetcher).toHaveBeenCalledOnce()
  const options = fetcher.mock.calls[0]![1] as RequestInit
  expect(options.credentials).toBe('include')
  expect(new Headers(options.headers).get('X-ZZ-Account')).toBe('a')
  expect(new Headers(options.headers).get('X-ZZ-CSRF')).toBe('1')
  expect(new Headers(options.headers).get('Idempotency-Key')).toBe('settings-operation')
  expect(JSON.parse(options.body as string)).toEqual({ revision: 1 })
})

it('被拒绝的管理写入和上传直接报错，不弹出密码验证或自动重试', async () => {
  const { request } = await import('./api')
  setToken('a'); setStorageUser('a')
  const marker = getToken()
  const fetcher = vi.fn().mockImplementation(async () => new Response('{"code":"reauth_required","error":"请求被拒绝"}', { status: 403 }))
  vi.stubGlobal('fetch', fetcher)
  const prompt = vi.fn((event: Event) => (event as CustomEvent).detail.finish(false))
  window.addEventListener('zz-reauthenticate', prompt)
  try {
    await expect(request('PUT', '/admin/backups/settings', { revision: 1 }, true)).rejects.toThrow('请求被拒绝')
    await expect(siteSettingsApi.upload('logo', new File(['image'], 'logo.png'))).rejects.toThrow('请求被拒绝')
    expect(fetcher.mock.calls[1]![1].body).toBeInstanceOf(FormData)
    expect(new Headers(fetcher.mock.calls[1]![1].headers).get('X-ZZ-Account')).toBe('a')
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(prompt).not.toHaveBeenCalled()
    expect(getToken()).toBe(marker)
  } finally { window.removeEventListener('zz-reauthenticate', prompt) }
})

it.each(['request', 'authFetch'])('%s 的旧请求返回 401 不清理新账号会话', async (client) => {
  const { request } = await import('./api')
  setToken('a'); setStorageUser('a')
  let resolve!: (value: Response) => void
  const fetcher = vi.fn().mockImplementationOnce(() => new Promise(done => { resolve = done }))
  vi.stubGlobal('fetch', fetcher)
  const old = client === 'request' ? request('GET', '/asset', null, true) : authFetch('/asset')
  setToken('b'); setStorageUser('b')
  const marker = getToken()
  resolve(new Response('{}', { status: 401 }))
  if (client === 'request') await expect(old).rejects.toThrow('HTTP 401')
  else expect((await old as Response).status).toBe(401)
  expect(getToken()).toBe(marker)
  expect(getStorageScope()).toBe('user:b')
  expect(fetcher).toHaveBeenCalledOnce()
})
