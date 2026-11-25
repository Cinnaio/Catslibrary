import { AGENT_OUTLINE_LIMITS, AGENT_OUTLINE_MAX, AGENT_OUTLINE_MIN, type AgentChapterPlan, type AgentOutline, type AgentOutlineChapter } from '@shared/ai-agent'
import type { Db, DbClient } from '../../db/pool'
import { all, first, withTx } from '../../db/query'
import { newId } from '../auth'
import { saveChapterPlan } from './agent-chapter-plan'
import { getAgentSession } from './agent-store'
import { AiError } from './client'

export function parseOutlineChapters(value: unknown): AgentOutlineChapter[] {
  if (!Array.isArray(value) || value.length < AGENT_OUTLINE_MIN || value.length > AGENT_OUTLINE_MAX)
    throw new AiError('invalid', '请填写 3 至 5 章的安排', 422)
  const used = new Set<string>()
  return value.map(chapter => {
    const fields = {} as AgentOutlineChapter
    for (const key of Object.keys(AGENT_OUTLINE_LIMITS) as Array<keyof typeof AGENT_OUTLINE_LIMITS>) {
      const text = chapter?.[key]
      if (typeof text !== 'string' || !text.trim() || text.length > AGENT_OUTLINE_LIMITS[key])
        throw new AiError('invalid', '请逐章填写标题、目标和情节步骤，并检查字段长度', 422)
      fields[key] = text.trim()
    }
    if (chapter.id !== undefined && (typeof chapter.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(chapter.id) || used.has(chapter.id)))
      throw new AiError('invalid', '大纲章节标识无效或重复', 422)
    if (chapter.id) { fields.id = chapter.id; used.add(chapter.id) }
    return fields
  })
}

export async function readAgentOutline(db: DbClient, userId: string, sessionId: string): Promise<AgentOutline | null> {
  const session = await getAgentSession(db, userId, sessionId)
  const outline = await first<AgentOutline>(db, 'SELECT revision,chapters FROM ai_agent_outlines WHERE user_id=$1 AND novel_id=$2', [userId, session.novelId])
  if (!outline) return null
  const drafts = await all<{ id: string; title: string; sessionId: string; status: string; chapterId: string; plan: AgentChapterPlan }>(db, `
    SELECT id,title,"sessionId",status,"chapterId",plan FROM (
      SELECT g.id,COALESCE(g.params_json::jsonb->>'draftTitle','未命名草稿') AS title,
        COALESCE(s.id,'') AS "sessionId",g.status,c.id AS "chapterId",g.params_json::jsonb->'agentChapterPlan' AS plan,
        row_number() OVER (PARTITION BY g.params_json::jsonb#>>'{agentChapterPlan,sourceOutline,chapterId}' ORDER BY
          CASE WHEN g.status='published' AND c.id IS NOT NULL THEN 0 ELSE 1 END,g.created_at DESC,g.id DESC) AS position
      FROM ai_generations g LEFT JOIN chapters c ON c.id=g.chapter_id AND c.novel_id=g.novel_id
      LEFT JOIN ai_agent_sessions s ON s.id=g.params_json::jsonb->>'agentSessionId' AND s.user_id=$1 AND s.novel_id=$2
      WHERE g.created_by=$1 AND g.novel_id=$2 AND g.deleted_at=0 AND g.status IN ('draft','published')
        AND g.params_json::jsonb#>>'{agentChapterPlan,sourceOutline,chapterId}'=ANY($3::text[])
    ) matched WHERE position<=5`, [userId, session.novelId, outline.chapters.map(chapter => chapter.id || '')])
  return { ...outline, chapters: outline.chapters.map(chapter => {
    const linked = drafts.filter(draft => draft.plan.sourceOutline?.chapterId === chapter.id)
    return { ...chapter, progress: {
      status: linked.some(draft => draft.status === 'published' && draft.chapterId) ? 'published' : linked.some(draft => draft.status === 'draft') ? 'draft' : linked.length ? 'unavailable' : 'planned',
      drafts: linked.map(({ plan: _plan, ...draft }) => draft),
      changedSinceWriting: linked.some(draft => draft.plan.sourceOutline!.revision !== outline.revision),
    } }
  }) }
}

