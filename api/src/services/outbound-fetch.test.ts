import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, type AddressInfo } from 'node:net'
import {
  clearOutboundRequestLogs,
  describeError,
  listOutboundRequestLogs,
  outboundFetch,
  probeProxyConnectivity,
  resolveOutboundProxy,
} from './outbound-fetch'

describe('统一出站代理', () => {
  beforeEach(() => {
    clearOutboundRequestLogs()
    vi.spyOn(console, 'info').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('环境代理优先于管理端代理', () => {
    const selected = resolveOutboundProxy('https://api.example.com/v1', {
      proxyBase: 'http://127.0.0.1:7890',
      httpsProxy: 'http://172.18.0.1:7890',
    })
    expect(selected).toEqual({ url: 'http://172.18.0.1:7890', source: 'environment' })
  })

  it('管理端代理全局生效，跳过规则走直连', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }))
    const proxyConfig = { proxyBase: 'http://127.0.0.1:7890', proxyBypass: '.internal.example.com' }

    await outboundFetch('https://api.example.com/v1', {}, { scope: 'ai-text', proxyConfig })
    await outboundFetch('https://service.internal.example.com/health', {}, { scope: 'health', proxyConfig })

    expect((fetchMock.mock.calls[0]?.[1] as { dispatcher?: unknown }).dispatcher).toBeTruthy()
    expect((fetchMock.mock.calls[1]?.[1] as { dispatcher?: unknown }).dispatcher).toBeUndefined()
    expect(listOutboundRequestLogs()).toEqual([
      expect.objectContaining({ scope: 'health', proxySource: 'none' }),
      expect.objectContaining({ scope: 'ai-text', proxySource: 'runtime', proxyHost: '127.0.0.1:7890' }),
    ])
  })

  it('日志移除查询参数、代理凭据和错误详情', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('token=top-secret'))

    await expect(
      outboundFetch(
        'https://api.example.com/v1/images?api_key=top-secret',
        {
          headers: { Authorization: 'Bearer top-secret' },
        },
        {
          scope: 'ai-image',
          proxyConfig: { proxyBase: 'http://proxy-user:proxy-pass@127.0.0.1:7890' },
        },
      ),
    ).rejects.toThrow()

    const serialized = JSON.stringify(listOutboundRequestLogs())
    expect(serialized).not.toContain('top-secret')
    expect(serialized).not.toContain('proxy-user')
    expect(serialized).not.toContain('proxy-pass')
    expect(listOutboundRequestLogs()[0]).toMatchObject({
      target: 'https://api.example.com/v1/images',
      proxyHost: '127.0.0.1:7890',
      error: 'token=***',
    })
  })

  it('安全请求的每次重定向都重新选择代理并记录日志', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: 'https://cdn.example.com/file?signature=secret' } }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))

    process.env.ALLOW_PRIVATE_FETCH = '1'
    try {
      const response = await outboundFetch(
        'https://api.example.com/start',
        {},
        { safe: true, scope: 'redirect', proxyConfig: { proxyBase: 'http://127.0.0.1:7890' } },
      )
      expect(response.status).toBe(200)
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(listOutboundRequestLogs()).toHaveLength(2)
      expect(JSON.stringify(listOutboundRequestLogs())).not.toContain('signature')
      expect((fetchMock.mock.calls[1]?.[1] as { dispatcher?: unknown }).dispatcher).toBeTruthy()
    } finally {
      delete process.env.ALLOW_PRIVATE_FETCH
    }
  })

  it('describeError 沿 cause 链展开真实原因并脱敏', () => {
    const inner = new Error('connect ECONNREFUSED 172.18.0.1:7890')
    const outer = new TypeError('fetch failed')
    ;(outer as { cause?: unknown }).cause = inner
    expect(describeError(outer)).toBe('fetch failed → connect ECONNREFUSED 172.18.0.1:7890')

    expect(describeError(new Error('token=top-secret'))).toBe('token=***')
    expect(describeError(new Error('Authorization: Bearer abc.def.ghi'))).toBe('Authorization: Bearer ***')
    expect(describeError(new Error('GET https://x.com/a?api_key=abc123'))).toBe('GET https://x.com/a?api_key=***')
    expect(describeError('boom')).toBe('boom')
    expect(describeError(undefined)).toBe('Error')
    expect(describeError(null)).toBe('Error')
  })

  it('probeProxyConnectivity 探测可达性与拒绝连接', async () => {
    const server = createServer()
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    const url = `http://127.0.0.1:${port}`
    try {
      expect(await probeProxyConnectivity(url)).toBeNull()
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
    const refused = await probeProxyConnectivity(url, 1500)
    expect(refused).toMatch(/无法连接代理服务器/)
    expect(await probeProxyConnectivity('not-a-url')).toMatch(/代理地址格式不正确/)
  })
})
