import { AGENT_OUTLINE_LIMITS, AGENT_OUTLINE_MAX, AGENT_OUTLINE_MIN, type AgentOutline, type AgentOutlineChapter } from '@shared/ai-agent'
import type { Db } from '../../db/pool'
import { first } from '../../db/query'
import { saveChapterPlan } from './agent-chapter-plan'
import { getAgentSession } from './agent-store'
import { AiError } from './client'

function parseOutlineChapters(value: unknown): AgentOutlineChapter[] {
  if (!Array.isArray(value) || value.length < AGENT_OUTLINE_MIN || value.length > AGENT_OUTLINE_MAX)
    throw new AiError('invalid', '请填写 3 至 5 章的安排', 422)
  return value.map(chapter => {
    const fields = {} as AgentOutlineChapter
    for (const key of Object.keys(AGENT_OUTLINE_LIMITS) as Array<keyof AgentOutlineChapter>) {
      const text = chapter?.[key]
      if (typeof text !== 'string' || !text.trim() || text.length > AGENT_OUTLINE_LIMITS[key])
        throw new AiError('invalid', '请逐章填写标题、目标和情节步骤，并检查字段长度', 422)
      fields[key] = text.trim()
    }
    return fields
  })
}

export async function readAgentOutline(db: Db, userId: string, sessionId: string): Promise<AgentOutline | null> {
  const session = await getAgentSession(db, userId, sessionId)
  return await first<AgentOutline>(db, 'SELECT revision,chapters FROM ai_agent_outlines WHERE user_id=$1 AND novel_id=$2',
    [userId, session.novelId]) ?? null
}

export async function saveAgentOutline(db: Db, userId: string, sessionId: string, body: Record<string, unknown>) {
  const { expectedRevision, chapters } = body
  if (typeof expectedRevision !== 'number' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= 2147483647)
    throw new AiError('invalid', '请提供当前大纲版本', 422)
  const content = parseOutlineChapters(chapters)
  const session = await getAgentSession(db, userId, sessionId)
  const params = [userId, session.novelId, JSON.stringify(content)]
  const saved = expectedRevision === 0
    ? await first<AgentOutline>(db, `INSERT INTO ai_agent_outlines(user_id,novel_id,revision,chapters)
         VALUES($1,$2,1,$3::jsonb) ON CONFLICT(user_id,novel_id) DO NOTHING RETURNING revision,chapters`, params)
    : await first<AgentOutline>(db, `UPDATE ai_agent_outlines SET chapters=$3::jsonb,revision=revision+1
         WHERE user_id=$1 AND novel_id=$2 AND revision=$4 RETURNING revision,chapters`, [...params, expectedRevision])
  if (!saved) throw new AiError('conflict', '这本书的大纲已变化，请重新读取后保存', 409)
  return saved
}

export async function applyAgentOutlineChapter(db: Db, userId: string, sessionId: string, body: Record<string, unknown>) {
  const { index, expectedOutlineRevision, expectedPlanRevision } = body
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= AGENT_OUTLINE_MAX ||
      typeof expectedOutlineRevision !== 'number' || !Number.isInteger(expectedOutlineRevision) || expectedOutlineRevision < 1)
    throw new AiError('invalid', '请指定当前大纲中的一章', 422)
  const outline = await readAgentOutline(db, userId, sessionId)
  if (!outline || outline.revision !== expectedOutlineRevision)
    throw new AiError('conflict', '大纲已变化，请重新读取后选择章节', 409)
  const chapter = outline.chapters[index]
  if (!chapter) throw new AiError('invalid', '当前大纲中没有这一章', 422)
  const later = outline.chapters.slice(index + 1).map(item => `《${item.title}》：${item.goal}`)
  const constraints = later.length ? '以下目标安排在后章，本章只按自己的目标和情节推进，不提前完成：\n' + later.join('\n') : ''
  return saveChapterPlan(db, userId, sessionId, { ...chapter, characters: '', ending: '', targetWords: 2000, constraints }, expectedPlanRevision)
}
