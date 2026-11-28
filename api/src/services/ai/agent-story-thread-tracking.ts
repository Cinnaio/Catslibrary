import type { AgentSession, AgentStoryThreadPlan, AgentStoryThreadProgress } from '@shared/ai-agent'
import type { Db, DbClient } from '../../db/pool'
import { all, first } from '../../db/query'
import { newId } from '../auth'
import { AiError } from './client'
import { chapterEvidence, findAgentChapter, scopedEditableChapter } from './agent-retrieval'

export function validateThreadTracking(body: Record<string, unknown>) {
  if (body.refreshSource !== undefined && typeof body.refreshSource !== 'boolean') throw new AiError('invalid', '请明确确认是否更新线索来源', 422)
  const target = body.targetChapterNumber
  if (target !== undefined && target !== null && (!Number.isSafeInteger(target) || Number(target) < 1 || Number(target) > 100000))
    throw new AiError('invalid', '计划目录位置须为 1 至 100000 的整数，或留空', 422)
  if (body.targetStage !== undefined && (typeof body.targetStage !== 'string' || body.targetStage.length > 200))
    throw new AiError('invalid', '计划剧情阶段最多 200 字', 422)
  if (body.progressRecord !== undefined) {
    const record = body.progressRecord as Record<string, unknown> | null
    if (!record || typeof record !== 'object' || Array.isArray(record) || !Number.isSafeInteger(record.chapterNumber) ||
      Number(record.chapterNumber) < 1 || Number(record.chapterNumber) > 100000 ||
      typeof record.quote !== 'string' || !record.quote.trim() || record.quote.length > 500 ||
      typeof record.note !== 'string' || !record.note.trim() || record.note.length > 1200)
      throw new AiError('invalid', '推进记录需要目录位置、最多 500 字的连续原文和最多 1200 字的进展说明', 422)
  }
}

export async function buildThreadTracking(db: DbClient, session: AgentSession, body: Record<string, unknown>, previous?: AgentStoryThreadPlan | null) {
  const targetChapterNumber = body.targetChapterNumber === undefined ? previous?.targetChapterNumber ?? null : body.targetChapterNumber as number | null
  const targetStage = body.targetStage === undefined ? previous?.targetStage || '' : String(body.targetStage).trim()
  const progress = [...(previous?.progress || [])]
  if (body.progressRecord !== undefined) {
    if (progress.length >= 40) throw new AiError('invalid', '每条线索最多保留 40 条推进记录', 422)
    const record = body.progressRecord as { chapterNumber: number; quote: string; note: string }
    const result = await findAgentChapter(db as Db, session, record.chapterNumber, '', undefined, true)
    if (!result.matches[0]) throw new AiError('invalid', '记录章节不存在或超出当前对话范围', 404)
    const chapter = await scopedEditableChapter(db, session, result.matches[0].id, true)
    if (!chapter.content.includes(record.quote)) throw new AiError('conflict', '摘录与当前正文不匹配，请回读原文后重新复制连续的一段', 409)
    progress.push({ id: newId('atp'), chapterId: chapter.id, chapterTitle: chapter.title, chapterNumber: record.chapterNumber,
      chapterRevision: chapterEvidence(session, chapter).revision, quote: record.quote, note: record.note.trim(),
      kind: body.disposition === 'partial' ? 'partial' : body.disposition === 'resolved' ? 'resolved' : 'advance', recordedAt: Date.now() })
  }
  return { targetChapterNumber, targetStage, progress }
}

/** Reminder position follows the selected anchor, never the newest chapter in the book. */
export async function readThreadTracking(db: DbClient, session: AgentSession, plans: AgentStoryThreadPlan[]) {
  const anchor = session.afterChapterId ? await first<{ ordinal: number }>(db,
    `SELECT COUNT(*)::int AS ordinal FROM chapters c JOIN chapters anchor ON anchor.id=$2 AND anchor.novel_id=$1
     WHERE c.novel_id=$1 AND (c.sort_order,c.id)<=(anchor.sort_order,anchor.id)`, [session.novelId, session.afterChapterId]) : null
  const currentChapterNumber = session.afterChapterId ? (anchor?.ordinal ? anchor.ordinal + 1 : undefined) : 1
  const ids = [...new Set(plans.flatMap(plan => (plan.progress || []).map(record => record.chapterId)))]
  const sources = ids.length ? await all<{ id: string; title: string; content: string; sort_order: number; visible: boolean }>(db,
    `SELECT c.id,c.title,c.content,c.sort_order,
       (EXISTS(SELECT 1 FROM chapters a WHERE a.id=$3 AND a.novel_id=c.novel_id AND (c.sort_order,c.id)<=(a.sort_order,a.id))
        OR EXISTS(SELECT 1 FROM ai_agent_artifacts a WHERE a.session_id=$2 AND a.task_id=c.ai_task_id)) AS visible
     FROM chapters c WHERE c.novel_id=$1 AND c.id=ANY($4::text[])`, [session.novelId, session.id, session.afterChapterId, ids]) : []
  const byId = new Map(sources.map(source => [source.id, source]))
  return { currentChapterNumber, plans: plans.map(plan => {
    const progress: AgentStoryThreadProgress[] = []
    for (const record of plan.progress || []) {
      const chapter = byId.get(record.chapterId)
      if (chapter?.visible) {
        const currentChapterRevision = chapterEvidence(session, chapter).revision
        progress.push({ ...record, currentChapterRevision, sourceChanged: record.chapterRevision !== currentChapterRevision })
      }
    }
    const target = plan.targetChapterNumber
    const reminder = currentChapterNumber && target && plan.disposition !== 'resolved' && plan.disposition !== 'hold'
      ? target === currentChapterNumber ? 'due' as const : target < currentChapterNumber ? 'overdue' as const : undefined : undefined
    return { ...plan, progress, hiddenProgressCount: (plan.progress?.length || 0) - progress.length, reminder }
  }) }
}
