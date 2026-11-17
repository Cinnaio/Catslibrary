import type { AgentSession } from '@shared/ai-agent'
import type { Db } from '../../db/pool'
import { all } from '../../db/query'
import { AiError } from './client'

/** Exact quotations. Positions are UTF-16 offsets in the supplied message. */
export function quotedAgentText(text: string) {
  return [...text.matchAll(/“([^”\r\n]{2,240})”|「([^」\r\n]{2,240})」|『([^』\r\n]{2,240})』|"([^"\r\n]{2,240})"/gu)]
    .map(match => ({ text: (match[1] || match[2] || match[3] || match[4] || '').trim(), end: match.index! + match[0].length }))
    .filter(quote => quote.text.length >= 2)
}

/** Exact source lookup, bounded independently of the distance between messages. */
export async function readConversationSources(db: Db, session: AgentSession, userId: string, ids: number[], offset?: number) {
  const requested = [...new Set(ids)]
  if (!requested.length || requested.length > 8 || requested.some(id => !Number.isSafeInteger(id) || id < 1))
    throw new AiError('invalid', '每次可核对 1–8 条原始消息', 422)
  if (offset !== undefined && (requested.length !== 1 || !Number.isSafeInteger(offset) || offset < 0))
    throw new AiError('invalid', '分段查阅只接受一个消息编号和有效位置', 422)
  const rows = await all<{ id: number; role: string; content: string }>(db,
    `SELECT e.id,e.role,e.content FROM ai_agent_events e JOIN ai_agent_sessions s ON s.id=e.session_id
     WHERE e.id=ANY($1::bigint[]) AND e.session_id=$2 AND s.user_id=$3 AND s.novel_id=$4 ORDER BY e.id`,
    [requested, session.id, userId, session.novelId])
  return {
    scope: '仅所列原始消息；不覆盖其他对话、作品正文或资源状态',
    messages: rows.map(row => {
      let start = offset ?? 0
      if (start > row.content.length) throw new AiError('invalid', '读取位置超出消息长度', 422)
      if (start < row.content.length && /[\uDC00-\uDFFF]/u.test(row.content[start]!)) start--
      let end = Math.min(start + (offset === undefined ? 3000 : 12000), row.content.length)
      if (end < row.content.length && /[\uDC00-\uDFFF]/u.test(row.content[end]!)) end--
      return { eventId: Number(row.id), speaker: row.role === 'user' ? '作者' : row.role === 'assistant' ? '助手' : '服务端操作记录',
        content: row.content.slice(start, end), truncated: start > 0 || end < row.content.length, offset: start,
        nextOffset: end < row.content.length ? end : null }
    }),
    continuation: 'nextOffset 非空时，仅传该条 eventId 并将 offset 设为 nextOffset 继续读；不要推断未读取部分。',
    unavailableEventIds: requested.filter(id => !rows.some(row => Number(row.id) === id)),
  }
}

/** Lexical guard, not a semantic classifier. Keep full clauses including negation
 * and conditions; the author still reviews the pending proposal before adoption. */
export function isAuthorQuote(source: string, content: string) {
  const quote = content.trim()
  if (!quote) return false
  for (let start = source.indexOf(quote); start >= 0; start = source.indexOf(quote, start + 1)) {
    const before = source.slice(0, start).replace(/[ \t\r]+$/, '')
    const after = source.slice(start + quote.length).replace(/^[ \t\r]+/, '')
    const startsClause = !before || /[。！？；：\n]$/.test(before) || /^(?:请)?记住$/.test(before)
    const endsClause = !after || /^[。！？；\n]/.test(after) || /[。！？；]$/.test(quote)
    if (startsClause && endsClause) return true
  }
  return false
}
