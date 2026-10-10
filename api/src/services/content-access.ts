import { requestSession } from './browser-session'
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Context } from 'hono'
import { loadConfig } from '../config'
import { getAdultContentEnabled } from './content-policy'
import { flattenReaderSettings, parseSettingsDocument } from './reader-settings'
import type { AuthEnv } from '../middlewares/auth'
import { getDb } from '../db/pool'
import { hashToken, ADMIN_SESSION_TTL, ADMIN_IDLE_TTL, type UserRow } from './auth'

/**
 * 这是“年满 18 岁后自行确认”的服务端凭证，不是年龄验证。
 * 绑定有效登录会话与账号共享模式，不允许匿名解锁。Cookie 期限不限制账号模式。
 */
export const ADULT_ACCESS_COOKIE = 'zhizhou_adult_access'
export const ADULT_ACCESS_HEADER = 'X-Content-Access'
export const ADULT_ACCESS_TTL_SECONDS = 24 * 60 * 60

export interface ContentAccessDecision {
  canViewRestricted: boolean
  accountId?: string
  reason: 'admin' | 'account_grant' | 'login_required' | 'site_disabled' | 'not_unlocked'
}

function signingSecret(): string {
  return `${loadConfig().sessionHashSalt}\u0000content-access-v2`
}

function signature(payload: string): string {
  return createHmac('sha256', signingSecret()).update(payload, 'utf8').digest('base64url')
}

export function createAdultAccessToken(sessionHash: string, until: number): string {
  const expiresAt = Math.floor(until / 1000)
  const payload = `v2.${expiresAt}.${Buffer.from(sessionHash).toString('base64url')}`
  return `${payload}.${signature(payload)}`
}

export function verifyAdultAccessToken(token: string, now = Date.now()): boolean {
  const parts = String(token || '').split('.')
  if (parts.length !== 4 || parts[0] !== 'v2') return false
  const expiresAt = Number(parts[1])
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(now / 1000)) return false

  const actual = Buffer.from(parts[3] || '', 'utf8')
  const expected = Buffer.from(signature(parts.slice(0, 3).join('.')), 'utf8')
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
  const secure = new URL(c.req.url).protocol === 'https:' || (loadConfig().trustProxy && c.req.header('X-Forwarded-Proto')?.split(',')[0]?.trim() === 'https')
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

export function setAdultAccessCookie(c: Context<AuthEnv>, token: string): void {
  setCookie(c, token, ADULT_ACCESS_TTL_SECONDS)
}

export function clearAdultAccessCookie(c: Context<AuthEnv>): void {
  setCookie(c, '', 0)
}

export function contentPolicyHeaders(): Record<string, string> {
  return {
    'Cache-Control': 'private, no-store',
    Vary: 'Cookie, Authorization, X-Content-Access',
  }
}

export function restrictedContentResponse(c: Context<AuthEnv>, reason = 'adult_mode_required') {
  return c.json(
    {
      error: reason === 'login_required' ? '请先登录后开启成人内容模式' : '限制级内容需要开启成人内容模式',
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
  const existingToken = requestAccessToken(c)
  const bearer = requestSession(c)
  // Bearer 存在时只接受该会话；无效 Bearer 不回退到另一个账号的 Cookie。
  let sessionHash = bearer ? await hashToken(bearer, loadConfig().sessionHashSalt) : ''
  if (!bearer && !c.req.header('Authorization') && verifyAdultAccessToken(existingToken)) {
    sessionHash = Buffer.from(existingToken.split('.')[2]!, 'base64url').toString('utf8')
  }
  if (!sessionHash) return { canViewRestricted: false, reason: 'login_required' }
  const { rows } = await getDb().query<UserRow & { expires_at: string; session_created: number; session_seen: number }>(
    `SELECT u.*, s.expires_at, s.created_at AS session_created, s.last_seen_at AS session_seen FROM user_sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > $2 AND u.status = 'active'`,
    [sessionHash, Date.now()],
  )
  const user = rows[0]
  // Apply administrator idle/absolute limits to content access as well as API authorization.
  if (user?.role === 'admin' && (Number(user.session_created) <= Date.now() - ADMIN_SESSION_TTL || Number(user.session_seen) <= Date.now() - ADMIN_IDLE_TTL))
    return { canViewRestricted: false, reason: 'login_required' }
  if (!user || (c.get('user') && c.get('user').id !== user.id)) return { canViewRestricted: false, reason: 'login_required' }
  if (user.role === 'admin') {
    if (bearer) setAdultAccessCookie(c, createAdultAccessToken(sessionHash, Math.min(Number(user.expires_at), Date.now() + ADULT_ACCESS_TTL_SECONDS * 1000)))
    return { canViewRestricted: true, reason: 'admin', accountId: user.id }
  }
  const adultContentEnabled = await getAdultContentEnabled()
  if (!adultContentEnabled) return { canViewRestricted: false, reason: 'site_disabled' }
  const settings = flattenReaderSettings(parseSettingsDocument(user.reader_settings || ''), 'desktop')
  if (settings.values.contentMode === 'adult') {
    if (bearer) setAdultAccessCookie(c, createAdultAccessToken(sessionHash, Math.min(Number(user.expires_at), Date.now() + ADULT_ACCESS_TTL_SECONDS * 1000)))
    return { canViewRestricted: true, reason: 'account_grant', accountId: user.id }
  }
  return { canViewRestricted: false, reason: 'not_unlocked' }
}

/** 受控操作忽略客户端时间戳，确保 safe 撤销和重新确认不会被旧/未来时间戳覆盖。 */
export function setAccountContentMode(settings: string, mode: 'safe' | 'adult') {
  const document = parseSettingsDocument(settings)
  document.shared.values.contentMode = mode
  document.shared.updatedAt.contentMode = Date.now()
  return JSON.stringify(document)
}
