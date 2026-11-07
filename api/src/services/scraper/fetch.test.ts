import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import { fetchHtml, MAX_HTML_BYTES, resolveProxyUrl, shouldBypassProxy } from './fetch'

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('正文下载限制', () => {
  it('收到响应头后正文停顿仍触发总超时并关闭请求', async () => {
    vi.stubEnv('ALLOW_PRIVATE_FETCH', '1')
    let sentHeaders!: () => void
    const headersReady = new Promise<void>(resolve => { sentHeaders = resolve })
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/html' })
      response.write('<p>')
      sentHeaders()
      // 故意不结束正文；服务端由测试 finally 关闭。
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address() as { port: number }
      const result = fetchHtml(`http://127.0.0.1:${address.port}/`, { timeoutMs: 300 }).then(value => value, error => error as Error)
      await headersReady
      expect(await result).toMatchObject({ message: expect.stringContaining('请求超时') })
    } finally {
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })

  it.each([undefined, '1'])('正文实际超限时取消读取，声明长度为 %s', async declared => {
    vi.stubEnv('ALLOW_PRIVATE_FETCH', '1')
    const cancel = vi.fn()
    let sent = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array(++sent === 1 ? MAX_HTML_BYTES : 1)) },
      cancel,
    }, { highWaterMark: 0 })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream, {
      headers: declared ? { 'Content-Length': declared } : {},
    })))
    await expect(fetchHtml('http://127.0.0.1/')).rejects.toThrow('16 MiB')
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(sent).toBe(2)
  })

  it('正常页面保留编码、内容和来源信息，声明超限则不读取正文', async () => {
    vi.stubEnv('ALLOW_PRIVATE_FETCH', '1')
    const fetch = vi.fn().mockResolvedValueOnce(new Response('<p>正常正文</p>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } }))
    vi.stubGlobal('fetch', fetch)
    await expect(fetchHtml('http://127.0.0.1/book')).resolves.toMatchObject({ html: '<p>正常正文</p>', encoding: 'utf-8', finalUrl: 'http://127.0.0.1/book' })
    const cancel = vi.fn(), pull = vi.fn()
    fetch.mockResolvedValueOnce(new Response(new ReadableStream({ pull, cancel }, { highWaterMark: 0 }), { headers: { 'Content-Length': String(MAX_HTML_BYTES + 1) } }))
    await expect(fetchHtml('http://127.0.0.1/')).rejects.toThrow('16 MiB')
    expect(pull).not.toHaveBeenCalled()
    expect(cancel).toHaveBeenCalledTimes(1)
  })
})

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
