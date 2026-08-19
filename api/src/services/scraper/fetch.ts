/**
 * HTML 抓取与编码检测 —— 由 Novel-KV _scrape-fetch.js 平移。
 * 纯 fetch + TextDecoder；支持 Docker 环境代理与后台开发代理。
 */
import { assertPublicUrl, safeFetch } from '../safe-fetch'
import { ProxyAgent } from 'undici'

export const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 13; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'zh-CN,zh;q=0.9',
}

export const DEFAULT_PROXY_DOMAINS = ['czbooks.net']

export interface FetchHtmlOptions {
  forceEncoding?: string
  timeoutMs?: number
  /** 后台运行时保存的代理，作为开发环境回退。 */
  proxyBase?: string
  proxyDomains?: string
  /** Docker / 系统环境变量代理，优先于后台运行时配置。 */
  httpProxy?: string
  httpsProxy?: string
  noProxy?: string
  /** 仅用于管理员连通性探测，忽略域名与 NO_PROXY 规则。 */
  forceProxy?: boolean
}

export interface FetchResult {
  html: string
  encoding: string
}

const proxyAgents = new Map<string, ProxyAgent>()

function proxyAgent(proxyUrl: string): NonNullable<RequestInit['dispatcher']> {
  let agent = proxyAgents.get(proxyUrl)
  if (!agent) {
    agent = new ProxyAgent(proxyUrl)
    proxyAgents.set(proxyUrl, agent)
  }
  // Node 22 的全局 fetch 使用内置 undici-types；外部 undici 的 Dispatcher
  // 运行时协议兼容，但声明版本不同，因此仅在边界处收窄转换。
  return agent as unknown as NonNullable<RequestInit['dispatcher']>
}

function hostMatches(host: string, rule: string): boolean {
  const normalizedHost = host.replace(/^\[|\]$/g, '')
  const normalized = rule
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/^\./, '')
  return Boolean(normalized) && (normalizedHost === normalized || normalizedHost.endsWith('.' + normalized))
}

export function shouldBypassProxy(targetUrl: string, noProxy = ''): boolean {
  const target = new URL(targetUrl)
  const host = target.hostname.toLowerCase()
  const port = target.port || (target.protocol === 'https:' ? '443' : '80')
  return noProxy
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .some((rule) => {
      if (rule === '*') return true
      let ruleHost = rule
      let rulePort = ''
      if (rule.startsWith('[')) {
        const bracket = rule.indexOf(']')
        if (bracket > 0) {
          ruleHost = rule.slice(1, bracket)
          if (rule[bracket + 1] === ':') rulePort = rule.slice(bracket + 2)
        }
      } else if ((rule.match(/:/g) || []).length === 1) {
        const portIndex = rule.lastIndexOf(':')
        if (/^\d+$/.test(rule.slice(portIndex + 1))) {
          ruleHost = rule.slice(0, portIndex)
          rulePort = rule.slice(portIndex + 1)
        }
      }
      return (!rulePort || rulePort === port) && hostMatches(host, ruleHost)
    })
}

function shouldUseRuntimeProxy(targetUrl: string, proxyDomains?: string): boolean {
  const host = new URL(targetUrl).hostname.toLowerCase()
  const domains = (proxyDomains || DEFAULT_PROXY_DOMAINS.join(','))
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
  return domains.some((domain) => hostMatches(host, domain))
}

/** 解析某个目标最终使用的标准 HTTP Forward Proxy。部署环境变量始终优先。 */
export function resolveProxyUrl(targetUrl: string, opts: FetchHtmlOptions = {}): string {
  const target = new URL(targetUrl)
  const environmentProxy = target.protocol === 'https:' ? (opts.httpsProxy || opts.httpProxy || '').trim() : (opts.httpProxy || '').trim()
  if (environmentProxy) {
    if (!opts.forceProxy && shouldBypassProxy(target.href, opts.noProxy)) return ''
    return environmentProxy
  }
  const runtimeProxy = (opts.proxyBase || '').trim()
  if (!runtimeProxy) return ''
  return opts.forceProxy || shouldUseRuntimeProxy(target.href, opts.proxyDomains) ? runtimeProxy : ''
}

export async function fetchHtml(url: string, opts: FetchHtmlOptions = {}): Promise<FetchResult> {
  // SSRF 防护仍校验最终目标；代理地址由管理员或部署环境控制。
  await assertPublicUrl(url)
  const proxyUrl = resolveProxyUrl(url, opts)
  const timeoutMs = opts.timeoutMs || 28000
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  let res: Response
  try {
    res = await safeFetch(url, {
      headers: FETCH_HEADERS,
      signal: controller.signal,
      ...(proxyUrl ? { dispatcher: proxyAgent(proxyUrl) } : {}),
    })
  } catch (err) {
    clearTimeout(timeout)
    if ((err as Error).name === 'AbortError') throw new Error(`请求超时 (${Math.round(timeoutMs / 1000)}s): ${url}`)
    if (proxyUrl) throw new Error(`代理请求失败: ${(err as Error).message}`)
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
  return { html, encoding: encoding || 'utf-8' }
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
