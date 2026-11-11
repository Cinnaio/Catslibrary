import type { AgentActionKind, AgentArtifact, AgentSession } from '@shared/ai-agent'
import { ANALYSIS_KINDS, type AnalysisKind } from '@shared/novel-analysis'
import type { Db } from '../../db/pool'
import { all, first, run, withTx } from '../../db/query'
import { newId } from '../auth'
import { getCurrentCoverState } from '../covers'
import { AiError } from './client'
import { generationContentRevision, getGeneration, listTaskGenerations, type GenerationRow } from './generations'
import { parseRewriteSuggestion, parseRewriteTaskParams } from './rewrite'
import { appendAgentEvent, publicAgentAction, requireAgentArtifact, type AgentActionRow } from './agent-store'

/** This adapter dispatches fixed, server-selected routes through the application's middleware. */
export type AgentApi = (path: string, method?: string, body?: unknown) => Promise<Record<string, unknown>>

export async function scopedAgentDraft(db: Db, session: AgentSession, id: string) {
  const draft = await getGeneration(db, id)
  if (!draft || draft.deleted_at || draft.novel_id !== session.novelId || !['continue', 'write_chapter', 'write_outline'].includes(draft.kind))
    throw new AiError('invalid', '该草稿不属于当前小说或已删除', 404)
  return draft
}

export function agentDraftTitle(draft: Pick<GenerationRow, 'params_json' | 'result'>): string {
  try {
    const p = JSON.parse(draft.params_json)
    if (typeof p.draftTitle === 'string' && p.draftTitle.trim()) return p.draftTitle
  } catch {
    /* Legacy drafts may not carry structured parameters. */
  }
  return draft.result.match(/^标题[：:]\s*(.+)/)?.[1]?.trim() || '未命名章节'
}

export async function readAgentArtifact(db: Db, session: AgentSession, taskId: string): Promise<AgentArtifact> {
  const task = await requireAgentArtifact(db, session.id, taskId)
  if (task.novelId !== session.novelId) throw new AiError('invalid', '任务小说不匹配', 409)
  const result: AgentArtifact = {
    task: { id: task.id, kind: task.kind, status: task.status, step: task.step, current: task.current, total: task.total, error: task.error, updatedAt: task.updatedAt, result: task.result },
    drafts: [],
    covers: [],
  }
  if (['continue', 'write_chapter', 'write_outline'].includes(task.kind)) {
    const drafts = await listTaskGenerations(db, task.id, session.novelId)
    for (const item of drafts) {
      const draft = await scopedAgentDraft(db, session, item.id).catch(() => null)
      if (draft)
        result.drafts.push({
          id: draft.id,
          title: agentDraftTitle(draft),
          content: draft.result,
          status: draft.status,
          revision: generationContentRevision(draft.result),
        })
    }
  }
  if (task.kind === 'cover') {
    result.covers = (
      await all<{ id: string; prompt: string }>(db, 'SELECT id,prompt FROM ai_cover_candidates WHERE task_id=$1 AND novel_id=$2 ORDER BY created_at DESC', [
        taskId,
        session.novelId,
      ])
    ).map((row) => ({ ...row, imageUrl: `/api/ai/agent/sessions/${encodeURIComponent(session.id)}/covers/${encodeURIComponent(row.id)}` }))
  }
  if (task.kind === 'rewrite_selection' && task.status === 'completed') {
    const params = parseRewriteTaskParams(JSON.parse(task.params || '{}'))
    const suggestion = params ? parseRewriteSuggestion(task.result, params) : undefined
    if (params && suggestion)
      result.rewrite = { draftId: params.draftId, before: params.selectedText, after: suggestion.suggestion, baseRevision: params.baseRevision }
  }
  if (task.kind === 'novel_analysis') {
    const report = await first<{ id: string; kind: AnalysisKind }>(db,
      "SELECT id,request_json->>'kind' AS kind FROM novel_analysis_reports WHERE novel_id=$1 AND task_id=$2", [session.novelId, taskId])
    if (report) result.analysisReport = { id: report.id, title: ANALYSIS_KINDS[report.kind],
      url: `/admin/ai?sub=analysis&novel=${encodeURIComponent(session.novelId)}&report=${encodeURIComponent(report.id)}` }
  }
  return result
}