export async function saveAgentOutline(db: Db, userId: string, sessionId: string, body: Record<string, unknown>, proposal?: { taskId: string; operationId: string }) {
  const { expectedRevision, chapters } = body
  if (typeof expectedRevision !== 'number' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= 2147483647)
    throw new AiError('invalid', '请提供当前大纲版本', 422)
  const content = parseOutlineChapters(chapters)
  return withTx(db, async query => {
    const tx = { query }
    const session = await first<{ novel_id: string; active_task_id: string }>(tx, 'SELECT novel_id,active_task_id FROM ai_agent_sessions WHERE id=$1 AND user_id=$2 FOR UPDATE', [sessionId, userId])
    if (!session) throw new AiError('invalid', '创作对话不存在', 404)
    await query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId])
    const current = await first<AgentOutline & { operation_id: string }>(tx, 'SELECT revision,chapters,operation_id FROM ai_agent_outlines WHERE user_id=$1 AND novel_id=$2 FOR UPDATE', [userId, session.novel_id])
    if (proposal && current?.operation_id === proposal.operationId) {
      const fields = (items: AgentOutlineChapter[]) => items.map(({ title, goal, beats }) => ({ title, goal, beats }))
      if (JSON.stringify(fields(current.chapters)) !== JSON.stringify(fields(content))) throw new AiError('conflict', '同一大纲请求不能更换内容', 409)
      return readAgentOutline(tx, userId, sessionId)
    }
    const active = await first(tx, "SELECT id FROM ai_tasks WHERE id=$1 AND user_id=$2 AND status IN ('queued','running')", [session.active_task_id, userId])
    if (proposal ? !active || session.active_task_id !== proposal.taskId : !!active)
      throw new AiError('conflict', '请等待当前回复完成后再调整大纲', 409)
    if ((current?.revision ?? 0) !== expectedRevision) throw new AiError('conflict', '大纲已变化，请重新读取后核对；本地编辑仍可保留', 409)
    if (current && (proposal || content.every(chapter => !chapter.id))) {
      const tracked = await readAgentOutline(tx, userId, sessionId)
      if (tracked?.chapters.some(chapter => chapter.progress?.status !== 'planned' && !content.some(item => item.id === chapter.id)))
        throw new AiError('conflict', '已有稿件的大纲章节须保留标识；如需移除，请作者在大纲中手动核对', 409)
    }
    for (const chapter of content) {
      if (chapter.id && !current?.chapters.some(item => item.id === chapter.id)) throw new AiError('conflict', '请使用当前大纲中的章节标识', 409)
      chapter.id ||= newId('olc')
    }
    await query(`INSERT INTO ai_agent_outlines(user_id,novel_id,revision,chapters,operation_id) VALUES($1,$2,1,$3::jsonb,$4)
      ON CONFLICT(user_id,novel_id) DO UPDATE SET revision=ai_agent_outlines.revision+1,chapters=EXCLUDED.chapters,operation_id=EXCLUDED.operation_id`,
    [userId, session.novel_id, JSON.stringify(content), proposal?.operationId || ''])
    if (proposal) await query("UPDATE ai_tasks SET params=jsonb_set(params::jsonb,'{chapterPlanProposed}','true'::jsonb)::text WHERE id=$1", [proposal.taskId])
    return readAgentOutline(tx, userId, sessionId)
  })
}

export function outlineChapterInput(outline: AgentOutline, index: number) {
  const chapter = outline.chapters[index]!
  const later = outline.chapters.slice(index + 1).map(item => `《${item.title}》：${item.goal}`)
  const constraints = later.length ? '以下目标安排在后章，本章只按自己的目标和情节推进，不提前完成：\n' + later.join('\n') : ''
  return { title: chapter.title, goal: chapter.goal, beats: chapter.beats, characters: '', ending: '', targetWords: 2000, constraints }
}

export async function applyAgentOutlineChapter(db: Db, userId: string, sessionId: string, body: Record<string, unknown>) {
  const { index, expectedOutlineRevision, expectedPlanRevision } = body
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= AGENT_OUTLINE_MAX ||
      typeof expectedOutlineRevision !== 'number' || !Number.isInteger(expectedOutlineRevision) || expectedOutlineRevision < 1)
    throw new AiError('invalid', '请指定当前大纲中的一章', 422)
  const outline = await readAgentOutline(db, userId, sessionId)
  if (!outline || outline.revision !== expectedOutlineRevision) throw new AiError('conflict', '大纲已变化，请重新读取后选择章节', 409)
  const chapter = outline.chapters[index]
  if (!chapter?.id) throw new AiError('invalid', '当前大纲中没有这一章，请刷新后重试', 422)
  return saveChapterPlan(db, userId, sessionId, outlineChapterInput(outline, index), expectedPlanRevision, undefined, async tx => {
    const session = await getAgentSession(tx, userId, sessionId)
    const current = await first<AgentOutline>(tx, 'SELECT revision,chapters FROM ai_agent_outlines WHERE user_id=$1 AND novel_id=$2 FOR SHARE', [userId, session.novelId])
    if (current?.revision !== expectedOutlineRevision || current.chapters[index]?.id !== chapter.id)
      throw new AiError('conflict', '大纲已变化，请重新读取后选择章节', 409)
    return { sourceOutline: { chapterId: chapter.id!, revision: outline.revision } }
  })
}
