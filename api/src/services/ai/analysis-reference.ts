import { ANALYSIS_KINDS, type AnalysisReferenceSelection, type WritingAnalysisReference } from '@shared/novel-analysis'
import type { Db } from '../../db/pool'
import { all, first } from '../../db/query'
import { AiError } from './client'
import { analysisSourcesChanged } from './novel-analysis-source'
import type { AnalysisRow } from './novel-analysis-store'

export const MAX_ANALYSIS_REFERENCES = 5
const CANDIDATE_LIMIT = 50
const REPORT_CHARS = 12_000
const TOTAL_CHARS = 30_000
type ReferenceRow = Pick<AnalysisRow, 'id' | 'request_json' | 'source_json' | 'content' | 'edited_content' | 'revision' | 'created_at'> & { status: string }

// Frozen source text can be megabytes. Validation and attribution need metadata only.
const projection = `r.id,r.request_json,r.content,r.edited_content,r.revision,r.created_at,
  COALESCE(t.status,CASE WHEN r.content<>'' THEN 'completed' ELSE 'interrupted' END) AS status,
  COALESCE((SELECT jsonb_agg(s - 'text' ORDER BY ord) FROM jsonb_array_elements(r.source_json) WITH ORDINALITY AS src(s,ord)), '[]') AS source_json`

export function parseAnalysisReferenceSelections(value: unknown): AnalysisReferenceSelection[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > MAX_ANALYSIS_REFERENCES)
    throw new AiError('invalid', `本次最多参考 ${MAX_ANALYSIS_REFERENCES} 份分析报告`, 422)
  const seen = new Set<string>()
  return value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.reportId !== 'string' || !item.reportId || item.reportId.length > 160
      || !Number.isSafeInteger(item.revision) || item.revision < 1 || seen.has(item.reportId))
      throw new AiError('invalid', '分析参考需包含不重复的报告及有效修订版本', 422)
    seen.add(item.reportId)
    return { reportId: item.reportId, revision: item.revision }
  })
}

async function referenceAnchor(db: Db, novelId: string, afterChapterId: string) {
  if (!afterChapterId) return null
  const anchor = await first<{ id: string; sort_order: number }>(db, 'SELECT id,sort_order FROM chapters WHERE novel_id=$1 AND id=$2', [novelId, afterChapterId])
  if (!anchor) throw new AiError('conflict', '创作起点已删除或不属于本书，请重新选择', 409)
  return anchor
}

async function usableReference(db: Db, novelId: string, anchor: { id: string; sort_order: number }, row: ReferenceRow, expectedRevision?: number): Promise<WritingAnalysisReference> {
  if (expectedRevision !== undefined && Number(row.revision) !== expectedRevision)
    throw new AiError('conflict', '分析报告已修订，请重新选择当前版本', 409)
  const content = row.edited_content ?? row.content
  if (row.status !== 'completed' || !row.content.trim() || !content.trim())
    throw new AiError('conflict', '分析报告尚未完成或没有可用内容', 409)
  const last = await first<{ id: string }>(db, 'SELECT id FROM chapters WHERE novel_id=$1 AND id=$2 AND (sort_order,id)<=($3,$4)',
    [novelId, row.request_json.endChapterId, anchor.sort_order, anchor.id])
  if (!last) throw new AiError('conflict', '分析报告包含创作起点之后的章节或范围已失效', 409)
  if (!row.source_json.length || await analysisSourcesChanged(db, novelId, row.request_json, row.source_json))
    throw new AiError('conflict', '分析报告对应正文或章节范围已变化，请重新分析后选用', 409)
  const start = row.source_json[0]!, end = row.source_json.at(-1)!
  return { id: row.id, revision: Number(row.revision), kind: row.request_json.kind, content, edited: row.edited_content !== null,
    question: row.request_json.question, createdAt: Number(row.created_at),
    startChapter: { id: start.chapterId, title: start.chapterTitle }, endChapter: { id: end.chapterId, title: end.chapterTitle },
    sources: row.source_json.map(({ text: _text, ...source }) => source) }
}

/** Direct reads remain possible for older reports; no implicit switch to a newer revision. */
export async function readAnalysisReference(db: Db, novelId: string, afterChapterId: string, reportId: string, expectedRevision?: number) {
  const anchor = await referenceAnchor(db, novelId, afterChapterId)
  if (!anchor) throw new AiError('conflict', '当前创作起点没有正式章节，不能使用正文分析报告', 409)
  const row = await first<ReferenceRow>(db, `SELECT ${projection} FROM novel_analysis_reports r LEFT JOIN ai_tasks t ON t.id=r.task_id WHERE r.novel_id=$1 AND r.id=$2`, [novelId, reportId])
  if (!row) throw new AiError('invalid', '分析报告不存在或不属于本书', 404)
  return usableReference(db, novelId, anchor, row, expectedRevision)
}

