import type { Context } from 'hono'
import { getConnInfo } from '@hono/node-server/conninfo'
import { loadConfig } from '../../config'

/** Resolve the client address from proxy headers (when trusted), then the direct socket address. */
export function resolveClientIp(headers: Record<string, string | undefined>, remoteAddress = '', trustProxy = true): string {
  if (trustProxy) {
    const forwarded = headers['cf-connecting-ip'] || headers['x-forwarded-for']?.split(',')[0]?.trim() || headers['x-real-ip'] || ''
    if (forwarded) return forwarded
  }
  return remoteAddress.replace(/^::ffff:/i, '')
}

/**
 * 从请求上下文解析客户端 IP。
 * 转发头（CF-Connecting-IP / X-Forwarded-For / X-Real-IP）仅在 TRUST_PROXY
 * 开启时才被信任：未部署反代时这些头可被请求方任意伪造，会使基于 IP 的
 * 限流与审计完全失真。
 */
export function clientIpFromContext(c: Context<any>): string {
  let remoteAddress = ''
  try {
    remoteAddress = getConnInfo(c).remote.address || ''
  } catch {
    // app.request() and non-Node adapters do not expose a socket.
  }
  return resolveClientIp(
    {
      'cf-connecting-ip': c.req.header('CF-Connecting-IP'),
      'x-forwarded-for': c.req.header('X-Forwarded-For'),
      'x-real-ip': c.req.header('X-Real-IP'),
    },
    remoteAddress,
    loadConfig().trustProxy,
  )
}
