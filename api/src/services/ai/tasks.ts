import type { Db } from '../../db/pool'
import { all, first, run } from '../../db/query'
import { newId } from '../auth'

export type AiTaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export const AI_TASK_QUEUED_TIMEOUT_MS = 15 * 60_000
export const AI_TASK_RUNNING_TIMEOUT_MS = 30 * 60_000
export const AI_TASK_HEARTBEAT_INTERVAL_MS = 60_000
export const AI_TASK_RECLAIM_INTERVAL_MS = 60_000

const ACTIVE_STATUSES = ['queued', 'running'] as const
const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled'] as const

export interface AiTask {
  id: string
  userId: string
  novelId: string
  kind: string
  status: AiTaskStatus
  current: number
  total: number
  step: string
  prompt: string
  /** 任务产物（JSON 字符串）；目前由封面描述词任务使用。 */
  result: string
  batchId: string
  /** 创建时的请求参数（JSON），失败/取消后按原参数重试用 */
  params: string
  error: string
  createdAt: number
  updatedAt: number
  finishedAt: number
}

interface AiTaskRow {
  id: string; user_id: string; novel_id: string; kind: string; status: string
  current: number; total: number; step: string; prompt: string; batch_id: string
  result: string; params: string; error: string; created_at: number; updated_at: number; finished_at: number
}

function mapTask(row: AiTaskRow): AiTask {
  return {
    id: String(row.id), userId: String(row.user_id || ''), novelId: String(row.novel_id || ''),
    kind: String(row.kind || ''), status: (String(row.status || 'queued') as AiTaskStatus),
    current: Number(row.current) || 0, total: Number(row.total) || 1, step: String(row.step || ''),
    prompt: String(row.prompt || ''), result: String(row.result || ''), batchId: String(row.batch_id || ''), params: String(row.params || ''),
    error: String(row.error || ''),
    createdAt: Number(row.created_at) || 0, updatedAt: Number(row.updated_at) || 0, finishedAt: Number(row.finished_at) || 0,
  }
}

export async function createAiTask(db: Db, input: { userId: string; novelId?: string; kind: string; total?: number; batchId?: string; prompt?: string; params?: string }): Promise<AiTask> {
  const id = newId('aitask')
  const now = Date.now()
  await run(db, `INSERT INTO ai_tasks (id,user_id,novel_id,kind,status,current,total,step,prompt,batch_id,params,error,created_at,updated_at,finished_at)
    VALUES ($1,$2,$3,$4,'queued',0,$5,'',$6,$7,$8,'',$9,$9,0)`, [id, input.userId, input.novelId || '', input.kind, Math.max(1, Math.trunc(input.total || 1)), input.prompt || '', input.batchId || '', input.params || '', now])
  return mapTask((await first<AiTaskRow>(db, 'SELECT * FROM ai_tasks WHERE id = $1', [id]))!)
}

export async function updateAiTask(db: Db, id: string, patch: { status?: AiTaskStatus; current?: number; total?: number; step?: string; prompt?: string; result?: string; batchId?: string; error?: string }): Promise<boolean> {
  const values: unknown[] = []
  const parts: string[] = []
  for (const [key, value] of Object.entries(patch)) {
    const column = { status: 'status', current: 'current', total: 'total', step: 'step', prompt: 'prompt', result: 'result', batchId: 'batch_id', error: 'error' }[key]
    if (!column) continue
    values.push(value); parts.push(`${column} = $${values.length}`)
  }
  if (!parts.length) return false
  const terminalStatus = patch.status && TERMINAL_STATUSES.includes(patch.status as (typeof TERMINAL_STATUSES)[number]) ? patch.status : undefined
  const finished = terminalStatus ? Date.now() : 0
  values.push(Date.now(), id)
  parts.push(`updated_at = $${values.length - 1}`)
  if (finished) { values.splice(values.length - 1, 0, finished); parts.push(`finished_at = $${values.length - 1}`) }
  const activeOrSameTerminal = terminalStatus
    ? `status IN ('queued','running') OR status = '${terminalStatus}'`
    : `status IN ('queued','running')`
  return (await run(db, `UPDATE ai_tasks SET ${parts.join(', ')} WHERE id = $${values.length} AND (${activeOrSameTerminal})`, values)) > 0
}

export async function getAiTask(db: Db, id: string): Promise<AiTask | undefined> {
  const row = await first<AiTaskRow>(db, 'SELECT * FROM ai_tasks WHERE id = $1', [id])
  return row ? mapTask(row) : undefined
}

export async function isAiTaskCancelled(db: Db, id: string): Promise<boolean> {
  const row = await first<{ status: string }>(db, 'SELECT status FROM ai_tasks WHERE id = $1', [id])
  return row?.status === 'cancelled'
}

/** 任务仍可由当前执行器继续推进时返回 true；failed/cancelled 任务不会被旧回调重新唤醒。 */
export async function isAiTaskActive(db: Db, id: string): Promise<boolean> {
  const row = await first<{ status: string }>(db, 'SELECT status FROM ai_tasks WHERE id = $1', [id])
  return row ? ACTIVE_STATUSES.includes(row.status as (typeof ACTIVE_STATUSES)[number]) : false
}

/** 仅刷新活跃任务的更新时间，用于长时间上游调用期间的存活心跳。 */
export async function touchAiTask(db: Db, id: string): Promise<boolean> {
  return (await run(db, `UPDATE ai_tasks SET updated_at = $1 WHERE id = $2 AND status IN ('queued','running')`, [Date.now(), id])) > 0
}

/**
 * 启动任务存活心跳。返回停止函数；心跳只会刷新 queued/running，
 * 因此任务被取消或回收后，旧执行器不会把它重新变成活跃任务。
 */
