import { canManageUser, isAdministrator } from '@shared/roles'
import { emailDomainRejection } from '@shared/email-domain-policy'
import type { Db, DbClient } from '../db/pool'
import { first, withTx } from '../db/query'
import { lockAccounts } from './account-security'
import type { UserRow } from './auth'
import { lockSecurity, openMail, queueKey, restriction, securityKey, securityPolicy, securityEvent } from './security-policy'
import { budgetPeriods, releaseBudget, transportFingerprint, type MailJob, type MailPayload } from './mail-queue'
import { MailDeliveryError, sendAccountMail } from './mail'

export async function finishMail(db: DbClient, job: MailJob, state: string, code: string, release = false, providerId = '') {
  if (release) await releaseBudget(db, job)
  const terminal = !['queued', 'sending'].includes(state)
  await db.query(
    `UPDATE mail_jobs SET state=$2,error_code=$3,payload=CASE WHEN $4 THEN '' ELSE payload END,
    lease_until=0,updated_at=$5,provider_id=CASE WHEN $6<>'' THEN $6 ELSE provider_id END WHERE id=$1`,
    [job.id, state, code, terminal, Date.now(), providerId],
  )
  if (['failed', 'cancelled', 'expired', 'bounced', 'complained'].includes(state))
    await db.query('DELETE FROM account_email_tokens WHERE token_hash=$1', [job.token_hash])
  if (job.audit_id) {
    await db.query('UPDATE account_security_audit SET after_state=$2::jsonb WHERE id=$1', [
      job.audit_id,
      JSON.stringify({ purpose: job.purpose, delivery: state, code }),
    ])
    if (terminal)
      await db.query(`UPDATE admin_operation_audit SET status=$2,response_status=$3,error=$4,updated_at=$5,finished_at=$5 WHERE id=$1`, [
        job.audit_id,
        ['accepted', 'delivered'].includes(state) ? 'completed' : 'failed',
        ['accepted', 'delivered'].includes(state) ? 200 : 503,
        code,
        Date.now(),
      ])
  }
}
async function rolloverBudget(db: DbClient, job: MailJob) {
  const now = Date.now(),
    old = budgetPeriods(Number(job.budget_at)),
    next = budgetPeriods(now)
  if (old[0] === next[0]) return true
  // An uncertain previous attempt retains its original reservation; never silently resend across a quota boundary.
  if (job.attempts) return false
  const p = await securityPolicy(db),
    caps = [p.daily, p.monthly],
    reserves = [p.reserveDaily, p.reserveMonthly]
  for (let i = 0; i < 2; i++)
    if (old[i] !== next[i]) {
      const row = await first<{ reserved: number; ordinary: number }>(db, 'SELECT * FROM mail_budget WHERE period=$1', [next[i]])
      if (Number(row?.reserved || 0) >= caps[i]! || (!job.emergency && Number(row?.ordinary || 0) >= caps[i]! - reserves[i]!)) return false
    }
  for (let i = 0; i < 2; i++)
    if (old[i] !== next[i]) {
      await db.query('UPDATE mail_budget SET reserved=GREATEST(0,reserved-1),ordinary=GREATEST(0,ordinary-$2) WHERE period=$1', [old[i], job.emergency ? 0 : 1])
      await db.query(
        `INSERT INTO mail_budget(period,reserved,ordinary) VALUES($1,1,$2) ON CONFLICT(period)
      DO UPDATE SET reserved=mail_budget.reserved+1,ordinary=mail_budget.ordinary+EXCLUDED.ordinary`,
        [next[i], job.emergency ? 0 : 1],
      )
    }
  await db.query('UPDATE mail_jobs SET budget_at=$2 WHERE id=$1', [job.id, now])
  job.budget_at = now
  return true
}
export async function runMailTick(db: Db) {
  const claimed = await withTx(db, async (query) => {
    const tx = { query }
    await lockAccounts(tx)
    await lockSecurity(tx)
    const now = Date.now()
    await query("INSERT INTO mail_worker_status(id,updated_at) VALUES('worker',$1) ON CONFLICT(id) DO UPDATE SET updated_at=EXCLUDED.updated_at", [now])
    const stale = (await query<MailJob>("SELECT * FROM mail_jobs WHERE state='sending' AND lease_until<$1 LIMIT 20", [now])).rows
    for (const job of stale) {
      await query("UPDATE mail_attempts SET outcome='unknown',code='lease_expired' WHERE job_id=$1 AND attempt=$2 AND outcome='sending'", [
        job.id,
        job.attempts,
      ])
      if (job.transport === 'resend' && job.attempts < 3 && Number(job.expires_at) > now && budgetPeriods(Number(job.budget_at))[0] === budgetPeriods(now)[0])
        await query("UPDATE mail_jobs SET state='queued',had_unknown=true,next_attempt_at=$2,error_code='lease_recovered' WHERE id=$1", [job.id, now + 30000])
      else await finishMail(tx, job, 'unknown', 'lease_expired')
    }
    const expired = (await query<MailJob>("SELECT * FROM mail_jobs WHERE state='queued' AND expires_at<=$1 LIMIT 50", [now])).rows
    for (const job of expired) await finishMail(tx, job, job.had_unknown ? 'unknown' : 'expired', 'queue_expired', job.attempts === 0)
    const policy = await securityPolicy(tx)
    if (policy.paused || !queueKey()) return null
    const breaker = await first<{ updated_at: number }>(tx, "SELECT updated_at FROM mail_worker_status WHERE id='breaker'")
    if (Number(breaker?.updated_at || 0) > now) return null
    const job = await first<MailJob>(
      tx,
      "SELECT * FROM mail_jobs WHERE state='queued' AND next_attempt_at<=$1 ORDER BY emergency DESC,created_at LIMIT 1 FOR UPDATE SKIP LOCKED",
      [now],
    )
    if (!job) return null
    const user = await first<UserRow>(tx, 'SELECT * FROM users WHERE id=$1', [job.user_id])
    const actor = job.emergency ? await first<UserRow>(tx, 'SELECT * FROM users WHERE id=$1', [job.actor_id]) : null
    const token =
      job.purpose === 'test' ? true : await first(tx, 'SELECT 1 FROM account_email_tokens WHERE token_hash=$1 AND expires_at>$2', [job.token_hash, now])
    let payload: MailPayload
    try {
      payload = openMail(job.id, job.payload)
    } catch {
      await finishMail(tx, job, 'failed', 'payload_unreadable', job.attempts === 0)
      return null
    }
    const changed =
      !user ||
      user.status !== 'active' ||
      securityKey(user.password_hash) !== job.credential_hash ||
      !token ||
      (job.purpose !== 'verify-email' && (user.email !== payload.to || !user.email_verified_at)) ||
      (job.emergency &&
        (!actor || actor.status !== 'active' || !isAdministrator(actor.role) || (actor.id !== user?.id && !canManageUser(actor.role, user?.role)))) ||
      job.transport !== policy.transport ||
      job.transport_fingerprint !== transportFingerprint()
    const blocked = await restriction(
      tx,
      [
        ['account', job.user_id],
        ['email', payload.to],
      ],
      job.purpose === 'verify-email' ? 'verify-email' : 'forgot-password',
    )
    const domainRejection = emailDomainRejection(payload.to, policy.emailDomains)
    if (changed || blocked?.effect === 'block' || domainRejection) {
      await finishMail(
        tx,
        job,
        job.had_unknown ? 'unknown' : 'cancelled',
        changed ? 'account_or_configuration_changed' : domainRejection || 'recipient_restricted',
        job.attempts === 0,
      )
      if (!changed && domainRejection) await securityEvent(tx, job.purpose, domainRejection, 'blocked', job.user_id, policy.revision, '', job.user_id)
      return null
    }
    if (!(await rolloverBudget(tx, job))) {
      await finishMail(tx, job, job.attempts ? 'unknown' : 'cancelled', 'quota_boundary', job.attempts === 0)
      return null
    }
    const budgets = (
      await query<{ period: string; reserved: number; ordinary: number }>('SELECT * FROM mail_budget WHERE period=ANY($1::text[])', [budgetPeriods(now)])
    ).rows
    const day = budgets.find((x) => x.period.startsWith('d:')),
      month = budgets.find((x) => x.period.startsWith('m:'))
    if (
      Number(day?.reserved) > policy.daily ||
      Number(month?.reserved) > policy.monthly ||
      (!job.emergency && (Number(day?.ordinary) > policy.daily - policy.reserveDaily || Number(month?.ordinary) > policy.monthly - policy.reserveMonthly))
    )
      return null
    // All instances share a minimum inter-send interval.
    const last = await first<{ updated_at: number }>(tx, "SELECT updated_at FROM mail_worker_status WHERE id='last-send'")
    if (Number(last?.updated_at || 0) > now - 5000) return null
    await query("INSERT INTO mail_worker_status(id,updated_at) VALUES('last-send',$1) ON CONFLICT(id) DO UPDATE SET updated_at=EXCLUDED.updated_at", [now])
    await query("UPDATE mail_jobs SET state='sending',attempts=attempts+1,lease_until=$2,updated_at=$3 WHERE id=$1", [job.id, now + 90000, now])
    job.attempts++
    job.state = 'sending'
    await query("INSERT INTO mail_attempts(job_id,attempt,outcome,created_at) VALUES($1,$2,'sending',$3)", [job.id, job.attempts, now])
    return { job, payload }
  })
  if (!claimed) return
  const { job, payload } = claimed
  let result: { providerId: string } | undefined, failure: MailDeliveryError | undefined
  try {
    result = await sendAccountMail(payload.to, payload.subject, payload.url, job.id, job.transport)
  } catch (error) {
    failure = error instanceof MailDeliveryError ? error : new MailDeliveryError('delivery_unknown', 'unknown')
  }
  await withTx(db, async (query) => {
    const tx = { query }
    await lockAccounts(tx)
    await lockSecurity(tx)
    const current = await first<MailJob>(tx, 'SELECT * FROM mail_jobs WHERE id=$1', [job.id])
    if (!current) return
    await query('UPDATE mail_attempts SET outcome=$3,code=$4 WHERE job_id=$1 AND attempt=$2', [
      job.id,
      job.attempts,
      failure?.outcome || 'accepted',
      failure?.code || '',
    ])
    if (current.state !== 'sending' || current.attempts !== job.attempts) return // A webhook or a newer lease owns the result.
    if (failure) {
      const recent = await first<{ n: number }>(
        tx,
        "SELECT count(*)::int AS n FROM mail_attempts WHERE created_at>$1 AND outcome IN ('rejected','unknown','retry')",
        [Date.now() - 300000],
      )
      if (Number(recent?.n) >= 5)
        await query("INSERT INTO mail_worker_status(id,updated_at) VALUES('breaker',$1) ON CONFLICT(id) DO UPDATE SET updated_at=EXCLUDED.updated_at", [
          Date.now() + 300000,
        ])
    }
    if (!failure) await finishMail(tx, current, 'accepted', '', false, result?.providerId || '')
    else if (
      (failure.outcome === 'retry' || (failure.outcome === 'unknown' && job.transport === 'resend')) &&
      job.attempts < 3 &&
      Number(job.expires_at) > Date.now() + 60000
    ) {
      await query(
        "UPDATE mail_jobs SET state='queued',had_unknown=had_unknown OR $5,lease_until=0,error_code=$2,next_attempt_at=$3,updated_at=$4 WHERE id=$1",
        [job.id, failure.code, Date.now() + 30000 * 2 ** job.attempts, Date.now(), failure.outcome === 'unknown'],
      )
    } else
      await finishMail(
        tx,
        current,
        failure.outcome === 'unknown' || current.had_unknown ? 'unknown' : 'failed',
        failure.code,
        failure.outcome === 'rejected' && job.attempts === 1 && !current.had_unknown,
      )
  })
}
export async function pruneSecurity(db: Db) {
  const p = await securityPolicy(db),
    cutoff = Date.now() - p.retentionDays * 86400000
  await db.query('DELETE FROM security_counters WHERE key_hash IN (SELECT key_hash FROM security_counters WHERE expires_at<$1 LIMIT 5000)', [Date.now()])
  await db.query('DELETE FROM security_events WHERE updated_at<$1', [cutoff])
  await db.query('DELETE FROM mail_delivery_events WHERE received_at<$1', [cutoff])
  await db.query("DELETE FROM mail_jobs WHERE updated_at<$1 AND state NOT IN ('queued','sending')", [cutoff])
  await db.query('DELETE FROM security_restrictions WHERE expires_at<$1', [cutoff])
  await db.query('DELETE FROM account_email_tokens WHERE expires_at<$1', [Date.now()])
}
