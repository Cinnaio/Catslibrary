import type { AgentMemory, AgentSession, AgentSummary, AgentSummaryContent } from '@shared/ai-agent'
import type { Db, DbClient } from '../../db/pool'
import { all, first, withTx } from '../../db/query'
import { newId } from '../auth'
import { AiError } from './client'

type MemoryRow = {
  id: string
  user_id: string
  novel_id: string
  session_id: string | null
  kind: 'agreement'
  title: string
  content: string
  status: AgentMemory['status']
  source_event_id: number | null
  supersedes_id: string | null
  target_revision: number | null
  revision: number
  created_at: number
  updated_at: number
}
const SELECT = 'SELECT * FROM ai_agent_memories'
const MAX_ACTIVE = 24

const mapMemory = (r: MemoryRow): AgentMemory => ({
  id: r.id,
  novelId: r.novel_id,
  sessionId: r.session_id || '',
  kind: r.kind,
  title: r.title,
  content: r.content,
  status: r.status,
  sourceEventId: r.source_event_id == null ? null : Number(r.source_event_id),
  supersedesId: r.supersedes_id,
  revision: Number(r.revision),
  createdAt: Number(r.created_at),
  updatedAt: Number(r.updated_at),
})

function text(value: unknown, max: number, label: string) {
  if (typeof value !== 'string' || !value.trim() || Array.from(value.trim()).length > max) throw new AiError('invalid', `${label}须为 1–${max} 字`, 422)
  return value.trim()
}

async function lock(db: DbClient, userId: string, session: AgentSession) {
  // Match turn admission's session -> user lock order, including the session FK
  // lock acquired by inserts, so concurrent sends cannot form a lock cycle.
  const owner = await first(db, 'SELECT id FROM ai_agent_sessions WHERE id=$1 AND user_id=$2 AND novel_id=$3 FOR UPDATE', [session.id, userId, session.novelId])
  if (!owner) throw new AiError('invalid', '创作对话不存在', 404)
  await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId])
  const running = await first(
    db,
    `SELECT 1 FROM ai_agent_sessions s JOIN ai_tasks t ON t.id=s.active_task_id
    WHERE s.user_id=$1 AND s.novel_id=$2 AND t.status IN ('queued','running')`,
    [userId, session.novelId],
  )
  if (running) throw new AiError('conflict', '请先等待或停止这本书正在进行的回复，再调整作品记忆', 409)
}

async function readMemory(db: DbClient, userId: string, novelId: string, id: string) {
  const value = await first<MemoryRow>(db, `${SELECT} WHERE id=$1 AND user_id=$2 AND novel_id=$3`, [id, userId, novelId])
  if (!value) throw new AiError('invalid', '创作记忆不存在', 404)
  return value
}

async function capacity(db: DbClient, userId: string, novelId: string, status: 'active' | 'pending') {
  const count = await first<{ count: number }>(db, 'SELECT COUNT(*)::int AS count FROM ai_agent_memories WHERE user_id=$1 AND novel_id=$2 AND status=$3', [
    userId,
    novelId,
    status,
  ])
  if (Number(count?.count) >= MAX_ACTIVE)
    throw new AiError('conflict', `最多保留 ${MAX_ACTIVE} 条${status === 'active' ? '生效' : '待确认'}记忆，请先合并或移除已有内容`, 409)
}

export async function listAgentMemories(db: DbClient, userId: string, novelId: string, offset = 0) {
  const rows = await all<MemoryRow>(
    db,
    `${SELECT} WHERE user_id=$1 AND novel_id=$2
    ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'active' THEN 1 ELSE 2 END,updated_at DESC,id DESC LIMIT 51 OFFSET $3`,
    [userId, novelId, offset],
  )
  return { memories: rows.slice(0, 50).map(mapMemory), hasMore: rows.length > 50, summary: null as AgentSummary | null }
}

export async function activeAgentMemories(db: DbClient, userId: string, novelId: string) {
  return (await all<MemoryRow>(db, `${SELECT} WHERE user_id=$1 AND novel_id=$2 AND status='active' ORDER BY created_at,id`, [userId, novelId])).map(mapMemory)
}

export async function createAgentMemory(
  db: Db,
  userId: string,
  session: AgentSession,
  input: { title: unknown; content: unknown; sourceEventId?: number; supersedesId?: string },
  proposed = false,
) {
  const title = text(input.title, 100, '记忆标题')
  const content = text(input.content, 1000, '记忆内容')
  return withTx(db, async (query) => {
    const scoped = { query }
    if (proposed) {
      const source = await first<{ id: number }>(
        scoped,
        `SELECT e.id FROM ai_agent_events e JOIN ai_agent_sessions s ON s.id=e.session_id
        WHERE e.id=$1 AND e.session_id=$2 AND e.role='user' AND s.user_id=$3 AND s.novel_id=$4 FOR UPDATE OF s`,
        [input.sourceEventId || 0, session.id, userId, session.novelId],
      )
      if (!source) throw new AiError('invalid', '记忆提议必须引用本对话的作者消息', 422)
      await query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId])
    } else {
      await lock(scoped, userId, session)
    }
    const duplicate = await first<MemoryRow>(
      scoped,
      `${SELECT} WHERE user_id=$1 AND novel_id=$2 AND title=$3 AND content=$4
      AND status=$5 AND COALESCE(supersedes_id,'')=$6`,
      [userId, session.novelId, title, content, proposed ? 'pending' : 'active', input.supersedesId || ''],
    )
    if (duplicate) return mapMemory(duplicate)
    if (proposed || !input.supersedesId) await capacity(scoped, userId, session.novelId, proposed ? 'pending' : 'active')
    let target: MemoryRow | undefined
    if (input.supersedesId) {
      target = await readMemory(scoped, userId, session.novelId, input.supersedesId)
      if (target.status !== 'active') throw new AiError('conflict', '旧记忆已变化，请重新读取后提议', 409)
    }
    const now = Date.now()
    if (target && !proposed) await query("UPDATE ai_agent_memories SET status='superseded',updated_at=$1 WHERE id=$2", [now, target.id])
    const id = newId('amem')
    await query(
      `INSERT INTO ai_agent_memories(id,user_id,novel_id,session_id,title,content,status,source_event_id,supersedes_id,target_revision,revision,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$11)`,
      [
        id,
        userId,
        session.novelId,
        session.id,
        title,
        content,
        proposed ? 'pending' : 'active',
        proposed ? input.sourceEventId : null,
        target?.id || null,
        target?.revision || null,
        now,
      ],
    )
    return mapMemory(await readMemory(scoped, userId, session.novelId, id))
  })
}