export function startAiTaskHeartbeat(db: Db, id: string, intervalMs = AI_TASK_HEARTBEAT_INTERVAL_MS): () => void {
  const timer = setInterval(() => {
    void touchAiTask(db, id).catch(() => {})
  }, Math.max(1_000, Math.trunc(intervalMs)))
  timer.unref?.()
  return () => clearInterval(timer)
}

export async function cancelAiTask(db: Db, id: string): Promise<boolean> {
  return (await run(db, `UPDATE ai_tasks SET status = 'cancelled', step = '已取消', updated_at = $1, finished_at = $1 WHERE id = $2 AND status IN ('queued','running')`, [Date.now(), id])) > 0
}

/**
 * 删除已结束的任务记录（completed/failed/cancelled）。
 * 运行中（queued/running）的任务必须先取消再删，避免删掉正在执行的记录。
 * 物理删除，不影响 ai_usage 审计账本；返回是否实际删除了一行。
 */
export async function deleteAiTask(db: Db, id: string): Promise<boolean> {
  return (await run(db, `DELETE FROM ai_tasks WHERE id = $1 AND status IN ('completed','failed','cancelled')`, [id])) > 0
}

/**
 * 服务启动时调用：有副作用的任务在重启后统一标记为 failed。
 * 可通过 excludeKinds 留出由调用方安全接管的任务类型。
 */
export async function failInterruptedAiTasks(db: Db, opts: { excludeKinds?: string[] } = {}): Promise<number> {
  const now = Date.now()
  const excluded = (opts.excludeKinds || []).map((kind) => String(kind).trim()).filter(Boolean)
  const placeholders = excluded.map((_, index) => '$' + String(index + 2)).join(', ')
  const exclusionSql = excluded.length ? ' AND kind NOT IN (' + placeholders + ')' : ''
  return run(
    db,
    `UPDATE ai_tasks SET status = 'failed', step = '已中断', error = '服务重启，任务中断', updated_at = $1, finished_at = $1
     WHERE status IN ('queued','running')` + exclusionSql,
    [now, ...excluded],
  )
}

/** 定期回收没有任何进展的孤儿任务，避免它们长期占用并发名额。 */
export async function reclaimStaleAiTasks(
  db: Db,
  opts: { now?: number; queuedAfterMs?: number; runningAfterMs?: number; excludeKinds?: string[] } = {},
): Promise<number> {
  const now = Number.isFinite(opts.now) ? Number(opts.now) : Date.now()
  const queuedAfterMs = Math.max(1_000, Math.trunc(opts.queuedAfterMs ?? AI_TASK_QUEUED_TIMEOUT_MS))
  const runningAfterMs = Math.max(1_000, Math.trunc(opts.runningAfterMs ?? AI_TASK_RUNNING_TIMEOUT_MS))
  const excluded = (opts.excludeKinds || []).map((kind) => String(kind).trim()).filter(Boolean)
  const placeholders = excluded.map((_, index) => '$' + String(index + 4)).join(', ')
  const exclusionSql = excluded.length ? ` AND kind NOT IN (${placeholders})` : ''
  return run(
    db,
    `UPDATE ai_tasks
     SET status = 'failed',
         step = CASE WHEN status = 'queued' THEN '排队超时，已回收' ELSE '后台任务超时，已自动回收' END,
         error = '后台任务超时，已自动回收',
         updated_at = $1,
         finished_at = $1
     WHERE ((status = 'queued' AND updated_at < $2) OR (status = 'running' AND updated_at < $3))${exclusionSql}`,
    [now, now - queuedAfterMs, now - runningAfterMs, ...excluded],
  )
}

/** 运行中（含排队）的创作任务数：路由据此做并发上限拦截。 */
export async function countActiveWritingTasks(db: Db): Promise<number> {
  const row = await first<{ total: number }>(
    db,
    `SELECT COUNT(*)::int AS total FROM ai_tasks
     WHERE status IN ('queued','running') AND kind IN ('continue','write_outline','write_chapter')`,
  )
  return Number(row?.total) || 0
}

/**
 * 清理保留期之外的已结束任务（completed/failed/cancelled）。
 * 任务是操作性记录，用量审计在 ai_usage 里另有账本，删任务不影响审计。
 */
export async function pruneFinishedAiTasks(db: Db, retentionDays: number): Promise<number> {
  const cutoff = Date.now() - Math.max(1, Math.trunc(retentionDays)) * 86_400_000
  return run(
    db,
    `DELETE FROM ai_tasks
     WHERE status IN ('completed','failed','cancelled') AND finished_at > 0 AND finished_at < $1`,
    [cutoff],
  )
}

export async function listAiTasks(db: Db, opts: { limit?: number; offset?: number; status?: string; kind?: string } = {}): Promise<{ items: AiTask[]; total: number }> {
  const limit = Math.min(Math.max(Math.trunc(opts.limit || 50), 1), 100)
  const offset = Math.max(Math.trunc(opts.offset || 0), 0)

  const conditions: string[] = []
  const params: unknown[] = []
  if (opts.status) {
    params.push(opts.status)
    conditions.push(`status = $${params.length}`)
  }
  if (opts.kind) {
    params.push(opts.kind)
    conditions.push(`kind = $${params.length}`)
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  const rows = await all<AiTaskRow>(db, `SELECT * FROM ai_tasks ${where} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, limit, offset])
  const total = await first<{ total: number }>(db, `SELECT COUNT(*)::int AS total FROM ai_tasks ${where}`, params)
  return { items: rows.map(mapTask), total: Number(total?.total) || 0 }
}
