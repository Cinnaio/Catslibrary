/**
 * HTML 抓取与编码检测 —— 由 Novel-KV _scrape-fetch.js 平移。
 * 纯 fetch + TextDecoder；浏览器代理（反爬）为可选，通过 opts.proxyBase 接入。
 */
import { assertPublicUrl, safeFetch } from '../safe-fetch'

export const FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Linux; Android 13; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'zh-CN,zh;q=0.9',
}

export const DEFAULT_PROXY_DOMAINS = ['czbooks.net']

export interface FetchHtmlOptions {
  forceEncoding?: string
  timeoutMs?: number
  proxyBase?: string
  proxyDomains?: string
}

export interface FetchResult {
  html: string
  encoding: string
}

export async function fetchHtml(url: string, opts: FetchHtmlOptions = {}): Promise<FetchResult> {
  // SSRF 防护：目标 URL 来自用户输入（书源/抓取任务），先校验再出站
  await assertPublicUrl(url)

  const proxyBase = (opts.proxyBase || '').trim()
  if (proxyBase && shouldUseBrowserProxy(url, proxyBase, opts.proxyDomains)) {
    try {
      return await fetchHtmlViaProxy(url, opts.forceEncoding, opts.timeoutMs, proxyBase)
    } catch (err) {
      throw new Error(`浏览器代理失败: ${(err as Error).message}`)
    }
  }

  const timeoutMs = opts.timeoutMs || 28000
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  let res: Response
  try {
    res = await safeFetch(url, { headers: FETCH_HEADERS, signal: controller.signal })
  } catch (err) {
    clearTimeout(timeout)
    if ((err as Error).name === 'AbortError') throw new Error(`请求超时 (${Math.round(timeoutMs / 1000)}s): ${url}`)
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

function shouldUseBrowserProxy(targetUrl: string, proxyBase: string, proxyDomains?: string): boolean {
  if (!proxyBase) return false
  let host: string
  try {
    host = new URL(targetUrl).hostname
  } catch {
    return false
  }
  const domains = (proxyDomains || DEFAULT_PROXY_DOMAINS.join(','))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return domains.some((domain) => host === domain || host.endsWith('.' + domain))
}

async function fetchHtmlViaProxy(targetUrl: string, forceEncoding: string | undefined, timeoutMs: number | undefined, proxyBase: string): Promise<FetchResult> {
  const base = new URL(proxyBase)
  base.searchParams.set('url', targetUrl)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs || 70000)

  let res: Response
  try {
    res = await fetch(base.href, { signal: controller.signal })
  } catch (err) {
    clearTimeout(timeout)
    if ((err as Error).name === 'AbortError') throw new Error(`请求超时 (${Math.round((timeoutMs || 70000) / 1000)}s): ${targetUrl}`)
    throw err
  }
  clearTimeout(timeout)

  const html = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${html.slice(0, 120)}`)
  return { html, encoding: forceEncoding || 'utf-8' }
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
