import type { AnalysisEvidenceCheck, AnalysisFactResult, AnalysisReferenceReview, AnalysisReview, AnalysisSource } from '@shared/novel-analysis'
import type { DbClient } from '../../db/pool'
import { all, first, run } from '../../db/query'
import { newId } from '../auth'
import { ANALYSIS_CHECKER_VERSION, analysisContentHash, analysisSourceFingerprint, checkAnalysisEvidence } from './novel-analysis-evidence'
import type { AnalysisReviewPacket } from './novel-analysis-facts'

export type ReviewReport = { id: string; revision: number; content: string; edited_content: string | null; source_json: Omit<AnalysisSource, 'text'>[] }
export interface AnalysisReviewRow {
  id: string; report_id: string; report_revision: number; content_hash: string; source_fingerprint: string; checker_version: string
  task_id: string; request_json: { reportId: string; revision: number; paragraphStarts?: number[] }; input_json: AnalysisReviewPacket
  result_json: AnalysisFactResult | null; created_at: number
}
export function reviewBinding(row: ReviewReport) {
  return [row.id, Number(row.revision), analysisContentHash(row.edited_content ?? row.content), analysisSourceFingerprint(row.source_json), ANALYSIS_CHECKER_VERSION] as const
}
export function reviewMatches(row: ReviewReport, review: AnalysisReviewRow) {
  const binding = reviewBinding(row)
  return review.report_id === binding[0] && Number(review.report_revision) === binding[1] && review.content_hash === binding[2]
    && review.source_fingerprint === binding[3] && review.checker_version === binding[4]
}
export async function saveAnalysisEvidence(db: DbClient, row: ReviewReport & { source_json: AnalysisSource[] }): Promise<AnalysisEvidenceCheck> {
  const binding = reviewBinding(row)
  const saved = await first<{ result_json: AnalysisEvidenceCheck }>(db, `SELECT result_json FROM novel_analysis_reviews WHERE kind='citation'
    AND report_id=$1 AND report_revision=$2 AND content_hash=$3 AND source_fingerprint=$4 AND checker_version=$5`, [...binding])
  if (saved) return saved.result_json
  const result = checkAnalysisEvidence(row.edited_content ?? row.content, row.source_json)
  await run(db, `INSERT INTO novel_analysis_reviews(id,report_id,report_revision,content_hash,source_fingerprint,checker_version,kind,result_json,created_at)
    VALUES($6,$1,$2,$3,$4,$5,'citation',$7::jsonb,$8) ON CONFLICT DO NOTHING`, [...binding, newId('areview'), JSON.stringify(result), Date.now()])
  return result
}
export async function readAnalysisReviews(db: DbClient, report: ReviewReport, sourceChanged = false): Promise<AnalysisReview[]> {
  const rows = await all<AnalysisReviewRow & { status: AnalysisReview['status'] | null; error: string | null }>(db, `SELECT r.*,
    t.status,t.error FROM novel_analysis_reviews r LEFT JOIN ai_tasks t ON t.id=r.task_id
    WHERE r.report_id=$1 AND r.kind='fact' ORDER BY r.created_at DESC,r.id DESC LIMIT 10`, [report.id])
  return rows.map(row => ({ id: row.id, reportId: row.report_id, reportRevision: Number(row.report_revision), contentHash: row.content_hash,
    sourceFingerprint: row.source_fingerprint, checkerVersion: row.checker_version, taskId: row.task_id,
    status: row.status || (row.result_json ? 'completed' : 'interrupted'), error: row.error || '',
    stale: sourceChanged || !reviewMatches(report, row), createdAt: Number(row.created_at), coverage: row.input_json.coverage,
    ...(row.result_json ? { result: row.result_json } : {}) }))
}

/** Read only version-matching results, with no model call or full source transfer. */
export async function analysisReferenceReview(db: DbClient, row: ReviewReport): Promise<AnalysisReferenceReview | undefined> {
  const binding = reviewBinding(row)
  const checks = await all<{ kind: string; result_json: AnalysisFactResult | AnalysisEvidenceCheck }>(db, `SELECT kind,result_json
    FROM novel_analysis_reviews WHERE report_id=$1 AND report_revision=$2 AND content_hash=$3 AND source_fingerprint=$4
    AND checker_version=$5 AND result_json IS NOT NULL ORDER BY created_at DESC,id DESC`, [...binding])
  if (!checks.length) return undefined
  const quoteCheck = checks.find(c => c.kind === 'citation')?.result_json as AnalysisEvidenceCheck | undefined
  const facts = checks.filter(c => c.kind === 'fact').map(c => c.result_json as AnalysisFactResult)
  const quoteIssues = quoteCheck?.items.filter(i => !['matched', 'uncertain'].includes(i.status)) || []
  const factItems = [...new Map(facts.flatMap(f => f.items).map(i => [`${i.start}:${i.end}:${i.kind}`, i])).values()]
  const candidates: AnalysisReferenceReview['issues'] = [
    ...factItems.map(i => ({ original: i.original, kind: i.kind, explanation: i.explanation, evidence: i.evidence })),
    ...quoteIssues.map(i => ({ original: i.quote, kind: i.status, explanation: '该引语尚未确认与所标来源的连续原文一致，不能作为逐字引文。', evidence: i.matches })),
  ]
  const issues: AnalysisReferenceReview['issues'] = []
  let chars = 0
  for (const issue of candidates) {
    const size = JSON.stringify(issue).length
    if (chars + size > 8000 || issues.length >= 12) continue
    issues.push(issue); chars += size
  }
  return { contentHash: binding[2], sourceFingerprint: binding[3], checkerVersion: binding[4], quoteIssues: quoteIssues.length,
    factIssues: factItems.length, checkedSegments: new Set(facts.flatMap(f => f.checkedSegmentIds)).size,
    partial: !facts.length || facts.some(f => f.partial) || quoteCheck?.coverage === 'partial' || issues.length < candidates.length, issues }
}
