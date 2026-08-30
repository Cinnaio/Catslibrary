import { Hono } from 'hono'
import { getDb } from '../db/pool'
import { requireAdmin, type AuthEnv } from '../middlewares/auth'
import { listAdminOperationAudit } from '../services/admin-operation-audit'
import { clampInt } from '../services/text'

export const adminOperationRoutes = new Hono<AuthEnv>()

adminOperationRoutes.use('*', requireAdmin())

/** 管理员副作用操作审计：返回元数据，不返回请求正文、目标 ID 或请求哈希。 */
adminOperationRoutes.get('/', async (c) => {
  const limit = clampInt(c.req.query('limit'), 10, 100, 50)
  const offset = clampInt(c.req.query('offset'), 0, 1_000_000, 0)
  const result = await listAdminOperationAudit(getDb(), {
    status: String(c.req.query('status') || '').trim(),
    action: String(c.req.query('action') || '').trim(),
    limit,
    offset,
  })
  return c.json({
    operations: result.rows.map((row) => ({
      id: String(row.id),
      operationId: String(row.operation_id),
      actorUserId: String(row.actor_user_id || ''),
      actorUsername: String(row.actor_username || ''),
      actorDisplayName: String(row.actor_display_name || ''),
      action: String(row.action || ''),
      targetCount: Number(row.target_count) || 0,
      status: String(row.status || 'pending'),
      responseStatus: Number(row.response_status) || 0,
      replayCount: Number(row.replay_count) || 0,
      error: String(row.error || ''),
      createdAt: Number(row.created_at) || 0,
      updatedAt: Number(row.updated_at) || 0,
      finishedAt: Number(row.finished_at) || 0,
    })),
    total: result.total,
    limit,
    offset,
  }, 200, { 'Cache-Control': 'no-store' })
})