export async function prepareAgentAction(db: Db, session: AgentSession, kind: AgentActionKind, targetId: string, title = '') {
  let payload: Record<string, unknown>
  let preview: AgentActionRow['preview']
  let label: string
  if (kind === 'apply_rewrite') {
    const task = await requireAgentArtifact(db, session.id, targetId)
    if (task.novelId !== session.novelId || task.kind !== 'rewrite_selection' || task.status !== 'completed')
      throw new AiError('invalid', '改写建议尚未完成', 409)
    const params = parseRewriteTaskParams(JSON.parse(task.params || '{}'))
    const suggestion = params ? parseRewriteSuggestion(task.result, params) : undefined
    if (!params || !suggestion) throw new AiError('invalid', '改写结果无效', 422)
    const draft = await scopedAgentDraft(db, session, params.draftId)
    if (draft.status !== 'draft' || generationContentRevision(draft.result) !== params.baseRevision)
      throw new AiError('conflict', '草稿已经变化，请基于当前版本重新改写', 409)
    const after = draft.result.slice(0, params.startUTF16) + suggestion.suggestion + draft.result.slice(params.endUTF16)
    payload = { draftId: draft.id, taskId: task.id, baseRevision: params.baseRevision, before: draft.result, after }
    label = '采纳改写到草稿'
    preview = {
      description: '仅替换这个草稿中已选的段落，原版本保留在本次记录中。',
      draftId: draft.id,
      before: params.selectedText,
      after: suggestion.suggestion,
    }
  } else if (kind === 'publish_draft') {
    const draft = await scopedAgentDraft(db, session, targetId)
    if (draft.status !== 'draft' || !['continue', 'write_chapter'].includes(draft.kind)) throw new AiError('conflict', '该内容不是可发布的章节草稿', 409)
    const chapterTitle = title.trim() || agentDraftTitle(draft)
    if (!chapterTitle || chapterTitle === '未命名章节' || chapterTitle.length > 200) throw new AiError('invalid', '发布前请提供有效章节标题', 422)
    payload = { draftId: draft.id, baseRevision: generationContentRevision(draft.result), title: chapterTitle, after: draft.result }
    label = `发布「${chapterTitle}」`
    preview = { description: `将此草稿作为「${session.novelTitle}」的新章节追加发布。`, draftId: draft.id, after: draft.result }
  } else if (kind === 'adopt_cover') {
    const candidate = await first<{ id: string; prompt: string }>(db, 'SELECT id,prompt FROM ai_cover_candidates WHERE id=$1 AND novel_id=$2', [
      targetId,
      session.novelId,
    ])
    if (!candidate) throw new AiError('invalid', '封面候选不存在或不属于当前小说', 404)
    const state = await getCurrentCoverState(db, session.novelId)
    if (!state) throw new AiError('invalid', '无法读取当前封面版本', 409)
    payload = { candidateId: candidate.id, expectedCoverVersion: state.version }
    label = '设为当前封面'
    preview = { description: `替换「${session.novelTitle}」的当前封面，旧封面按现有机制保留历史。`, candidateId: candidate.id }
  } else if (kind === 'restore_draft') {
    const previous = await first<AgentActionRow>(
      db,
      "SELECT * FROM ai_agent_actions WHERE id=$1 AND session_id=$2 AND status='completed' AND kind IN ('apply_rewrite','restore_draft')",
      [targetId, session.id],
    )
    if (!previous || typeof previous.payload.before !== 'string' || typeof previous.payload.after !== 'string')
      throw new AiError('invalid', '没有可恢复的草稿版本', 404)
    const draft = await scopedAgentDraft(db, session, String(previous.payload.draftId))
    if (draft.status !== 'draft' || generationContentRevision(draft.result) !== generationContentRevision(previous.payload.after))
      throw new AiError('conflict', '草稿已经再次修改或发布，不能覆盖当前版本', 409)
    payload = { draftId: draft.id, baseRevision: generationContentRevision(draft.result), before: draft.result, after: previous.payload.before }
    label = '恢复上一次草稿版本'
    preview = { description: '恢复到这次修改之前；如果草稿已经变化，操作会停止。', draftId: draft.id, before: draft.result, after: previous.payload.before }
  } else throw new AiError('invalid', '不支持的采纳操作', 422)
  const same = await first<AgentActionRow>(
    db,
    "SELECT * FROM ai_agent_actions WHERE session_id=$1 AND kind=$2 AND payload=$3::jsonb AND status IN ('pending','executing') ORDER BY created_at DESC LIMIT 1",
    [session.id, kind, JSON.stringify(payload)],
  )
  if (same) return publicAgentAction(same)
  const id = newId('agentaction')
  const now = Date.now()
  await run(db, 'INSERT INTO ai_agent_actions(id,session_id,kind,title,payload,preview,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$7)', [
    id,
    session.id,
    kind,
    label,
    JSON.stringify(payload),
    JSON.stringify(preview),
    now,
  ])
  await appendAgentEvent(db, session.id, 'activity', `待确认：${label}`, '', { actionId: id })
  return publicAgentAction((await first<AgentActionRow>(db, 'SELECT * FROM ai_agent_actions WHERE id=$1', [id]))!)
}

