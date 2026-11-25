import { AGENT_CHAPTER_PLAN_LIMITS, type AgentChapterPlan, type AgentChapterPlanInput } from '@shared/ai-agent'
import type { Db, DbClient } from '../../db/pool'
import { first, withTx } from '../../db/query'
import { AiError } from './client'

interface PlanRow { chapter_plan: AgentChapterPlan | null; chapter_plan_operation_id: string; active_task_id: string }

export function parseChapterPlan(value: unknown): AgentChapterPlanInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AiError('invalid', '章节计划格式无效', 422)
  const raw = value as Record<string, unknown>
  const fields = {} as Record<keyof typeof AGENT_CHAPTER_PLAN_LIMITS, string>
  for (const [key, max] of Object.entries(AGENT_CHAPTER_PLAN_LIMITS)) {
    if (typeof raw[key] !== 'string' || raw[key].length > max) throw new AiError('invalid', '章节计划字段缺失或过长', 422)
    fields[key as keyof typeof fields] = raw[key].trim()
  }
  if (!fields.title || !fields.goal || !fields.beats) throw new AiError('invalid', '请填写章节标题、章节目标和情节步骤', 422)
  if (typeof raw.targetWords !== 'number' || !Number.isSafeInteger(raw.targetWords) || raw.targetWords < 300 || raw.targetWords > 30000)
    throw new AiError('invalid', '计划篇幅须为 300 至 30000 字', 422)
  return { ...fields, targetWords: raw.targetWords }
}

export async function readChapterPlan(db: DbClient, userId: string, sessionId: string) {
  const row = await first<PlanRow>(db, 'SELECT chapter_plan FROM ai_agent_sessions WHERE id=$1 AND user_id=$2', [sessionId, userId])
  if (!row) throw new AiError('invalid', '创作对话不存在', 404)
  return row.chapter_plan
}

export function snapshotChapterPlan(plan: AgentChapterPlan | null, revision: unknown) {
  if (revision === undefined) return undefined
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 1) throw new AiError('invalid', '章节计划版本无效', 422)
  if (!plan || plan.revision !== revision) throw new AiError('conflict', '章节计划已变化，请重新查看并确认', 409)
  return plan
}

export async function saveChapterPlan(db: Db, userId: string, sessionId: string, value: unknown, expectedRevision: unknown,
  proposal?: { taskId: string; operationId: string },
  attach?: (db: DbClient) => Promise<Pick<AgentChapterPlan, 'sourceOutline' | 'storyThreads'>>) {
  const content = parseChapterPlan(value)
  if (typeof expectedRevision !== 'number' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
    throw new AiError('invalid', '请提供章节计划的当前版本', 422)
  return withTx(db, async query => {
    const scoped = { query }
    const row = await first<PlanRow>(scoped, 'SELECT chapter_plan,chapter_plan_operation_id,active_task_id FROM ai_agent_sessions WHERE id=$1 AND user_id=$2 FOR UPDATE', [sessionId, userId])
    if (!row) throw new AiError('invalid', '创作对话不存在', 404)
    if (proposal && row.chapter_plan_operation_id === proposal.operationId && row.chapter_plan) {
      if (JSON.stringify(parseChapterPlan(row.chapter_plan)) !== JSON.stringify(content)) throw new AiError('conflict', '同一计划请求不能更换内容', 409)
      return row.chapter_plan
    }
    const active = await first(scoped, "SELECT id FROM ai_tasks WHERE id=$1 AND user_id=$2 AND kind='agent_chat' AND status IN ('queued','running')", [row.active_task_id, userId])
    if (proposal ? !active || row.active_task_id !== proposal.taskId : !!active)
      throw new AiError('conflict', proposal ? '计划所属轮次已结束，请重新提出计划' : '助手正在处理消息，请等待或停止后编辑计划', 409)
    if ((row.chapter_plan?.revision || 0) !== expectedRevision) throw new AiError('conflict', '章节计划已变化，请重新读取后编辑', 409)
    const metadata = attach ? await attach(scoped) : { sourceOutline: row.chapter_plan?.sourceOutline, storyThreads: row.chapter_plan?.storyThreads }
    const plan: AgentChapterPlan = { version: 1, ...content, ...metadata, revision: expectedRevision + 1, updatedAt: Date.now() }
    await query('UPDATE ai_agent_sessions SET chapter_plan=$1::jsonb,chapter_plan_operation_id=$2,updated_at=GREATEST(updated_at+1,$3) WHERE id=$4',
      [JSON.stringify(plan), proposal?.operationId || '', plan.updatedAt, sessionId])
    if (proposal) await query("UPDATE ai_tasks SET params=jsonb_set(params::jsonb,'{chapterPlanProposed}','true'::jsonb)::text WHERE id=$1", [proposal.taskId])
    return plan
  })
}
