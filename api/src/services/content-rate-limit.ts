import { isAdministrator } from '@shared/roles'
import type { ReadingAccessPolicy } from '@shared/reading-access'
import type { Context } from 'hono'
import type { AuthEnv } from '../middlewares/auth'
import { getDb } from '../db/pool'
import { hashToken } from './auth'
import { loadConfig } from '../config'
import { clientIpFromContext } from './ai/audit-context'
import { resolveContentAccess } from './content-access'
import { recordChapterRateLimit } from './reading-access'
import { getReadingAccessSettings } from './reading-access-settings'

const OTHER_LIMITS = { unlock: { account: 5, ip: 20 }, 'book-search': { account: 30, ip: 60 }, 'source-search': { account: 30, ip: 60 }, 'reading-stats': { account: 60, ip: 120 } }

/** PG 原子计数，多个 API 实例共享。未知 IP 不以可伪造头部代替。 */
export async function checkContentRate(c: Context<AuthEnv>, action: 'chapter' | keyof typeof OTHER_LIMITS, policy?: ReadingAccessPolicy) {
  if (action === 'chapter' && isAdministrator(c.get('user')?.role)) return null
  const now = Date.now()
  const config = loadConfig()
  const chapterPolicy = action === 'chapter' ? policy ?? await getReadingAccessSettings() : null
  const quota = action === 'chapter' ? chapterPolicy!.minuteLimits : OTHER_LIMITS[action]
  const limits: Array<[string, number]> = []
  const user = c.get('user')
  const accountId = user?.id || (action === 'chapter' ? (await resolveContentAccess(c)).accountId : undefined)
  if (accountId) limits.push([`${action}:user:${accountId}`, quota.account])
  const ip = clientIpFromContext(c)
  if (chapterPolicy && !accountId && ip) limits.push([`chapter:guest:${ip}`, chapterPolicy.minuteLimits.guest])
  if (ip) limits.push([`${action}:ip:${ip}`, quota.ip])
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
      if (chapterPolicy) await recordChapterRateLimit(c, chapterPolicy)
      const retryAfter = Math.max(1, Math.ceil((Number(row.expires_at) - now) / 1000))
      return c.json({ error: '请求过于频繁，请稍后再试', code: 'content_rate_limited', retryAfter }, 429, {
        'Retry-After': String(retryAfter),
        'Cache-Control': 'private, no-store',
      })
    }
  }
  return null
}
