import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { MiddlewareHandler } from 'hono'
import { loadConfig, PROJECT_ROOT } from '../config'
import { browserRequest, cookieSession, secureRequest } from '../services/browser-session'

export function csrfProtection(): MiddlewareHandler {
  return async (c, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) return next()
    if (!browserRequest(c) && !cookieSession(c)) return next() // Native Bearer clients do not use ambient browser credentials.
    const origin = c.req.header('Origin')
    const self = new URL(c.req.url).origin
    const configured = process.env.SITE_URL?.trim()
    let site = ''
    try {
      if (configured) site = new URL(configured).origin
    } catch {
      /* fail closed */
    }
    const trusted = !!origin && origin !== 'null' && [self, site, ...loadConfig().corsOrigins].includes(origin)
    const sameOrigin = !origin && c.req.header('Sec-Fetch-Site') === 'same-origin'
    if (c.req.header('X-ZZ-CSRF') !== '1' || (!trusted && !sameOrigin)) return c.json({ error: '请求来源验证失败，请刷新页面后重试', code: 'csrf_failed' }, 403)
    await next()
  }
}
export function browserSecurityHeaders(options: { inlineScripts?: string[] } = {}): MiddlewareHandler {
  // Hash only trusted build-time bootstrap scripts, never scripts appearing in dynamic user content.
  let scripts: Promise<string[]> | undefined
  async function trustedScripts() {
    if (options.inlineScripts) return options.inlineScripts
    scripts ||= readFile(path.join(process.env.WEB_DIST_DIR || path.join(PROJECT_ROOT, 'web/dist'), 'index.html'), 'utf8')
      .then((html) =>
        [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
          .filter((match) => !/\bsrc\s*=/i.test(match[1]!) && match[2]?.trim())
          .map((match) => match[2]!),
      )
      .catch(() => [])
    return scripts
  }
  return async (c, next) => {
    await next()
    c.header('X-Content-Type-Options', 'nosniff')
    c.header('X-Frame-Options', 'DENY')
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin')
    if (secureRequest(c)) c.header('Strict-Transport-Security', 'max-age=15552000')
    if (c.res.headers.get('Content-Type')?.includes('text/html')) {
      const hashes = (await trustedScripts()).map((script) => `'sha256-${createHash('sha256').update(script).digest('base64')}'`)
      c.header(
        'Content-Security-Policy-Report-Only',
        `default-src 'self'; script-src 'self' https://challenges.cloudflare.com https://static.cloudflareinsights.com ${hashes.join(' ')}; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' https: data: blob:; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https:; frame-src https://challenges.cloudflare.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'`,
      )
    }
  }
}
