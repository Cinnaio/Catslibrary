import type { AgentEvidence } from '@shared/ai-agent'
import type { Db } from '../../db/pool'
import { all } from '../../db/query'
import { readAgentChapter } from './agent-retrieval'
import { getAgentSession } from './agent-store'
import { AiError } from './client'
import { generationContentRevision, getGeneration } from './generations'
import { createMaterialBlock, limitMaterialText, type MaterialBlock } from './prompt-material'

export interface AgentWritingLength {
  kind: 'target' | 'minimum'
  words: number
}

/** Resolved at submission, stored with the task so a retry uses the same material. */
export interface AgentWritingContext {
  sessionId: string
  sources: AgentEvidence[]
  authorMessages: Array<{ id: number; content: string }>
  brief: string
  priorDraft?: { id: string; revision: string; text: string }
  length?: AgentWritingLength
}

const MAX_REFERENCES = 6
const DEFAULT_CHAPTER_WORDS = 2000

function referenceList(value: unknown, pattern: RegExp) {
  if (value === undefined || value === '') return []
  const items = typeof value === 'string' ? value.split(',').map(item => item.trim()) : []
  if (!items.length || items.length > MAX_REFERENCES || items.some(item => !pattern.test(item)))
    throw new AiError('invalid', '创作依据需提供至多六个有效编号', 422)
  return [...new Set(items)]
}

function readLength(raw: Record<string, unknown>, rewrite: boolean, previous?: AgentWritingLength): AgentWritingLength | undefined {
  const { targetWords, minimumWords } = raw
  if (targetWords !== undefined && minimumWords !== undefined)
    throw new AiError('invalid', '请只指定一个篇幅目标或最低字数', 422)
  const words = minimumWords === undefined ? targetWords : minimumWords
  if (words === undefined) return previous ?? (rewrite ? undefined : { kind: 'target', words: DEFAULT_CHAPTER_WORDS })
  const min = minimumWords !== undefined || rewrite ? 1 : 300
  const max = rewrite ? 12_000 : 30_000
  if (typeof words !== 'number' || !Number.isSafeInteger(words) || words < min || words > max)
    throw new AiError('invalid', `篇幅须为 ${min} 至 ${max} 字`, 422)
  return { kind: minimumWords !== undefined ? 'minimum' : 'target', words }
}

