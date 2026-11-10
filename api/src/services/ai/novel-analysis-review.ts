import type { AnalysisReviewRow } from './novel-analysis-review-store'
import type { Db } from '../../db/pool'
import { first, run, withTx } from '../../db/query'
import { newId } from '../auth'
import { AiError, chat, providerLabel, textProvider, type AiChatResult } from './client'
import { getAiSettings } from './settings'
import { recordUsage } from './usage'
import { usageAuditFields } from './upstream-usage'
import { createAiTask, cancelAiTask, getAiTask, isAiTaskActive, startAiTaskHeartbeat, updateAiTask } from './tasks'
import { requireAnalysis } from './novel-analysis-store'
import { analysisSourcesChanged } from './novel-analysis-source'
import { ANALYSIS_FACT_PROMPT, analysisReviewSegments, buildAnalysisReviewPacket, parseAnalysisFactResult, parseParagraphStarts } from './novel-analysis-facts'
import { reviewBinding, reviewMatches, saveAnalysisEvidence } from './novel-analysis-review-store'

export async function previewAnalysisReview(db: Db, novelId: string, reportId: string, starts?: unknown) {
  const report = await requireAnalysis(db, novelId, reportId)
  if (!report.content) throw new AiError('conflict', '请等待报告完成后核对', 409)
  const content = report.edited_content ?? report.content
  return { ...buildAnalysisReviewPacket(content, report.source_json, parseParagraphStarts(starts)).coverage,
    revision: Number(report.revision), availableSegments: analysisReviewSegments(content) }
}

export async function createAnalysisReview(db: Db, userId: string, novelId: string, reportId: string,
  requestId: unknown, revision: unknown, starts?: unknown) {
  if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,160}$/u.test(requestId) || !Number.isSafeInteger(revision))
    throw new AiError('invalid', '核对请求需携带有效请求标识与报告版本', 422)
  const paragraphStarts = parseParagraphStarts(starts)
  const requested = { reportId, revision, ...(paragraphStarts ? { paragraphStarts } : {}) }
  return withTx(db, async query => {
    const tx = { query }
    await query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId])
    const old = await first<AnalysisReviewRow>(tx, "SELECT * FROM novel_analysis_reviews WHERE user_id=$1 AND request_id=$2 AND kind='fact'", [userId, requestId])
    if (old) {
      await requireAnalysis(tx, novelId, old.report_id)
      const same = old.report_id === reportId && old.request_json.revision === revision
        && JSON.stringify(old.request_json.paragraphStarts) === JSON.stringify(paragraphStarts)
      if (!same) throw new AiError('conflict', '同一请求标识不能更换报告、版本或核对段落', 409)
      return { reviewId: old.id, taskId: old.task_id, created: false }
    }
    await query('SELECT id FROM novel_analysis_reports WHERE id=$1 AND novel_id=$2 FOR UPDATE', [reportId, novelId])
    const report = await requireAnalysis(tx, novelId, reportId)
    if (!report.content || Number(report.revision) !== revision) throw new AiError('conflict', '报告未完成或已修订，请重新读取', 409)
    if (await analysisSourcesChanged(tx, novelId, report.request_json, report.source_json))
      throw new AiError('conflict', '正文或章节范围已变化，请先重新分析', 409)
    const active = await first(tx, `SELECT r.id FROM novel_analysis_reviews r JOIN ai_tasks t ON t.id=r.task_id
      WHERE r.report_id=$1 AND t.status IN ('queued','running')`, [reportId])
    if (active) throw new AiError('conflict', '本报告已有核对进行中，请等待或停止', 409)
    const packet = buildAnalysisReviewPacket(report.edited_content ?? report.content, report.source_json, paragraphStarts)
    if (!packet.coverage.segments.length) throw new AiError('invalid', '所选段落缺少有效来源或超出本次原文额度，请先补充引用或缩小段落', 422)
    const id = newId('areview')
    const task = await createAiTask(tx, { userId, novelId, kind: 'novel_analysis_review', total: packet.coverage.segments.length,
      prompt: '核对小说分析的主要结论', params: JSON.stringify({ reportId, reviewId: id, version: 1 }) })
    await run(tx, `INSERT INTO novel_analysis_reviews(id,report_id,report_revision,content_hash,source_fingerprint,checker_version,
      kind,user_id,request_id,request_json,task_id,input_json,created_at)
      VALUES($6,$1,$2,$3,$4,$5,'fact',$7,$8,$9::jsonb,$10,$11::jsonb,$12)`,
    [...reviewBinding(report), id, userId, requestId, JSON.stringify(requested), task.id, JSON.stringify(packet), Date.now()])
    return { reviewId: id, taskId: task.id, created: true }
  })
}

