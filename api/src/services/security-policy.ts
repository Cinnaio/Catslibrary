import { createHmac, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import type { Db, DbClient } from '../db/pool'
import { first, withTx } from '../db/query'
import { loadConfig } from '../config'
import { AccountError, auditAccount, lockAccounts } from './account-security'
import { mailConfiguration } from './mail'
import { parseSmtp } from './mail-settings'
import { DEFAULT_SECURITY_POLICY, SECURITY_ACTIONS, type SecurityPolicy, type SecurityAction } from '@shared/security'
import { DEFAULT_EMAIL_DOMAIN_POLICY, parseEmailDomainList, type EmailDomainPolicy } from '@shared/email-domain-policy'

export const SECURITY_LOCK = 730072
export const lockSecurity = (db: DbClient) => db.query('SELECT pg_advisory_xact_lock($1)', [SECURITY_LOCK])
export async function lockSecurityAdmin(db: DbClient, actorId: string) {
  await lockAccounts(db)
  await lockSecurity(db)
  const actor = await first<import('./auth').UserRow>(db, "SELECT * FROM users WHERE id=$1 AND role='super_admin' AND status='active'", [actorId])
  if (!actor) throw new SecurityError('forbidden', '超级管理员权限已变化', 403)
  return actor
}
export class SecurityError extends AccountError {
  constructor(
    public code: string,
    message: string,
    status: 400 | 403 | 409 | 429 | 503 = 429,
    public retryAfter = 60,
  ) {
    super(message, status)
  }
}
export function securityKey(value: string) {
  return createHmac('sha256', loadConfig().sessionHashSalt)
    .update('security:' + value)
    .digest('hex')
}
export function emailHint(email: string) {
  const [name = '', domain = ''] = email.split('@')
  return `${name.slice(0, 1)}***@${domain}`
}
export function queueKey(): Buffer | null {
  const raw = process.env.MAIL_QUEUE_ENCRYPTION_KEY || process.env.SITE_SETTINGS_ENCRYPTION_KEY || ''
  if (!/^[A-Za-z0-9+/]{43}=$/.test(raw)) return null
  const key = Buffer.from(raw, 'base64')
  return key.length === 32 ? key : null
}
export function sealMail(id: string, value: unknown) {
  const key = queueKey()
  if (!key) throw new SecurityError('mail_key_missing', '邮件队列加密尚未配置，请联系超级管理员', 503)
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from('mail-job:' + id))
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join('.')
}
export function openMail<T>(id: string, value: string): T {
  const key = queueKey()
  if (!key) throw new Error('mail_key_missing')
  const [version, iv, tag, data] = value.split('.')
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('mail_payload_invalid')
  const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'))
  cipher.setAAD(Buffer.from('mail-job:' + id))
  cipher.setAuthTag(Buffer.from(tag, 'base64'))
  return JSON.parse(Buffer.concat([cipher.update(Buffer.from(data, 'base64')), cipher.final()]).toString('utf8')) as T
}
export async function securityPolicy(db: DbClient): Promise<SecurityPolicy> {
  const row = await first<{ value: SecurityPolicy }>(db, "SELECT value FROM security_policy WHERE id='site'")
  if (!row) return structuredClone(DEFAULT_SECURITY_POLICY)
  // Invalid persisted policy must never silently disable protection.
  return validatePolicy(row.value)
}
export function validatePolicy(input: unknown): SecurityPolicy {
  if (!input || typeof input !== 'object') throw new SecurityError('policy_invalid', '安全策略格式无效', 400)
  const p = input as SecurityPolicy
  for (const key of [
    'daily',
    'monthly',
    'hourly',
    'cooldownSeconds',
    'accountQuarterHour',
    'accountDaily',
    'recipientDaily',
    'newAccountDaily',
    'ipQuarterHour',
    'identifierQuarterHour',
    'retentionDays',
  ] as const)
    if (!Number.isSafeInteger(p[key]) || p[key] < 1 || p[key] > (key === 'retentionDays' ? 180 : 100000))
      throw new SecurityError('policy_invalid', `${key} 超出允许范围`, 400)
  if (!Number.isSafeInteger(p.revision) || p.revision < 0 || typeof p.paused !== 'boolean' || !['smtp', 'resend'].includes(p.transport))
    throw new SecurityError('policy_invalid', '策略状态无效', 400)
  for (const [reserve, total] of [
    [p.reserveDaily, p.daily],
    [p.reserveMonthly, p.monthly],
  ] as const)
    if (!Number.isSafeInteger(reserve) || reserve < 0 || reserve >= total) throw new SecurityError('policy_invalid', '应急预留必须小于总预算', 400)
  if (p.daily > p.monthly || p.newAccountDaily > p.accountDaily)
    throw new SecurityError('policy_invalid', '日预算不能超过月预算，新账号限额不能超过账号限额', 400)
  if (!p.challenges || SECURITY_ACTIONS.some((action) => !['off', 'observe', 'enforce'].includes(p.challenges[action])))
    throw new SecurityError('policy_invalid', '验证策略无效', 400)
  const domains = Object.hasOwn(p, 'emailDomains') ? p.emailDomains : DEFAULT_EMAIL_DOMAIN_POLICY
  if (!domains || typeof domains !== 'object' || typeof domains.allowlistEnabled !== 'boolean' || typeof domains.includeSubdomains !== 'boolean')
    throw new SecurityError('policy_invalid', '邮箱域名策略格式无效', 400)
  const blocklist = parseEmailDomainList(domains.blocklist),
    allowlist = parseEmailDomainList(domains.allowlist)
  if (blocklist.error || allowlist.error)
    throw new SecurityError('policy_invalid', blocklist.error ? `域名黑名单：${blocklist.error}` : `域名白名单：${allowlist.error}`, 400)
  if (domains.allowlistEnabled && !allowlist.domains.length) throw new SecurityError('policy_invalid', '开启白名单时至少填写一个允许的邮箱域名', 400)
  const emailDomains: EmailDomainPolicy = {
    allowlistEnabled: domains.allowlistEnabled,
    includeSubdomains: domains.includeSubdomains,
    blocklist: blocklist.domains,
    allowlist: allowlist.domains,
  }
  return Object.fromEntries(
    Object.keys(DEFAULT_SECURITY_POLICY).map((key) => [
      key,
      key === 'challenges'
        ? Object.fromEntries(SECURITY_ACTIONS.map((a) => [a, p.challenges[a]]))
        : key === 'emailDomains'
          ? emailDomains
          : p[key as keyof SecurityPolicy],
    ]),
  ) as unknown as SecurityPolicy
}
export function requireReason(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length < 4 || value.length > 300) throw new SecurityError('reason_required', '请填写 4–300 字的操作原因', 400)
  return value.trim()
}
export async function saveSecurityPolicy(db: Db, actorId: string, input: unknown, reason: unknown) {
  const next = validatePolicy(input),
    why = requireReason(reason)
  if (next.transport === 'resend' && parseSmtp(mailConfiguration().smtp)?.hostname !== 'smtp.resend.com')
    throw new SecurityError('resend_configuration', '请先保存 smtp.resend.com 的发件凭据，再启用 Resend API', 400)
  return withTx(db, async (query) => {
    const tx = { query }
    await lockSecurityAdmin(tx, actorId)
    const before = await securityPolicy(tx)
    if (!next.paused && (await first(tx, "SELECT 1 FROM mail_worker_status WHERE id='restore-hold' AND updated_at>0")))
      throw new SecurityError('restore_reconciliation_required', '请先核对服务商额度并录入保守用量，再恢复发送', 409)
    if (before.revision !== next.revision) throw new SecurityError('policy_conflict', '安全策略已更新，请刷新后重试', 409)
    // Older clients omit the new field; saving another setting must not erase
    // the server's domain restrictions. A present but invalid field is rejected.
    const value = {
      ...next,
      emailDomains: Object.hasOwn(input as object, 'emailDomains') ? next.emailDomains : before.emailDomains,
      revision: next.revision + 1,
    }
    await query(
      "INSERT INTO security_policy(id,value,updated_at) VALUES('site',$1::jsonb,$2) ON CONFLICT(id) DO UPDATE SET value=EXCLUDED.value,updated_at=EXCLUDED.updated_at",
      [JSON.stringify(value), Date.now()],
    )
    await auditAccount(tx, actorId, 'security-center', 'security-policy', why, before, value)
    return value
  })
}
export async function securityEvent(
  db: DbClient,
  action: string,
  rule: string,
  outcome: string,
  identity: string,
  revision: number,
  hint = '',
  targetId = '',
  sourceHash = '',
) {
  const now = Date.now(),
    bucket = securityKey(`${action}:${rule}:${outcome}:${identity}:${targetId}:${Math.floor(now / 900000)}`)
  await db.query(
    `INSERT INTO security_events(id,bucket,action,rule,outcome,identity_hint,policy_revision,created_at,updated_at,target_id,source_hash)
    VALUES($1,$1,$2,$3,$4,$5,$6,$7,$7,$8,$9) ON CONFLICT(bucket) DO UPDATE SET count=security_events.count+1,updated_at=EXCLUDED.updated_at`,
    [bucket, action, rule, outcome, hint, revision, now, targetId, sourceHash],
  )
}
export async function restriction(db: DbClient, identities: Array<[string, string]>, action: SecurityAction) {
  const keys = identities.filter(([, value]) => value).map(([kind, value]) => securityKey(`${kind}:${value}`))
  if (!keys.length) return null
  return first<{ effect: string }>(
    db,
    `SELECT effect FROM security_restrictions WHERE key_hash=ANY($1::text[]) AND action IN ($2,'all') AND expires_at>$3
    ORDER BY CASE effect WHEN 'block' THEN 0 ELSE 1 END LIMIT 1`,
    [keys, action, Date.now()],
  )
}
