import type { AnalysisNote, AnalysisReport, AnalysisReportSummary, AnalysisRequest, AnalysisSource } from '@shared/novel-analysis'
import { ANALYSIS_KINDS } from '@shared/novel-analysis'
import type { Db, DbClient } from '../../db/pool'
import { all, first, run, withTx } from '../../db/query'
import { newId } from '../auth'
import { AiError } from './client'
import { createAiTask, getAiTask, cancelAiTask } from './tasks'
import { analysisHash, analysisSourcesChanged, captureAnalysisSources, parseAnalysisRequest } from './novel-analysis-source'

export interface AnalysisRow {
  id: string; novel_id: string; user_id: string; request_id: string; request_json: AnalysisRequest
  source_json: AnalysisSource[]; notes_json: AnalysisNote[]; synthesis_json: AnalysisNote[] | null
  checked_source_ids: string[]; content: string; edited_content: string | null; revision: number
  task_id: string; created_at: number; updated_at: number
}
export async function requireAnalysis(db: DbClient, novelId: string, id: string) {
  const row = await first<AnalysisRow>(db, 'SELECT * FROM novel_analysis_reports WHERE id=$1 AND novel_id=$2', [id, novelId])
  if (!row) throw new AiError('invalid', '分析报告不存在或不属于本书', 404)
  return row
}
export async function createAnalysis(db: Db, userId: string, novelId: string, value: unknown, requestId: string) {
  const request = parseAnalysisRequest(value)
  if (!/^[a-zA-Z0-9_-]{8,160}$/u.test(requestId)) throw new AiError('invalid', '分析请求标识无效', 422)
  return withTx(db, async query => {
    const tx = { query }
    // Serialize lost-response retries and submissions for the same account.
    await query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId])
    const old = await first<AnalysisRow>(tx, 'SELECT * FROM novel_analysis_reports WHERE user_id=$1 AND request_id=$2', [userId, requestId])
    if (old) {
      if (old.novel_id !== novelId || analysisHash(parseAnalysisRequest(old.request_json)) !== analysisHash(request))
        throw new AiError('conflict', '同一请求标识不能更换作品、范围或分析要求', 409)
      return { reportId: old.id, taskId: old.task_id, created: false }
    }
    if (!await first(tx, 'SELECT id FROM novels WHERE id=$1 FOR UPDATE', [novelId])) throw new AiError('invalid', '小说不存在', 404)
    const active = await first(tx, "SELECT id FROM ai_tasks WHERE novel_id=$1 AND kind='novel_analysis' AND status IN ('queued','running')", [novelId])
    if (active) throw new AiError('conflict', '本书已有分析进行中，请先等待或停止', 409)
    const sources = await captureAnalysisSources(tx, novelId, request)
    const id = newId('analysis')
    const task = await createAiTask(tx, { userId, novelId, kind: 'novel_analysis', total: sources.length,
      prompt: `${ANALYSIS_KINDS[request.kind]}：${request.question || '按正文梳理并提供依据'}`, params: JSON.stringify({ reportId: id, version: 1 }) })
    const now = Date.now()
    await run(tx, `INSERT INTO novel_analysis_reports(id,novel_id,user_id,request_id,request_json,source_json,task_id,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$8)`, [id, novelId, userId, requestId, JSON.stringify(request), JSON.stringify(sources), task.id, now])
    return { reportId: id, taskId: task.id, created: true }
  })
}

