import { loadConfig } from '../config'

export const ADULT_UNLOCK_ACTION = 'r18_unlock'

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
  const config = turnstileConfig()
  if (!config.configured || typeof token !== 'string' || !token || token.length > 2048) return false
  try {
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
