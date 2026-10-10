import type { Context } from 'hono'
import { loadConfig } from '../config'
import { bearerToken } from './auth'

export function secureRequest(c: Context): boolean {
  // A configured HTTPS public site keeps cookies secure behind an HTTP upstream without trusting client forwarding headers.
  try {
    if (process.env.SITE_URL && new URL(process.env.SITE_URL).protocol === 'https:') return true
  } catch {
    /* request-based fallback */
  }
  return new URL(c.req.url).protocol === 'https:' || (loadConfig().trustProxy && c.req.header('X-Forwarded-Proto')?.split(',')[0]?.trim() === 'https')
}
export function browserRequest(c: Context): boolean {
  return c.req.header('X-Session-Transport') === 'cookie' || !!c.req.header('Origin') || !!c.req.header('Sec-Fetch-Site')
}
export function sessionCookieName(c: Context): string {
  return secureRequest(c) ? '__Host-zz_session' : 'zz_session'
}
export function cookieSession(c: Context): string {
  const name = sessionCookieName(c)
  const matches = (c.req.header('Cookie') || '')
    .split(';')
    .map((value) => value.trim())
    .filter((value) => value.startsWith(name + '='))
  if (matches.length !== 1) return ''
  const value = matches[0]!.slice(name.length + 1)
  return /^[a-f0-9]{64}$/.test(value) ? value : ''
}
/** An explicit Authorization header never falls back to another account's cookie. */
export function requestSession(c: Context): string {
  return c.req.header('Authorization') !== undefined ? bearerToken(c.req.header('Authorization') || '') : cookieSession(c)
}
export function setSessionCookie(c: Context, token: string, ttl?: number): void {
  const attrs = [
    `${sessionCookieName(c)}=${token}`,
    'Path=/',
    'HttpOnly',
    `SameSite=${process.env.SESSION_COOKIE_SAMESITE === 'none' && secureRequest(c) ? 'None' : 'Lax'}`,
  ]
  if (secureRequest(c)) attrs.push('Secure')
  if (ttl !== undefined) attrs.push(`Max-Age=${Math.max(0, Math.floor(ttl / 1000))}`)
  c.header('Set-Cookie', attrs.join('; '), { append: true })
  c.header('Cache-Control', 'private, no-store')
}
export function clearSessionCookie(c: Context): void {
  setSessionCookie(c, '', 0)
}
export function sessionResponse(c: Context, token: string, ttl: number, remember = false): { token?: string; remember: boolean } {
  if (!browserRequest(c)) return { token, remember }
  setSessionCookie(c, token, remember ? ttl : undefined)
  return { remember }
}
