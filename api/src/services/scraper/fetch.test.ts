import { describe, expect, it } from 'vitest'
import { resolveProxyUrl, shouldBypassProxy } from './fetch'

describe('scraper 标准代理解析', () => {
  it('HTTPS_PROXY 优先于后台开发代理', () => {
    expect(
      resolveProxyUrl('https://czbooks.net/book/1', {
        proxyBase: 'http://127.0.0.1:7890',
        httpsProxy: 'http://172.18.0.1:7890',
      }),
    ).toBe('http://172.18.0.1:7890')
  })

  it('HTTP 目标使用 HTTP_PROXY，HTTPS 目标可回退到 HTTP_PROXY', () => {
    const options = { httpProxy: 'http://host.docker.internal:7890' }
    expect(resolveProxyUrl('http://example.com', options)).toBe(options.httpProxy)
    expect(resolveProxyUrl('https://example.com', options)).toBe(options.httpProxy)
  })

  it('环境代理遵循 NO_PROXY，管理员测试可强制绕过', () => {
    const options = {
      httpsProxy: 'http://172.18.0.1:7890',
      noProxy: 'localhost,.internal.example.com,api.example.com:8443',
    }
    expect(resolveProxyUrl('https://service.internal.example.com', options)).toBe('')
    expect(resolveProxyUrl('https://api.example.com:8443', options)).toBe('')
    expect(resolveProxyUrl('https://api.example.com', options)).toBe(options.httpsProxy)
    expect(resolveProxyUrl('https://service.internal.example.com', { ...options, forceProxy: true })).toBe(options.httpsProxy)
  })

  it('后台开发代理默认处理所有目标，并支持跳过列表', () => {
    const options = { proxyBase: 'http://127.0.0.1:7890', proxyBypass: 'example.org' }
    expect(resolveProxyUrl('https://www.czbooks.net/book/1', options)).toBe(options.proxyBase)
    expect(resolveProxyUrl('https://example.org/book/1', options)).toBe('')
    expect(resolveProxyUrl('https://api.other.example/book/1', options)).toBe(options.proxyBase)
  })

  it('NO_PROXY 支持全局通配和端口匹配', () => {
    expect(shouldBypassProxy('https://example.com', '*')).toBe(true)
    expect(shouldBypassProxy('https://example.com:8443', 'example.com:8443')).toBe(true)
    expect(shouldBypassProxy('https://example.com', 'example.com:8443')).toBe(false)
    expect(shouldBypassProxy('http://[::1]:8787', '::1')).toBe(true)
  })
})
