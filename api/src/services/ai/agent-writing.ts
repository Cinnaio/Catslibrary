import type { AgentEvidence } from '@shared/ai-agent'
import type { Db } from '../../db/pool'
import { all } from '../../db/query'
import { quotedAgentText } from './agent-conversation'
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
const MAX_CITED_PASSAGES = 4

export function parseAgentSourceIds(value: unknown): string[] {
  if (value === undefined || value === '') return []
  const items = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,，、]/u) : [value]
  const ids = [...new Set(items.map(item => typeof item === 'string' ? item.trim() : ''))]
  if (ids.length > MAX_REFERENCES || ids.some(id => !/^[a-f0-9]{24}$/u.test(id)))
    throw new AiError('invalid', '原文依据请填写至多六个查阅结果的片段编号，可用数组或逗号分隔', 422)
  return ids
}

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

/** Reuse exact, attributable quotations from the assistant replies to the selected author messages. */
async function citedAgentPassages(db: Db, session: Awaited<ReturnType<typeof getAgentSession>>, authorTasks: string[]) {
  if (!authorTasks.length) return []
  const replies = await all<{ id: number; content: string }>(db, `
    SELECT id,content FROM ai_agent_events WHERE session_id=$1 AND role='assistant' AND task_id=ANY($2::text[])
    ORDER BY id DESC LIMIT 12`, [session.id, authorTasks])
  const quotes: Array<{ chapterId: string; quote: string; replyId: number }> = []
  for (const reply of replies) {
    for (const citation of quotedAgentText(reply.content)) {
      const link = reply.content.slice(citation.end).match(/^\s*[（(]?\s*\[[^\]\r\n]{1,200}\]\(\/read\/([^/\s)]+)\/([^/\s)]+)\)/u)
      if (!link) continue
      try {
        if (decodeURIComponent(link[1]!) === session.novelId)
          quotes.push({ chapterId: decodeURIComponent(link[2]!), quote: citation.text, replyId: Number(reply.id) })
      } catch { /* A malformed model-authored link has no verifiable chapter. */ }
    }
  }
  const relevantQuotes = quotes.slice(0, 12)
  if (!relevantQuotes.length) return []
  const candidates = await all<{ event_id: number; source: AgentEvidence }>(db, `
    SELECT e.id AS event_id,source FROM ai_agent_events e
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(e.metadata->'sources','[]')) AS material(source)
    WHERE e.session_id=$1 AND e.role='activity' AND source->>'kind'='chapter' AND source->>'chapterId'=ANY($2::text[])
      AND e.id<$3
    ORDER BY e.id DESC LIMIT 120`, [session.id, [...new Set(relevantQuotes.map(item => item.chapterId))],
    Math.max(...relevantQuotes.map(item => item.replyId))])
  const excerpts: AgentEvidence[] = []
  for (const item of relevantQuotes) {
    if (excerpts.length >= MAX_CITED_PASSAGES) break
    const matching = candidates.filter(row => Number(row.event_id) < item.replyId &&
      row.source.chapterId === item.chapterId && row.source.novelId === session.novelId)
    const source = matching.find(row => row.source.excerpt.includes(item.quote))?.source || matching[0]?.source
    if (!source) continue
    try {
      const result = source.excerpt.includes(item.quote)
        ? await readAgentChapter(db, session, item.chapterId, source.offset, source.revision)
        : await readAgentChapter(db, session, item.chapterId, 0, source.revision, item.quote)
      const passage = result.sources[0]
      if (passage?.excerpt.includes(item.quote) && !excerpts.some(old => old.id === passage.id)) excerpts.push(passage)
    } catch (error) {
      if (!(error instanceof AiError) || ![404, 409, 422].includes(error.status)) throw error
      // Old assistant quotations may be approximate or their chapter has changed.
    }
  }
  return excerpts
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

  const sourceIds = parseAgentSourceIds(raw.sourceIds)
  const saved = sourceIds.length ? (await all<{ source: AgentEvidence }>(db, `
    SELECT DISTINCT ON (source->>'id') source
    FROM ai_agent_events e
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(e.metadata->'sources','[]')) AS material(source)
    WHERE e.session_id=$1 AND e.role='activity' AND source->>'kind'='chapter' AND source->>'id'=ANY($2::text[])
    ORDER BY source->>'id',e.id DESC`, [session.id, sourceIds])).map(row => row.source) : []
  const selected = raw.sourceIds === undefined ? previous?.sources || [] : sourceIds.map(id => saved.find(row => row.id === id))
  const sources = await Promise.all(selected.map(async item => {
    if (!item?.chapterId || item.novelId !== session.novelId)
      throw new AiError('invalid', '原文依据须来自当前会话的正式章节查阅记录', 422)
    const { sources: [current] } = await readAgentChapter(db, session, item.chapterId, item.offset, item.revision)
    if (!current || current.id !== item.id) throw new AiError('conflict', '原文片段已变化，请重新查阅', 409)
    return current
  }))

  const authorIds = raw.authorEventIds === undefined
    ? (previous?.authorMessages || []).slice(-MAX_REFERENCES).map(item => item.id)
    : referenceList(raw.authorEventIds, /^\d{1,15}$/).map(Number)
  if (Number.isSafeInteger(raw.focusAuthorEventId)) authorIds.push(Number(raw.focusAuthorEventId))
  const taskId = String(raw.authorTaskId || '')
  const messages = authorIds.length || taskId ? await all<{ id: number; content: string; task_id: string }>(db, `
    SELECT id,content,task_id FROM ai_agent_events WHERE session_id=$1 AND role='user'
    AND (id=ANY($2::bigint[]) OR ($3<>'' AND task_id=$3)) ORDER BY id`, [session.id, authorIds, taskId]) : []
  const authorMessages = messages.map(item => ({ id: Number(item.id), content: item.content }))
  if (authorIds.some(id => !authorMessages.some(item => item.id === id)))
    throw new AiError('invalid', '请只引用当前会话中的作者消息', 422)
  const cited = await citedAgentPassages(db, session, [...new Set(messages.map(message => message.task_id).filter(id => id && id !== taskId))])

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
  const passages = [...new Map([...cited, ...sources].map(source => [source.id, source])).values()].slice(0, MAX_REFERENCES + MAX_CITED_PASSAGES)
  return { sessionId: session.id, sources: passages, authorMessages, brief: session.brief, ...(priorDraft ? { priorDraft } : {}), ...(length ? { length } : {}) }
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