async function requireReview(db: Db, novelId: string, reportId: string, reviewId: string) {
  await requireAnalysis(db, novelId, reportId)
  const row = await first<AnalysisReviewRow>(db, "SELECT * FROM novel_analysis_reviews WHERE id=$1 AND report_id=$2 AND kind='fact'", [reviewId, reportId])
  if (!row) throw new AiError('invalid', '核对记录不存在或不属于本报告', 404)
  return row
}
export async function stopAnalysisReview(db: Db, novelId: string, reportId: string, reviewId: string) {
  await cancelAiTask(db, (await requireReview(db, novelId, reportId, reviewId)).task_id)
}
export async function applyAnalysisFinding(db: Db, novelId: string, reportId: string, reviewId: string, findingId: unknown, revision: unknown) {
  const review = await requireReview(db, novelId, reportId, reviewId)
  if (typeof findingId !== 'string' || !Number.isSafeInteger(revision)) throw new AiError('invalid', '请选择核对建议并携带报告版本', 422)
  const finding = review.result_json?.items.find(i => i.id === findingId)
  if (!finding) throw new AiError('invalid', '核对建议不存在', 404)
  return withTx(db, async query => {
    const tx = { query }
    await query('SELECT id FROM novel_analysis_reports WHERE id=$1 AND novel_id=$2 FOR UPDATE', [reportId, novelId])
    const report = await requireAnalysis(tx, novelId, reportId)
    if (!reviewMatches(report, review) || Number(report.revision) !== revision
      || await analysisSourcesChanged(tx, novelId, report.request_json, report.source_json))
      throw new AiError('conflict', '报告或原文已变化，旧核对建议不能应用，请重新核对', 409)
    const content = report.edited_content ?? report.content
    if (content.slice(finding.start, finding.end) !== finding.original) throw new AiError('conflict', '建议对应原句已变化', 409)
    const next = content.slice(0, finding.start) + finding.suggestion + content.slice(finding.end)
    if (!next.trim() || next.length > 50000) throw new AiError('invalid', '修订后的报告需为 1–50000 字', 422)
    await run(tx, 'UPDATE novel_analysis_reports SET edited_content=$1,revision=revision+1,updated_at=$2 WHERE id=$3', [next, Date.now(), reportId])
    await saveAnalysisEvidence(tx, { ...report, edited_content: next, revision: Number(report.revision) + 1 })
    return { revision: Number(report.revision) + 1 }
  })
}

/** One explicit operation, one upstream call. Old-version results stay attached to that version. */
export async function runAnalysisReview(db: Db, novelId: string, reportId: string, reviewId: string, taskId: string,
  audit: { ipAddress?: string; userAgent?: string } = {}, invoke: typeof chat = chat) {
  const controller = new AbortController()
  const stopHeartbeat = startAiTaskHeartbeat(db, taskId)
  let polling = false
  const timer = setInterval(() => {
    if (polling) return
    polling = true
    void isAiTaskActive(db, taskId).then(active => { if (!active) controller.abort() }).catch(() => controller.abort()).finally(() => { polling = false })
  }, 500)
  timer.unref?.()
  const active = async () => {
    if (controller.signal.aborted || !await isAiTaskActive(db, taskId)) throw new AiError('cancelled', '核对已停止，原报告已保留', 409)
  }
  try {
    const review = await requireReview(db, novelId, reportId, reviewId)
    const task = await getAiTask(db, taskId)
    if (!task || task.kind !== 'novel_analysis_review' || task.novelId !== novelId || review.task_id !== taskId || review.result_json) return
    const started = await withTx(db, async query => {
      await query('SELECT id FROM ai_tasks WHERE id=$1 FOR UPDATE', [taskId])
      const current = await first<{ status: string }>({ query }, 'SELECT status FROM ai_tasks WHERE id=$1', [taskId])
      return current?.status === 'queued' && await updateAiTask({ query }, taskId, { status: 'running', step: '正在核对主要结论与原文' })
    })
    if (!started) return
    await active()
    const settings = await getAiSettings(db), usageId = newId('aiuse')
    const record = (response: AiChatResult) => recordUsage(db, { usageId, userId: task.userId, taskId, novelId,
      generationType: 'novel_analysis_review', model: response.model, provider: providerLabel(textProvider().baseUrl),
      tokenUsageReported: response.tokenUsageReported, promptTokens: response.promptTokens, completionTokens: response.completionTokens,
      costMillicents: response.cost * 100000, ...usageAuditFields(response), ...audit })
    let phase = ''
    const response = await invoke({ messages: [{ role: 'system', content: ANALYSIS_FACT_PROMPT },
      { role: 'user', content: JSON.stringify({ segments: review.input_json.coverage.segments,
        sources: review.input_json.sources.map(s => ({ id: s.id, chapterTitle: s.chapterTitle, part: s.part, text: s.text })) }) }],
    stream: true, temperature: 0.2, maxTokens: settings.storyMemoryReasoningMode === 'high' ? 12000 : 6000,
    timeoutMs: settings.storyMemoryTimeoutSeconds * 1000, reasoningMode: settings.storyMemoryReasoningMode,
    maxAttempts: 1, retryOnTimeout: false, returnIncompleteResult: true, signal: controller.signal, onIncomplete: record,
    onProgress: async progress => {
      if (phase === progress.phase || phase === 'writing') return
      phase = progress.phase
      await active()
      await updateAiTask(db, taskId, { step: phase === 'thinking' ? '正在核对原文' : '正在接收核对结果' })
    } })
    await record(response)
    await active()
    if (response.refusal || response.truncated || response.finishReason === 'length' || response.toolCalls?.length || !response.text.trim())
      throw new AiError('upstream', '核对输出未完成，原报告和已有核对已保留', 502)
    const result = parseAnalysisFactResult(response.text, review.input_json)
    await withTx(db, async query => {
      const tx = { query }
      await query('SELECT id FROM ai_tasks WHERE id=$1 FOR UPDATE', [taskId])
      if (!await isAiTaskActive(tx, taskId)) return
      await run(tx, 'UPDATE novel_analysis_reviews SET result_json=$1::jsonb WHERE id=$2 AND task_id=$3 AND result_json IS NULL', [JSON.stringify(result), reviewId, taskId])
      await updateAiTask(tx, taskId, { status: 'completed', current: result.checkedSegmentIds.length,
        step: '已完成本次范围核对，请对照原文确认疑点', result: JSON.stringify({ reportId, reviewId }) })
    })
  } catch (error) {
    await updateAiTask(db, taskId, { status: 'failed', step: '核对未完成，原报告已保留',
      error: error instanceof AiError ? error.message : '核对未完成，原报告和已有核对已保留' })
  } finally { clearInterval(timer); stopHeartbeat() }
}
