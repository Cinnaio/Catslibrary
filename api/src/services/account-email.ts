import { canManageUser, isAdministrator } from '@shared/roles'
import type { Db } from '../db/pool'
import { first, withTx } from '../db/query'
import { hashToken, newToken, hashPassword, newSalt, type UserRow } from './auth'
import { loadConfig } from '../config'
import { AccountError, lockAccounts, auditAccount, accountSnapshot } from './account-security'
import { mailConfiguration, sendAccountMail } from './mail'

export function normalizeEmail(value: unknown): string {
  if (typeof value !== 'string') throw new AccountError('请输入有效邮箱')
  const email = value.trim().toLowerCase()
  if (email.length > 254 || !/^[a-z0-9.!#$%&'*+\-/=?^_`{|}~]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(email)) throw new AccountError('请输入有效邮箱')
  return email
}
export async function limitEmailRequest(db: Db, identity: string, ip?: string) {
  const salt = loadConfig().sessionHashSalt
  const keys = [await hashToken(`mail-account:${identity}`, salt)]
  if (ip !== undefined) keys.push(await hashToken(`mail-ip:${ip}`, salt))
  await withTx(db, async query => {
    // 固定顺序下锁；多进程同样适用。
    await query('SELECT pg_advisory_xact_lock($1)', [730071])
    for (const [index, key] of keys.entries()) {
      const { rows } = await query<{ total: number }>('SELECT count(*)::int AS total FROM login_failures WHERE key_hash=$1 AND created_at>$2', [key, Date.now() - 15 * 60000])
      if (Number(rows[0]?.total) >= (index === 0 ? 3 : 20)) throw new AccountError('邮件请求过于频繁，请稍后重试', 429)
    }
    for (const key of keys) await query('INSERT INTO login_failures (key_hash,created_at) VALUES ($1,$2)', [key, Date.now()])
    await query('DELETE FROM login_failures WHERE created_at<$1', [Date.now() - 86400000])
  })
}

export async function issueAccountEmail(db: Db, userId: string, email: string, purpose: 'verify-email' | 'reset-password', actorId = userId, expected?: { role: string; status: string; passwordHash?: string }, reason = '用户申请账号邮件') {
  const config = mailConfiguration()
  if (!config.ready) throw new AccountError('邮件服务尚未配置，请联系超级管理员', 503)
  const token = newToken()
  const tokenHash = await hashToken(token, loadConfig().sessionHashSalt)
  const auditId = await withTx(db, async query => {
    await lockAccounts({ query })
    const user = await first<UserRow>({ query }, 'SELECT * FROM users WHERE id=$1 FOR UPDATE', [userId])
    if (!user || user.status !== 'active') throw new AccountError('账号不可用', 403)
    if (actorId !== userId) {
      const actor = await first<UserRow>({ query }, 'SELECT * FROM users WHERE id=$1 FOR UPDATE', [actorId])
      if (!actor || actor.status !== 'active' || !isAdministrator(actor.role) || !canManageUser(actor.role, user.role)) throw new AccountError('管理员权限已变化', 403)
    }
    if (expected && (user.role !== expected.role || user.status !== expected.status)) throw new AccountError('账号状态已变化，请刷新', 409)
    if (expected?.passwordHash && user.password_hash !== expected.passwordHash) throw new AccountError('账号凭据已变化，请重新登录', 409)
    if (purpose === 'reset-password' && (user.email !== email || !user.email_verified_at)) throw new AccountError('账号尚未绑定已验证邮箱')
    if (purpose === 'verify-email') {
      const used = await first({ query }, 'SELECT 1 FROM users WHERE lower(email)=$1 AND id<>$2', [email, userId])
      if (used) throw new AccountError('此邮箱无法绑定')
    }
    await query('DELETE FROM account_email_tokens WHERE user_id=$1 AND purpose=$2 OR expires_at<$3', [userId, purpose, Date.now()])
    await query(`INSERT INTO account_email_tokens (token_hash,user_id,purpose,email,expires_at,created_at) VALUES ($1,$2,$3,$4,$5,$6)`,
      [tokenHash, userId, purpose, email, Date.now() + (purpose === 'verify-email' ? 86400000 : 30 * 60000), Date.now()])
    return auditAccount({ query }, actorId, userId, `request-${purpose}`, reason, accountSnapshot(user), { purpose, delivery: 'requested' }, true)
  })
  try {
    const route = purpose === 'verify-email' ? '/verify-email' : '/reset-password'
    await sendAccountMail(email, purpose === 'verify-email' ? '验证你的知舟邮箱' : '重置你的知舟密码', `${config.publicOrigin}${route}#token=${token}`)
  } catch (error) {
    await withTx(db, async query => {
      await query('DELETE FROM account_email_tokens WHERE token_hash=$1', [tokenHash])
      await query("UPDATE account_security_audit SET after_state=$2::jsonb WHERE id=$1", [auditId, JSON.stringify({ purpose, delivery: 'failed' })])
      await query("UPDATE admin_operation_audit SET status='failed',response_status=503,error='邮件发送失败',updated_at=$2,finished_at=$2 WHERE id=$1", [auditId, Date.now()])
    })
    throw error
  }
  await withTx(db, async query => {
    await query('UPDATE account_security_audit SET after_state=$2::jsonb WHERE id=$1', [auditId, JSON.stringify({ purpose, delivery: 'accepted' })])
    await query("UPDATE admin_operation_audit SET status='completed',response_status=200,updated_at=$2,finished_at=$2 WHERE id=$1", [auditId, Date.now()])
  })
}

export async function consumeAccountEmail(db: Db, token: unknown, purpose: 'verify-email' | 'reset-password', password?: unknown) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw new AccountError('链接无效或已过期')
  if (purpose === 'reset-password' && (typeof password !== 'string' || password.length < 8 || password.length > 512)) throw new AccountError('新密码需要 8–512 位')
  const salt = purpose === 'reset-password' ? newSalt() : ''
  const passwordHash = purpose === 'reset-password' ? await hashPassword(password as string, salt) : ''
  const tokenHash = await hashToken(token, loadConfig().sessionHashSalt)
  await withTx(db, async query => {
    const tx = { query }
    await lockAccounts(tx)
    const link = await first<{ user_id: string; email: string; expires_at: number }>(tx, 'SELECT * FROM account_email_tokens WHERE token_hash=$1 AND purpose=$2 FOR UPDATE', [tokenHash, purpose])
    if (!link || Number(link.expires_at) <= Date.now()) throw new AccountError('链接无效或已过期')
    const user = await first<UserRow>(tx, 'SELECT * FROM users WHERE id=$1 FOR UPDATE', [link.user_id])
    if (!user || user.status !== 'active') throw new AccountError('链接无效或已过期')
    if (purpose === 'verify-email') {
      if (await first(tx, 'SELECT 1 FROM users WHERE lower(email)=$1 AND id<>$2', [link.email, user.id])) throw new AccountError('此邮箱无法绑定')
      await query('UPDATE users SET email=$2,email_verified_at=$3,updated_at=$3 WHERE id=$1', [user.id, link.email, Date.now()])
    } else {
      if (user.email !== link.email || !user.email_verified_at) throw new AccountError('链接无效或已过期')
      await query('UPDATE users SET password_hash=$2,password_salt=$3,password_iterations=120000,updated_at=$4 WHERE id=$1', [user.id, passwordHash, salt, Date.now()])
    }
    await query('DELETE FROM user_sessions WHERE user_id=$1', [user.id])
    await query('DELETE FROM account_email_tokens WHERE user_id=$1', [user.id])
    await auditAccount(tx, user.id, user.id, purpose, '用户通过邮件确认', accountSnapshot(user), purpose === 'verify-email' ? { ...accountSnapshot(user), emailVerified: true } : { passwordChanged: true })
  })
}
