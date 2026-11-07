/** PO18 账号失效是共享会话问题；不把普通 404/403 或付费权限当作失效。 */
export const PO18_SESSION_REQUIRED = 'PO18 会话已失效或尚未登录，请在抓取中心重新登录；登录后自动恢复追更'

export function po18BlockedMessage(previous = ''): string {
  return previous.includes('HTTP 404') ? `${previous}；${PO18_SESSION_REQUIRED}` : PO18_SESSION_REQUIRED
}

export class Po18SessionExpiredError extends Error {
  constructor() {
    super(PO18_SESSION_REQUIRED)
    this.name = 'Po18SessionExpiredError'
  }
}

export function isPo18twUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    return ['https:', 'http:'].includes(url.protocol) && /(^|\.)po18\.tw$/i.test(url.hostname)
  } catch {
    return false
  }
}

export function isPo18AuthUrl(rawUrl: string): boolean {
  return isPo18twUrl(rawUrl) && /^\/(?:apps\/)?(?:login|logout)(?:\.php)?\/?$/i.test(new URL(rawUrl).pathname)
}

export function cookieIsDeleted(setCookie: string, now = Date.now()): boolean {
  const parts = setCookie.split(';')
  const maxAge = parts.slice(1).find(part => /^\s*max-age\s*=/i.test(part))?.split('=')[1]?.trim()
  if (maxAge !== undefined && /^-?\d+$/.test(maxAge)) return Number(maxAge) <= 0
  const expires = parts.slice(1).find(part => /^\s*expires\s*=/i.test(part))?.split('=').slice(1).join('=').trim()
  return parts[0]!.slice(parts[0]!.indexOf('=') + 1).trim() === '' || Boolean(expires && Date.parse(expires) <= now)
}

export function assertPo18SessionResponse(response: Response, rawUrl: string, requestCookie: string): void {
  if (!isPo18twUrl(rawUrl)) return
  if (response.status === 401) throw new Po18SessionExpiredError()
  // 404 即使附带清除令牌，仍首先是该链接不存在，不能因此停掉整个账号。
  if (response.status >= 400) return
  const location = response.headers.get('location')
  if (isPo18AuthUrl(rawUrl) || (response.status >= 300 && location && isPo18AuthUrl(new URL(location, rawUrl).href))) {
    throw new Po18SessionExpiredError()
  }
  const sent = new Set(requestCookie.split(';').map(part => part.trim().split('=')[0]))
  const latest = new Map<string, string>()
  const url = new URL(rawUrl)
  for (const value of response.headers.getSetCookie()) {
    const [pair = '', ...attributes] = value.split(';')
    const name = pair.split('=')[0]!.trim()
    if (!/^authtoken[1-6]$/.test(name) || !sent.has(name)) continue
    const domain = attributes.find(part => /^\s*domain\s*=/i.test(part))?.split('=')[1]?.trim().toLowerCase().replace(/^\./, '')
    if (domain && url.hostname !== domain && !url.hostname.endsWith(`.${domain}`)) continue
    const path = attributes.find(part => /^\s*path\s*=/i.test(part))?.split('=')[1]?.trim()
    if (path?.startsWith('/') && url.pathname !== path && !url.pathname.startsWith(path.endsWith('/') ? path : `${path}/`)) continue
    latest.set(name, value)
  }
  if ([...latest.values()].some(value => cookieIsDeleted(value))) throw new Po18SessionExpiredError()
}
