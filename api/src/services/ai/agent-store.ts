import type { AgentReferenceSelection, AgentEvent, AgentSession, AgentAction, AgentActionKind } from '@shared/ai-agent'
import type { Db, DbClient } from '../../db/pool'
import { all, first, run, withTx } from '../../db/query'
import { newId } from '../auth'
import { AiError } from './client'
import { createAiTask, getAiTask, isAiTaskActive, updateAiTask } from './tasks'
import { publishAiTask } from './task-events'
import { DEFAULT_WRITING_CONTENT_PREFERENCES, validateWritingContentPreferences } from './writing-preferences'

import { agentTaskParams } from './agent-recovery'
import { snapshotChapterPlan } from './agent-chapter-plan'
import type { AgentChapterPlan } from '@shared/ai-agent'
import { referenceSelection, snapshotWritingReferences } from './agent-writing-references'

interface SessionRow {
  chapter_plan: AgentChapterPlan | null
  id: string
  user_id: string
  novel_id: string
  title: string
  after_chapter_id: string
  brief: string
  content_preferences: AgentSession['contentPreferences']
  active_task_id: string
  created_at: number
  updated_at: number
  novel_title: string
  anchor_title: string
  writing_reference_ids: string[]
  book_settings_revision: number
}
const SESSION_SELECT = `SELECT s.*, n.title AS novel_title, COALESCE(c.title,'') AS anchor_title,
  COALESCE(b.revision,0) AS book_settings_revision
  FROM ai_agent_sessions s JOIN novels n ON n.id=s.novel_id
  LEFT JOIN chapters c ON c.id=s.after_chapter_id AND c.novel_id=s.novel_id
  LEFT JOIN ai_agent_book_settings b ON b.user_id=s.user_id AND b.novel_id=s.novel_id`

function mapSession(r: SessionRow): AgentSession {
  return {
    id: r.id,
    novelId: r.novel_id,
    novelTitle: r.novel_title,
    title: r.title,
    afterChapterId: r.after_chapter_id,
    anchorTitle: r.anchor_title,
    brief: r.brief,
    contentPreferences: r.content_preferences,
    writingReferenceIds: r.writing_reference_ids || [],
    bookSettingsRevision: r.book_settings_revision,
    activeTaskId: r.active_task_id,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  }
}

export async function getAgentSession(db: DbClient, userId: string, id: string): Promise<AgentSession> {
  const r = await first<SessionRow>(db, `${SESSION_SELECT} WHERE s.id=$1 AND s.user_id=$2`, [id, userId])
  if (!r) throw new AiError('invalid', '创作对话不存在', 404)
  return mapSession(r)
}

export async function listAgentSessions(db: DbClient, userId: string, novelId = '', offset = 0) {
  const rows = await all<SessionRow>(db,
    `${SESSION_SELECT} WHERE s.user_id=$1 ${novelId ? 'AND s.novel_id=$3' : ''} ORDER BY s.updated_at DESC,s.id LIMIT 31 OFFSET $2`,
    novelId ? [userId, offset, novelId] : [userId, offset],
  )
  return { sessions: rows.slice(0, 30).map(mapSession), hasMore: rows.length > 30 }
}

export async function deleteAgentSession(db: Db, userId: string, id: string) {
  await withTx(db, async (query) => {
    const scoped = { query }
    const session = await first<{ active_task_id: string }>(scoped,
      'SELECT active_task_id FROM ai_agent_sessions WHERE id=$1 AND user_id=$2 FOR UPDATE', [id, userId])
    if (!session) throw new AiError('invalid', '创作对话不存在', 404)
    if (await first(scoped, "SELECT 1 FROM ai_tasks WHERE id=$1 AND status IN ('queued','running')", [session.active_task_id]))
      throw new AiError('conflict', '请先等待或停止当前回复，再删除对话', 409)
    if (await first(scoped, "SELECT 1 FROM ai_agent_actions WHERE session_id=$1 AND status='executing'", [id]))
      throw new AiError('conflict', '请先核对正在执行的采纳操作，再删除对话', 409)

    await query(`DELETE FROM ai_tasks WHERE user_id=$1 AND kind='agent_chat'
      AND (id=$3 OR id IN (SELECT task_id FROM ai_agent_events WHERE session_id=$2 AND role='user'))`,
    [userId, id, session.active_task_id])
    await query('DELETE FROM ai_agent_sessions WHERE id=$1', [id])
  })
}

