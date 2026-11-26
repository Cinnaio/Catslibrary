import { randomUUID } from 'node:crypto'
import * as webpush from 'web-push'
import type { Db } from '../db/pool'
import { first } from '../db/query'
import { notificationRows, notificationSettings, quietUntil } from './notifications'

import { pushConfiguration } from './push-settings'
export { pushConfiguration } from './push-settings'

export function validPushEndpoint(endpoint: string) {
  try {
    const u = new URL(endpoint)
    return (
      u.protocol === 'https:' &&
      !u.username &&
      !u.password &&
      !u.hash &&
      !u.port &&
      (u.hostname === 'web.push.apple.com' ||
        u.hostname.endsWith('.push.apple.com') ||
        u.hostname === 'fcm.googleapis.com' ||
        u.hostname === 'updates.push.services.mozilla.com' ||
        u.hostname.endsWith('.notify.windows.com'))
    )
  } catch {
    return false
  }
}
type Job = { id: number; notification_id: string; subscription_id: string; attempts: number; user_id: string; endpoint: string; p256dh: string; auth: string }
export async function runNotificationTick(db: Db, send = webpush.sendNotification) {
  const config = pushConfiguration()
  const maintenanceNow = Date.now()
  // Sessions revoke subscriptions by FK; expired sessions are also removed without waiting for another login.
  await db.query('DELETE FROM notification_subscriptions s USING user_sessions session WHERE s.session_hash=session.token_hash AND session.expires_at<=$1', [
    maintenanceNow,
  ])
  await db.query('DELETE FROM notifications WHERE created_at<$1', [maintenanceNow - 90 * 86400000])
  if (!config.configured) return
  for (let i = 0; i < 12; i++) {
    const now = Date.now()
    const lease = randomUUID()
    const claimed = await first<{ id: number }>(
      db,
      `UPDATE notification_deliveries SET state='sending',lease=$2,available_at=$1+60000,attempts=attempts+1
      WHERE id=(SELECT id FROM notification_deliveries WHERE state IN ('pending','sending') AND available_at<=$1
        ORDER BY available_at,id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id`,
      [now, lease],
    )
    if (!claimed) break
    const job = await first<Job>(
      db,
      `SELECT d.*,s.user_id,s.endpoint,s.p256dh,s.auth FROM notification_deliveries d
      JOIN notification_subscriptions s ON s.id=d.subscription_id JOIN users u ON u.id=s.user_id
      JOIN user_sessions session ON session.token_hash=s.session_hash
      WHERE d.id=$1 AND d.lease=$2 AND u.status='active' AND session.expires_at>$3 AND s.vapid_public_key=$4`,
      [claimed.id, lease, now, config.publicKey],
    )
    const finish = async (state: string, at = now) =>
      db.query('UPDATE notification_deliveries SET state=$3,available_at=$4 WHERE id=$1 AND lease=$2', [claimed.id, lease, state, at])
    if (!job || job.attempts > 5) {
      await finish('skipped')
      continue
    }
    const message = (await notificationRows(db, job.user_id, { id: job.notification_id }))[0]
    const settings = await notificationSettings(db, job.user_id)
    if (
      !message ||
      message.readAt ||
      now - Number(message.createdAt) > 86400000 ||
      (message.kind === 'reply' && !settings.replies) ||
      (message.kind === 'task' && !settings.tasks)
    ) {
      await finish('skipped')
      continue
    }
    const until = message.kind === 'test' ? now : quietUntil(settings, now)
    if (until > now) {
      await db.query("UPDATE notification_deliveries SET state='pending',available_at=$3,attempts=attempts-1 WHERE id=$1 AND lease=$2", [job.id, lease, until])
      continue
    }
    if (!validPushEndpoint(job.endpoint)) {
      await finish('failed')
      continue
    }
    try {
      // Payload intentionally contains no personal content. The service worker fetches an authenticated preview.
      await send({ endpoint: job.endpoint, keys: { p256dh: job.p256dh, auth: job.auth } }, JSON.stringify({ id: message.id }), {
        TTL: 3600,
        timeout: 10000,
        urgency: 'normal',
        vapidDetails: { subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey },
      })
      await finish('sent')
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode
      if (status === 404 || status === 410) await db.query('DELETE FROM notification_subscriptions WHERE id=$1', [job.subscription_id])
      else
        await finish(
          job.attempts >= 5 || (status && status >= 400 && status < 500 && status !== 429) ? 'failed' : 'pending',
          now + Math.min(3600000, 30000 * 2 ** job.attempts),
        )
    }
  }
}
