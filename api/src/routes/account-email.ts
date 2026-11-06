import { Hono } from 'hono'
import { getDb } from '../db/pool'
import { first } from '../db/query'
import { requireUser, requireAdmin, type AuthEnv } from '../middlewares/auth'
import { verifyPassword, type UserRow } from '../services/auth'
import { AccountError } from '../services/account-security'
import { normalizeEmail, issueAccountEmail, consumeAccountEmail, limitEmailRequest } from '../services/account-email'
import { adminMailSettings, publicMailStatus, testMailConnection } from '../services/mail'
import { saveMailSettings } from '../services/mail-settings'
import { updateSiteSettings } from '../services/site-settings'
import { bodyLimit } from 'hono/body-limit'
import { clientIpFromContext } from '../services/ai/audit-context'
import { withBusinessActivity } from '../middlewares/backup-maintenance'

export const accountEmailRoutes = new Hono<AuthEnv>()
accountEmailRoutes.onError((error, c) => {
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
  await updateSiteSettings(async () => { saveMailSettings(body) })
  return c.json(adminMailSettings())
})
accountEmailRoutes.post('/mail-settings/test', requireAdmin(), bodyLimit({ maxSize: 1024, onError: c => c.json({ error: '连接测试请求过大' }, 413) }), async c => {
  if (c.get('user').role !== 'super_admin') return c.json({ error: '需要超级管理员权限' }, 403)
  const body = await c.req.json().catch(() => null)
  await limitEmailRequest(getDb(), `smtp-test:${c.get('user').id}`)
  await testMailConnection(body?.revision)
  return c.json({ success: true, message: 'SMTP 连接及认证通过；未发送邮件，实际送达仍需以收件结果为准。' })
})
accountEmailRoutes.post('/email/request', requireUser(), async c => {
  const body = await c.req.json().catch(() => ({}))
  const user = c.get('user')
  await limitEmailRequest(getDb(), user.id, clientIpFromContext(c))
  if (typeof body.currentPassword !== 'string' || body.currentPassword.length > 512 || !await verifyPassword(body.currentPassword, user))
    return c.json({ error: '当前密码不正确' }, 400)
  const email = normalizeEmail(body.email)
  await issueAccountEmail(getDb(), user.id, email, 'verify-email', user.id, { role: user.role, status: user.status, passwordHash: user.password_hash })
  return c.json({ success: true, message: '验证邮件已发送，请查收。确认后需要重新登录。' })
})
accountEmailRoutes.post('/email/verify', async c => {
  const body = await c.req.json().catch(() => ({}))
  await limitEmailRequest(getDb(), 'verify:' + String(body.token || '').slice(0, 64), clientIpFromContext(c))
  await consumeAccountEmail(getDb(), body.token, 'verify-email')
  return c.json({ success: true })
})
accountEmailRoutes.post('/forgot-password', async c => {
  const body = await c.req.json().catch(() => ({}))
  const identifier = typeof body.identifier === 'string' ? body.identifier.trim().toLowerCase().slice(0, 254) : ''
  await limitEmailRequest(getDb(), identifier, clientIpFromContext(c))
  const user = await first<UserRow>(getDb(), "SELECT * FROM users WHERE (username=$1 OR lower(email)=$1) AND status='active'", [identifier])
  if (user?.email && user.email_verified_at) {
    // 发信不阻塞公开响应，避免 SMTP 延迟泄露账号是否存在。失败后用户可重新申请。
    const db = getDb(), email = user.email
    setImmediate(() => {
      void withBusinessActivity(db, async () => {
        await limitEmailRequest(db, user.id)
        await issueAccountEmail(db, user.id, email, 'reset-password')
      })
        .catch(() => { /* 不输出账号、凭据或邮件令牌。 */ })
    })
  }
  return c.json({ success: true, message: '如果账号已绑定可用邮箱，你将收到密码重置邮件。' })
})
accountEmailRoutes.post('/reset-password', async c => {
  const body = await c.req.json().catch(() => ({}))
  await limitEmailRequest(getDb(), 'reset:' + String(body.token || '').slice(0, 64), clientIpFromContext(c))
  await consumeAccountEmail(getDb(), body.token, 'reset-password', body.password)
  return c.json({ success: true })
})
