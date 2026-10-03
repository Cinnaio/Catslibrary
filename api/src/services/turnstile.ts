import { loadConfig } from '../config'
import { decryptSiteSecret, encryptionReady, readSetting, TURNSTILE_KEY } from './site-settings'
import type { TurnstileSettings } from '@shared/site-settings'

export const ADULT_UNLOCK_ACTION = 'r18_unlock'
export interface StoredTurnstile { siteKey: string; secret: string; hostnames: string[] }

export function parseHostnames(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 20) throw new Error('允许域名必须为最多 20 项的列表')
  const hosts = value.map(v => {
    if (typeof v !== 'string') throw new Error('域名必须为文字')
    const host = v.trim().toLowerCase()
    if (!/^(?:localhost|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)$/.test(host) || host.length > 253) {
      throw new Error('请填写纯域名，不包含协议、路径、通配符或端口')
    }
    return host
  })
  return [...new Set(hosts)]
}
export async function effectiveTurnstile() {
  const env = turnstileConfig()
  // Existing deployments and isolated service tests need no database when all explicit env keys exist.
  const explicit = Boolean(process.env.TURNSTILE_SITE_KEY?.trim() && process.env.TURNSTILE_SECRET_KEY?.trim() && process.env.TURNSTILE_HOSTNAMES?.trim())
  const saved = explicit ? null : await readSetting<StoredTurnstile>(TURNSTILE_KEY)
  const siteKey = process.env.TURNSTILE_SITE_KEY?.trim() || saved?.siteKey || ''
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim() || (saved?.secret ? decryptSiteSecret(saved.secret) : '')
  const hostnames = process.env.TURNSTILE_HOSTNAMES?.trim() ? env.hostnames : saved?.hostnames?.length ? saved.hostnames : env.hostnames
  const sources: TurnstileSettings['sources'] = {
    siteKey: process.env.TURNSTILE_SITE_KEY?.trim() ? 'environment' : saved?.siteKey ? 'database' : 'default',
    secret: process.env.TURNSTILE_SECRET_KEY?.trim() ? 'environment' : saved?.secret ? 'database' : 'default',
    hostnames: process.env.TURNSTILE_HOSTNAMES?.trim() ? 'environment' : saved?.hostnames?.length ? 'database' : 'default',
  }
  return { siteKey, secret, hostnames, configured: Boolean(siteKey && secret && hostnames.length), sources,
    secretSet: Boolean(secret || saved?.secret), secretReadable: Boolean(secret), encryptionReady: encryptionReady() }
}
export async function publicTurnstileSettings(): Promise<TurnstileSettings> {
  const { secret: _secret, ...safe } = await effectiveTurnstile()
  return safe
}

export function turnstileConfig() {
  const siteKey = process.env.TURNSTILE_SITE_KEY?.trim() || ''
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim() || ''
  const hostnames = (process.env.TURNSTILE_HOSTNAMES || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  if (!hostnames.length) {
    for (const origin of [process.env.SITE_URL || '', ...loadConfig().corsOrigins]) {
      try { hostnames.push(new URL(origin).hostname.toLowerCase()) } catch { /* explicit hostnames required otherwise */ }
    }
  }
  return { siteKey, secret, hostnames, configured: Boolean(siteKey && secret && hostnames.length) }
}

export async function verifyAdultChallenge(token: unknown, remoteip: string): Promise<boolean> {
  if (typeof token !== 'string' || !token || token.length > 2048) return false
  try {
    const config = await effectiveTurnstile()
    if (!config.configured) return false
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: config.secret, response: token, ...(remoteip ? { remoteip } : {}) }),
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) return false
    const result = await response.json() as { success?: boolean; hostname?: string; action?: string }
    return result.success === true && result.action === ADULT_UNLOCK_ACTION
      && config.hostnames.includes(String(result.hostname || '').toLowerCase())
  } catch {
    // 不泄露密钥或上游错误；验证不可达时不授予权限。
    return false
  }
}
