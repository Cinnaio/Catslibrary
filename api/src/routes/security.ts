import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { randomBytes } from 'node:crypto'
import { isIP } from 'node:net'
import { getDb } from '../db/pool'
import { first, withTx } from '../db/query'
import { requireAdmin, optionalUser, type AuthEnv } from '../middlewares/auth'
import { AccountError, auditAccount } from '../services/account-security'
import { effectiveTurnstile } from '../services/turnstile'
import {
  SecurityError,
  securityPolicy,
  saveSecurityPolicy,
  queueKey,
  securityKey,
  emailHint,
  requireReason,
  lockSecurityAdmin,
  restriction,
} from '../services/security-policy'
import { clientIpFromContext } from '../services/ai/audit-context'
import { mailConfiguration } from '../services/mail'
import { budgetPeriods, reserveMail, insertMailJob, type MailJob } from '../services/mail-queue'
import { finishMail } from '../services/mail-worker'
import { receiveMailWebhook } from '../services/mail-webhook'
import { normalizeEmail } from '../services/account-email'
import { newId } from '../services/auth'
import { SECURITY_ACTIONS, type SecurityAction, type SecurityOverview } from '@shared/security'

export const securityAdminRoutes = new Hono<AuthEnv>()
export const securityPublicRoutes = new Hono<AuthEnv>()
for (const routes of [securityAdminRoutes, securityPublicRoutes]) {
  routes.use('*', bodyLimit({ maxSize: 262144, onError: (c) => c.json({ error: '请求过大' }, 413) }))
  routes.onError((error, c) => {
    if (error instanceof SecurityError) {
      c.header('Retry-After', String(error.retryAfter))
      return c.json({ error: error.message, code: error.code }, error.status)
    }
    if (error instanceof AccountError) return c.json({ error: error.message }, error.status)
    return c.json({ error: '安全服务暂不可用' }, 503)
  })
}
securityAdminRoutes.use('*', requireAdmin())
function actionOf(value: unknown): SecurityAction {
  if (!SECURITY_ACTIONS.includes(value as SecurityAction)) throw new SecurityError('action_invalid', '验证用途无效', 400)
  return value as SecurityAction
}
securityPublicRoutes.get('/challenge', optionalUser(), async (c) => {
  const action = actionOf(c.req.query('action')),
    p = await securityPolicy(getDb()),
    config = await effectiveTurnstile()
  const rule = await restriction(
    getDb(),
    [
      ['ip', clientIpFromContext(c)],
      ['account', action === 'verify-email' ? c.get('user')?.id || '' : ''],
    ],
    action,
  )
  c.header('Cache-Control', 'no-store')
  return c.json({
    action,
    mode: rule?.effect === 'allow' ? 'off' : p.challenges[action],
    siteKey: config.configured ? config.siteKey : '',
    configured: config.configured,
  })
})
securityPublicRoutes.get('/native-challenge', async (c) => {
  const action = actionOf(c.req.query('action')),
    config = await effectiveTurnstile()
  if (!config.configured) return c.json({ error: '安全验证尚未配置' }, 503)
  c.header('Cache-Control', 'no-store')
  const nonce = randomBytes(18).toString('base64'),
    key = JSON.stringify(config.siteKey).replace(/</g, '\\u003c')
  c.header(
    'Content-Security-Policy',
    `default-src 'none'; script-src 'nonce-${nonce}' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src https://challenges.cloudflare.com; style-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`,
  )
  c.header('Referrer-Policy', 'no-referrer')
  return c.html(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>账户安全验证</title>
<style nonce="${nonce}">:root{color-scheme:light dark}body{font:16px system-ui;margin:16px}</style>
<script nonce="${nonce}">function report(status,token=''){window.webkit?.messageHandlers?.accountChallenge?.postMessage({status,token});document.getElementById('status').textContent=status==='success'?'验证完成，请返回应用继续。':'验证失败或已过期，请重新验证。'}
window.addEventListener('error',e=>{if(e.target?.tagName==='SCRIPT')report('error')},true);
function ready(){turnstile.render('#challenge',{sitekey:${key},action:'${action.replace(/-/g, '_')}',callback:token=>report('success',token),'expired-callback':()=>report('expired'),'error-callback':()=>report('error'),theme:'auto'});}</script>
<script nonce="${nonce}" src="https://challenges.cloudflare.com/turnstile/v0/api.js?onload=ready&render=explicit" defer></script></head><body><div id="challenge"></div><p id="status">正在加载安全验证…</p></body></html>`)
})
securityPublicRoutes.post('/resend-webhook', async (c) => {
  await receiveMailWebhook(getDb(), await c.req.text(), {
    'svix-id': c.req.header('svix-id') || '',
    'svix-timestamp': c.req.header('svix-timestamp') || '',
    'svix-signature': c.req.header('svix-signature') || '',
  })
  return c.json({ success: true })
})
securityAdminRoutes.get('/overview', async (c) => {
  const db = getDb(),
    p = await securityPolicy(db),
    now = Date.now(),
    periods = budgetPeriods(now)
  const budgets = (await db.query<{ period: string; reserved: number; ordinary: number }>('SELECT * FROM mail_budget WHERE period=ANY($1::text[])', [periods]))
    .rows
  const today = budgets.find((x) => x.period === periods[0]),
    month = budgets.find((x) => x.period === periods[1])
  const counts = await first<{ queued: number; unknown: number; failed: number; accepted: number; delivered: number }>(
    db,
    `SELECT
    count(*) FILTER(WHERE state IN ('queued','sending'))::int AS queued,count(*) FILTER(WHERE state='unknown')::int AS unknown,
    count(*) FILTER(WHERE state IN ('failed','bounced','complained') AND created_at>$1)::int AS failed,
    count(*) FILTER(WHERE state IN ('accepted','delivered') AND created_at>$1)::int AS accepted,
    count(*) FILTER(WHERE state='delivered' AND created_at>$1)::int AS delivered FROM mail_jobs`,
    [now - 86400000],
  )
  const blocked = await first<{ n: number }>(db, "SELECT COALESCE(sum(count),0)::int AS n FROM security_events WHERE outcome='blocked' AND updated_at>$1", [
    now - 86400000,
  ])
  const status = (await db.query<{ id: string; updated_at: number }>('SELECT * FROM mail_worker_status')).rows
  const workerAt = Number(status.find((x) => x.id === 'worker')?.updated_at || 0),
    lastWebhookAt = Number(status.find((x) => x.id === 'webhook')?.updated_at || 0)
  const restoreHold = Number(status.find((x) => x.id === 'restore-hold')?.updated_at || 0) > 0,
    breakerUntil = Number(status.find((x) => x.id === 'breaker')?.updated_at || 0)
  const trend = (
    await db.query<{ day: string; sent: number; failed: number }>(
      `SELECT to_char(to_timestamp(created_at/1000.0) AT TIME ZONE 'UTC','YYYY-MM-DD') AS day,
    count(*) FILTER(WHERE released=false)::int AS sent,count(*) FILTER(WHERE state IN ('failed','bounced','complained'))::int AS failed
    FROM mail_jobs WHERE created_at>$1 GROUP BY day ORDER BY day`,
      [now - 14 * 86400000],
    )
  ).rows
  const config = mailConfiguration(),
    turnstile = await effectiveTurnstile()
  const alerts: SecurityOverview['alerts'] = []
  if (p.paused) alerts.push({ code: 'paused', message: '邮件已暂停，待发任务仍会按有效期清理。', severity: 'warning' })
  if (restoreHold) alerts.push({ code: 'restore', message: '备份已恢复，请核对服务商用量后录入保守计数，解除恢复保护。', severity: 'error' })
  if (breakerUntil > now) alerts.push({ code: 'breaker', message: '短时间内连续投递失败，工作进程自动冷却五分钟。', severity: 'warning' })
  if (!queueKey()) alerts.push({ code: 'encryption', message: '队列加密密钥尚未配置，邮件不能入队。', severity: 'error' })
  if (!config.ready) alerts.push({ code: 'mail', message: '发件服务尚未配置完整。', severity: 'error' })
  if (!turnstile.configured && Object.values(p.challenges).includes('enforce'))
    alerts.push({ code: 'challenge', message: '强制验证已启用，但 Turnstile 尚未就绪，对应申请会被阻止。', severity: 'error' })
  if (now - workerAt > 90000) alerts.push({ code: 'worker', message: '投递工作进程尚未运行或心跳中断。', severity: 'error' })
  if (counts?.unknown) alerts.push({ code: 'unknown', message: `${counts.unknown} 封邮件的投递结果待核实，额度仍保留。`, severity: 'warning' })
  if ((counts?.failed || 0) >= 3) alerts.push({ code: 'delivery', message: '最近一天出现多次投递失败，请检查邮件记录和停发名单。', severity: 'warning' })
  for (const [name, value, max] of [
    ['日', today?.reserved || 0, p.daily],
    ['月', month?.reserved || 0, p.monthly],
  ] as const)
    if (value / max >= 0.7)
      alerts.push({
        code: `budget-${name}`,
        message: `本站${name}预算已使用 ${value}/${max}，${value >= max ? '已达到上限' : value / max >= 0.9 ? '接近上限' : '请留意剩余额度'}。`,
        severity: value >= max ? 'error' : 'warning',
      })
  const response: SecurityOverview = {
    policy: p,
    today: today?.reserved || 0,
    month: month?.reserved || 0,
    ordinaryToday: today?.ordinary || 0,
    ordinaryMonth: month?.ordinary || 0,
    queued: counts?.queued || 0,
    unknown: counts?.unknown || 0,
    failed: counts?.failed || 0,
    accepted: counts?.accepted || 0,
    delivered: counts?.delivered || 0,
    blocked: blocked?.n || 0,
    encryptionReady: Boolean(queueKey()),
    mailReady: config.ready,
    turnstileReady: turnstile.configured,
    webhookReady: Boolean(process.env.RESEND_WEBHOOK_SECRET),
    workerAt,
    lastWebhookAt,
    nextResetAt: Date.parse(new Date(now).toISOString().slice(0, 10)) + 86400000,
    trend,
    alerts,
    restoreHold,
    breakerUntil,
  }
  return c.json(response)
})
securityAdminRoutes.put('/policy', async (c) => {
  const body = await c.req.json()
  return c.json(await saveSecurityPolicy(getDb(), c.get('user').id, body.policy, body.reason))
})
securityAdminRoutes.post('/budget-reconcile', async (c) => {
  const body = await c.req.json(),
    reason = requireReason(body.reason)
  if (!Number.isSafeInteger(body.daily) || !Number.isSafeInteger(body.monthly) || body.daily < 0 || body.monthly < body.daily || body.monthly > 1000000)
    throw new SecurityError('budget_invalid', '请填写有效的日／月已用额度，月计数不能小于日计数', 400)
  await withTx(getDb(), async (query) => {
    const tx = { query }
    await lockSecurityAdmin(tx, c.get('user').id)
    const periods = budgetPeriods(Date.now()),
      values = [body.daily, body.monthly]
    const before = []
    for (let i = 0; i < 2; i++) {
      const row = await first<{ reserved: number; ordinary: number }>(tx, 'SELECT reserved,ordinary FROM mail_budget WHERE period=$1', [periods[i]])
      before.push({ period: periods[i], reserved: Number(row?.reserved || 0), ordinary: Number(row?.ordinary || 0) })
      if (Number(row?.reserved || 0) > values[i]) throw new SecurityError('budget_decrease', '核对只能上调用量，不能退回已预占或结果未知的额度', 400)
      await query(
        `INSERT INTO mail_budget(period,reserved,ordinary) VALUES($1,$2,$2) ON CONFLICT(period) DO UPDATE SET
        ordinary=mail_budget.ordinary+EXCLUDED.reserved-mail_budget.reserved,reserved=EXCLUDED.reserved`,
        [periods[i], values[i]],
      )
    }
    await query("UPDATE mail_worker_status SET updated_at=0 WHERE id='restore-hold'")
    await auditAccount(tx, c.get('user').id, 'security-center', 'mail-budget-reconcile', reason, before, { daily: body.daily, monthly: body.monthly })
  })
  return c.json({ success: true })
})
securityAdminRoutes.get('/mail', async (c) => {
  const offset = Math.max(0, Math.min(100000, Number(c.req.query('offset')) || 0)),
    state = c.req.query('state') || '',
    q = (c.req.query('q') || '').slice(0, 100)
  const where = `WHERE ($1='' OR j.state=$1) AND ($2='' OR position(lower($2) in lower(j.recipient_hint||' '||j.user_id||' '||j.id))>0)
    AND ($3 OR EXISTS(SELECT 1 FROM users u WHERE u.id=j.user_id AND u.role='reader'))`
  const params = [state, q, c.get('user').role === 'super_admin']
  const items = (
    await getDb().query(
      `SELECT j.id,j.user_id,j.actor_id,j.recipient_hint,j.purpose,j.state,j.emergency,j.attempts,j.error_code,j.created_at,j.updated_at,j.expires_at,j.provider_id,j.transport FROM mail_jobs j ${where} ORDER BY j.created_at DESC,j.id LIMIT 30 OFFSET $4`,
      [...params, Math.floor(offset)],
    )
  ).rows
  const total = await first<{ n: number }>(getDb(), `SELECT count(*)::int AS n FROM mail_jobs j ${where}`, params)
  return c.json({ items, total: total?.n || 0 })
})
securityAdminRoutes.get('/mail/:id', async (c) => {
  const job = await first<MailJob>(getDb(), 'SELECT * FROM mail_jobs WHERE id=$1', [c.req.param('id')])
  if (!job) throw new SecurityError('not_found', '邮件记录不存在', 400)
  if (c.get('user').role !== 'super_admin' && !(await first(getDb(), "SELECT 1 FROM users WHERE id=$1 AND role='reader'", [job.user_id])))
    throw new SecurityError('forbidden', '无权查看', 403)
  return c.json({
    attempts: (await getDb().query('SELECT attempt,outcome,code,created_at FROM mail_attempts WHERE job_id=$1 ORDER BY id', [job.id])).rows,
    events: (await getDb().query('SELECT kind,occurred_at,received_at FROM mail_delivery_events WHERE provider_id=$1 ORDER BY occurred_at', [job.provider_id]))
      .rows,
  })
})
securityAdminRoutes.post('/mail/:id/cancel', async (c) => {
  const body = await c.req.json(),
    reason = requireReason(body.reason)
  await withTx(getDb(), async (query) => {
    const tx = { query }
    await lockSecurityAdmin(tx, c.get('user').id)
    const job = await first<MailJob>(tx, 'SELECT * FROM mail_jobs WHERE id=$1', [c.req.param('id')])
    if (!job || job.state !== 'queued') throw new SecurityError('mail_changed', '只可取消尚未开始的待发任务，请刷新', 409)
    await finishMail(tx, job, job.had_unknown ? 'unknown' : 'cancelled', 'admin_cancelled', job.attempts === 0)
    await auditAccount(tx, c.get('user').id, job.user_id, 'mail-cancel', reason, { state: job.state }, { state: job.had_unknown ? 'unknown' : 'cancelled' })
  })
  return c.json({ success: true })
})
securityAdminRoutes.post('/mail/:id/resolve', async (c) => {
  const body = await c.req.json(),
    reason = requireReason(body.reason)
  if (!['accepted', 'failed'].includes(body.state)) throw new SecurityError('state_invalid', '核实结果无效', 400)
  await withTx(getDb(), async (query) => {
    const tx = { query }
    await lockSecurityAdmin(tx, c.get('user').id)
    const job = await first<MailJob>(tx, 'SELECT * FROM mail_jobs WHERE id=$1', [c.req.param('id')])
    if (!job || job.state !== 'unknown') throw new SecurityError('mail_changed', '只可核实结果未知的任务，请刷新', 409)
    await finishMail(tx, job, body.state, 'admin_reconciled', false)
    await auditAccount(tx, c.get('user').id, job.user_id, 'mail-resolve', reason, { state: 'unknown' }, { state: body.state, quotaRetained: true })
  })
  return c.json({ success: true })
})
securityAdminRoutes.post('/test-mail', async (c) => {
  const body = await c.req.json(),
    reason = requireReason(body.reason),
    user = c.get('user')
  if (!user.email || !user.email_verified_at) throw new SecurityError('email_required', '请先验证自己的邮箱；测试只能发送至当前管理员已验证邮箱', 400)
  if (!mailConfiguration().ready) throw new SecurityError('mail_unconfigured', '邮件配置尚未就绪', 503)
  const id = await withTx(getDb(), async (query) => {
    const tx = { query }
    const current = await lockSecurityAdmin(tx, user.id)
    const policy = await securityPolicy(tx)
    if (!current.email || !current.email_verified_at) throw new SecurityError('email_required', '请先验证自己的邮箱', 400)
    const reserved = await reserveMail(tx, policy, current, current.email, 'test', false)
    if (reserved.duplicate) return reserved.duplicate
    const auditId = await auditAccount(tx, user.id, user.id, 'mail-test', reason, null, { delivery: 'queued' }, true)
    return insertMailJob(tx, {
      user: current,
      actor: user.id,
      email: current.email,
      purpose: 'test',
      emergency: false,
      policy,
      payload: { to: current.email, subject: 'Cat’s Library 邮件投递测试', url: '' },
      tokenHash: '',
      auditId,
    })
  })
  return c.json({ id, message: '测试邮件已入队，计入本站普通预算。' })
})
securityAdminRoutes.get('/events', async (c) => {
  const offset = Math.max(0, Math.min(100000, Number(c.req.query('offset')) || 0)),
    outcome = c.req.query('outcome') || ''
  const where = `WHERE ($1='' OR e.outcome=$1) AND ($2 OR EXISTS(SELECT 1 FROM users u WHERE u.id=e.target_id AND u.role='reader'))`
  const params = [outcome, c.get('user').role === 'super_admin']
  const items = (
    await getDb().query(
      `SELECT e.id,e.action,e.rule,e.outcome,e.identity_hint,e.target_id,e.count,e.policy_revision,e.created_at,e.updated_at,(e.source_hash<>'') AS can_restrict_source FROM security_events e ${where} ORDER BY updated_at DESC,id LIMIT 30 OFFSET $3`,
      [...params, Math.floor(offset)],
    )
  ).rows
  const total = await first<{ n: number }>(getDb(), `SELECT count(*)::int AS n FROM security_events e ${where}`, params)
  return c.json({ items, total: total?.n || 0 })
})
securityAdminRoutes.post('/events/:id/restrict-source', async (c) => {
  const reason = requireReason((await c.req.json()).reason)
  await withTx(getDb(), async (query) => {
    const tx = { query }
    await lockSecurityAdmin(tx, c.get('user').id)
    const event = await first<{ action: SecurityAction; source_hash: string; identity_hint: string }>(
      tx,
      'SELECT action,source_hash,identity_hint FROM security_events WHERE id=$1',
      [c.req.param('id')],
    )
    if (!event?.source_hash || !SECURITY_ACTIONS.includes(event.action)) throw new SecurityError('source_missing', '此事件没有可处置的请求来源', 400)
    const now = Date.now(),
      expires = now + 86400000
    const existing = await first<{ id: string }>(
      tx,
      "SELECT id FROM security_restrictions WHERE kind='ip' AND key_hash=$1 AND action=$2 AND effect='block' AND expires_at>$3",
      [event.source_hash, event.action, now],
    )
    if (existing) return
    const id = newId('restriction')
    await query(
      `INSERT INTO security_restrictions(id,kind,key_hash,action,effect,hint,reason,expires_at,created_at,actor_id)
      VALUES($1,'ip',$2,$3,'block',$4,$5,$6,$7,$8)`,
      [id, event.source_hash, event.action, event.identity_hint, reason, expires, now, c.get('user').id],
    )
    await auditAccount(
      tx,
      c.get('user').id,
      'security-center',
      'security-event-restrict',
      reason,
      { eventId: c.req.param('id') },
      { id, action: event.action, hint: event.identity_hint, expiresAt: expires },
    )
  })
  return c.json({ success: true })
})
securityAdminRoutes.get('/restrictions', async (c) => {
  const offset = Math.max(0, Math.min(100000, Number(c.req.query('offset')) || 0)),
    now = Date.now()
  const items = (
    await getDb().query(
      'SELECT id,kind,action,effect,hint,reason,expires_at,created_at,actor_id FROM security_restrictions WHERE expires_at>$1 ORDER BY created_at DESC LIMIT 30 OFFSET $2',
      [now, Math.floor(offset)],
    )
  ).rows
  const total = await first<{ n: number }>(getDb(), 'SELECT count(*)::int AS n FROM security_restrictions WHERE expires_at>$1', [now])
  return c.json({ items, total: total?.n || 0 })
})
securityAdminRoutes.post('/restrictions', async (c) => {
  const b = await c.req.json(),
    reason = requireReason(b.reason),
    now = Date.now()
  if (
    !['account', 'email', 'ip'].includes(b.kind) ||
    !['block', 'allow'].includes(b.effect) ||
    !['all', ...SECURITY_ACTIONS].includes(b.action) ||
    typeof b.value !== 'string' ||
    b.value.length > 254 ||
    !Number.isSafeInteger(b.hours) ||
    b.hours < 1 ||
    b.hours > 720
  )
    throw new SecurityError('restriction_invalid', '限制参数无效，有效期应为 1–720 小时', 400)
  const value = b.kind === 'email' ? normalizeEmail(b.value) : b.value.trim()
  if (!value || (b.kind === 'ip' && !isIP(value))) throw new SecurityError('restriction_invalid', '目标格式无效', 400)
  if (b.effect === 'allow' && b.kind === 'email') throw new SecurityError('restriction_invalid', '邮箱不支持验证豁免，请对账号或 IP 设置限时例外', 400)
  if (b.effect === 'allow' && b.kind === 'account' && b.action !== 'verify-email')
    throw new SecurityError('restriction_invalid', '账号例外仅适用于已登录的邮箱绑定；匿名请求不能凭填写的账号获得豁免', 400)
  if (b.kind === 'account' && !(await first(getDb(), 'SELECT 1 FROM users WHERE id=$1', [value])))
    throw new SecurityError('restriction_invalid', '账号 ID 不存在', 400)
  const hint = b.kind === 'email' ? emailHint(value) : b.kind === 'ip' ? 'IP · ' + securityKey('ip:' + value).slice(0, 8) : value
  await withTx(getDb(), async (query) => {
    const tx = { query }
    await lockSecurityAdmin(tx, c.get('user').id)
    const id = newId('restriction')
    await query(
      `INSERT INTO security_restrictions(id,kind,key_hash,action,effect,hint,reason,expires_at,created_at,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, b.kind, securityKey(b.kind + ':' + value), b.action, b.effect, hint, reason, now + b.hours * 3600000, now, c.get('user').id],
    )
    await auditAccount(tx, c.get('user').id, 'security-center', 'security-restrict', reason, null, {
      id,
      kind: b.kind,
      action: b.action,
      effect: b.effect,
      hint,
      hours: b.hours,
    })
  })
  return c.json({ success: true })
})
securityAdminRoutes.post('/restrictions/:id/revoke', async (c) => {
  const reason = requireReason((await c.req.json()).reason)
  await withTx(getDb(), async (query) => {
    const tx = { query }
    await lockSecurityAdmin(tx, c.get('user').id)
    const row = await first<{ id: string; hint: string }>(tx, 'SELECT id,hint FROM security_restrictions WHERE id=$1', [c.req.param('id')])
    if (!row) throw new SecurityError('not_found', '限制不存在', 400)
    await query('UPDATE security_restrictions SET expires_at=$2 WHERE id=$1', [row.id, Date.now()])
    await auditAccount(tx, c.get('user').id, 'security-center', 'security-revoke', reason, row, { revoked: true })
  })
  return c.json({ success: true })
})
