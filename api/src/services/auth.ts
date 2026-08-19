/**
 * 认证核心 —— 由 Novel-KV server/functions/_user-auth.js 平移。
 * 纯函数 + WebCrypto，不依赖数据库，便于单测。
 */
import { webcrypto } from 'node:crypto'
import { sha256Hex } from './hash'

export const PASSWORD_ITERATIONS = 120000
export const SESSION_TTL = 30 * 86400000
/** 「保持登录」会话有效期：默认临时会话 30 天，勾选保持登录后延长到 180 天。 */
export const REMEMBER_TTL = 180 * 86400000

export interface UserRow {
  id: string
  username: string
  display_name: string
  bio: string
  role: string
  status: string
  password_hash: string
  password_salt: string
  password_iterations: number
  created_at: number
  updated_at: number
  last_login_at: number
  reader_settings?: string
}

export interface PublicUser {
  id: string
  username: string
  displayName: string
  role: string
  status: string
  createdAt: number
  updatedAt: number
  lastLoginAt: number
  bio: string
  avatarUrl: string
}

export function publicUser(user: UserRow | null | undefined): PublicUser | null {
  if (!user) return null
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name || '',
    role: user.role || 'reader',
    status: user.status || 'active',
    createdAt: user.created_at,
    updatedAt: user.updated_at,
    lastLoginAt: user.last_login_at || 0,
    bio: user.bio || '',
    avatarUrl: '/api/avatar/' + encodeURIComponent(user.id) + '?v=' + encodeURIComponent(user.updated_at || 0),
  }
}

export function cleanUsername(value: unknown): string {
  return String(value || '').trim().toLowerCase()
}

export function validUsername(username: string): boolean {
  return /^[a-z0-9_-]{3,32}$/.test(username)
}

export function cleanDisplayName(value: unknown): string {
  return String(value || '').replace(/[\x00-\x1F\x7F]/g, '').replace(/\s+/g, ' ').trim().slice(0, 20)
}

export function cleanBio(value: unknown): string {
  return String(value || '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim()
    .slice(0, 80)
}

export async function hashPassword(password: string, saltHex: string, iterations = PASSWORD_ITERATIONS): Promise<string> {
  const key = await webcrypto.subtle.importKey('raw', enc(String(password || '')), 'PBKDF2', false, ['deriveBits'])
  const bits = await webcrypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(saltHex), iterations },
    key,
    256,
  )
  return toHex(new Uint8Array(bits))
}

export async function verifyPassword(
  password: string,
  user: Pick<UserRow, 'password_hash' | 'password_salt' | 'password_iterations'> | null | undefined,
): Promise<boolean> {
  if (!user?.password_hash || !user?.password_salt) return false
  const hash = await hashPassword(password, user.password_salt, user.password_iterations || PASSWORD_ITERATIONS)
  return safeEqual(hash, user.password_hash)
}

export function newSalt(): string {
  return randomHex(16)
}

export function newToken(): string {
  return randomHex(32)
}

export function newId(prefix: string): string {
  return prefix + '_' + Date.now().toString(36) + '_' + webcrypto.randomUUID().slice(0, 8)
}

/** 会话 token 只存摘要；salt 走环境变量，防离线彩虹表。 */
export async function hashToken(token: string, salt: string): Promise<string> {
  return sha256Hex(salt, token)
}

export function deviceName(ua: string): string {
  if (!ua) return '未知设备'
  const browser = /Edg\//i.test(ua)
    ? 'Edge'
    : /Chrome\//i.test(ua)
      ? 'Chrome'
      : /Firefox\//i.test(ua)
        ? 'Firefox'
        : /Safari\//i.test(ua)
          ? 'Safari'
          : '浏览器'
  const model = deviceModel(ua)
  return (model || systemName(ua)) + ' · ' + browser
}

export function bearerToken(header: string): string {
  return (header || '').replace(/^Bearer\s+/i, '').trim()
}

function systemName(ua: string): string {
  if (/Windows/i.test(ua)) return 'Windows'
  if (/Android/i.test(ua)) return 'Android'
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS'
  if (/Mac OS X/i.test(ua)) return 'Mac'
  if (/Linux/i.test(ua)) return 'Linux'
  return '未知系统'
}

function deviceModel(ua: string): string {
  const android = ua.match(/\(([^)]*Android[^)]*)\)/i)?.[1]
  if (android) {
    const part = android
      .split(';')
      .map((s) => s.trim())
      .find((s) => /\bBuild\//i.test(s))
    if (part) return part.replace(/\s*Build\/.*$/i, '').slice(0, 40)
  }
  return ua.match(/\b(iPhone|iPad|iPod)\b/i)?.[1] || ''
}

function enc(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

function safeEqual(a: string, b: string): boolean {
  a = String(a || '')
  b = String(b || '')
  if (a.length !== b.length) return false
  let out = 0
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return out === 0
}

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes)
  webcrypto.getRandomValues(arr)
  return toHex(arr)
}
