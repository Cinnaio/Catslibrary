import { createHash } from 'node:crypto'
import { AGENT_CONTINUATION_LIMIT, AGENT_CONTINUATION_NOTE_LIMIT, type AgentContinuationPreview } from '@shared/ai-agent'
import type { Db, DbClient } from '../../db/pool'
import { all, first, withTx } from '../../db/query'
import { getAgentSummary } from './agent-memory'
import { agentPublishedChapterId, createAgentSession, findAgentSession, getAgentSession, type AgentActionRow } from './agent-store'
import { AiError } from './client'

const ITEM_LENGTH_LIMIT = 600

export async function readAgentContinuation(db: DbClient, userId: string, sessionId: string, actionId: string, lock = false): Promise<AgentContinuationPreview> {
  const session = await getAgentSession(db, userId, sessionId)
  const action = await first<AgentActionRow>(db, 'SELECT * FROM ai_agent_actions WHERE session_id=$1 AND id=$2', [session.id, actionId])
  const chapterId = action && agentPublishedChapterId(action)
  if (!action || !chapterId) throw new AiError('invalid', '未找到这次发布的正式章节', 404)
  const chapter = await first<{ id: string; title: string }>(db,
    `SELECT id,title FROM chapters WHERE id=$1 AND novel_id=$2${lock ? ' FOR SHARE' : ''}`, [chapterId, session.novelId])
  if (!chapter) throw new AiError('conflict', '已发布的章节已删除或撤回，请重新选择续写起点', 409)

  const savedId = typeof action.result.continuationSessionId === 'string' ? action.result.continuationSessionId : ''
  // A deleted follow-up can be replaced from a fresh preview. A delayed request keeps its original revision.
  const existingSession = savedId ? await findAgentSession(db, userId, savedId) : undefined
  if (existingSession?.novelId === session.novelId && existingSession.afterChapterId === chapter.id)
    return { chapter, candidates: [], revision: '', existingSession }

  const summary = await getAgentSummary(db, session.id)
  const author = await all<{ id: string; content: string }>(db,
    `SELECT id::text,content FROM (SELECT id,content FROM ai_agent_events WHERE session_id=$1 AND role='user'
      ORDER BY id DESC LIMIT 6) recent ORDER BY recent.id`, [session.id])
  const candidates: AgentContinuationPreview['candidates'] = []
  const add = (id: string, kind: typeof candidates[number]['kind'], text: string) => {
    const value = text.trim()
    if (value && value.length <= ITEM_LENGTH_LIMIT && !candidates.some(candidate => candidate.text === value))
      candidates.push({ id, kind, text: value })
  }
  summary?.content.openQuestions.slice(0, 4).forEach((text, i) => add(`question-${i}`, 'question', text.replace(/^#\d+\s*/u, '')))
  summary?.content.nextSteps.slice(0, 4).forEach((text, i) => add(`next-${i}`, 'next_step', text.replace(/^#\d+\s*/u, '')))
  for (const message of author) add(`author-${message.id}`, 'author_message', message.content)
  const revision = createHash('sha256').update(JSON.stringify([action.id, chapter, savedId, candidates])).digest('hex')
  return { chapter, candidates, revision }
}

export async function continuePublishedChapter(db: Db, userId: string, sessionId: string, actionId: string, body: Record<string, unknown>) {
  const { expectedRevision, selectedIds, note } = body
  if (typeof expectedRevision !== 'string' || !/^[a-f0-9]{64}$/u.test(expectedRevision) || !Array.isArray(selectedIds) ||
      selectedIds.length > AGENT_CONTINUATION_LIMIT || selectedIds.some(id => typeof id !== 'string' || id.length > 48) ||
      new Set(selectedIds).size !== selectedIds.length || typeof note !== 'string' || note.length > AGENT_CONTINUATION_NOTE_LIMIT)
    throw new AiError('invalid', '请选择有效的承接事项，补充内容最多 1200 字', 422)

  return withTx(db, async query => {
    const tx = { query }
    await query('SELECT id FROM ai_agent_sessions WHERE id=$1 AND user_id=$2 FOR UPDATE', [sessionId, userId])
    const preview = await readAgentContinuation(tx, userId, sessionId, actionId, true)
    if (preview.existingSession) return preview.existingSession
    if (preview.revision !== expectedRevision) throw new AiError('conflict', '可承接的事项已变化，请刷新后重新选择', 409)
    const selected = preview.candidates.filter(item => selectedIds.includes(item.id))
    if (selected.length !== selectedIds.length) throw new AiError('invalid', '请选择当前预览中的事项', 422)
    const continuationNotes = selected.map(({ kind, text }) => ({ kind, text }))
    if (note.trim()) continuationNotes.push({ kind: 'note', text: note.trim() })
    const source = await getAgentSession(tx, userId, sessionId)
    const next = await createAgentSession(tx, userId, { novelId: source.novelId, afterChapterId: preview.chapter.id, continuationNotes })
    await query("UPDATE ai_agent_actions SET result=result || jsonb_build_object('continuationSessionId',$3::text) WHERE id=$1 AND session_id=$2",
      [actionId, sessionId, next.id])
    return next
  })
}
