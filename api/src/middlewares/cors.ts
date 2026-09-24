/**
 * CORS —— 移植自 _middleware.js 的 corsHeaders。
 * 拒绝的来源只告警一次，避免浏览器侧静默失败。
 */
import type { MiddlewareHandler } from 'hono'
import { loadConfig } from '../config'

const CORS_HEADERS = {
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Reader-Id, X-Content-Access',
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Max-Age': '86400',
}

const warnedOrigins = new Set<string>()

export function cors(): MiddlewareHandler {
  return async (c, next) => {
    const origin = c.req.header('Origin') || ''
    const self = new URL(c.req.url).origin
    const headers = computeCorsHeaders(origin, self)

    if (c.req.method === 'OPTIONS') {
      return c.body(null, 204, headers)
    }

    await next()

    for (const [key, value] of Object.entries(headers)) {
      if (value) c.header(key, value)
    }
  }
}

export function computeCorsHeaders(origin: string, self: string): Record<string, string> {
  const headers: Record<string, string> = { ...CORS_HEADERS }
  if (!origin) return headers

  const allowed = loadConfig().corsOrigins

  if (origin === self || allowed.includes(origin.replace(/\/+$/, ''))) {
    headers['Access-Control-Allow-Origin'] = origin
    headers.Vary = 'Origin'
  } else if (!warnedOrigins.has(origin)) {
    warnedOrigins.add(origin)
    console.warn(
      `[cors] 拒绝跨域来源 ${origin}（本机为 ${self}）。如需放行，请设置 CORS_ORIGINS=${origin} 后重启 API。` +
        (allowed.length ? ` 当前允许: ${allowed.join(', ')}` : ' 当前未配置任何允许来源。'),
    )
  }
  return headers
}