function summary(row: AnalysisRow, task?: { status: string; step: string; error: string }): AnalysisReportSummary {
  return { id: row.id, novelId: row.novel_id, request: row.request_json, taskId: row.task_id,
    status: (task?.status || (row.content ? 'completed' : 'interrupted')) as AnalysisReportSummary['status'],
    step: task?.step || '', error: task?.error || '', processed: row.content ? row.source_json.length : new Set(row.notes_json.flatMap(note => note.sourceIds)).size, total: row.source_json.length,
    chapterCount: new Set(row.source_json.map(source => source.chapterId)).size, revision: Number(row.revision),
    edited: row.edited_content !== null, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) }
}
export async function readAnalysis(db: Db, novelId: string, id: string): Promise<AnalysisReport> {
  const row = await requireAnalysis(db, novelId, id)
  const task = await getAiTask(db, row.task_id)
  return { ...summary(row, task), content: row.edited_content ?? row.content, originalContent: row.content,
    sourceChanged: await analysisSourcesChanged(db, novelId, row.request_json, row.source_json),
    sources: row.source_json.map(({ text: _text, ...source }) => source), notes: row.notes_json, checkedSourceIds: row.checked_source_ids }
}
export async function listAnalyses(db: Db, novelId: string, offset = 0) {
  // Project only source metadata, avoiding large text snapshots in list reads.
  const rows = await all<AnalysisRow & { status: string; step: string; error: string }>(db, `SELECT r.id,r.novel_id,r.request_json,r.task_id,r.revision,
    r.created_at,r.updated_at,CASE WHEN r.edited_content IS NULL THEN NULL ELSE '' END AS edited_content,
    CASE WHEN r.content='' THEN '' ELSE 'saved' END AS content,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('chapterId',s->>'chapterId')) FROM jsonb_array_elements(r.source_json) s),'[]') AS source_json,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('sourceIds',n->'sourceIds')) FROM jsonb_array_elements(r.notes_json) n),'[]') AS notes_json,
    t.status,t.step,t.error FROM novel_analysis_reports r LEFT JOIN ai_tasks t ON t.id=r.task_id
    WHERE r.novel_id=$1 ORDER BY r.created_at DESC,r.id DESC LIMIT 21 OFFSET $2`, [novelId, offset])
  return { reports: rows.slice(0, 20).map(row => summary(row, row.status ? row : undefined)), hasMore: rows.length > 20 }
}
export async function editAnalysis(db: Db, novelId: string, id: string, content: unknown, expectedRevision: unknown) {
  if (typeof content !== 'string' || !content.trim() || content.length > 50_000 || !Number.isSafeInteger(expectedRevision))
    throw new AiError('invalid', '报告需为 1–50000 字，并携带当前版本', 422)
  const row = await requireAnalysis(db, novelId, id)
  if (!row.content) throw new AiError('conflict', '请等待报告完成后修订', 409)
  if (!await run(db, `UPDATE novel_analysis_reports SET edited_content=$1,revision=revision+1,updated_at=$2
    WHERE id=$3 AND novel_id=$4 AND revision=$5 AND content<>''`, [content.trim(), Date.now(), id, novelId, expectedRevision]))
    throw new AiError('conflict', '报告已被修改，请重新读取后保存', 409)
}
export async function stopAnalysis(db: Db, novelId: string, id: string) {
  const row = await requireAnalysis(db, novelId, id)
  await cancelAiTask(db, row.task_id)
}
export async function resumeAnalysis(db: Db, userId: string, novelId: string, id: string) {
  return withTx(db, async query => {
    const tx = { query }
    await query('SELECT id FROM novels WHERE id=$1 FOR UPDATE', [novelId])
    let row = await requireAnalysis(tx, novelId, id)
    const task = await first<{ status: string }>(tx, 'SELECT status FROM ai_tasks WHERE id=$1 FOR UPDATE', [row.task_id])
    // Same task -> report lock order as worker checkpoints.
    await query('SELECT id FROM novel_analysis_reports WHERE id=$1 FOR UPDATE', [id])
    row = await requireAnalysis(tx, novelId, id)
    if (task && ['queued', 'running'].includes(task.status)) return { reportId: row.id, taskId: row.task_id, created: false }
    if (row.content) throw new AiError('conflict', '报告已完成；重新分析会创建新报告', 409)
    if (await analysisSourcesChanged(tx, novelId, row.request_json, row.source_json))
      throw new AiError('conflict', '正文或章节范围已变化，请新建报告；原阅读记录已保留', 409)
    if (await first(tx, "SELECT id FROM ai_tasks WHERE novel_id=$1 AND kind='novel_analysis' AND status IN ('queued','running')", [novelId]))
      throw new AiError('conflict', '本书另有分析进行中，请先等待或停止', 409)
    const next = await createAiTask(tx, { userId, novelId, kind: 'novel_analysis', total: row.source_json.length,
      prompt: `${ANALYSIS_KINDS[row.request_json.kind]}：继续已保存的阅读记录`, params: JSON.stringify({ reportId: id, version: 1 }) })
    await run(tx, 'UPDATE novel_analysis_reports SET task_id=$1,updated_at=$2 WHERE id=$3', [next.id, Date.now(), id])
    return { reportId: id, taskId: next.id, created: true }
  })
}
