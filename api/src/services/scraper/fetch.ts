/**
 * HTML 抓取与编码检测 —— 由 Novel-KV _scrape-fetch.js 平移。
 * 纯 fetch + TextDecoder；支持 Docker 环境代理与后台开发代理。
 */
import { describeError, outboundFetch, resolveOutboundProxy, shouldBypassProxy, type OutboundProxyConfig } from '../outbound-fetch'

export { shouldBypassProxy }

export const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 13; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'zh-CN,zh;q=0.9',
}

export interface FetchHtmlOptions extends OutboundProxyConfig {
  forceEncoding?: string
  timeoutMs?: number
  scope?: string
  method?: string
  body?: RequestInit['body']
  /** 仅用于管理员连通性探测，忽略跳过代理规则。 */
  forceProxy?: boolean
  /** 仅由受信任的源站会话适配器注入，不会写入日志。 */
  headers?: Headers | Record<string, string> | Array<[string, string]>
  /** 仅在携带站点 Cookie 时使用，限制安全抓取的重定向目标。 */
  allowedRedirectHosts?: string[]
}

export interface FetchResult {
  html: string
  encoding: string
  /** 跟随安全重定向后的最终 URL，用于识别登录页、拦截页和失效链接。 */
  finalUrl?: string
  /** 仅供同一受信任站点的后续请求合并 Cookie，不向 API 返回。 */
  setCookies?: string[]
}

function responseSetCookies(headers: Headers): string[] {
  const typed = headers as Headers & { getSetCookie?: () => string[] }
  const values = typed.getSetCookie?.()
  if (values?.length) return values
  const raw = headers.get('set-cookie') || ''
  return raw ? raw.split(/,(?=\s*[^;,=\s]+=[^;,]*)/) : []
}

function proxyOverrides(opts: FetchHtmlOptions): OutboundProxyConfig | undefined {
  const config = {
    proxyBase: opts.proxyBase,
    proxyBypass: opts.proxyBypass,
    httpProxy: opts.httpProxy,
    httpsProxy: opts.httpsProxy,
    noProxy: opts.noProxy,
  }
  return Object.values(config).some((value) => value !== undefined) ? config : undefined
}

/** Backward-compatible helper for callers that only need the selected proxy URL. */
export function resolveProxyUrl(targetUrl: string, opts: FetchHtmlOptions = {}): string {
  return resolveOutboundProxy(targetUrl, proxyOverrides(opts), opts.forceProxy)?.url || ''
}

export async function fetchHtml(url: string, opts: FetchHtmlOptions = {}): Promise<FetchResult> {
  const proxyUrl = resolveProxyUrl(url, opts)
  const timeoutMs = opts.timeoutMs || 28000
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  let res: Response
  try {
    const headers = new Headers(FETCH_HEADERS)
    if (opts.headers) {
      new Headers(opts.headers).forEach((value, key) => headers.set(key, value))
    }
    const requestInit: RequestInit = { headers, signal: controller.signal }
    if (opts.method) requestInit.method = opts.method
    if (opts.body !== undefined) requestInit.body = opts.body
    res = await outboundFetch(url, requestInit, {
      scope: opts.scope || 'scrape',
      safe: true,
      allowedRedirectHosts: opts.allowedRedirectHosts,
      forceProxy: opts.forceProxy,
      proxyConfig: proxyOverrides(opts),
    })
  } catch (err) {
    clearTimeout(timeout)
    if ((err as Error).name === 'AbortError') throw new Error(`请求超时 (${Math.round(timeoutMs / 1000)}s): ${url}`)
    if (proxyUrl) throw new Error(`代理请求失败: ${describeError(err)}`)
    throw err
  }
  clearTimeout(timeout)

  if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`)

  const arrayBuffer = await res.arrayBuffer()
  const bytes = new Uint8Array(arrayBuffer)

  let encoding: string | null = null
  const contentType = res.headers.get('Content-Type') || ''
  const headerMatch = contentType.match(/charset=([^\s;]+)/i)
  if (headerMatch) encoding = headerMatch[1]!.toLowerCase()

  const head = new TextDecoder('utf-8').decode(bytes.slice(0, 2048))
  const metaMatch = head.match(/<meta[^>]+charset\s*=\s*["']?([a-zA-Z0-9_-]+)/i)
  if (metaMatch) {
    const metaCharset = metaMatch[1]!.toLowerCase()
    if (!encoding || metaCharset !== encoding) encoding = metaCharset
  }

  const forceEncoding = opts.forceEncoding
  if ((!encoding || encoding === 'utf-8') && forceEncoding && forceEncoding !== 'utf-8') {
    try {
      const gbkText = new TextDecoder('gb18030', { fatal: false }).decode(bytes)
      const utf8Text = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
      const gbkChinese = (gbkText.match(/[一-鿿]/g) || []).length
      const utf8Chinese = (utf8Text.match(/[一-鿿]/g) || []).length
      encoding = gbkChinese > utf8Chinese ? 'gbk' : encoding || 'utf-8'
    } catch {
      encoding = forceEncoding
    }
  }

  encoding = encoding || forceEncoding || null
  const html = decodeBytes(bytes, encoding || 'utf-8')
  return { html, encoding: encoding || 'utf-8', finalUrl: res.url || url, setCookies: responseSetCookies(res.headers) }
}

export function decodeBytes(bytes: Uint8Array, encoding: string): string {
  const enc = encoding.toLowerCase()

  if (enc === 'gbk' || enc === 'gb2312' || enc === 'gb18030') {
    try {
      return new TextDecoder('gb18030', { fatal: false }).decode(bytes)
    } catch {
      throw new Error('当前运行时不支持 GB18030 解码，请使用本地模式抓取')
    }
  }
  if (enc === 'big5') {
    try {
      return new TextDecoder('big5', { fatal: false }).decode(bytes)
    } catch {
      throw new Error('当前运行时不支持 Big5 解码')
    }
  }

  return new TextDecoder(enc || 'utf-8', { fatal: false }).decode(bytes)
}
