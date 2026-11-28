import type { AnalysisNote, AnalysisReport, AnalysisReportSummary, AnalysisRequest, AnalysisSource } from '@shared/novel-analysis'
import { ANALYSIS_KINDS } from '@shared/novel-analysis'
import type { Db, DbClient } from '../../db/pool'
import { all, first, run, withTx } from '../../db/query'
import { newId } from '../auth'
import { AiError } from './client'
import { createAiTask, getAiTask, cancelAiTask, updateAiTask } from './tasks'
import { analysisHash, analysisSourcesChanged, captureAnalysisSources, parseAnalysisRequest } from './novel-analysis-source'
import { analysisOutputLimits, readAnalysisProgress } from './novel-analysis-options'
import { getAiSettings } from './settings'
import { analysisGenerationKey, analysisReuseKey } from './novel-analysis-reuse'
import { readAnalysisReviews, saveAnalysisEvidence } from './novel-analysis-review-store'

export interface AnalysisRow {
  id: string; novel_id: string; user_id: string; request_id: string; request_json: AnalysisRequest
  source_json: AnalysisSource[]; notes_json: AnalysisNote[]; synthesis_json: AnalysisNote[] | null
  checked_source_ids: string[]; content: string; edited_content: string | null; revision: number
  task_id: string; created_at: number; updated_at: number
  generation_key: string; reuse_key: string; force_refresh: boolean; reused_sources: number
}
export async function requireAnalysis(db: DbClient, novelId: string, id: string) {
  const row = await first<AnalysisRow>(db, 'SELECT * FROM novel_analysis_reports WHERE id=$1 AND novel_id=$2', [id, novelId])
  if (!row) throw new AiError('invalid', '分析报告不存在或不属于本书', 404)
  return row
}
export async function createAnalysis(db: Db, userId: string, novelId: string, value: unknown, requestId: string, forceRefresh: unknown = false) {
  const request = parseAnalysisRequest(value)
  if (!/^[a-zA-Z0-9_-]{8,160}$/u.test(requestId)) throw new AiError('invalid', '分析请求标识无效', 422)
  if (typeof forceRefresh !== 'boolean') throw new AiError('invalid', '重新分析选项无效', 422)
  const settings = await getAiSettings(db)
  const generationKey = analysisGenerationKey(settings.storyMemoryReasoningMode)
  return withTx(db, async query => {
    const tx = { query }
    // Serialize retries for an account and cross-account submissions for a book.
    await query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId])
    const old = await first<AnalysisRow & { submitted_force_refresh: boolean }>(tx,
      'SELECT r.*,q.force_refresh AS submitted_force_refresh FROM novel_analysis_requests q '
      + 'JOIN novel_analysis_reports r ON r.id=q.report_id WHERE q.user_id=$1 AND q.request_id=$2', [userId, requestId])
    if (old) {
      if (old.novel_id !== novelId || analysisHash(parseAnalysisRequest(old.request_json)) !== analysisHash(request)
        || old.submitted_force_refresh !== forceRefresh)
        throw new AiError('conflict', '同一请求标识不能更换作品、范围、分析要求或重新分析选项', 409)
      return { reportId: old.id, taskId: old.task_id, created: false, reused: old.request_id !== requestId || old.user_id !== userId }
    }
    if (!await first(tx, 'SELECT id FROM novels WHERE id=$1 FOR UPDATE', [novelId])) throw new AiError('invalid', '小说不存在', 404)
    const sources = await captureAnalysisSources(tx, novelId, request)
    const reuseKey = analysisReuseKey(request, sources, generationKey)
    if (!forceRefresh) {
      const existing = await first<{ id: string; task_id: string }>(tx,
        'SELECT r.id,r.task_id FROM novel_analysis_reports r LEFT JOIN ai_tasks t ON t.id=r.task_id '
        + "WHERE r.novel_id=$1 AND r.reuse_key=$2 AND ((r.content<>'' AND (t.status='completed' OR t.id IS NULL)) "
        + "OR t.status IN ('queued','running')) ORDER BY r.created_at DESC,r.id DESC LIMIT 1", [novelId, reuseKey])
      if (existing) {
        await run(tx, 'INSERT INTO novel_analysis_requests(user_id,request_id,report_id,force_refresh) VALUES($1,$2,$3,$4)',
          [userId, requestId, existing.id, forceRefresh])
        return { reportId: existing.id, taskId: existing.task_id, created: false, reused: true }
      }
    }
    const active = await first(tx, "SELECT id FROM ai_tasks WHERE novel_id=$1 AND kind='novel_analysis' AND status IN ('queued','running')", [novelId])
    if (active) throw new AiError('conflict', '本书已有分析进行中，请先等待或停止', 409)
    const id = newId('analysis')
    const task = await createAiTask(tx, { userId, novelId, kind: 'novel_analysis', total: sources.length,
      prompt: `${ANALYSIS_KINDS[request.kind]}：${request.question || '按正文梳理并提供依据'}`, params: JSON.stringify({ reportId: id, version: 1, outputLimits: analysisOutputLimits(settings) }) })
    const now = Date.now()
    await run(tx, 'INSERT INTO novel_analysis_reports(id,novel_id,user_id,request_id,request_json,source_json,task_id,created_at,updated_at,generation_key,reuse_key,force_refresh) '
      + 'VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$8,$9,$10,$11)',
    [id, novelId, userId, requestId, JSON.stringify(request), JSON.stringify(sources), task.id, now, generationKey, reuseKey, forceRefresh])
    await run(tx, 'INSERT INTO novel_analysis_requests(user_id,request_id,report_id,force_refresh) VALUES($1,$2,$3,$4)',
      [userId, requestId, id, forceRefresh])
    return { reportId: id, taskId: task.id, created: true, reused: false }
  })
}

