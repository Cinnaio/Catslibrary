import type { DbClient } from '../db/pool'
import { first } from '../db/query'
import type { SecurityPolicy } from '@shared/security'
import { mailConfiguration } from './mail'
import { emailHint, restriction, sealMail, securityKey, SecurityError } from './security-policy'
import { newId, type UserRow } from './auth'

export interface MailPayload {
  to: string
  subject: string
  url: string
}
export interface MailJob {
  id: string
  user_id: string
  actor_id: string
  recipient_hash: string
  recipient_hint: string
  purpose: 'verify-email' | 'reset-password' | 'test'
  state: string
  emergency: boolean
  payload: string
  token_hash: string
  credential_hash: string
  transport: 'smtp' | 'resend'
  transport_fingerprint: string
  provider_id: string
  attempts: number
  error_code: string
  next_attempt_at: number
  lease_until: number
  expires_at: number
  created_at: number
  updated_at: number
  budget_at: number
  policy_revision: number
  released: boolean
  had_unknown: boolean
  audit_id: string
}
export function budgetPeriods(now: number) {
  const date = new Date(now).toISOString()
  return ['d:' + date.slice(0, 10), 'm:' + date.slice(0, 7)]
}
export function transportFingerprint() {
  const c = mailConfiguration()
  return securityKey(JSON.stringify({ smtp: c.smtp, from: c.from, publicOrigin: c.publicOrigin, outbox: c.outbox }))
}
export async function releaseBudget(db: DbClient, job: MailJob) {
  if (job.released) return
  for (const period of budgetPeriods(Number(job.budget_at)))
    await db.query('UPDATE mail_budget SET reserved=GREATEST(0,reserved-1),ordinary=GREATEST(0,ordinary-$2) WHERE period=$1', [period, job.emergency ? 0 : 1])
  await db.query('UPDATE mail_jobs SET released=true WHERE id=$1', [job.id])
}
/** Called under account lock then SECURITY_LOCK, in the token/queue transaction. */
export async function reserveMail(
  db: DbClient,
  p: SecurityPolicy,
  user: UserRow,
  email: string,
  purpose: MailJob['purpose'],
  emergency: boolean,
  actor = user.id,
) {
  const now = Date.now(),
    recipient = securityKey('email:' + email)
  if (p.paused) throw new SecurityError('mail_paused', '邮件发送已暂停，请稍后重试', 503)
  const rule = await restriction(
    db,
    [
      ['account', user.id],
      ['email', email],
    ],
    purpose === 'verify-email' ? 'verify-email' : 'forgot-password',
  )
  if (rule?.effect === 'block') throw new SecurityError('mail_restricted', '此邮件操作暂时受限，请联系管理员', 403)
  const duplicate = await first<MailJob>(
    db,
    `SELECT * FROM mail_jobs WHERE user_id=$1 AND recipient_hash=$2 AND purpose=$3
    AND (state IN ('queued','sending') OR (state IN ('accepted','delivered','unknown') AND created_at>$4)) ORDER BY created_at DESC LIMIT 1`,
    [user.id, recipient, purpose, now - p.cooldownSeconds * 1000],
  )
  if (duplicate) return { duplicate: duplicate.id, recipient }
  // Emergency bypasses ordinary per-recipient exhaustion only after a verified administrator action.
  if (!emergency) {
    const counts = await first<{ quarter: number; day: number; recipient: number; recent: number }>(
      db,
      `SELECT
      count(*) FILTER(WHERE user_id=$1 AND created_at>$3)::int AS quarter,
      count(*) FILTER(WHERE user_id=$1)::int AS day,
      count(*) FILTER(WHERE recipient_hash=$2)::int AS recipient,
      count(*) FILTER(WHERE user_id=$1 AND created_at>$5)::int AS recent
      FROM mail_jobs WHERE created_at>$4 AND released=false AND (user_id=$1 OR recipient_hash=$2)`,
      [user.id, recipient, now - 900000, now - 86400000, now - p.cooldownSeconds * 1000],
    )
    const accountLimit = Number(user.created_at) > now - 86400000 ? Math.min(p.newAccountDaily, p.accountDaily) : p.accountDaily
    if (counts && (counts.recent || counts.quarter >= p.accountQuarterHour || counts.day >= accountLimit || counts.recipient >= p.recipientDaily))
      throw new SecurityError('mail_recipient_rate', '邮件申请过于频繁，请稍后重试', 429, p.cooldownSeconds)
    const hourly = await first<{ n: number }>(db, 'SELECT count(*)::int AS n FROM mail_jobs WHERE created_at>$1 AND emergency=false AND released=false', [
      now - 3600000,
    ])
    if (Number(hourly?.n) >= p.hourly) throw new SecurityError('mail_hour_budget', '邮件服务繁忙，请稍后重试', 429, 3600)
  } else {
    const recent = await first(db, 'SELECT 1 FROM mail_jobs WHERE actor_id=$1 AND emergency=true AND created_at>$2 AND released=false', [actor, now - 60000])
    if (recent) throw new SecurityError('mail_emergency_rate', '应急发送仍需间隔一分钟', 429)
  }
  const periods = budgetPeriods(now),
    caps = [p.daily, p.monthly],
    reserves = [p.reserveDaily, p.reserveMonthly]
  for (let i = 0; i < periods.length; i++) {
    const row = await first<{ reserved: number; ordinary: number }>(db, 'SELECT reserved,ordinary FROM mail_budget WHERE period=$1', [periods[i]])
    if (Number(row?.reserved || 0) >= caps[i]! || (!emergency && Number(row?.ordinary || 0) >= caps[i]! - reserves[i]!))
      throw new SecurityError('mail_budget_exhausted', '邮件发送额度暂不可用，请稍后重试或联系管理员', 503)
  }
  for (const period of periods)
    await db.query(
      `INSERT INTO mail_budget(period,reserved,ordinary) VALUES($1,1,$2)
    ON CONFLICT(period) DO UPDATE SET reserved=mail_budget.reserved+1,ordinary=mail_budget.ordinary+EXCLUDED.ordinary`,
      [period, emergency ? 0 : 1],
    )
  return { duplicate: '', recipient }
}
export async function insertMailJob(
  db: DbClient,
  input: {
    id?: string
    user: UserRow
    actor: string
    email: string
    purpose: MailJob['purpose']
    emergency: boolean
    policy: SecurityPolicy
    payload: MailPayload
    tokenHash: string
    auditId: string
  },
) {
  const id = input.id || newId('mail'),
    now = Date.now()
  await db.query(
    `INSERT INTO mail_jobs(id,user_id,actor_id,recipient_hash,recipient_hint,purpose,state,emergency,payload,token_hash,credential_hash,
    transport,transport_fingerprint,next_attempt_at,expires_at,created_at,updated_at,budget_at,policy_revision,audit_id)
    VALUES($1,$2,$3,$4,$5,$6,'queued',$7,$8,$9,$10,$11,$12,$13,$14,$13,$13,$13,$15,$16)`,
    [
      id,
      input.user.id,
      input.actor,
      securityKey('email:' + input.email),
      emailHint(input.email),
      input.purpose,
      input.emergency,
      sealMail(id, input.payload),
      input.tokenHash,
      securityKey(input.user.password_hash),
      input.policy.transport,
      transportFingerprint(),
      now,
      now + 10 * 60000,
      input.policy.revision,
      input.auditId,
    ],
  )
  return id
}
