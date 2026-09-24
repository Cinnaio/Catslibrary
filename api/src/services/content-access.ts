import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Context } from 'hono'
import { loadConfig } from '../config'
import { getAdultContentEnabled } from './content-policy'
import { flattenReaderSettings, parseSettingsDocument } from './reader-settings'
import type { AuthEnv } from '../middlewares/auth'

/**
 * 这是“年满 18 岁后自行确认”的服务端凭证，不是年龄验证。
 * 它的作用是让内容 API 不再把前端 mode 当成唯一拦截点，同时兼容未登录读者
 * 现有的本设备成人模式。真正的年龄/身份合规验证仍属于独立的产品与合规能力。
 */
export const ADULT_ACCESS_COOKIE = 'zhizhou_adult_access'
export const ADULT_ACCESS_HEADER = 'X-Content-Access'
export const ADULT_ACCESS_TTL_SECONDS = 24 * 60 * 60

export interface ContentAccessDecision {
  canViewRestricted: boolean
  reason: 'admin' | 'reader_setting' | 'guest_token' | 'site_disabled' | 'not_unlocked'
}

function signingSecret(): string {
  return `${loadConfig().sessionHashSalt}\u0000content-access-v1`
}

function signature(payload: string): string {
  return createHmac('sha256', signingSecret()).update(payload, 'utf8').digest('base64url')
}

export function createAdultAccessToken(now = Date.now()): string {
  const expiresAt = Math.floor(now / 1000) + ADULT_ACCESS_TTL_SECONDS
  const payload = `v1.${expiresAt}`
  return `${payload}.${signature(payload)}`
}

export function verifyAdultAccessToken(token: string, now = Date.now()): boolean {
  const parts = String(token || '').split('.')
  if (parts.length !== 3 || parts[0] !== 'v1') return false
  const expiresAt = Number(parts[1])
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(now / 1000)) return false

  const actual = Buffer.from(parts[2] || '', 'utf8')
  const expected = Buffer.from(signature(`v1.${parts[1]}`), 'utf8')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function requestCookie(header: string, name: string): string {
  for (const part of String(header || '').split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0) continue
    const key = part.slice(0, separator).trim()
    if (key === name) return part.slice(separator + 1).trim()
  }
  return ''
}

function requestAccessToken(c: Context<AuthEnv>): string {
  return c.req.header(ADULT_ACCESS_HEADER) || requestCookie(c.req.header('Cookie') || '', ADULT_ACCESS_COOKIE)
}

function setCookie(c: Context<AuthEnv>, value: string, maxAge: number): void {
  const secure = new URL(c.req.url).protocol === 'https:'
  const requestOrigin = c.req.header('Origin') || ''
  const sameOrigin = !requestOrigin || requestOrigin === new URL(c.req.url).origin
  const attributes = [
    `${ADULT_ACCESS_COOKIE}=${value}`,
    'Path=/api',
    `Max-Age=${maxAge}`,
    'HttpOnly',
    // 独立前端/API 域名在 HTTPS 下需要 None 才能随 fetch(credentials: include) 回传；
    // 本地 HTTP 或同源部署不能使用 None+非 Secure，保留 Lax 兼容开发环境。
    `SameSite=${secure && !sameOrigin ? 'None' : 'Lax'}`,
  ]
  if (secure) attributes.push('Secure')
  c.header('Set-Cookie', attributes.join('; '))
}

export function setAdultAccessCookie(c: Context<AuthEnv>, token = createAdultAccessToken()): void {
  setCookie(c, token, ADULT_ACCESS_TTL_SECONDS)
}

export function clearAdultAccessCookie(c: Context<AuthEnv>): void {
  setCookie(c, '', 0)
}

export function contentPolicyHeaders(): Record<string, string> {
  return {
    'Cache-Control': 'private, no-store',
    Vary: 'Cookie, Authorization',
  }
}

export function restrictedContentResponse(c: Context<AuthEnv>, reason = 'adult_mode_required') {
  return c.json(
    {
      error: '限制级内容需要开启成人内容模式',
      code: 'restricted_content',
      reason,
    },
    403,
    contentPolicyHeaders(),
  )
}

/**
 * 解析当前请求是否可以读取 restricted 内容。
 * 管理员需要能够在后台查看受限作品，即使全站读者开关处于关闭状态；
 * 这只对带有有效管理员会话的请求成立，不会放宽普通读者的访问。
 */
export async function resolveContentAccess(c: Context<AuthEnv>): Promise<ContentAccessDecision> {
  const user = c.get('user')
  const existingToken = requestAccessToken(c)

  if (user?.role === 'admin') {
    if (!verifyAdultAccessToken(existingToken)) setAdultAccessCookie(c)
    return { canViewRestricted: true, reason: 'admin' }
  }

  const adultContentEnabled = await getAdultContentEnabled()
  if (!adultContentEnabled) return { canViewRestricted: false, reason: 'site_disabled' }

  if (user) {
    const settings = flattenReaderSettings(parseSettingsDocument(user.reader_settings || ''), 'desktop')
    if (settings.values.contentMode === 'adult') {
      if (!verifyAdultAccessToken(existingToken)) setAdultAccessCookie(c)
      return { canViewRestricted: true, reason: 'reader_setting' }
    }
  }

  if (verifyAdultAccessToken(existingToken)) return { canViewRestricted: true, reason: 'guest_token' }
  return { canViewRestricted: false, reason: 'not_unlocked' }
}
