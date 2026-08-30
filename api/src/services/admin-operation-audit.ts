import type { Db } from '../db/pool'
import { all, first, run } from '../db/query'
import { newId } from './auth'

export type AdminOperationAuditStatus = 'pending' | 'completed' | 'failed'

export interface AdminOperationAuditInput {
  operationId: string
  scope: string
  actorUserId: string
  action: string
  targetCount?: number
  requestHash: string
}

export interface AdminOperationAuditRow {
  id: string
  operation_id: string
  scope: string
  actor_user_id: string
  actor_username?: string
  actor_display_name?: string
  action: string
  target_count: number
  request_hash: string
  status: AdminOperationAuditStatus
  response_status: number
  replay_count: number
  error: string
  created_at: number
  updated_at: number
  finished_at: number
}

function boundedCount(value: unknown): number {
  const count = Math.trunc(Number(value))
  return Number.isFinite(count) ? Math.max(0, Math.min(1_000_000, count)) : 0
}

/** 创建审计记录；重复操作 ID 返回原记录，便于幂等请求继续收尾。 */
export async function startAdminOperationAudit(db: Db, input: AdminOperationAuditInput): Promise<string> {
  const operationId = String(input.operationId || '').trim().slice(0, 160)
  const scope = String(input.scope || '').trim().slice(0, 240)
  const actorUserId = String(input.actorUserId || '').trim().slice(0, 160)
  const action = String(input.action || '').trim().slice(0, 120)
  const requestHash = String(input.requestHash || '').trim().slice(0, 128)
  const now = Date.now()
  const inserted = await first<{ id: string }>(
    db,
    `INSERT INTO admin_operation_audit
      (id, operation_id, scope, actor_user_id, action, target_count, request_hash, status, response_status, replay_count, error, created_at, updated_at, finished_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', 202, 0, '', $8, $8, 0)
     ON CONFLICT (scope, operation_id) DO NOTHING
     RETURNING id`,
    [newId('adminop'), operationId, scope, actorUserId, action, boundedCount(input.targetCount), requestHash, now],
  )
  if (inserted?.id) return String(inserted.id)

  const existing = await first<{ id: string }>(
    db,
    'SELECT id FROM admin_operation_audit WHERE scope = $1 AND operation_id = $2',
    [scope, operationId],
  )
  return String(existing?.id || '')
}

export async function finishAdminOperationAudit(
  db: Db,
  id: string,
  result: { status: Exclude<AdminOperationAuditStatus, 'pending'>; responseStatus: number; error?: string },
): Promise<void> {
  if (!id) return
  const status = result.status === 'completed' ? 'completed' : 'failed'
  const responseStatus = Math.max(100, Math.min(599, Math.trunc(Number(result.responseStatus)) || 500))
  const error = status === 'failed' ? String(result.error || '操作失败').slice(0, 240) : ''
  const now = Date.now()
  await run(
    db,
    `UPDATE admin_operation_audit
     SET status = $1, response_status = $2, error = $3, updated_at = $4, finished_at = $4
     WHERE id = $5`,
    [status, responseStatus, error, now, id],
  )
}

export async function incrementAdminOperationReplay(db: Db, scope: string, operationId: string): Promise<void> {
  if (!scope || !operationId) return
  await run(
    db,
    `UPDATE admin_operation_audit
     SET replay_count = replay_count + 1, updated_at = $3
     WHERE scope = $1 AND operation_id = $2`,
    [scope, operationId, Date.now()],
  )
}

export interface ListAdminOperationAuditOptions {
  status?: string
  action?: string
  limit: number
  offset: number
}

export async function listAdminOperationAudit(
  db: Db,
  options: ListAdminOperationAuditOptions,
): Promise<{ rows: AdminOperationAuditRow[]; total: number }> {
  const conditions: string[] = []
  const params: unknown[] = []
  if (['pending', 'completed', 'failed'].includes(options.status || '')) {
    params.push(options.status)
    conditions.push(`a.status = $${params.length}`)
  }
  if (options.action) {
    params.push(String(options.action).slice(0, 120))
    conditions.push(`a.action = $${params.length}`)
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const rows = await all<AdminOperationAuditRow>(
    db,
    `SELECT a.id, a.operation_id, a.scope, a.actor_user_id,
            u.username AS actor_username, u.display_name AS actor_display_name,
            a.action, a.target_count, a.request_hash, a.status, a.response_status,
            a.replay_count, a.error, a.created_at, a.updated_at, a.finished_at
       FROM admin_operation_audit a
       LEFT JOIN users u ON u.id = a.actor_user_id
       ${where}
       ORDER BY a.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, options.limit, options.offset],
  )
  const total = await first<{ total: number }>(
    db,
    `SELECT COUNT(*)::int AS total FROM admin_operation_audit a ${where}`,
    params,
  )
  return { rows, total: Number(total?.total) || 0 }
}

/** 审计记录只需支撑运维回溯，默认保留半年，避免长期增长。 */
export async function pruneAdminOperationAudit(db: Db, retentionDays = 180): Promise<number> {
  const days = Math.max(1, Math.min(3650, Math.trunc(Number(retentionDays)) || 180))
  return run(db, 'DELETE FROM admin_operation_audit WHERE created_at < $1', [Date.now() - days * 86400000])
}
