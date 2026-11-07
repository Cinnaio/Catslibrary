import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { request, clearToken, setToken } from './api'
import type { ChallengeRequest } from './security-challenge'

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  clearToken()
})
afterEach(() => {
  vi.unstubAllGlobals()
  clearToken()
})
function transport(action = 'forgot-password', mode = 'enforce') {
  const mock = vi.fn(
    async (url: string) =>
      new Response(JSON.stringify(url.includes('/security/challenge') ? { action, mode, configured: true, siteKey: 'fixture' } : { success: true })),
  )
  vi.stubGlobal('fetch', mock)
  return mock
}
function complete(token: string | null, changeAccount = false) {
  const handler = (e: Event) => {
    if (changeAccount) setToken('other')
    ;(e as CustomEvent<ChallengeRequest>).detail.finish(token)
  }
  window.addEventListener('zz-security-challenge', handler, { once: true })
}
it('验证通过后仅提交一次原申请，带有对应场景令牌', async () => {
  const fetcher = transport()
  complete('fixture-token')
  await request('POST', '/auth/forgot-password', { identifier: 'reader' })
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(JSON.parse((fetcher.mock.calls[1] as unknown as [string, RequestInit])[1].body as string)).toEqual({
    identifier: 'reader',
    turnstileToken: 'fixture-token',
  })
})
it('取消验证不提交邮件申请，原输入对象不被修改', async () => {
  const fetcher = transport()
  complete(null)
  const draft = { identifier: 'reader' }
  await expect(request('POST', '/auth/forgot-password', draft)).rejects.toThrow('已取消')
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(draft).toEqual({ identifier: 'reader' })
})
it('验证期间切换账号阻止旧账号写入', async () => {
  const fetcher = transport('verify-email')
  setToken('reader')
  complete('fixture', true)
  await expect(request('POST', '/auth/email/request', { email: 'a@example.test', currentPassword: 'fixture' }, true)).rejects.toThrow('账号已变化')
  expect(fetcher).toHaveBeenCalledTimes(1)
})
it('观察模式无需弹窗，配置请求失败或结构无效时不提交', async () => {
  const fetcher = transport('login', 'observe')
  await request('POST', '/auth/login', { username: 'reader', password: 'fixture' })
  expect(fetcher).toHaveBeenCalledTimes(2)
  fetcher.mockResolvedValueOnce(new Response('{"error":"暂不可用"}', { status: 503 }))
  await expect(request('POST', '/auth/login', {})).rejects.toThrow('暂不可用')
  fetcher.mockResolvedValueOnce(new Response('{}'))
  await expect(request('POST', '/auth/login', {})).rejects.toThrow('配置无效')
  expect(fetcher).toHaveBeenCalledTimes(4)
})
