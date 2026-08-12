import type { Db } from '../../db/pool'
import { all, first, run } from '../../db/query'
import { newId } from '../auth'

export type AiTaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

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
  batchId: string
  error: string
  createdAt: number
  updatedAt: number
  finishedAt: number
}

interface AiTaskRow {
  id: string; user_id: string; novel_id: string; kind: string; status: string
  current: number; total: number; step: string; prompt: string; batch_id: string
  error: string; created_at: number; updated_at: number; finished_at: number
}

function mapTask(row: AiTaskRow): AiTask {
  return {
    id: String(row.id), userId: String(row.user_id || ''), novelId: String(row.novel_id || ''),
    kind: String(row.kind || ''), status: (String(row.status || 'queued') as AiTaskStatus),
    current: Number(row.current) || 0, total: Number(row.total) || 1, step: String(row.step || ''),
    prompt: String(row.prompt || ''), batchId: String(row.batch_id || ''), error: String(row.error || ''),
    createdAt: Number(row.created_at) || 0, updatedAt: Number(row.updated_at) || 0, finishedAt: Number(row.finished_at) || 0,
  }
}

export async function createAiTask(db: Db, input: { userId: string; novelId?: string; kind: string; total?: number; batchId?: string; prompt?: string }): Promise<AiTask> {
  const id = newId('aitask')
  const now = Date.now()
  await run(db, `INSERT INTO ai_tasks (id,user_id,novel_id,kind,status,current,total,step,prompt,batch_id,error,created_at,updated_at,finished_at)
    VALUES ($1,$2,$3,$4,'queued',0,$5,'',$6,$7,'',$8,$8,0)`, [id, input.userId, input.novelId || '', input.kind, Math.max(1, Math.trunc(input.total || 1)), input.prompt || '', input.batchId || '', now])
  return mapTask((await first<AiTaskRow>(db, 'SELECT * FROM ai_tasks WHERE id = $1', [id]))!)
}

export async function updateAiTask(db: Db, id: string, patch: { status?: AiTaskStatus; current?: number; total?: number; step?: string; prompt?: string; batchId?: string; error?: string }): Promise<void> {
  const values: unknown[] = []
  const parts: string[] = []
  for (const [key, value] of Object.entries(patch)) {
    const column = { status: 'status', current: 'current', total: 'total', step: 'step', prompt: 'prompt', batchId: 'batch_id', error: 'error' }[key]
    if (!column) continue
    values.push(value); parts.push(`${column} = $${values.length}`)
  }
  if (!parts.length) return
  const finished = patch.status && ['completed', 'failed', 'cancelled'].includes(patch.status) ? Date.now() : 0
  values.push(Date.now(), id)
  parts.push(`updated_at = $${values.length - 1}`)
  if (finished) { values.splice(values.length - 1, 0, finished); parts.push(`finished_at = $${values.length - 1}`) }
  await run(db, `UPDATE ai_tasks SET ${parts.join(', ')} WHERE id = $${values.length}`, values)
}

export async function isAiTaskCancelled(db: Db, id: string): Promise<boolean> {
  const row = await first<{ status: string }>(db, 'SELECT status FROM ai_tasks WHERE id = $1', [id])
  return row?.status === 'cancelled'
}

export async function cancelAiTask(db: Db, id: string): Promise<boolean> {
  return (await run(db, `UPDATE ai_tasks SET status = 'cancelled', step = '已取消', updated_at = $1, finished_at = $1 WHERE id = $2 AND status IN ('queued','running')`, [Date.now(), id])) > 0
}

export async function listAiTasks(db: Db, opts: { limit?: number; offset?: number } = {}): Promise<{ items: AiTask[]; total: number }> {
  const limit = Math.min(Math.max(Math.trunc(opts.limit || 50), 1), 100)
  const offset = Math.max(Math.trunc(opts.offset || 0), 0)
  const rows = await all<AiTaskRow>(db, 'SELECT * FROM ai_tasks ORDER BY created_at DESC LIMIT $1 OFFSET $2', [limit, offset])
  const total = await first<{ total: number }>(db, 'SELECT COUNT(*)::int AS total FROM ai_tasks')
  return { items: rows.map(mapTask), total: Number(total?.total) || 0 }
}
