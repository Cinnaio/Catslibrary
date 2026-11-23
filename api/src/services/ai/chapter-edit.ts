import { resolveRewriteSelection } from './rewrite-selection'
import type { AgentActionKind, AgentChapterEditSource, AgentChapterHistory, AgentSession } from '@shared/ai-agent'
import type { Db, DbClient } from '../../db/pool'
import { all, first, withTx } from '../../db/query'
import { newId } from '../auth'
import { AiError } from './client'
import { chapterEvidence, scopedEditableChapter } from './agent-retrieval'
import { appendAgentEvent, requireAgentArtifact, type AgentActionRow } from './agent-store'
import { buildTextRewriteTaskParams, validateRewriteSelection, type TextRewriteTaskParams } from './rewrite'

export interface EditableChapter { id: string; title: string; content: string; sort_order: number }
export interface ChapterEditParams extends TextRewriteTaskParams { chapterId: string; chapterTitle: string }

export const chapterRevision = (session: AgentSession, chapter: EditableChapter) => chapterEvidence(session, chapter).revision
export async function chapterEditSource(db: DbClient, session: AgentSession, chapterId: string): Promise<AgentChapterEditSource> {
  const row = await scopedEditableChapter(db, session, chapterId)
  return { id: row.id, title: row.title, content: row.content, revision: chapterRevision(session, row) }
}

export function buildChapterEditParams(session: AgentSession, chapter: EditableChapter, body: Record<string, unknown>): ChapterEditParams {
  if (body.baseRevision !== chapterRevision(session, chapter)) throw new AiError('conflict', '章节已变化，请重新读取原文后生成建议', 409)
  const validated = validateRewriteSelection(chapter.content, {
    baseRevision: String(body.baseRevision), startUTF16: body.startUTF16 as number, endUTF16: body.endUTF16 as number,
    selectedText: body.selectedText as string, mode: 'custom', instruction: body.instruction as string,
  })
  if (!validated.value) throw new AiError('invalid', validated.error || '选段无效', 422)
  return { ...buildTextRewriteTaskParams(chapter.content, validated.value), chapterId: chapter.id, chapterTitle: chapter.title }
}
export function parseChapterEdit(params: string, result: string) {
  try {
    const p = JSON.parse(params) as ChapterEditParams
    const r = JSON.parse(result) as { version?: unknown; suggestion?: unknown }
    if (r.version !== 1 || p.version !== 1 || typeof p.chapterId !== 'string' || typeof p.chapterTitle !== 'string' || typeof p.baseContent !== 'string' ||
      !validateRewriteSelection(p.baseContent, p).value || typeof r.suggestion !== 'string' || !r.suggestion.trim() || Array.from(r.suggestion).length > 12000) return undefined
    return { params: p, suggestion: r.suggestion }
  } catch { return undefined }
}

export async function recentChapterEditSuggestions(db: DbClient, session: AgentSession) {
  const rows = await all<{ id: string; status: string; params: string }>(db,
    `SELECT t.id,t.status,t.params FROM ai_agent_artifacts a JOIN ai_tasks t ON t.id=a.task_id
     WHERE a.session_id=$1 AND t.novel_id=$2 AND t.kind='chapter_edit'
     ORDER BY a.created_at DESC,t.id DESC LIMIT 8`, [session.id, session.novelId])
  return rows.flatMap(row => {
    try {
      const p = JSON.parse(row.params) as Partial<ChapterEditParams>
      if (!p?.chapterId || !p.chapterTitle) return []
      return [{ taskId: row.id, status: row.status, chapterId: p.chapterId, chapterTitle: p.chapterTitle,
        instruction: p.instruction?.slice(0, 300), previousTaskId: p.previousTaskId }]
    } catch { return [] }
  })
}

export async function chapterEditHistory(db: DbClient, session: AgentSession, chapterId: string, offset = 0) {
  const chapter = await scopedEditableChapter(db, session, chapterId)
  const rows = await all<{ id: string; chapter_title: string; kind: string; created_at: number; after_revision: string }>(db,
    'SELECT id,chapter_title,kind,created_at,after_revision FROM ai_chapter_edit_history WHERE chapter_id=$1 AND novel_id=$2 ORDER BY created_at DESC,id DESC LIMIT 21 OFFSET $3',
    [chapterId, session.novelId, offset])
  const revision = chapterRevision(session, chapter)
  const history: AgentChapterHistory[] = rows.slice(0, 20).map(row => ({ id: row.id, chapterTitle: row.chapter_title, kind: row.kind,
    createdAt: Number(row.created_at), canRestore: row.after_revision === revision }))
  return { history, hasMore: rows.length > 20 }
}

