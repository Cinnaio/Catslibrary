import { createHash } from 'node:crypto'
import type { AnalysisRequest, AnalysisSource } from '@shared/novel-analysis'
import { ANALYSIS_KINDS } from '@shared/novel-analysis'
import type { DbClient } from '../../db/pool'
import { all } from '../../db/query'
import { AiError } from './client'
import { cleanStoryText } from './story-memory'

export const ANALYSIS_PIECE_CHARS = 12_000
type Chapter = { id: string; title: string; content: string; sort_order: number; ordinal: number }
export const analysisHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

/** Literal lookup inside the frozen selection; later sources help resolve earlier questions. */
export function searchAnalysisSources(sources: AnalysisSource[], value: unknown) {
  if (typeof value !== 'string' || value.trim().length < 2 || value.trim().length > 80)
    throw new AiError('invalid', '请提供 2–80 字的原文关键词', 422)
  const query = value.trim()
  const matches: Array<{ id: string; chapterTitle: string; part: number; excerpt: string }> = []
  let matchedSources = 0
  for (let i = sources.length - 1; i >= 0; i--) {
    const source = sources[i]!
    const at = source.text.indexOf(query)
    if (at < 0) continue
    matchedSources++
    if (matches.length >= 6) continue
    let start = Math.max(0, at - 160), end = Math.min(source.text.length, at + query.length + 200)
    if (start > 0 && /[\uDC00-\uDFFF]/u.test(source.text[start]!)) start--
    if (end < source.text.length && /[\uD800-\uDBFF]/u.test(source.text[end - 1]!)) end--
    matches.push({ id: source.id, chapterTitle: source.chapterTitle, part: source.part, excerpt: source.text.slice(start, end) })
  }
  return { query, matchedSources, truncated: matchedSources > matches.length, order: '较晚来源优先',
    matches, notice: '每个来源仅显示首次命中附近的片段；用 read_source 查看上下文。无命中不等于事件未发生。' }
}

export function parseAnalysisRequest(value: unknown): AnalysisRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AiError('invalid', '分析参数无效', 422)
  const v = value as Record<string, unknown>
  if (typeof v.kind !== 'string' || !Object.hasOwn(ANALYSIS_KINDS, v.kind)) throw new AiError('invalid', '请选择分析主题', 422)
  for (const key of ['startChapterId', 'endChapterId']) {
    if (typeof v[key] !== 'string' || !v[key] || v[key].length > 160) throw new AiError('invalid', '请选择起止章节', 422)
  }
  if (typeof v.question !== 'string' || v.question.length > 2000) throw new AiError('invalid', '分析要求最多 2000 字', 422)
  if (v.kind === 'custom' && !v.question.trim()) throw new AiError('invalid', '请填写需要分析的问题', 422)
  return { kind: v.kind as AnalysisRequest['kind'], startChapterId: v.startChapterId as string, endChapterId: v.endChapterId as string, question: v.question.trim() }
}

async function rangeRows(db: DbClient, novelId: string, request: AnalysisRequest) {
  const rows = await all<Chapter>(db, `WITH ordered AS (
    SELECT id,title,content,sort_order,ROW_NUMBER() OVER (ORDER BY sort_order,id)::int AS ordinal
    FROM chapters WHERE novel_id=$1
  ) SELECT * FROM ordered WHERE ordinal BETWEEN
    (SELECT ordinal FROM ordered WHERE id=$2) AND (SELECT ordinal FROM ordered WHERE id=$3)
    ORDER BY ordinal`, [novelId, request.startChapterId, request.endChapterId])
  if (!rows.length) throw new AiError('invalid', '章节范围无效、已删除或不属于本书，请重新选择', 422)
  return rows
}
const revision = (row: Chapter) => analysisHash([row.id, row.title, Number(row.sort_order), row.content])

/** Snapshot exact normalized text; long chapters are fully segmented, never truncated. */
export async function captureAnalysisSources(db: DbClient, novelId: string, request: AnalysisRequest): Promise<AnalysisSource[]> {
  const rows = await rangeRows(db, novelId, request)
  if (rows.reduce((sum, row) => sum + row.content.length, 0) > 2_000_000)
    throw new AiError('invalid', '所选正文超过 200 万字符，请分成多个范围分析', 422)
  const sources: AnalysisSource[] = []
  for (const row of rows) {
    const text = cleanStoryText(row.content)
    let offset = 0, part = 1
    do {
      let end = Math.min(text.length, offset + ANALYSIS_PIECE_CHARS)
      if (end < text.length) {
        const boundary = text.lastIndexOf('\n', end)
        if (boundary > end - 1000) end = boundary + 1
        else if (/[\uD800-\uDBFF]/u.test(text[end - 1]!)) end--
      }
      sources.push({ id: `S${sources.length + 1}`, chapterId: row.id, chapterTitle: row.title, chapterOrdinal: Number(row.ordinal),
        part: part++, offset, endOffset: end, revision: revision(row), text: text.slice(offset, end) })
      offset = end
    } while (offset < text.length)
  }
  if (!sources.some(source => source.text.trim())) throw new AiError('invalid', '所选章节没有可分析的正文', 422)
  return sources
}

export async function analysisSourcesChanged(db: DbClient, novelId: string, request: AnalysisRequest, sources: AnalysisSource[]) {
  let rows: Chapter[]
  try { rows = await rangeRows(db, novelId, request) } catch (error) {
    if (error instanceof AiError) return true
    throw error
  }
  const chapters = sources.filter(source => source.part === 1)
  return rows.length !== chapters.length || rows.some((row, i) => row.id !== chapters[i]?.chapterId || revision(row) !== chapters[i]?.revision)
}
