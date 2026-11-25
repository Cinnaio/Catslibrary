import { createHash } from 'node:crypto'
import type { AgentStoryThreadPlan, AgentStoryThreadState, AgentChapterPlan } from '@shared/ai-agent'
import type { Db, DbClient } from '../../db/pool'
import { all, first, withTx } from '../../db/query'
import { newId } from '../auth'
import { AiError } from './client'
import { getStoryGraph } from './story-graph'
import { getAgentSession } from './agent-store'
import { saveChapterPlan } from './agent-chapter-plan'

const columns = `id,thread,disposition,note,revision,source_revision AS "sourceRevision",source_anchor_id AS "sourceAnchorId"`
async function graphSource(db: DbClient, userId: string, sessionId: string) {
  const session = await getAgentSession(db, userId, sessionId)
  const graph = session.afterChapterId ? await getStoryGraph(db as Db, session.novelId, session.afterChapterId) : null
  const sourceRevision = graph?.status === 'ready' ? createHash('sha256').update(JSON.stringify([session.afterChapterId, graph.updatedAt, graph.graph])).digest('hex') : ''
  return { session, graph, sourceRevision }
}
export async function readStoryThreadPlans(db: DbClient, userId: string, sessionId: string): Promise<AgentStoryThreadState> {
  const { session, graph, sourceRevision } = await graphSource(db, userId, sessionId)
  const plans = await all<AgentStoryThreadPlan>(db, `SELECT ${columns} FROM ai_agent_story_thread_plans WHERE user_id=$1 AND novel_id=$2 ORDER BY id`, [userId, session.novelId])
  return { candidates: graph?.graph?.threads || [], sourceRevision, graphStatus: graph?.status || 'unavailable',
    plans: plans.map(plan => ({ ...plan, stale: !sourceRevision || plan.sourceRevision !== sourceRevision })) }
}
export async function changeStoryThreadPlan(db: Db, userId: string, sessionId: string, body: Record<string, unknown>) {
  const { id, threadId, expectedRevision, sourceRevision, disposition, note } = body
  if (!['advance','later','hold','resolved'].includes(String(disposition)) || typeof note !== 'string' || note.length > 1200 ||
      !Number.isSafeInteger(expectedRevision) || Number(expectedRevision) < 0 || (id !== undefined && typeof id !== 'string'))
    throw new AiError('invalid', '请提供有效的线索安排与版本，说明最多 1200 字', 422)
  return withTx(db, async query => {
    const tx = { query }
    const owned = await first(tx, 'SELECT id FROM ai_agent_sessions WHERE id=$1 AND user_id=$2 FOR UPDATE', [sessionId, userId])
    if (!owned) throw new AiError('invalid', '创作对话不存在', 404)
    await query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId])
    const { session, graph, sourceRevision: currentSource } = await graphSource(tx, userId, sessionId)
    const previous = id ? await first<AgentStoryThreadPlan>(tx, `SELECT ${columns} FROM ai_agent_story_thread_plans WHERE id=$1 AND user_id=$2 AND novel_id=$3 FOR UPDATE`, [id, userId, session.novelId]) : null
    if (id && !previous) throw new AiError('invalid', '这条线索安排不存在', 404)
    if (previous) {
      if (previous.revision !== expectedRevision) throw new AiError('conflict', '线索安排已变化，请刷新核对', 409)
      await query('UPDATE ai_agent_story_thread_plans SET disposition=$1,note=$2,revision=revision+1 WHERE id=$3', [disposition, note.trim(), previous.id])
    } else {
      const thread = graph?.graph?.threads.find(item => item.id === threadId)
      if (expectedRevision !== 0 || !currentSource || sourceRevision !== currentSource || !thread)
        throw new AiError('conflict', '星图来源已变化，请刷新并核对线索', 409)
      const existing = await first<AgentStoryThreadPlan>(tx, `SELECT ${columns} FROM ai_agent_story_thread_plans WHERE user_id=$1 AND novel_id=$2 AND source_revision=$3 AND thread->>'id'=$4`, [userId, session.novelId, currentSource, thread.id])
      if (existing) {
        if (existing.disposition !== disposition || existing.note !== note.trim()) throw new AiError('conflict', '这条线索已有安排，请刷新后编辑', 409)
        return readStoryThreadPlans(tx, userId, sessionId)
      }
      const count = await first<{ count: number }>(tx, 'SELECT count(*)::int AS count FROM ai_agent_story_thread_plans WHERE user_id=$1 AND novel_id=$2', [userId, session.novelId])
      if ((count?.count || 0) >= 40) throw new AiError('invalid', '每本书最多保留 40 条线索安排，请先移除不再需要的条目', 422)
      await query(`INSERT INTO ai_agent_story_thread_plans(id,user_id,novel_id,source_revision,source_anchor_id,thread,disposition,note) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8)`,
        [newId('ast'), userId, session.novelId, currentSource, session.afterChapterId, JSON.stringify(thread), disposition, note.trim()])
    }
    return readStoryThreadPlans(tx, userId, sessionId)
  })
}
export async function removeStoryThreadPlan(db: Db, userId: string, sessionId: string, id: string, revision: unknown) {
  const session = await getAgentSession(db, userId, sessionId)
  if (!Number.isSafeInteger(revision) || Number(revision) < 1) throw new AiError('invalid', '请提供线索版本', 422)
  const result = await db.query('DELETE FROM ai_agent_story_thread_plans WHERE id=$1 AND user_id=$2 AND novel_id=$3 AND revision=$4', [id, userId, session.novelId, revision])
  if (!result.rowCount) throw new AiError('conflict', '线索安排已变化，请刷新核对', 409)
}
export async function applyStoryThreadPlans(db: Db, userId: string, sessionId: string, body: Record<string, unknown>) {
  const { ids, expectedPlanRevision, revisions } = body
  if (!Array.isArray(ids) || ids.length > 6 || ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length ||
      !Array.isArray(revisions) || revisions.length !== ids.length || revisions.some(revision => !Number.isSafeInteger(revision)))
    throw new AiError('invalid', '每章最多带入六条线索安排', 422)
  const session = await getAgentSession(db, userId, sessionId)
  const row = await first<{ chapter_plan: AgentChapterPlan | null }>(db, 'SELECT chapter_plan FROM ai_agent_sessions WHERE id=$1 AND user_id=$2', [sessionId, userId])
  if (!row?.chapter_plan) throw new AiError('invalid', '请先建立章节计划，再带入线索安排', 422)
  return saveChapterPlan(db, userId, sessionId, row.chapter_plan, expectedPlanRevision, undefined, async tx => {
    await tx.query('SELECT id FROM ai_agent_story_thread_plans WHERE user_id=$1 AND novel_id=$2 ORDER BY id FOR SHARE', [userId, session.novelId])
    const state = await readStoryThreadPlans(tx, userId, sessionId)
    const selected = ids.map((id, i) => state.plans.find(plan => plan.id === id && plan.revision === revisions[i]))
    if (selected.some(plan => !plan || plan.stale || plan.disposition === 'resolved'))
      throw new AiError('conflict', '线索版本或来源已变化，或已回收，请刷新核对后重选', 409)
    return { sourceOutline: row.chapter_plan!.sourceOutline, storyThreads: selected as AgentStoryThreadPlan[] }
  })
}

/** New writing must still match the author's reviewed arrangements. Retrying a saved turn keeps its original snapshot. */
export async function validateStoryThreadSnapshot(db: DbClient, userId: string, sessionId: string, plan: AgentChapterPlan) {
  if (!plan.storyThreads?.length) return
  const session = await getAgentSession(db, userId, sessionId)
  await db.query('SELECT id FROM ai_agent_story_thread_plans WHERE user_id=$1 AND novel_id=$2 ORDER BY id FOR SHARE', [userId, session.novelId])
  const state = await readStoryThreadPlans(db, userId, sessionId)
  if (plan.storyThreads.some(saved => !state.plans.some(current => current.id === saved.id && current.revision === saved.revision &&
      !current.stale && current.sourceRevision === saved.sourceRevision && current.disposition !== 'resolved')))
    throw new AiError('conflict', '本章线索安排或星图来源已变化，请重新核对并保存本章选择后写作', 409)
}
