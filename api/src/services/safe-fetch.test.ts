import { afterEach, describe, expect, it, vi } from 'vitest'
import { lookup } from 'node:dns/promises'
import { assertPublicUrl, isPrivateIp, safeFetch, UnsafeUrlError } from './safe-fetch'

// 仅域名解析路径需要受控 DNS；其余用例（IP 字面量 / localhost / 协议错误）不会触达 lookup
vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }))

describe('isPrivateIp', () => {
  it('识别环回/私网/链路本地/保留 IPv4 地址段', () => {
    for (const ip of [
      '127.0.0.1', '10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1',
      '169.254.169.254', '100.64.0.1', '0.0.0.0', '192.0.0.8', '198.18.0.1',
      '224.0.0.1', '255.255.255.255',
    ]) {
      expect(isPrivateIp(ip), ip).toBe(true)
    }
  })

  it('识别 IPv6 环回/唯一本地/链路本地与 v4 映射形式', () => {
    for (const ip of ['::1', '::', 'fe80::1', 'fc00::1', 'fdff::1', '::ffff:10.0.0.1', '[::1]']) {
      expect(isPrivateIp(ip), ip).toBe(true)
    }
  })

  it('公网地址放行', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '223.5.5.5', '2606:4700::6810:84e5']) {
      expect(isPrivateIp(ip), ip).toBe(false)
    }
  })

  it('无法识别的输入按不安全处理', () => {
    expect(isPrivateIp('not-an-ip')).toBe(true)
    expect(isPrivateIp('')).toBe(true)
  })
})

describe('assertPublicUrl', () => {
  afterEach(() => {
    delete process.env.ALLOW_PRIVATE_FETCH
  })

  it('拒绝非 http/https 协议与非法 URL', async () => {
    await expect(assertPublicUrl('ftp://example.com/file')).rejects.toThrow(UnsafeUrlError)
    await expect(assertPublicUrl('file:///etc/passwd')).rejects.toThrow(UnsafeUrlError)
    await expect(assertPublicUrl('not a url')).rejects.toThrow(UnsafeUrlError)
  })

  it('拒绝内网 IP 字面量与本地主机名', async () => {
    await expect(assertPublicUrl('http://127.0.0.1:8787/api')).rejects.toThrow(/内网|保留/)
    await expect(assertPublicUrl('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(/内网|保留/)
    await expect(assertPublicUrl('http://[::1]:5432/')).rejects.toThrow(/内网|保留/)
    await expect(assertPublicUrl('http://localhost/admin')).rejects.toThrow(/本地主机名/)
    await expect(assertPublicUrl('http://db.internal/secrets')).rejects.toThrow(/本地主机名/)
  })

  it('公网 IP 字面量放行', async () => {
    const url = await assertPublicUrl('https://8.8.8.8/path')
    expect(url.hostname).toBe('8.8.8.8')
  })

  it('ALLOW_PRIVATE_FETCH=1 时跳过地址检查（逃生口）', async () => {
    process.env.ALLOW_PRIVATE_FETCH = '1'
    const url = await assertPublicUrl('http://127.0.0.1:9999/mirror')
    expect(url.hostname).toBe('127.0.0.1')
  })

  it('域名解析到 fake-ip 池（198.18/15）时附加代理接管 DNS 的提示', async () => {
    vi.mocked(lookup).mockResolvedValueOnce([{ address: '198.18.0.192', family: 4 }] as never)
    const err = await assertPublicUrl('https://wap.example-site.vip/list').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(UnsafeUrlError)
    expect((err as Error).message).toContain('198.18.0.192')
    expect((err as Error).message).toContain('fake-ip')
    expect((err as Error).message).toContain('ALLOW_PRIVATE_FETCH')
  })

  it('域名解析到普通内网地址时保持原文案，不提 fake-ip', async () => {
    vi.mocked(lookup).mockResolvedValueOnce([{ address: '10.0.0.5', family: 4 }] as never)
    const err = await assertPublicUrl('https://wap.example-site.vip/list').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(UnsafeUrlError)
    expect((err as Error).message).toContain('10.0.0.5')
    expect((err as Error).message).not.toContain('fake-ip')
  })
})

describe('safeFetch 重定向防护', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('公网站点 302 重定向到内网地址时阻断（经典 SSRF 绕过）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1:8787/api/internal' } }),
    ))
    await expect(safeFetch('https://93.184.216.34/page')).rejects.toThrow(/内网|保留/)
  })

  it('跟随公网重定向并返回最终响应', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { Location: 'https://93.184.216.35/final' } }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const res = await safeFetch('https://93.184.216.34/page')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('ok')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1]![0]).toBe('https://93.184.216.35/final')
  })

  it('重定向次数超限时报错', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(null, { status: 302, headers: { Location: 'https://93.184.216.34/loop' } }),
    ))
    await expect(safeFetch('https://93.184.216.34/start')).rejects.toThrow(/重定向次数/)
  })
})