export async function createAgentSession(
  db: Db,
  userId: string,
  input: { novelId: string; afterChapterId?: string; brief?: string; contentPreferences?: unknown },
) {
  const suppliedPreferences = validateWritingContentPreferences(input.contentPreferences)
  if (suppliedPreferences.error) throw new AiError('invalid', suppliedPreferences.error, 422)
  const novel = await first(db, 'SELECT id FROM novels WHERE id=$1', [input.novelId])
  if (!novel) throw new AiError('invalid', '小说不存在', 404)
  const anchor = await first<{ id: string }>(
    db,
    `SELECT id FROM chapters WHERE novel_id=$1 ${input.afterChapterId ? 'AND id=$2' : ''} ORDER BY sort_order DESC,id DESC LIMIT 1`,
    input.afterChapterId ? [input.novelId, input.afterChapterId] : [input.novelId],
  )
  if (input.afterChapterId && !anchor) throw new AiError('invalid', '续写起点不属于当前小说', 422)
  const defaults = await first<Pick<SessionRow, 'brief' | 'content_preferences'>>(db,
    'SELECT brief,content_preferences FROM ai_agent_book_settings WHERE user_id=$1 AND novel_id=$2', [userId, input.novelId])
  const preferences = input.contentPreferences === undefined
    ? validateWritingContentPreferences(defaults?.content_preferences)
    : suppliedPreferences
  const id = newId('agent')
  await run(
    db,
    `INSERT INTO ai_agent_sessions(id,user_id,novel_id,after_chapter_id,brief,content_preferences,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$7)`,
    [
      id,
      userId,
      input.novelId,
      anchor?.id || '',
      (input.brief ?? defaults?.brief ?? '').slice(0, 4000),
      JSON.stringify(preferences.preferences || DEFAULT_WRITING_CONTENT_PREFERENCES),
      Date.now(),
    ],
  )
  return getAgentSession(db, userId, id)
}

export async function saveAgentSessionSettings(
  db: Db,
  userId: string,
  id: string,
  input: { brief?: string; contentPreferences?: unknown; expectedUpdatedAt: number; expectedBookSettingsRevision?: unknown },
) {
  const expectedRevision = input.expectedBookSettingsRevision
  if (expectedRevision !== undefined && (typeof expectedRevision !== 'number' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision > 2147483647))
    throw new AiError('invalid', '作品创作设置版本无效', 422)
  return withTx(db, async (query) => {
    const scoped = { query }
    const session = await first<SessionRow>(scoped,
      'SELECT * FROM ai_agent_sessions WHERE id=$1 AND user_id=$2 FOR UPDATE', [id, userId])
    if (!session) throw new AiError('invalid', '创作对话不存在', 404)
    if (await first(scoped, "SELECT 1 FROM ai_tasks WHERE id=$1 AND status IN ('queued','running')", [session.active_task_id]))
      throw new AiError('conflict', '请先等待或停止当前回复，再调整会话设置', 409)
    if (Number(session.updated_at) !== input.expectedUpdatedAt) throw new AiError('conflict', '会话已变化，请刷新后再保存', 409)
    const brief = input.brief ?? session.brief
    if (brief.length > 4000) throw new AiError('invalid', '创作约定最多 4000 字', 422)
    const preferences = validateWritingContentPreferences(input.contentPreferences ?? session.content_preferences)
    if (preferences.error) throw new AiError('invalid', preferences.error, 422)
    const contentPreferences = JSON.stringify(preferences.preferences)
    if (expectedRevision !== undefined) {
      const values = [userId, session.novel_id, brief, contentPreferences]
      const saved = expectedRevision === 0
        ? await run(scoped, `INSERT INTO ai_agent_book_settings(user_id,novel_id,brief,content_preferences)
          VALUES($1,$2,$3,$4) ON CONFLICT (user_id,novel_id) DO NOTHING`, values)
        : await run(scoped, `UPDATE ai_agent_book_settings SET brief=$3,content_preferences=$4,revision=revision+1
          WHERE user_id=$1 AND novel_id=$2 AND revision=$5`, [...values, expectedRevision])
      if (!saved) throw new AiError('conflict', '本书的默认创作设置已更新，请刷新后再保存', 409)
    }
    await query('UPDATE ai_agent_sessions SET brief=$1,content_preferences=$2,updated_at=GREATEST(updated_at+1,$3) WHERE id=$4',
      [brief, contentPreferences, Date.now(), id])
    return getAgentSession(scoped, userId, id)
  })
}

export async function appendAgentEvent(
  db: DbClient,
  sessionId: string,
  role: AgentEvent['role'],
  content: string,
  taskId = '',
  metadata: AgentEvent['metadata'] = {},
  requestId: string | null = null,
) {
  await run(db, `INSERT INTO ai_agent_events(session_id,role,content,task_id,metadata,request_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)`, [
    sessionId,
    role,
    content,
    taskId,
    JSON.stringify(metadata),
    requestId,
    Date.now(),
  ])
}

