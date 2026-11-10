import type { AgentPhase, AgentRecovery, AgentSession } from '@shared/ai-agent'
import type { Db } from '../../db/pool'
import { first, run } from '../../db/query'
import { AiError } from './client'
import { AI_TASK_OWNER_ID, getAiTask, type AiTask } from './tasks'
import { publishAiTask } from './task-events'

export const AGENT_READ_TOOLS = new Set([
  'read_overview',
  'search_chapters',
  'search_story',
  'read_chapter',
  'list_novel_analyses',
  'read_novel_analysis',
  'list_drafts',
  'read_draft',
  'list_covers',
  'read_task',
  'read_conversation',
  'read_conversation_sources',
])

export function agentTaskParams(task?: Pick<AiTask, 'params'>) {
  try {
    return JSON.parse(task?.params || '{}') as {
      sessionId?: string
      providerPresetId?: string
      model?: string
      recoveryFromTaskId?: string
      agentPhase?: AgentPhase
    }
  } catch {
    return {}
  }
}

/** Persist stage before work starts; an expired/cancelled executor cannot advance it. */
export async function setAgentPhase(db: Db, taskId: string, phase: AgentPhase, step: string) {
  const updated = await run(
    db,
    `UPDATE ai_tasks SET params=jsonb_set(COALESCE(NULLIF(params,''),'{}')::jsonb,'{agentPhase}',$1::jsonb)::text,
    step=$2,updated_at=$3 WHERE id=$4 AND kind='agent_chat' AND status IN ('queued','running') AND owner_id=$5
    AND lease_expires_at>floor(extract(epoch FROM clock_timestamp())*1000)::bigint`,
    [JSON.stringify(phase), step, Date.now(), taskId, AI_TASK_OWNER_ID],
  )
  if (!updated) throw new AiError('cancelled', '本轮已停止或执行权已过期', 409)
  publishAiTask(taskId, { step, updatedAt: Date.now() })
}

export async function getAgentRecovery(db: Db, session: AgentSession, task?: AiTask | null): Promise<AgentRecovery | null> {
  if (!task || !['failed', 'cancelled'].includes(task.status)) return null
  const params = agentTaskParams(task)
  const failure = await first<{ metadata: { failurePhase?: AgentPhase; summaryDiagnostic?: { reason?: string } } }>(
    db,
    "SELECT metadata FROM ai_agent_events WHERE session_id=$1 AND task_id=$2 AND metadata->>'error'='true' AND metadata->>'tool' IS NULL ORDER BY id DESC LIMIT 1",
    [session.id, task.id],
  )
  const tooLong = failure?.metadata.summaryDiagnostic?.reason === 'input_too_long'
  const phase = failure?.metadata.failurePhase || params.agentPhase || 'context'
  return {
    taskId: task.id,
    phase,
    canResume: !tooLong,
    message: tooLong
      ? '早前单条消息过长，请新建对话并保存必要的作品记忆。'
      : task.status === 'cancelled'
        ? '本轮已停止。已保存的对话和产出仍可查看。'
        : '本轮未完成。已保存的对话和产出仍可查看；继续整理会重新调用文本模型。',
  }
}

export async function requireRecoveryTask(db: Db, session: AgentSession, userId: string, taskId: string) {
  const task = await getAiTask(db, taskId)
  if (!task || task.kind !== 'agent_chat' || task.userId !== userId || agentTaskParams(task).sessionId !== session.id)
    throw new AiError('invalid', '该回复不属于此对话', 404)
  if (!['failed', 'cancelled'].includes(task.status)) throw new AiError('conflict', '只能继续已失败或停止的回复，请刷新状态', 409)
  if (!(await getAgentRecovery(db, session, task))?.canResume) throw new AiError('conflict', '早前消息过长，请新建对话', 409)
  return task
}
