import { createHash } from 'node:crypto'
import type { StoryEvidence, StoryGraphResponse } from '@shared/story-graph'
import type { WritingAnalysisReference } from '@shared/novel-analysis'
import { AiError } from './client'

export interface StoryEvidenceSource extends StoryEvidence {
  id: string
}

export type StoryGraphEvidenceInput = Pick<StoryGraphResponse, 'chapters'> & { reports: WritingAnalysisReference[] }

/** Keep report excerpts exact; S# identifiers are local to each validated report. */
export function buildStoryGraphEvidenceSources(input: StoryGraphEvidenceInput): StoryEvidenceSource[] {
  const sources: StoryEvidenceSource[] = []
  for (const report of input.reports) {
    const kind = report.kind === 'plot' ? 'plot' : report.kind === 'relationships' || report.kind === 'characters' ? 'relationship' : null
    if (!kind || !report.content.trim()) continue
    const first = input.chapters.find(chapter => chapter.id === report.startChapter.id)
    const last = input.chapters.find(chapter => chapter.id === report.endChapter.id)
    if (!first || !last || first.ordinal > last.ordinal) continue
    const covered = new Set(input.chapters.filter(chapter => chapter.ordinal >= first.ordinal && chapter.ordinal <= last.ordinal).map(chapter => chapter.id))
    const sourceChapters = new Map(report.sources.filter(source => covered.has(source.chapterId)).map(source => [source.id, source.chapterId]))
    const revision = createHash('sha256')
      .update(JSON.stringify([report.id, report.revision, kind, report.content, [...sourceChapters]]))
      .digest('hex')
      .slice(0, 20)
    let start = 0
    while (start < report.content.length) {
      let end = Math.min(start + 1200, report.content.length)
      let boundary = false
      if (end < report.content.length) {
        const window = report.content.slice(start, end)
        const split = Math.max(window.lastIndexOf('\n'), window.lastIndexOf('。'), window.lastIndexOf('；'))
        if (split >= 600) {
          end = start + split + 1
          boundary = true
        }
        // Avoid splitting a UTF-16 surrogate pair at the right edge.
        if (/[\uD800-\uDBFF]/.test(report.content[end - 1]!)) end--
      }
      const quote = report.content.slice(start, end).trim()
      if (quote.length >= 2) {
        const chapterIds = [...new Set([...quote.matchAll(/\[\[(S\d+)\]\]/g)].flatMap(match => {
          const chapterId = sourceChapters.get(match[1]!)
          return chapterId ? [chapterId] : []
        }))]
        sources.push({ id: `${kind}_${revision}_${start}`, kind, quote, chapterIds })
      }
      if (end === report.content.length) break
      // Overlap a long unbroken entry so names and chapter markers near a cut remain usable.
      start = boundary ? end : end - 160
      if (/[\uDC00-\uDFFF]/.test(report.content[start]!)) start--
    }
  }
  return sources
}

/** Model-authored excerpts and chapter links never become trusted source records. */
export function resolveStoryGraphEvidence(value: unknown, sources: StoryEvidenceSource[]): unknown {
  const root = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  const catalog = new Map(sources.map((source) => [source.id, source]))
  const resolved: Record<string, unknown> = { ...root }
  for (const [key, limit] of [
    ['people', 60],
    ['relationships', 120],
    ['threads', 80],
  ] as const) {
    const entries = root[key]
    if (!Array.isArray(entries) || entries.length > limit) throw new AiError('invalid', `${key}：图谱结构无效或超过容量，请重新生成`, 422)
    resolved[key] = entries.map((raw: unknown, index) => {
      const node = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
      const path = `${key}[${index}].evidenceIds`
      const kind = key === 'people' ? '人物' : key === 'relationships' ? '关系' : '情节'
      const title = key === 'people' ? node.name : key === 'relationships' ? node.label : node.title
      const label = typeof title === 'string' && title.trim() ? `${kind}「${title.trim().slice(0, 60)}」` : `${kind}第 ${index + 1} 项`
      if (!Array.isArray(node.evidenceIds) || !node.evidenceIds.length || node.evidenceIds.length > 8) {
        throw new AiError('invalid', `${label}（${path}）：必须引用本次报告中的 1–8 个证据 ID，请重新生成`, 422)
      }
      const evidence = node.evidenceIds.map((id: unknown, refIndex) => {
        const source = typeof id === 'string' ? catalog.get(id) : undefined
        if (!source) throw new AiError('invalid', `${label}（${path}[${refIndex}]）：证据 ID 不属于本次有效报告，请重新生成`, 422)
        return { kind: source.kind, quote: source.quote, chapterIds: [...source.chapterIds] }
      })
      return { ...node, evidence }
    })
  }
  return resolved
}