/** Confirmation consumes only the saved proposal; client/model payloads cannot replace it. */
export async function confirmAgentAction(db: Db, session: AgentSession, id: string, call: AgentApi) {
  const action = await withTx(db, async (query) => {
    const scoped = { query }
    await query('SELECT id FROM ai_agent_sessions WHERE id=$1 FOR UPDATE', [session.id])
    const action = await first<AgentActionRow>(scoped, 'SELECT * FROM ai_agent_actions WHERE id=$1 AND session_id=$2', [id, session.id])
    if (!action) throw new AiError('invalid', '操作不存在', 404)
    if (action.status === 'completed') return action
    const now = Date.now()
    const claimed = await run(scoped,
      `UPDATE ai_agent_actions SET status='executing',lease_until=$1,updated_at=$2 WHERE id=$3 AND
      (status='pending' OR (status='executing' AND lease_until<$2))`,
      [now + 120_000, now, id],
    )
    if (!claimed) throw new AiError('conflict', '操作已处理或正在执行，请刷新查看', 409)
    return action
  })
  if (action.status === 'completed') return publicAgentAction(action)
  const p = action.payload
  try {
    let result: Record<string, unknown> = {}
    if (action.kind === 'apply_rewrite') {
      result = await call(`/api/ai/writing/drafts/${encodeURIComponent(String(p.draftId))}/rewrite/${encodeURIComponent(String(p.taskId))}/apply`, 'POST', {
        baseRevision: p.baseRevision,
        operationId: id,
      })
    } else if (action.kind === 'publish_draft') {
      const draft = await scopedAgentDraft(db, session, String(p.draftId))
      // A lost response can be reconciled without publishing a second chapter.
      if (draft.status === 'published' && draft.chapter_id && generationContentRevision(draft.result) === p.baseRevision)
        result = { chapterId: draft.chapter_id, alreadyPublished: true }
      else
        result = await call(`/api/ai/writing/drafts/${encodeURIComponent(draft.id)}/publish`, 'POST', {
          novelId: session.novelId,
          title: p.title,
          expectedContentRevision: p.baseRevision,
        })
    } else if (action.kind === 'adopt_cover') {
      result = await call(`/api/ai/cover/candidates/${encodeURIComponent(String(p.candidateId))}/adopt`, 'POST', {
        expectedCoverVersion: p.expectedCoverVersion,
        operationId: id,
      })
    } else {
      await withTx(db, async (query) => {
        await query('SELECT id FROM ai_agent_sessions WHERE id=$1 FOR UPDATE', [session.id])
        const row = (await query<GenerationRow>('SELECT * FROM ai_generations WHERE id=$1 AND novel_id=$2 FOR UPDATE', [p.draftId, session.novelId])).rows[0]
        if (!row || row.deleted_at || row.status !== 'draft' || generationContentRevision(row.result) !== p.baseRevision)
          throw new AiError('conflict', '草稿已变化，请重新检查恢复范围', 409)
        await query("UPDATE ai_generations SET result=$1 WHERE id=$2 AND status='draft'", [p.after, row.id])
        const restored = { draftId: row.id, revision: generationContentRevision(String(p.after)) }
        await query("UPDATE ai_agent_actions SET status='completed',result=$1,error='',updated_at=$2 WHERE id=$3", [JSON.stringify(restored), Date.now(), id])
        await appendAgentEvent({ query }, session.id, 'activity', `已完成：${action.title}`, '', { actionId: id })
      })
      return { ...publicAgentAction(action), status: 'completed' as const, error: '' }
    }
    await withTx(db, async (query) => {
      await query('SELECT id FROM ai_agent_sessions WHERE id=$1 FOR UPDATE', [session.id])
      await query("UPDATE ai_agent_actions SET status='completed',result=$1,error='',updated_at=$2 WHERE id=$3", [JSON.stringify(result), Date.now(), id])
      await appendAgentEvent({ query }, session.id, 'activity', `已完成：${action.title}`, '', { actionId: id })
    })
    return { ...publicAgentAction(action), status: 'completed' as const, error: '' }
  } catch (error) {
    const message = error instanceof AiError ? error.message : '操作失败，请核对当前内容后重新预览'
    await run(db, "UPDATE ai_agent_actions SET status='failed',error=$1,updated_at=$2 WHERE id=$3", [message, Date.now(), id])
    throw error
  }
}
