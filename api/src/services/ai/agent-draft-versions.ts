import type { AgentDraftRead, AgentEvent, AgentSession } from '@shared/ai-agent'
import type { Db } from '../../db/pool'
import { all } from '../../db/query'
import { agentDraftTitle } from './agent-actions'
import { quotedAgentText } from './agent-conversation'
import { generationContentRevision } from './generations'
import { parseRewriteSuggestion, parseRewriteTaskParams } from './rewrite'

export interface AgentDraftVersion {
  read: AgentDraftRead
  excerpt: string
  content: string
}

const MAX_MATCHES = 8
const WHOLE_READ_LIMIT = 12_000

/** Matches actual saved text, including unadopted suggestions in this conversation. */
export async function findAgentDraftVersions(db: Db, session: AgentSession, phrase: string) {
  const quote = phrase.trim()
  if (quote.length < 2 || quote.length > 240) return []
  const [drafts, rewrites] = await Promise.all([
    all<{ id: string; result: string; params_json: string; created_at: number }>(db, `
      SELECT id,result,params_json,created_at FROM ai_generations
      WHERE novel_id=$1 AND status='draft' AND deleted_at=0 AND kind IN ('continue','write_chapter')
        AND position($2 in result)>0 ORDER BY created_at DESC,id DESC LIMIT ${MAX_MATCHES}`, [session.novelId, quote]),
    all<{ id: string; result: string; params: string; created_at: number; draft_id: string; draft_params: string }>(db, `
      SELECT t.id,t.result,t.params,t.created_at,g.id AS draft_id,g.params_json AS draft_params
      FROM ai_agent_artifacts a JOIN ai_tasks t ON t.id=a.task_id
      JOIN ai_generations g ON g.id=(CASE WHEN t.params IS JSON THEN t.params::jsonb->>'draftId' END)
      WHERE a.session_id=$1 AND t.novel_id=$2 AND g.novel_id=$2 AND g.deleted_at=0
        AND t.kind='rewrite_selection' AND t.status='completed'
        AND position($3 in (CASE WHEN t.result IS JSON THEN t.result::jsonb->>'suggestion' END))>0
      ORDER BY t.created_at DESC,t.id DESC LIMIT ${MAX_MATCHES}`, [session.id, session.novelId, quote]),
  ])
  function describe(read: AgentDraftRead, content: string): AgentDraftVersion {
    const position = content.indexOf(quote)
    const excerpt = content.slice(Math.max(0, position - 100), position + quote.length + 100)
    const truncated = content.length > WHOLE_READ_LIMIT
    return { read: { ...read, ...(truncated ? { truncated: true } : {}) }, excerpt, content: truncated ? excerpt : content }
  }
  const matches = drafts.map(row => describe({
    kind: 'draft', title: agentDraftTitle(row), draftId: row.id,
    revision: generationContentRevision(row.result), createdAt: Number(row.created_at),
  }, row.result))
  for (const row of rewrites) {
    const params = parseRewriteTaskParams(JSON.parse(row.params))
    const rewrite = params && parseRewriteSuggestion(row.result, params)
    if (!params || !rewrite || params.draftId !== row.draft_id || !rewrite.suggestion.includes(quote)) continue
    const versionText = params.baseContent.slice(0, params.startUTF16) + rewrite.suggestion + params.baseContent.slice(params.endUTF16)
    const revision = generationContentRevision(versionText)
    if (matches.some(match => match.read.draftId === row.draft_id && match.read.revision === revision)) continue
    matches.push(describe({
      kind: 'rewrite', title: agentDraftTitle({ params_json: row.draft_params, result: params.baseContent }),
      draftId: row.draft_id, taskId: row.id, revision, createdAt: Number(row.created_at),
    }, versionText))
  }
  return matches.sort((a, b) => (b.read.createdAt || 0) - (a.read.createdAt || 0)).slice(0, MAX_MATCHES)
}

/** Keep a quote through a review or approval, up to the next submitted version. */
export async function resolveAgentDraftFocus(db: Db, session: AgentSession, events: AgentEvent[]) {
  const authorMessages = events.filter(event => event.role === 'user').reverse()
  const latest = authorMessages[0]
  if (!latest || /\b(?:aitask|aigen)_[a-z0-9_]+\b|(?:按|基于|用|重读|查看|回到|改回)\s*(?:第一章的?)?(?:原草稿|原稿|初稿)/iu.test(latest.content))
    return undefined
  const currentQuotes = quotedAgentText(latest.content)
  const refersBack = /改|检查|核对|这一?版|继续|可以|确认/u.test(latest.content) &&
    !/另[一个]+版|换一版|第[一二三四五六七八九十\d]+版/u.test(latest.content)
  const authorEvent = currentQuotes.length ? latest : refersBack
    ? authorMessages.find(event => quotedAgentText(event.content).length > 0)
    : undefined
  if (!authorEvent || (authorEvent.id !== latest.id && events.some(event => event.id > authorEvent.id && event.metadata.artifactTaskId &&
    ['generate_draft', 'rewrite_draft', 'refine_rewrite'].includes(event.metadata.tool || '')))) return undefined
  const matches = new Map<string, AgentDraftVersion>()
  for (const quote of quotedAgentText(authorEvent.content).slice(0, 3)) {
    for (const version of await findAgentDraftVersions(db, session, quote.text)) matches.set(version.read.taskId || version.read.draftId, version)
  }
  if (!matches.size) return undefined
  return { authorEventId: authorEvent.id, matches: [...matches.values()] }
}
