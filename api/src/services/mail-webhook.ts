import { Webhook } from 'svix'
import type { Db } from '../db/pool'
import { first, withTx } from '../db/query'
import { lockAccounts } from './account-security'
import { lockSecurity, SecurityError, securityEvent, securityPolicy } from './security-policy'
import { finishMail } from './mail-worker'
import type { MailJob } from './mail-queue'
import { newId } from './auth'

const states: Record<string, string> = {
  'email.sent': 'accepted',
  'email.delivered': 'delivered',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
  'email.failed': 'failed',
  'email.suppressed': 'failed',
}
const rank: Record<string, number> = {
  queued: 0,
  sending: 0,
  unknown: 0,
  accepted: 1,
  failed: 2,
  delivered: 3,
  bounced: 4,
  complained: 5,
  cancelled: 6,
  expired: 6,
}
export async function receiveMailWebhook(db: Db, raw: string, headers: Record<string, string>) {
  const secret = process.env.RESEND_WEBHOOK_SECRET
  if (!secret) throw new SecurityError('webhook_unconfigured', '回调尚未配置', 503)
  let event: { type: string; created_at: string; data: { email_id: string; tags?: Record<string, string>; bounce?: { type?: string } } }
  try {
    new Webhook(secret).verify(raw, headers)
    event = JSON.parse(raw) as typeof event
  } catch {
    throw new SecurityError('webhook_invalid', '回调验证失败', 403)
  }
  if (typeof event?.data?.email_id !== 'string' || !event.data.email_id || !Object.hasOwn(states, event.type)) return
  const permanentBounce = event.type === 'email.bounced' && event.data.bounce?.type === 'Permanent'
  const state = event.type === 'email.bounced' && !permanentBounce ? 'failed' : states[event.type]!
  const suppress = permanentBounce || ['email.complained', 'email.suppressed'].includes(event.type)
  const occurred = Date.parse(event.created_at)
  if (!Number.isFinite(occurred)) throw new SecurityError('webhook_invalid', '回调格式无效', 400)
  await withTx(db, async (query) => {
    const tx = { query }
    await lockAccounts(tx)
    await lockSecurity(tx)
    const inserted = await query(
      `INSERT INTO mail_delivery_events(id,provider_id,kind,occurred_at,received_at,delivery_state,suppress) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO NOTHING RETURNING id`,
      [headers['svix-id'], event.data.email_id, event.type, occurred, Date.now(), state, suppress],
    )
    if (!inserted.rows.length) return
    // Only a signed provider event may associate a job tag with its provider id.
    const tag = typeof event.data.tags?.job_id === 'string' ? event.data.tags.job_id : ''
    const job = await first<MailJob>(tx, "SELECT * FROM mail_jobs WHERE transport='resend' AND (provider_id=$1 OR (id=$2 AND provider_id='')) LIMIT 1", [
      event.data.email_id,
      tag,
    ])
    if (job) {
      await query("UPDATE mail_jobs SET provider_id=$2 WHERE id=$1 AND provider_id=''", [job.id, event.data.email_id])
      await applyDelivery(tx, job, state, event.type, event.data.email_id, suppress)
    }
    if (job) await query('UPDATE mail_delivery_events SET applied=true WHERE id=$1', [headers['svix-id']])
    await query("INSERT INTO mail_worker_status(id,updated_at) VALUES('webhook',$1) ON CONFLICT(id) DO UPDATE SET updated_at=EXCLUDED.updated_at", [Date.now()])
  })
}
async function applyDelivery(db: import('../db/pool').DbClient, job: MailJob, state: string, kind: string, providerId: string, suppress: boolean) {
  if ((rank[state] || 0) > (rank[job.state] || 0)) await finishMail(db, job, state, kind, false, providerId)
  if (suppress) {
    const exists = await first(
      db,
      "SELECT 1 FROM security_restrictions WHERE key_hash=$1 AND effect='block' AND action='all' AND actor_id='provider' AND expires_at>$2",
      [job.recipient_hash, Date.now()],
    )
    if (!exists)
      await db.query(
        `INSERT INTO security_restrictions(id,kind,key_hash,action,effect,hint,reason,expires_at,created_at,actor_id)
      VALUES($1,'email',$2,'all','block',$3,$4,$5,$6,'provider')`,
        [newId('restriction'), job.recipient_hash, job.recipient_hint, kind, Date.now() + 3650 * 86400000, Date.now()],
      )
    await securityEvent(db, job.purpose, kind, 'suppressed', job.recipient_hash, (await securityPolicy(db)).revision, job.recipient_hint, job.user_id)
  }
}
export async function reconcileDeliveryEvents(db: Db) {
  await withTx(db, async (query) => {
    const tx = { query }
    await lockAccounts(tx)
    await lockSecurity(tx)
    const rows = (
      await query<{
        id: string
        provider_id: string
        kind: string
        delivery_state: string
        suppress: boolean
      }>(`SELECT e.id,e.provider_id,e.kind,e.delivery_state,e.suppress FROM mail_delivery_events e
      WHERE applied=false AND EXISTS(SELECT 1 FROM mail_jobs j WHERE j.provider_id=e.provider_id) ORDER BY occurred_at LIMIT 50`)
    ).rows
    for (const event of rows) {
      const job = await first<MailJob>(tx, 'SELECT * FROM mail_jobs WHERE provider_id=$1', [event.provider_id])
      if (job) await applyDelivery(tx, job, event.delivery_state, event.kind, event.provider_id, event.suppress)
      await query('UPDATE mail_delivery_events SET applied=true WHERE id=$1', [event.id])
    }
  })
}