export async function changeAgentMemory(
  db: Db,
  userId: string,
  session: AgentSession,
  id: string,
  input: { operation: 'edit' | 'confirm' | 'archive'; expectedRevision: number; title?: unknown; content?: unknown },
) {
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) throw new AiError('invalid', '记忆版本无效，请刷新后重试', 422)
  return withTx(db, async (query) => {
    const scoped = { query }
    await lock(scoped, userId, session)
    const current = await readMemory(scoped, userId, session.novelId, id)
    if ((input.operation === 'confirm' && current.status === 'active') || (input.operation === 'archive' && current.status === 'archived'))
      return mapMemory(current)
    if (current.revision !== input.expectedRevision || !['active', 'pending'].includes(current.status))
      throw new AiError('conflict', '记忆已变化，请刷新后再保存', 409)
    const now = Date.now()
    if (input.operation === 'confirm') {
      if (current.supersedes_id) {
        const target = await readMemory(scoped, userId, session.novelId, current.supersedes_id)
        if (target.status !== 'active' || target.revision !== current.target_revision) throw new AiError('conflict', '要取代的记忆已变化，请重新提出记忆', 409)
        await query("UPDATE ai_agent_memories SET status='superseded',updated_at=$1 WHERE id=$2", [now, target.id])
      } else await capacity(scoped, userId, session.novelId, 'active')
      await query("UPDATE ai_agent_memories SET status='active',revision=revision+1,updated_at=$1 WHERE id=$2", [now, id])
    } else if (input.operation === 'archive') {
      await query("UPDATE ai_agent_memories SET status='archived',revision=revision+1,updated_at=$1 WHERE id=$2", [now, id])
    } else {
      const title = text(input.title, 100, '记忆标题')
      const content = text(input.content, 1000, '记忆内容')
      if (current.status === 'pending')
        await query('UPDATE ai_agent_memories SET title=$1,content=$2,revision=revision+1,updated_at=$3 WHERE id=$4', [title, content, now, id])
      else {
        await query("UPDATE ai_agent_memories SET status='superseded',updated_at=$1 WHERE id=$2", [now, id])
        const nextId = newId('amem')
        await query(
          `INSERT INTO ai_agent_memories(id,user_id,novel_id,session_id,title,content,status,supersedes_id,revision,created_at,updated_at)
          VALUES($1,$2,$3,$4,$5,$6,'active',$7,$8,$9,$9)`,
          [nextId, userId, session.novelId, session.id, title, content, id, current.revision + 1, now],
        )
        return mapMemory(await readMemory(scoped, userId, session.novelId, nextId))
      }
    }
    return mapMemory(await readMemory(scoped, userId, session.novelId, id))
  })
}

export async function saveAgentSummary(db: DbClient, session: AgentSession, throughEventId: number, content: AgentSummaryContent): Promise<AgentSummary> {
  const now = Date.now()
  await db.query(
    `INSERT INTO ai_agent_summaries(session_id,through_event_id,content,revision,updated_at)
    VALUES($1,$2,$3,1,$4) ON CONFLICT(session_id) DO UPDATE SET through_event_id=EXCLUDED.through_event_id,content=EXCLUDED.content,revision=ai_agent_summaries.revision+1,updated_at=EXCLUDED.updated_at
    WHERE ai_agent_summaries.through_event_id < EXCLUDED.through_event_id`,
    [session.id, throughEventId, JSON.stringify(content), now],
  )
  return (await getAgentSummary(db, session.id))!
}

export async function getAgentSummary(db: DbClient, sessionId: string): Promise<AgentSummary | null> {
  const row = await first<{ through_event_id: number; content: AgentSummaryContent; revision: number; updated_at: number }>(
    db,
    'SELECT through_event_id,content,revision,updated_at FROM ai_agent_summaries WHERE session_id=$1',
    [sessionId],
  )
  if (!row) return null
  const content = typeof row.content === 'string' ? (JSON.parse(row.content) as AgentSummaryContent) : row.content
  return { throughEventId: Number(row.through_event_id), content, revision: Number(row.revision), updatedAt: Number(row.updated_at) }
}

export async function agentMemorySource(db: DbClient, userId: string, session: AgentSession, id: string) {
  const memory = await readMemory(db, userId, session.novelId, id)
  if (!memory.source_event_id) return null
  const source = await first<{ id: number; content: string; sessionId: string }>(
    db,
    `SELECT e.id,e.content,e.session_id AS "sessionId" FROM ai_agent_events e
    JOIN ai_agent_sessions s ON s.id=e.session_id WHERE e.id=$1 AND s.user_id=$2 AND s.novel_id=$3`,
    [memory.source_event_id, userId, session.novelId],
  )
  return source ? { ...source, id: Number(source.id) } : null
}
