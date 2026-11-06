import type { Db, DbClient } from '../db/pool'
import { first, withTx } from '../db/query'
import { newId, type UserRow } from './auth'
import { canManageUser, isAdministrator } from '@shared/roles'

export const ACCOUNT_LOCK = 730070
export class AccountError extends Error {
  constructor(message: string, public status: 400 | 403 | 404 | 409 | 429 | 503 = 400) { super(message) }
}
export async function lockAccounts(db: DbClient) {
  await db.query('SELECT pg_advisory_xact_lock($1)', [ACCOUNT_LOCK])
}
export async function siteInitialized(db: DbClient): Promise<boolean> {
  return Boolean(await first(db, "SELECT 1 FROM site_initialization WHERE id='site' UNION ALL SELECT 1 FROM users LIMIT 1"))
}
export async function assertSuperAdministrator(db: DbClient) {
  if (await siteInitialized(db) && !await first(db, "SELECT 1 FROM users WHERE role='super_admin' AND status='active' LIMIT 1"))
    throw new Error('站点缺少可用超级管理员。请运行 npm run admin:recover -- --username <用户名> --reason <原因>，明确指定已有账号后再启动。')
}
export async function auditAccount(db: DbClient, actor: string, target: string, action: string, reason: string, before: unknown, after: unknown, pending = false) {
  const now = Date.now()
  const id = newId('security')
  await db.query(`INSERT INTO account_security_audit (id,actor_user_id,target_user_id,action,reason,before_state,after_state,created_at)
    VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8)`, [id, actor, target, action, reason, JSON.stringify(before), JSON.stringify(after), now])
  await db.query(`INSERT INTO admin_operation_audit
    (id,operation_id,scope,actor_user_id,action,target_count,request_hash,status,response_status,created_at,updated_at,finished_at)
    VALUES ($1,$2,$3,$4,$5,1,'',$7,$8,$6,$6,$9)`, [id, newId('accountop'), `account.${target}`, actor, action, now, pending ? 'pending' : 'completed', pending ? 202 : 200, pending ? 0 : now])
  return id
}
export const accountSnapshot = (user: UserRow) => ({ role: user.role, status: user.status, emailVerified: Number(user.email_verified_at) > 0 })

export async function protectLastSuper(db: DbClient, target: UserRow, nextRole: string, nextStatus: string) {
  if (target.role !== 'super_admin' || target.status !== 'active' || (nextRole === 'super_admin' && nextStatus === 'active')) return
  const row = await first<{ total: number }>(db, "SELECT count(*)::int AS total FROM users WHERE role='super_admin' AND status='active'")
  if ((row?.total || 0) <= 1) throw new AccountError('至少保留一位已启用的超级管理员')
}

export async function withManagedAccount<T>(db: Db, actorId: string, targetId: string, expected: { expectedRole?: unknown; expectedStatus?: unknown }, fn: (db: DbClient, actor: UserRow, target: UserRow) => Promise<T>) {
  return withTx(db, async query => {
    const tx = { query }
    await lockAccounts(tx)
    const actor = await first<UserRow>(tx, 'SELECT * FROM users WHERE id=$1 FOR UPDATE', [actorId])
    if (!actor || actor.status !== 'active' || !isAdministrator(actor.role)) throw new AccountError('管理员状态已变化，请重新登录', 403)
    const target = await first<UserRow>(tx, 'SELECT * FROM users WHERE id=$1 FOR UPDATE', [targetId])
    if (!target) throw new AccountError('用户不存在', 404)
    if (!canManageUser(actor.role, target.role)) throw new AccountError('管理员只能管理普通读者，管理权限由超级管理员调整', 403)
    if (expected.expectedRole !== target.role || expected.expectedStatus !== target.status) throw new AccountError('账号状态已变化，请刷新后重试', 409)
    return fn(tx, actor, target)
  })
}

export async function recoverSuperAdministrator(db: Db, username: string, reason: string) {
  if (!username || !reason.trim()) throw new AccountError('必须明确指定用户名和恢复原因')
  return withTx(db, async query => {
    const tx = { query }
    await lockAccounts(tx)
    const target = await first<UserRow>(tx, 'SELECT * FROM users WHERE username=$1 FOR UPDATE', [username.toLowerCase()])
    if (!target) throw new AccountError('账号不存在；恢复命令不会创建账号', 404)
    await query("UPDATE users SET role='super_admin',status='active',updated_at=$2 WHERE id=$1", [target.id, Date.now()])
    await query('DELETE FROM user_sessions WHERE user_id=$1', [target.id])
    await query('DELETE FROM account_email_tokens WHERE user_id=$1', [target.id])
    await query("INSERT INTO site_initialization (id,initialized_at) VALUES ('site',$1) ON CONFLICT DO NOTHING", [Date.now()])
    await auditAccount(tx, 'server-recovery', target.id, 'recover-super-admin', reason, accountSnapshot(target), { ...accountSnapshot(target), role: 'super_admin', status: 'active' })
    return target.id
  })
}