export async function readAgentEvents(db: DbClient, sessionId: string, before = 0, limit = 60) {
  const rows = await all<{ id: number; role: AgentEvent['role']; content: string; task_id: string; request_id: string | null; metadata: AgentEvent['metadata']; created_at: number }>(
    db,
    'SELECT * FROM ai_agent_events WHERE session_id=$1 AND ($2::bigint=0 OR id<$2) ORDER BY id DESC LIMIT $3',
    [sessionId, before, limit + 1],
  )
  return {
    hasEarlier: rows.length > limit,
    events: rows
      .slice(0, limit)
      .reverse()
      .map((r) => ({ id: Number(r.id), role: r.role, content: r.content, taskId: r.task_id, ...(r.request_id ? { requestId: r.request_id } : {}), metadata: r.metadata, createdAt: Number(r.created_at) })),
  }
}

export async function finishAgentReply(db: Db, sessionId: string, taskId: string, content: string, round: number) {
  const patch = { status: 'completed' as const, current: round + 1, total: round + 1, step: '本轮对话已完成', result: '' }
  await withTx(db, async (query) => {
    const scoped = { query }
    const session = await first(scoped, 'SELECT id FROM ai_agent_sessions WHERE id=$1 AND active_task_id=$2 FOR UPDATE', [sessionId, taskId])
    if (!session || !(await isAiTaskActive(scoped, taskId)) || !(await updateAiTask(scoped, taskId, patch, { publish: false })))
      throw new AiError('cancelled', '本轮已停止或执行权已过期', 409)
    await appendAgentEvent(scoped, sessionId, 'assistant', content, taskId, { round })
  })
  const time = Date.now()
  publishAiTask(taskId, { ...patch, updatedAt: time, finishedAt: time })
}

/** Session lock serializes turns across API processes. Request IDs survive lost responses. */
export async function beginAgentTurn(
  db: Db,
  userId: string,
  sessionId: string,
  content: string,
  requestId: string,
  provider: { providerPresetId: string; model: string } = { providerPresetId: '', model: '' },
  recoveryFromTaskId = '',
  references?: AgentReferenceSelection,
  chapterPlanRevision?: unknown,
  planningOnly?: unknown,
) {
  if (planningOnly !== undefined && planningOnly !== true) throw new AiError('invalid', '章节规划模式无效', 422)
  if (planningOnly && chapterPlanRevision !== undefined) throw new AiError('invalid', '拟定计划与确认写作不能同时提交', 422)
  const selection = referenceSelection(references)
  if (!content.trim() || content.length > 8000) throw new AiError('invalid', '请输入 1–8000 字的消息', 422)
  if (!/^[a-zA-Z0-9_-]{8,160}$/.test(requestId)) throw new AiError('invalid', '消息请求标识无效', 422)
  return withTx(db, async (query) => {
    const scoped = { query }
    const session = await first<SessionRow>(scoped, 'SELECT * FROM ai_agent_sessions WHERE id=$1 AND user_id=$2 FOR UPDATE', [sessionId, userId])
    if (!session) throw new AiError('invalid', '创作对话不存在', 404)
    const previous = await first<{ task_id: string; content: string; metadata: AgentEvent['metadata'] }>(
      scoped,
      'SELECT task_id,content,metadata FROM ai_agent_events WHERE session_id=$1 AND request_id=$2',
      [sessionId, requestId],
    )
    if (previous) {
      if (previous.metadata.planningOnly !== planningOnly) throw new AiError('conflict', '同一消息不能切换规划模式', 409)
      if (previous.metadata.chapterPlanRevision !== chapterPlanRevision) throw new AiError('conflict', '同一消息不能更换章节计划版本', 409)
      if (previous.content !== content) throw new AiError('conflict', '同一请求标识不能提交不同消息', 409)
      if ((previous.metadata.providerPresetId || '') !== provider.providerPresetId) throw new AiError('conflict', '同一请求标识不能切换模型预设', 409)
      if ((previous.metadata.recoveryFromTaskId || '') !== recoveryFromTaskId) throw new AiError('conflict', '同一请求标识不能切换恢复来源', 409)
      if (JSON.stringify(previous.metadata.referenceSelection) !== JSON.stringify(selection)) throw new AiError('conflict', '同一请求标识不能更换写作参考', 409)
      return { taskId: previous.task_id, created: false }
    }
    const chapterPlan = snapshotChapterPlan(session.chapter_plan, chapterPlanRevision)
    if (recoveryFromTaskId) {
      const source = await first(scoped, `SELECT id FROM ai_tasks WHERE id=$1 AND user_id=$2 AND kind='agent_chat'
        AND status IN ('failed','cancelled') AND params::jsonb->>'sessionId'=$3`, [recoveryFromTaskId, userId, sessionId])
      if (!source || session.active_task_id !== recoveryFromTaskId)
        throw new AiError('conflict', '对话已进入新的轮次，请刷新后继续', 409)
    }
    const active = await first(scoped, "SELECT id FROM ai_tasks WHERE id=$1 AND status IN ('queued','running')", [session.active_task_id])
    if (active) throw new AiError('conflict', '助手正在处理上一条消息，请等待或停止后继续', 409)
    // Serialize per-account admission as well as the conversation.
    await query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId])
    const running = await first<{ count: number }>(
      scoped,
      "SELECT COUNT(*)::int AS count FROM ai_tasks WHERE user_id=$1 AND kind='agent_chat' AND status IN ('queued','running')",
      [userId],
    )
    if (Number(running?.count) >= 2) throw new AiError('conflict', '已有两个创作对话在处理，请等待完成', 429)
    const recoveryParams = recoveryFromTaskId ? await first<{ params: string }>(scoped, 'SELECT params FROM ai_tasks WHERE id=$1', [recoveryFromTaskId]) : undefined
    const writingReferences = recoveryFromTaskId ? agentTaskParams(recoveryParams).writingReferences || []
      : await snapshotWritingReferences(scoped, userId, selection?.ids ?? session.writing_reference_ids ?? [], !!selection)
    if (selection?.scope === 'session') await query('UPDATE ai_agent_sessions SET writing_reference_ids=$1::jsonb WHERE id=$2', [JSON.stringify(selection.ids), sessionId])
    const referenceMetadata = writingReferences.map(({ id, title, revision }) => ({ id, title, revision }))
    const task = await createAiTask(scoped, {
      userId,
      novelId: session.novel_id,
      kind: 'agent_chat',
      total: 1,
      prompt: content,
      params: JSON.stringify({ sessionId, agentUsageVersion: 1, ...provider, writingReferences, ...(planningOnly ? { planningOnly: true } : {}), ...(chapterPlan ? { chapterPlan } : {}), ...(recoveryFromTaskId ? { recoveryFromTaskId } : {}) }),
    })
    await appendAgentEvent(scoped, sessionId, 'user', content, task.id, { ...provider, ...(planningOnly ? { planningOnly: true } : {}), ...(chapterPlan ? { chapterPlanRevision: chapterPlan.revision } : {}), referenceSelection: selection, ...(referenceMetadata.length ? { writingReferences: referenceMetadata } : {}), ...(recoveryFromTaskId ? { recoveryFromTaskId } : {}) }, requestId)
    await query(
      "UPDATE ai_agent_sessions SET active_task_id=$1,title=CASE WHEN title='新的创作对话' THEN $2 ELSE title END,updated_at=GREATEST(updated_at+1,$3) WHERE id=$4",
      [task.id, content.slice(0, 32), Date.now(), sessionId],
    )
    return { taskId: task.id, created: true }
  })
}