export async function prepareChapterAction(db: Db, session: AgentSession, kind: Extract<AgentActionKind, 'apply_chapter_edit' | 'restore_chapter'>, targetId: string, selection?: unknown) {
  let selected: ReturnType<typeof resolveRewriteSelection> | undefined
  let chapter: EditableChapter
  let after: string
  let beforePreview: string
  let afterPreview: string
  let baseRevision: string
  if (kind === 'apply_chapter_edit') {
    const task = await requireAgentArtifact(db, session.id, targetId)
    const edit = parseChapterEdit(task.params || '{}', task.result)
    if (task.novelId !== session.novelId || task.kind !== 'chapter_edit' || task.status !== 'completed' || !edit)
      throw new AiError('invalid', '章节改写建议尚未完成或已失效', 409)
    chapter = await scopedEditableChapter(db, session, edit.params.chapterId)
    baseRevision = edit.params.baseRevision
    beforePreview = edit.params.selectedText
    selected = resolveRewriteSelection(beforePreview, edit.suggestion, selection)
    afterPreview = selected.text
    after = edit.params.baseContent.slice(0, edit.params.startUTF16) + afterPreview + edit.params.baseContent.slice(edit.params.endUTF16)
  } else {
    // History IDs survive conversation deletion. Completed action IDs also work as a shortcut.
    const previous = await first<{ chapter_id: string; before_content: string; after_revision: string }>(db,
      'SELECT chapter_id,before_content,after_revision FROM ai_chapter_edit_history WHERE novel_id=$1 AND (id=$2 OR action_id=$2)', [session.novelId, targetId])
    if (!previous) throw new AiError('invalid', '没有可恢复的章节版本', 404)
    chapter = await scopedEditableChapter(db, session, previous.chapter_id)
    baseRevision = previous.after_revision
    after = previous.before_content
    beforePreview = chapter.content
    afterPreview = after
  }
  if (chapterRevision(session, chapter) !== baseRevision) throw new AiError('conflict', '章节已被再次编辑，请核对最新原文；本次操作不会覆盖它', 409)
  if (chapter.content === after) throw new AiError('invalid', '建议与当前章节相同，无需保存', 422)
  const label = kind === 'apply_chapter_edit' ? '保存改写到原章节' : '恢复修改前的章节'
  return {
    payload: { chapterId: chapter.id, baseRevision, before: chapter.content, after,
      ...(selected ? { taskId: targetId, selection: selected.selection } : {}) },
    label: label + '「' + chapter.title + '」',
    preview: { description: '将直接更新「' + session.novelTitle + '」中的「' + chapter.title + '」。确认后读者将看到新正文，修改前的版本会保留。' +
      (selected ? `采用 ${selected.selection.acceptedChanges.length} / ${selected.total} 处改动，未选处保留原文。` : ''),
      ...(selected ? { sourceTaskId: targetId, selection: selected.selection } : {}),
      chapterId: chapter.id, chapterTitle: chapter.title, before: beforePreview, after: afterPreview },
  }
}

/** Content, durable history, action receipt and event commit together. */
export async function confirmChapterAction(db: Db, session: AgentSession, action: AgentActionRow) {
  await withTx(db, async query => {
    const tx = { query }
    const owner = await first<{ user_id: string }>(tx, 'SELECT user_id FROM ai_agent_sessions WHERE id=$1 FOR UPDATE', [session.id])
    if (!owner) throw new AiError('invalid', '对话已删除', 404)
    const current = await first<AgentActionRow>(tx, 'SELECT * FROM ai_agent_actions WHERE id=$1 AND session_id=$2 FOR UPDATE', [action.id, session.id])
    if (current?.status === 'completed') return
    if (!current || current.status !== 'executing') throw new AiError('conflict', '操作状态已变化，请刷新', 409)
    const p = current.payload
    const chapter = await scopedEditableChapter(tx, session, String(p.chapterId), true)
    if (typeof p.after !== 'string' || chapter.content !== p.before || chapterRevision(session, chapter) !== p.baseRevision)
      throw new AiError('conflict', '章节已变化，请重新预览；未覆盖当前正文', 409)
    const revision = chapterRevision(session, { ...chapter, content: p.after })
    const historyId = newId('chapteredit')
    const now = Date.now()
    await query('INSERT INTO ai_chapter_edit_history(id,chapter_id,novel_id,actor_user_id,action_id,kind,chapter_title,before_content,after_content,before_revision,after_revision,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
      [historyId, chapter.id, session.novelId, owner.user_id, action.id, action.kind, chapter.title, chapter.content, p.after, p.baseRevision, revision, now])
    await query('UPDATE chapters SET content=$1,word_count=$2 WHERE id=$3 AND novel_id=$4', [p.after, p.after.replace(/<[^>]*>/g, '').length, chapter.id, session.novelId])
    await query('UPDATE novels SET updated_at=$1 WHERE id=$2', [now, session.novelId])
    await query("UPDATE ai_agent_actions SET status='completed',result=$1,error='',updated_at=$2 WHERE id=$3", [JSON.stringify({ chapterId: chapter.id, historyId, revision }), now, action.id])
    await appendAgentEvent(tx, session.id, 'activity', '已完成：' + action.title, '', { actionId: action.id })
  })
}
