import { Hono } from 'hono'
import { getDb } from '../db/pool'
import { first } from '../db/query'
import { requireUser, requireAdmin, type AuthEnv } from '../middlewares/auth'
import { verifyPassword, type UserRow } from '../services/auth'
import { AccountError, auditAccount } from '../services/account-security'
import { normalizeEmail, issueAccountEmail, consumeAccountEmail, limitEmailRequest } from '../services/account-email'
import { adminMailSettings, publicMailStatus, testMailConnection } from '../services/mail'
import { saveMailSettings } from '../services/mail-settings'
import { updateSiteSettings } from '../services/site-settings'
import { bodyLimit } from 'hono/body-limit'
import { setTimeout as delay } from 'node:timers/promises'
import { clientIpFromContext } from '../services/ai/audit-context'
import { protectRequest } from '../services/security-requests'
import { SecurityError, requireReason, lockSecurityAdmin } from '../services/security-policy'
import { requestSession } from '../services/browser-session'

export const accountEmailRoutes = new Hono<AuthEnv>()
const emailBodyLimit = bodyLimit({ maxSize: 16384, onError: c => c.json({ error: '请求过大' }, 413) })
accountEmailRoutes.onError((error, c) => {
  if (error instanceof SecurityError) { c.header('Retry-After', String(error.retryAfter)); return c.json({error:error.message,code:error.code},error.status) }
  if (error instanceof AccountError) return c.json({ error: error.message }, error.status)
  // 驱动/SMTP 错误可能携带凭据或邮件令牌，不记录原始错误。
  return c.json({ error: '账号邮件操作失败，请稍后重试' }, 500)
})
accountEmailRoutes.get('/mail-status', c => c.json({ ready: publicMailStatus().ready }))
accountEmailRoutes.get('/mail-settings', requireAdmin(), c => {
  if (c.get('user').role !== 'super_admin') return c.json({ error: '需要超级管理员权限' }, 403)
  return c.json(adminMailSettings())
})
accountEmailRoutes.put('/mail-settings', requireAdmin(), bodyLimit({ maxSize: 16384, onError: c => c.json({ error: '邮件配置请求过大' }, 413) }), async c => {
  if (c.get('user').role !== 'super_admin') return c.json({ error: '需要超级管理员权限' }, 403)
  const body = await c.req.json().catch(() => null)
  const reason = requireReason(body?.reason)
  await updateSiteSettings(async (tx) => {
    await lockSecurityAdmin(tx,c.get('user').id)
    // File replacement is not transactional. Keep a durable pending audit before touching the file.
    const db = getDb(), before = adminMailSettings()
    const auditId = await auditAccount(db,c.get('user').id,'security-center','mail-settings',reason,before,{delivery:'pending'},true)
    try {
      saveMailSettings(body)
      await db.query('UPDATE account_security_audit SET after_state=$2::jsonb WHERE id=$1',[auditId,JSON.stringify({...adminMailSettings(),credentialChanged:Boolean(body.password||body.clearPassword)})])
      await db.query("UPDATE admin_operation_audit SET status='completed',response_status=200,updated_at=$2,finished_at=$2 WHERE id=$1",[auditId,Date.now()])
    } catch(error) {
      await db.query("UPDATE admin_operation_audit SET status='failed',error='mail_settings_save_failed',response_status=503,updated_at=$2,finished_at=$2 WHERE id=$1",[auditId,Date.now()])
      throw error
    }
  })
  return c.json(adminMailSettings())
})
accountEmailRoutes.post('/mail-settings/test', requireAdmin(), bodyLimit({ maxSize: 1024, onError: c => c.json({ error: '连接测试请求过大' }, 413) }), async c => {
  if (c.get('user').role !== 'super_admin') return c.json({ error: '需要超级管理员权限' }, 403)
  const body = await c.req.json().catch(() => null)
  await limitEmailRequest(getDb(), `smtp-test:${c.get('user').id}`)
  await testMailConnection(body?.revision)
  return c.json({ success: true, message: 'SMTP 连接及认证通过；未发送邮件，实际送达仍需以收件结果为准。' })
})
accountEmailRoutes.post('/email/request', emailBodyLimit, requireUser(), async c => {
  const body = await c.req.json().catch(() => ({}))
  const user = c.get('user')
  await protectRequest(getDb(), 'verify-email', user.id, clientIpFromContext(c), body.turnstileToken, user.id, requestSession(c))
  if (typeof body.currentPassword !== 'string' || body.currentPassword.length > 512 || !await verifyPassword(body.currentPassword, user))
    return c.json({ error: '当前密码不正确' }, 400)
  const email = normalizeEmail(body.email)
  await issueAccountEmail(getDb(), user.id, email, 'verify-email', user.id, { role: user.role, status: user.status, passwordHash: user.password_hash })
  return c.json({ success: true, message: '验证邮件申请已受理，请稍后查收。确认后需要重新登录。' })
})
accountEmailRoutes.post('/email/verify', emailBodyLimit, async c => {
  const body = await c.req.json().catch(() => ({}))
  await limitEmailRequest(getDb(), 'verify:' + String(body.token || '').slice(0, 64), clientIpFromContext(c))
  await consumeAccountEmail(getDb(), body.token, 'verify-email')
  return c.json({ success: true })
})
accountEmailRoutes.post('/forgot-password', emailBodyLimit, async c => {
  const started = Date.now()
  const body = await c.req.json().catch(() => ({}))
  const identifier = typeof body.identifier === 'string' ? body.identifier.trim().toLowerCase().slice(0, 254) : ''
  await protectRequest(getDb(), 'forgot-password', identifier, clientIpFromContext(c), body.turnstileToken)
  const user = await first<UserRow>(getDb(), "SELECT * FROM users WHERE (username=$1 OR lower(email)=$1) AND status='active'", [identifier])
  if (user?.email && user.email_verified_at) {
    // Await durable enqueue, never SMTP. Account-specific rejection remains private.
    try { await issueAccountEmail(getDb(), user.id, user.email, 'reset-password') } catch { /* audit contains only safe decision codes */ }
  }
  // A common response floor hides ordinary enqueue-vs-no-account timing differences.
  await delay(Math.max(0,250-(Date.now()-started)))
  return c.json({ success: true, message: '如果账号已绑定可用邮箱，你将收到密码重置邮件。' })
})
accountEmailRoutes.post('/reset-password', emailBodyLimit, async c => {
  const body = await c.req.json().catch(() => ({}))
  await limitEmailRequest(getDb(), 'reset:' + String(body.token || '').slice(0, 64), clientIpFromContext(c))
  await consumeAccountEmail(getDb(), body.token, 'reset-password', body.password)
  return c.json({ success: true })
})