export async function trackAgentArtifact(db: DbClient, sessionId: string, taskId: string) {
  await run(db, 'INSERT INTO ai_agent_artifacts(task_id,session_id,created_at) VALUES($1,$2,$3) ON CONFLICT(task_id) DO NOTHING', [
    taskId,
    sessionId,
    Date.now(),
  ])
}

export async function requireAgentArtifact(db: Db, sessionId: string, taskId: string) {
  if (!(await first(db, 'SELECT task_id FROM ai_agent_artifacts WHERE task_id=$1 AND session_id=$2', [taskId, sessionId])))
    throw new AiError('invalid', '该任务不属于此对话', 404)
  const task = await getAiTask(db, taskId)
  if (!task) throw new AiError('invalid', '任务已移除，可在草稿或封面工作区查看保留的产出', 404)
  return task
}

export interface AgentActionRow {
  id: string
  session_id: string
  kind: AgentActionKind
  title: string
  payload: Record<string, unknown>
  preview: AgentAction['preview']
  status: AgentAction['status']
  result: Record<string, unknown>
  error: string
  lease_until: number
  created_at: number
  updated_at: number
}
export const publicAgentAction = (r: AgentActionRow): AgentAction => ({
  id: r.id,
  kind: r.kind,
  title: r.title,
  preview: r.preview,
  status: r.status,
  error: r.error,
  createdAt: Number(r.created_at),
  ...(r.status === 'executing' ? { canResume: Number(r.lease_until) < Date.now() } : {}),
})
export async function listAgentActions(db: DbClient, sessionId: string) {
  return (await all<AgentActionRow>(db, 'SELECT * FROM ai_agent_actions WHERE session_id=$1 ORDER BY created_at DESC LIMIT 50', [sessionId])).map(
    publicAgentAction,
  )
}
