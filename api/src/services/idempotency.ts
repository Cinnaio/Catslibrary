import { createHash } from 'node:crypto'
import type { Context } from 'hono'
import type { Db } from '../db/pool'
import { first, run } from '../db/query'
import { newId } from './auth'
import { finishAdminOperationAudit, incrementAdminOperationReplay, startAdminOperationAudit } from './admin-operation-audit'

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000
const MAX_KEY_LENGTH = 160

interface IdempotencyRow {
  id: string
  scope: string
  operation_key: string
  request_hash: string
  status: string
  response_status: number
  response_content_type: string
  response_body: string
  expires_at: number
}

/** 让对象字段顺序不影响同一个请求的指纹。数组顺序仍然有意义。 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonicalize(item)]),
    )
  }
  if (typeof value === 'number' && Number.isNaN(value)) return null
  return value
}

export function requestHash(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(payload))).digest('hex')
}

/** 优先使用标准请求头，body 字段用于兼容现有移动端/管理端客户端。 */
export function idempotencyKeyFromRequest(
  c: Pick<Context, 'req'>,
  body: unknown,
  fields: string[] = ['operationId', 'clientRequestId'],
): string {
  const headerKey = c.req.header('Idempotency-Key') || c.req.header('X-Operation-Id') || ''
  if (headerKey.trim()) return headerKey.trim().slice(0, MAX_KEY_LENGTH)
  if (!body || typeof body !== 'object') return ''
  for (const field of fields) {
    const value = (body as Record<string, unknown>)[field]
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, MAX_KEY_LENGTH)
  }
  return ''
}

function replay(row: IdempotencyRow): Response {
  return new Response(row.response_body || '{}', {
    status: Number(row.response_status) || 200,
    headers: {
      'Content-Type': row.response_content_type || 'application/json',
      'X-Idempotent-Replay': 'true',
    },
  })
}

/**
 * 对带操作 ID 的副作用请求做一次性提交与响应重放。
 * - 首个请求持有 pending 记录并执行 handler；
 * - 相同指纹的重试重放首次 2xx 响应；
 * - 相同 ID 携带不同参数直接冲突，避免误把一个确认覆盖成另一个操作；
 * - 非 2xx 不留永久锁，调用方可以修正后重试。
 */
export async function withIdempotency(
  db: Db,
  options: {
    scope: string
    operationKey?: string
    payload: unknown
    ttlMs?: number
    audit?: { actorUserId: string; action: string; targetCount?: number }
  },
  handler: () => Promise<Response>,
): Promise<Response> {
  const operationKey = String(options.operationKey || '').trim().slice(0, MAX_KEY_LENGTH)
  if (!operationKey) return handler()

  const now = Date.now()
  const expiresAt = now + Math.max(60_000, Math.trunc(options.ttlMs || DEFAULT_TTL_MS))
  const scope = String(options.scope || '').trim().slice(0, 240)
  const hash = requestHash(options.payload)

  // 过期的 pending/completed 记录允许同一个客户端 ID 开启新一轮操作。
  await run(db, 'DELETE FROM api_idempotency WHERE scope = $1 AND operation_key = $2 AND expires_at < $3', [scope, operationKey, now])
  const inserted = await first<IdempotencyRow>(
    db,
    `INSERT INTO api_idempotency
      (id, scope, operation_key, request_hash, status, response_status, response_content_type, response_body, created_at, updated_at, expires_at)
     VALUES ($1, $2, $3, $4, 'pending', 202, 'application/json', '{}', $5, $5, $6)
     ON CONFLICT (scope, operation_key) DO NOTHING
     RETURNING *`,
    [newId('idem'), scope, operationKey, hash, now, expiresAt],
  )

  if (!inserted) {
    const existing = await first<IdempotencyRow>(db, 'SELECT * FROM api_idempotency WHERE scope = $1 AND operation_key = $2', [scope, operationKey])
    if (existing && existing.request_hash !== hash) {
      return Response.json({ error: '同一操作 ID 携带了不同参数', code: 'idempotency_conflict' }, { status: 409 })
    }
    await incrementAdminOperationReplay(db, scope, operationKey).catch(() => {})
    if (existing?.status === 'completed') return replay(existing)
    return Response.json({ error: '相同操作正在处理中，请稍后重试', code: 'idempotency_in_progress' }, { status: 409 })
  }

  const auditId = options.audit
    ? await startAdminOperationAudit(db, {
        operationId: operationKey,
        scope,
        actorUserId: options.audit.actorUserId,
        action: options.audit.action,
        targetCount: options.audit.targetCount,
        requestHash: hash,
      }).catch(() => '')
    : ''

  try {
    const response = await handler()
    if (response.status >= 200 && response.status < 300) {
      const body = await response.clone().text()
      await run(
        db,
        `UPDATE api_idempotency
         SET status = 'completed', response_status = $1, response_content_type = $2, response_body = $3, updated_at = $4
         WHERE id = $5 AND status = 'pending'`,
        [response.status, response.headers.get('Content-Type') || 'application/json', body, Date.now(), inserted.id],
      )
      await finishAdminOperationAudit(db, auditId, { status: 'completed', responseStatus: response.status }).catch(() => {})
    } else {
      await run(db, 'DELETE FROM api_idempotency WHERE id = $1', [inserted.id])
      await finishAdminOperationAudit(db, auditId, { status: 'failed', responseStatus: response.status, error: `HTTP ${response.status}` }).catch(() => {})
    }
    return response
  } catch (error) {
    await run(db, 'DELETE FROM api_idempotency WHERE id = $1', [inserted.id]).catch(() => {})
    await finishAdminOperationAudit(db, auditId, { status: 'failed', responseStatus: 500, error: '服务器处理异常' }).catch(() => {})
    throw error
  }
}
