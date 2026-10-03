import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { verifyAdultChallenge, turnstileConfig } from './turnstile'

beforeEach(() => {
  vi.stubEnv('TURNSTILE_SITE_KEY', 'fixture-site')
  vi.stubEnv('TURNSTILE_SECRET_KEY', 'fixture-secret')
  vi.stubEnv('TURNSTILE_HOSTNAMES', 'read.example.com')
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })
describe('R18 Turnstile 服务端验证', () => {
  it('校验 success、hostname、action，且只向官方接口发送验证数据', async () => {
    const fetcher = vi.fn(async (_input: string, _init: RequestInit) => new Response(JSON.stringify({ success: true, hostname: 'read.example.com', action: 'r18_unlock' })))
    vi.stubGlobal('fetch', fetcher)
    expect(await verifyAdultChallenge('test-token', '192.0.2.1')).toBe(true)
    expect(fetcher).toHaveBeenCalledWith('https://challenges.cloudflare.com/turnstile/v0/siteverify', expect.objectContaining({ method: 'POST' }))
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual({ secret: 'fixture-secret', response: 'test-token', remoteip: '192.0.2.1' })
  })
  it.each([
    { success: false, hostname: 'read.example.com', action: 'r18_unlock' },
    { success: true, hostname: 'attacker.example.com', action: 'r18_unlock' },
    { success: true, hostname: 'read.example.com', action: 'login' },
    { success: true },
  ])('不接受错误验证响应 %j', async response => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(response))))
    expect(await verifyAdultChallenge('test-token', '')).toBe(false)
  })
  it('未配置、超长/缺失令牌、网络错误和非 2xx 全部拒绝', async () => {
    const fetcher = vi.fn(async () => { throw new Error('offline') })
    vi.stubGlobal('fetch', fetcher)
    expect(await verifyAdultChallenge(undefined, '')).toBe(false)
    expect(await verifyAdultChallenge('x'.repeat(2049), '')).toBe(false)
    expect(fetcher).not.toHaveBeenCalled()
    expect(await verifyAdultChallenge('test-token', '')).toBe(false)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })))
    expect(await verifyAdultChallenge('test-token', '')).toBe(false)
    vi.stubEnv('TURNSTILE_SECRET_KEY', '')
    expect(turnstileConfig().configured).toBe(false)
    expect(await verifyAdultChallenge('test-token', '')).toBe(false)
  })
})
