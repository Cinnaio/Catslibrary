/**
 * SSRF 防护层 —— 所有抓取用户可控 URL 的出站请求必须经由此模块。
 *
 * 防护点：
 * 1. 仅允许 http/https 协议；
 * 2. 目标主机解析后不得落在环回/内网/链路本地（含云元数据 169.254.169.254）等保留地址段；
 * 3. 重定向手动跟随，每一跳重新校验（公网站点 302 到内网是经典绕过手法）。
 *
 * 已知局限：校验与 fetch 自身的 DNS 解析之间存在理论上的 rebinding 窗口
 * （需自定义 dispatcher 钉住 IP 才能根治），对本项目的威胁模型而言按跳校验已足够。
 *
 * 逃生口：确需抓取内网源（如本地镜像站）时设 ALLOW_PRIVATE_FETCH=1 跳过地址检查。
 */
import { isIP } from 'node:net'
import { lookup } from 'node:dns/promises'

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsafeUrlError'
  }
}

const allowPrivateFetch = () => /^(1|true|yes)$/i.test(process.env.ALLOW_PRIVATE_FETCH?.trim() || '')

/** 判断 IP 是否属于环回/内网/链路本地/保留地址段。无法识别的输入一律按不安全处理。 */
export function isPrivateIp(ip: string): boolean {
  let addr = String(ip || '')
    .trim()
    .toLowerCase()
  if (addr.startsWith('[') && addr.endsWith(']')) addr = addr.slice(1, -1)
  // IPv4-mapped IPv6（::ffff:1.2.3.4）按内层 v4 判断
  const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) addr = mapped[1]!

  const version = isIP(addr)
  if (version === 4) {
    const parts = addr.split('.').map((s) => Number.parseInt(s, 10))
    const [a, b, c] = parts as [number, number, number]
    if (a === 0 || a === 10 || a === 127) return true // 0/8 保留、10/8 私网、127/8 环回
    if (a === 100 && b >= 64 && b <= 127) return true // 100.64/10 CGNAT
    if (a === 169 && b === 254) return true // 169.254/16 链路本地（含云元数据端点）
    if (a === 172 && b >= 16 && b <= 31) return true // 172.16/12 私网
    if (a === 192 && b === 168) return true // 192.168/16 私网
    if (a === 192 && b === 0 && c === 0) return true // 192.0.0/24 IETF 保留
    if (a === 198 && (b === 18 || b === 19)) return true // 198.18/15 基准测试
    if (a >= 224) return true // 224/4 组播 + 240/4 保留 + 广播
    return false
  }
  if (version === 6) {
    if (addr === '::' || addr === '::1') return true // 未指定 / 环回
    const firstSegment = addr.split(':')[0] || ''
    const first = Number.parseInt(firstSegment || '0', 16)
    if (!Number.isFinite(first)) return true
    if (first === 0) return true // 0000::/8 保留（含各种映射/兼容形式）
    if ((first & 0xfe00) === 0xfc00) return true // fc00::/7 唯一本地
    if ((first & 0xffc0) === 0xfe80) return true // fe80::/10 链路本地
    return false
  }
  return true
}

/** Clash / Mihomo 等代理 fake-ip 模式的默认地址池（198.18.0.0/15）。 */
function isFakeIpPool(address: string): boolean {
  return /^(?:::ffff:)?198\.(?:18|19)\./i.test(String(address || '').trim())
}

/** 校验 URL 可安全出站：协议合法且主机不解析到内网/保留地址。通过则返回解析后的 URL。 */
export async function assertPublicUrl(rawUrl: string): Promise<URL> {
  let url: URL
  try {
    url = new URL(String(rawUrl || ''))
  } catch {
    throw new UnsafeUrlError(`URL 无效: ${String(rawUrl || '').slice(0, 200)}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UnsafeUrlError(`仅支持 http/https 协议: ${url.protocol}`)
  }
  if (allowPrivateFetch()) return url

  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  if (isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new UnsafeUrlError(`目标为内网/保留地址，已阻止: ${hostname}`)
    return url
  }
  const lowered = hostname.toLowerCase()
  if (lowered === 'localhost' || lowered.endsWith('.localhost') || lowered.endsWith('.local') || lowered.endsWith('.internal')) {
    throw new UnsafeUrlError(`目标为本地主机名，已阻止: ${hostname}`)
  }

  let records: Array<{ address: string }>
  try {
    records = await lookup(hostname, { all: true, verbatim: true })
  } catch {
    throw new UnsafeUrlError(`无法解析主机名: ${hostname}`)
  }
  if (!records.length) throw new UnsafeUrlError(`无法解析主机名: ${hostname}`)
  for (const record of records) {
    if (isPrivateIp(record.address)) {
      // 域名解析到 fake-ip 池几乎必是本机代理接管了 DNS（而非目标站真在内网），给出可操作的提示
      const hint = isFakeIpPool(record.address)
        ? '。该网段是 Clash 类代理 fake-ip 模式的地址池：可在代理的 fake-ip-filter 放行该域名，或设 ALLOW_PRIVATE_FETCH=1 让抓取经代理转发'
        : ''
      throw new UnsafeUrlError(`目标解析到内网/保留地址，已阻止: ${hostname} → ${record.address}${hint}`)
    }
  }
  return url
}

const MAX_REDIRECTS = 5

export type FetchImplementation = (url: string, init: RequestInit) => Promise<Response>

/**
 * 带 SSRF 防护的 fetch：首跳与每次重定向都经 assertPublicUrl 校验。
 * 语义与 fetch(redirect:'follow') 一致（303 及 POST 的 301/302 按规范降级为 GET）。
 */
export async function safeFetch(rawUrl: string, init: RequestInit = {}, fetchImplementation: FetchImplementation = fetch): Promise<Response> {
  let current = (await assertPublicUrl(rawUrl)).href
  let currentInit = init
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const res = await fetchImplementation(current, { ...currentInit, redirect: 'manual' } as RequestInit)
    if (res.status < 300 || res.status >= 400) return res
    const location = res.headers.get('Location')
    if (!location) return res
    await res.body?.cancel().catch(() => {})
    const next = new URL(location, current)
    current = (await assertPublicUrl(next.href)).href
    const method = (currentInit.method || 'GET').toUpperCase()
    if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST')) {
      currentInit = { ...currentInit, method: 'GET', body: undefined }
    }
  }
  throw new UnsafeUrlError(`重定向次数超过 ${MAX_REDIRECTS} 次: ${rawUrl}`)
}