function summary(row: AnalysisRow, task?: { status: string; step: string; error: string; result?: string }): AnalysisReportSummary {
  return { id: row.id, novelId: row.novel_id, request: row.request_json, taskId: row.task_id,
    status: (task?.status || (row.content ? 'completed' : 'interrupted')) as AnalysisReportSummary['status'],
    phase: readAnalysisProgress(task?.result).phase,
    step: task?.step || '', error: task?.error || '', processed: row.content ? row.source_json.length : new Set(row.notes_json.flatMap(note => note.sourceIds)).size, total: row.source_json.length,
    chapterCount: new Set(row.source_json.map(source => source.chapterId)).size, revision: Number(row.revision),
    reusedSources: Number(row.reused_sources || 0),
    edited: row.edited_content !== null, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) }
}
export async function readAnalysis(db: Db, novelId: string, id: string): Promise<AnalysisReport> {
  const row = await requireAnalysis(db, novelId, id)
  const task = await getAiTask(db, row.task_id)
  const sourceChanged = await analysisSourcesChanged(db, novelId, row.request_json, row.source_json)
  return { ...summary(row, task), content: row.edited_content ?? row.content, originalContent: row.content,
    sourceChanged,
    ...(row.content ? { evidence: await saveAnalysisEvidence(db, row) } : {}),
    reviews: await readAnalysisReviews(db, row, sourceChanged),
    sources: row.source_json.map(({ text: _text, ...source }) => source), notes: row.notes_json, checkedSourceIds: row.checked_source_ids }
}
export async function listAnalyses(db: Db, novelId: string, offset = 0) {
  // Project only source metadata, avoiding large text snapshots in list reads.
  const rows = await all<AnalysisRow & { status: string; step: string; error: string; result: string }>(db, `SELECT r.id,r.novel_id,r.request_json,r.task_id,r.revision,
    r.created_at,r.updated_at,r.reused_sources,CASE WHEN r.edited_content IS NULL THEN NULL ELSE '' END AS edited_content,
    CASE WHEN r.content='' THEN '' ELSE 'saved' END AS content,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('chapterId',s->>'chapterId')) FROM jsonb_array_elements(r.source_json) s),'[]') AS source_json,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('sourceIds',n->'sourceIds')) FROM jsonb_array_elements(r.notes_json) n),'[]') AS notes_json,
    t.status,t.step,t.error,t.result FROM novel_analysis_reports r LEFT JOIN ai_tasks t ON t.id=r.task_id
    WHERE r.novel_id=$1 ORDER BY r.created_at DESC,r.id DESC LIMIT 21 OFFSET $2`, [novelId, offset])
  return { reports: rows.slice(0, 20).map(row => summary(row, row.status ? row : undefined)), hasMore: rows.length > 20 }
}
export async function editAnalysis(db: Db, novelId: string, id: string, content: unknown, expectedRevision: unknown) {
  if (typeof content !== 'string' || !content.trim() || content.length > 50_000 || !Number.isSafeInteger(expectedRevision))
    throw new AiError('invalid', '报告需为 1–50000 字，并携带当前版本', 422)
  await withTx(db, async query => {
    const tx = { query }
    await query('SELECT id FROM novel_analysis_reports WHERE id=$1 AND novel_id=$2 FOR UPDATE', [id, novelId])
    const row = await requireAnalysis(tx, novelId, id)
    if (!row.content) throw new AiError('conflict', '请等待报告完成后修订', 409)
    if (!await run(tx, `UPDATE novel_analysis_reports SET edited_content=$1,revision=revision+1,updated_at=$2
    WHERE id=$3 AND novel_id=$4 AND revision=$5 AND content<>''`, [content.trim(), Date.now(), id, novelId, expectedRevision]))
      throw new AiError('conflict', '报告已被修改，请重新读取后保存', 409)
    await saveAnalysisEvidence(tx, { ...row, edited_content: content.trim(), revision: Number(row.revision) + 1 })
  })
}
export async function stopAnalysis(db: Db, novelId: string, id: string) {
  const row = await requireAnalysis(db, novelId, id)
  await cancelAiTask(db, row.task_id)
}
export async function resumeAnalysis(db: Db, userId: string, novelId: string, id: string) {
  const settings = await getAiSettings(db)
  return withTx(db, async query => {
    const tx = { query }
    await query('SELECT id FROM novels WHERE id=$1 FOR UPDATE', [novelId])
    let row = await requireAnalysis(tx, novelId, id)
    const task = await first<{ status: string; result: string }>(tx, 'SELECT status,result FROM ai_tasks WHERE id=$1 FOR UPDATE', [row.task_id])
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
      prompt: `${ANALYSIS_KINDS[row.request_json.kind]}：继续已保存的阅读记录`, params: JSON.stringify({ reportId: id, version: 1, outputLimits: analysisOutputLimits(settings) }) })
    const progress = readAnalysisProgress(task?.result)
    if (!await updateAiTask(tx, next.id, { result: JSON.stringify({ reportId: id, phase: progress.phase,
      consolidation: { ...progress.consolidation, requests: 0, retries: 0 } }) }))
      throw new AiError('conflict', '任务状态已变化，请重新读取报告后继续', 409)
    await run(tx, 'UPDATE novel_analysis_reports SET task_id=$1,updated_at=$2 WHERE id=$3', [next.id, Date.now(), id])
    return { reportId: id, taskId: next.id, created: true }
  })
}
