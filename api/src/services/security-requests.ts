import type { Db } from '../db/pool'
import { withTx } from '../db/query'
import type { SecurityAction } from '@shared/security'
import { effectiveTurnstile, verifyChallenge } from './turnstile'
import { lockSecurity, restriction, securityEvent, securityKey, securityPolicy, SecurityError } from './security-policy'

/** Counts requests, including nonexistent accounts, separately from billable mail. */
export async function protectRequest(db: Db, action: SecurityAction, identity: string, ip: string, token: unknown, accountId = '', session = '') {
  const sourceHash = ip ? securityKey('ip:' + ip) : '',
    hint = ip ? 'IP · ' + sourceHash.slice(0, 8) : ''
  const decision = await withTx(db, async (query) => {
    const tx = { query }
    await lockSecurity(tx)
    const policy = await securityPolicy(tx)
    const limits: Array<[string, number, number]> = [
      ['global:' + action, 300, 60000],
      ['identifier:' + action + ':' + identity, policy.identifierQuarterHour, 900000],
    ]
    if (ip) limits.push(['ip:' + action + ':' + ip, policy.ipQuarterHour, 900000])
    if (session) limits.push(['session:' + action + ':' + session, policy.identifierQuarterHour, 900000])
    // Check global budget first to bound writes from rotating identities.
    for (const [key, max, window] of limits) {
      const now = Date.now()
      const { rows } = await query<{ count: number; expires_at: number }>(
        `INSERT INTO security_counters(key_hash,count,expires_at) VALUES($1,1,$2)
        ON CONFLICT(key_hash) DO UPDATE SET count=CASE WHEN security_counters.expires_at<=$3 THEN 1 ELSE LEAST(security_counters.count+1,100001) END,
        expires_at=CASE WHEN security_counters.expires_at<=$3 THEN $2 ELSE security_counters.expires_at END RETURNING count,expires_at`,
        [securityKey(key), now + window, now],
      )
      if (rows[0]!.count > max) {
        const global = key.startsWith('global:')
        await securityEvent(
          tx,
          action,
          key.split(':')[0] + '_rate',
          'blocked',
          global ? 'global' : ip,
          policy.revision,
          global ? '全站请求' : hint,
          global ? '' : accountId,
          global ? '' : sourceHash,
        )
        return {
          policy,
          error: new SecurityError('security_rate_limited', '请求过于频繁，请稍后重试', 429, Math.ceil((Number(rows[0]!.expires_at) - now) / 1000)),
          allow: false,
        }
      }
    }
    const rule = await restriction(
      tx,
      [
        ['ip', ip],
        ['account', accountId],
      ],
      action,
    )
    if (rule?.effect === 'block') {
      await securityEvent(tx, action, 'restriction', 'blocked', ip, policy.revision, hint, accountId, sourceHash)
      return { policy, error: new SecurityError('security_restricted', '此操作暂时受限，请稍后重试', 403), allow: false }
    }
    // An unauthenticated caller cannot claim a whitelisted account by typing its username.
    const exception = await restriction(
      tx,
      [
        ['ip', ip],
        ['account', action === 'verify-email' ? accountId : ''],
      ],
      action,
    )
    return { policy, error: null, allow: exception?.effect === 'allow' }
  })
  if (decision.error) throw decision.error
  const mode = decision.policy.challenges[action]
  if (mode === 'observe') await securityEvent(db, action, 'challenge', 'observed', ip, decision.policy.revision, hint, accountId, sourceHash)
  if (mode !== 'enforce' || decision.allow) return
  const config = await effectiveTurnstile()
  if (!config.configured) throw new SecurityError('challenge_unavailable', '安全验证尚未配置，请联系管理员', 503)
  if (!(await verifyChallenge(token, ip, action.replace(/-/g, '_')))) {
    await securityEvent(db, action, 'challenge', 'blocked', ip, decision.policy.revision, hint, accountId, sourceHash)
    throw new SecurityError('challenge_required', '请完成安全验证后重试；旧版客户端请更新或通过网页操作', 403)
  }
}