export async function resolveAgentWritingContext(
  db: Db,
  scope: { userId: string; novelId: string; afterChapterId?: string; rewrite?: boolean; wholeDraft?: boolean },
  value: unknown,
  previous?: AgentWritingContext,
): Promise<AgentWritingContext | undefined> {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new AiError('invalid', '对话创作依据无效', 422)
  const raw = value as Record<string, unknown>
  const session = await getAgentSession(db, scope.userId, String(raw.sessionId || ''))
  if (session.novelId !== scope.novelId || (scope.afterChapterId !== undefined && session.afterChapterId !== scope.afterChapterId))
    throw new AiError('conflict', '创作任务与当前会话的作品或起点不符', 409)
  if (previous && previous.sessionId !== session.id)
    throw new AiError('conflict', '上次改写不属于当前会话', 409)

  const length = readLength(raw, !!scope.rewrite, previous?.length)
  if (length && scope.rewrite && !scope.wholeDraft)
    throw new AiError('invalid', '整章篇幅只适用于整章改写', 422)

  const sourceIds = raw.sourceIds === undefined
    ? previous?.sources.map(source => source.id) || []
    : referenceList(raw.sourceIds, /^[a-f0-9]{24}$/)
  const saved = sourceIds.length ? await all<{ source: AgentEvidence }>(db, `
    SELECT DISTINCT ON (source->>'id') source
    FROM ai_agent_events e
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(e.metadata->'sources','[]')) AS material(source)
    WHERE e.session_id=$1 AND e.role='activity' AND source->>'kind'='chapter' AND source->>'id'=ANY($2::text[])
    ORDER BY source->>'id',e.id DESC`, [session.id, sourceIds]) : []
  const sources = await Promise.all(sourceIds.map(async id => {
    const item = saved.find(row => row.source.id === id)?.source
    if (!item?.chapterId || item.novelId !== session.novelId)
      throw new AiError('invalid', '原文依据须来自当前会话的正式章节查阅记录', 422)
    const { sources: [current] } = await readAgentChapter(db, session, item.chapterId, item.offset, item.revision)
    if (!current || current.id !== id) throw new AiError('conflict', '原文片段已变化，请重新查阅', 409)
    return current
  }))

  const authorIds = raw.authorEventIds === undefined
    ? (previous?.authorMessages || []).slice(-MAX_REFERENCES).map(item => item.id)
    : referenceList(raw.authorEventIds, /^\d{1,15}$/).map(Number)
  const taskId = String(raw.authorTaskId || '')
  const messages = authorIds.length || taskId ? await all<{ id: number; content: string }>(db, `
    SELECT id,content FROM ai_agent_events WHERE session_id=$1 AND role='user'
    AND (id=ANY($2::bigint[]) OR ($3<>'' AND task_id=$3)) ORDER BY id`, [session.id, authorIds, taskId]) : []
  const authorMessages = messages.map(item => ({ id: Number(item.id), content: item.content }))
  if (authorIds.some(id => !authorMessages.some(item => item.id === id)))
    throw new AiError('invalid', '请只引用当前会话中的作者消息', 422)

  let priorDraft: AgentWritingContext['priorDraft']
  if (raw.priorDraftId || raw.priorDraftRevision) {
    if (scope.rewrite || typeof raw.priorDraftId !== 'string' || !raw.priorDraftId ||
      typeof raw.priorDraftRevision !== 'string' || !raw.priorDraftRevision)
      throw new AiError('invalid', '请同时提供要承接的草稿及其版本', 422)
    const draft = await getGeneration(db, raw.priorDraftId)
    if (!draft || draft.deleted_at || draft.novel_id !== session.novelId || !['continue', 'write_chapter'].includes(draft.kind))
      throw new AiError('invalid', '要承接的章节草稿不属于当前作品或已删除', 404)
    const revision = generationContentRevision(draft.result)
    if (draft.status !== 'draft' || revision !== raw.priorDraftRevision)
      throw new AiError('conflict', '要承接的章节草稿已变化，请重新读取后续写', 409)
    priorDraft = { id: draft.id, revision, text: limitMaterialText(draft.result, 6000, 'tail') }
  }
  return { sessionId: session.id, sources, authorMessages, brief: session.brief, ...(priorDraft ? { priorDraft } : {}), ...(length ? { length } : {}) }
}

export function agentWritingMaterials(context: AgentWritingContext) {
  const evidence = context.sources.map(source => createMaterialBlock({
    id: source.id,
    kind: 'published_context',
    text: `《${source.title}》\n${source.excerpt}`,
    source: { field: 'agent_chapter_excerpt', chapterId: source.chapterId, revision: source.revision },
  })).filter((block): block is MaterialBlock => !!block)
  const authors = [
    createMaterialBlock({ id: 'agent-brief', kind: 'author_request', text: context.brief }),
    ...context.authorMessages.map(message => createMaterialBlock({
      id: `author-message-${message.id}`,
      kind: 'author_request',
      text: message.content,
      maxChars: 2000,
      mode: 'both',
    })),
  ].filter((block): block is MaterialBlock => !!block)
  const prior = context.priorDraft && createMaterialBlock({
    id: `prior-draft-${context.priorDraft.id}`,
    kind: 'batch_draft',
    text: context.priorDraft.text,
    source: { field: 'agent_prior_draft', revision: context.priorDraft.revision },
    maxChars: 6000,
    mode: 'tail',
  })
  return { evidence, authors, prior }
}

export function agentLengthInstruction(length: AgentWritingLength) {
  return `正文${length.kind === 'minimum' ? '至少' : '约'} ${length.words} 字（不计标题和空白，包含标点）。`
}