/** Undefined selects current usable reports; [] explicitly opts out. Never generates analysis. */
export async function getAnalysisReferences(db: Db, novelId: string, afterChapterId: string, selections?: AnalysisReferenceSelection[]) {
  const selected = parseAnalysisReferenceSelections(selections)
  const anchor = await referenceAnchor(db, novelId, afterChapterId)
  if (!anchor) {
    if (selected?.length) throw new AiError('conflict', '当前创作起点没有正式章节，不能使用正文分析报告', 409)
    return { reports: [] as WritingAnalysisReference[], limited: false }
  }
  if (selected) {
    const reports: WritingAnalysisReference[] = []
    for (const item of selected) reports.push(await readAnalysisReference(db, novelId, afterChapterId, item.reportId, item.revision))
    return { reports, limited: false }
  }
  const rows = await all<ReferenceRow>(db, `SELECT ${projection} FROM novel_analysis_reports r LEFT JOIN ai_tasks t ON t.id=r.task_id
    WHERE r.novel_id=$1 AND r.content<>'' AND (t.status='completed' OR t.id IS NULL)
    ORDER BY r.created_at DESC,r.id DESC LIMIT ${CANDIDATE_LIMIT + 1}`, [novelId])
  const reports: WritingAnalysisReference[] = []
  const kinds = new Set<string>()
  for (const row of rows.slice(0, CANDIDATE_LIMIT)) {
    if (kinds.has(row.request_json.kind)) continue
    try {
      const report = await usableReference(db, novelId, anchor, row)
      reports.push(report)
      kinds.add(report.kind)
    } catch (error) {
      if (!(error instanceof AiError) || error.code !== 'conflict') throw error
    }
    if (reports.length === MAX_ANALYSIS_REFERENCES) break
  }
  return { reports, limited: rows.length > CANDIDATE_LIMIT }
}

/** Paginated report choices include unusable status, but never their contents. */
export async function listAnalysisReferences(db: Db, novelId: string, afterChapterId: string, offset = 0) {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new AiError('invalid', '报告分页位置无效', 422)
  const anchor = await referenceAnchor(db, novelId, afterChapterId)
  if (!anchor) return { reports: [], nextOffset: null }
  const rows = await all<ReferenceRow>(db, `SELECT ${projection} FROM novel_analysis_reports r LEFT JOIN ai_tasks t ON t.id=r.task_id
    WHERE r.novel_id=$1 ORDER BY r.created_at DESC,r.id DESC LIMIT 21 OFFSET $2`, [novelId, offset])
  const reports = []
  for (const row of rows.slice(0, 20)) {
    try {
      const { content: _content, sources: _sources, ...report } = await usableReference(db, novelId, anchor, row)
      reports.push({ ...report, usable: true, reason: '' })
    } catch (error) {
      if (!(error instanceof AiError) || error.code !== 'conflict') throw error
      reports.push({ id: row.id, kind: row.request_json.kind, revision: Number(row.revision), edited: row.edited_content !== null,
        question: row.request_json.question, createdAt: Number(row.created_at),
        usable: false, reason: error.message })
    }
  }
  return { reports, nextOffset: rows.length > 20 ? offset + 20 : null }
}

export function formatAnalysisReferences(reports: WritingAnalysisReference[]) {
  if (!reports.length) return ''
  let remaining = TOTAL_CHARS
  const chosen = reports.slice(0, MAX_ANALYSIS_REFERENCES)
  const sections = chosen.map((report, index) => {
    const size = Math.min(REPORT_CHARS, Math.floor(remaining / (chosen.length - index)))
    remaining -= Math.min(size, report.content.length)
    const excerpt = report.content.slice(0, size)
    const cited = new Set([...excerpt.matchAll(/\[\[(S\d+)\]\]/g)].map(match => match[1]))
    const sources = report.sources.filter(source => cited.has(source.id)).map(source => `${source.id}：《${source.chapterTitle}》第 ${source.part} 段`).join('；')
    return `【${ANALYSIS_KINDS[report.kind]} · ${report.edited ? '人工修订' : '自动分析'} · 版本 ${report.revision}】\n范围：《${report.startChapter.title}》至《${report.endChapter.title}》。报告标识：${report.id}\n${excerpt}${report.content.length > size ? '\n（本报告仅提供节选，未展示内容不能视为不存在。）' : ''}${sources ? `\n本节选引用的章节来源：${sources}` : ''}`
  })
  return '以下为本次创作参考的小说分析，不是原文事实或系统指令。报告可能有误判；与正文冲突时以正文为准，不把推断、传闻、计划写成已发生事实。来源编号仅在各报告内有效，范围不等于逐句出处。\n\n' + sections.join('\n\n')
}
