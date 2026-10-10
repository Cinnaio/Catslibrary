import type { Context } from 'hono'
import type { AuthEnv } from '../middlewares/auth'
import { getDb } from '../db/pool'
import { hashToken } from './auth'
import { loadConfig } from '../config'
import { clientIpFromContext } from './ai/audit-context'
import { resolveContentAccess } from './content-access'

/** PG 原子计数，多个 API 实例共享。未知 IP 不以可伪造头部代替。 */
export async function checkContentRate(c: Context<AuthEnv>, action: 'chapter' | 'unlock' | 'reading-stats') {
  if (action === 'chapter' && c.get('user')?.role === 'admin') return null
  const now = Date.now()
  const config = loadConfig()
  const configuredLimit = Number(process.env.CHAPTER_READ_LIMIT_PER_MINUTE || 120)
  const chapterLimit = Number.isSafeInteger(configuredLimit) && configuredLimit > 0 ? configuredLimit : 120
  const limits: Array<[string, number]> = []
  const user = c.get('user')
  const accountId = user?.id || (action === 'chapter' ? (await resolveContentAccess(c)).accountId : undefined)
  if (accountId) limits.push([`${action}:user:${accountId}`, action === 'unlock' ? 5 : action === 'reading-stats' ? 60 : chapterLimit])
  const ip = clientIpFromContext(c)
  if (ip) limits.push([`${action}:ip:${ip}`, action === 'unlock' ? 20 : action === 'reading-stats' ? 120 : chapterLimit * 2])
  const db = getDb()
  await db.query('DELETE FROM content_request_limits WHERE key_hash IN (SELECT key_hash FROM content_request_limits WHERE expires_at <= $1 LIMIT 100)', [now])
  for (const [key, max] of limits) {
    const keyHash = await hashToken(key, config.sessionHashSalt)
    const { rows } = await db.query<{ request_count: number; expires_at: string }>(
      `INSERT INTO content_request_limits (key_hash, request_count, expires_at) VALUES ($1, 1, $2)
       ON CONFLICT (key_hash) DO UPDATE SET
         request_count = CASE WHEN content_request_limits.expires_at <= $3 THEN 1 ELSE content_request_limits.request_count + 1 END,
         expires_at = CASE WHEN content_request_limits.expires_at <= $3 THEN $2 ELSE content_request_limits.expires_at END
       RETURNING request_count, expires_at`, [keyHash, now + 60000, now],
    )
    const row = rows[0]!
    if (row.request_count > max) {
      return c.json({ error: '请求过于频繁，请稍后再试', code: 'content_rate_limited' }, 429, {
        'Retry-After': String(Math.max(1, Math.ceil((Number(row.expires_at) - now) / 1000))),
        'Cache-Control': 'private, no-store',
      })
    }
  }
  return null
}
