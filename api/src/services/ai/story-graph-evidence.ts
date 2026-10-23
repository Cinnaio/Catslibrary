import { createHash } from 'node:crypto'
import type { StoryEvidence, StoryGraphResponse } from '@shared/story-graph'
import { AiError } from './client'

export interface StoryEvidenceSource extends StoryEvidence {
  id: string
}

type EvidenceInput = Pick<StoryGraphResponse, 'archives' | 'chapters'>

/** Keep excerpts contiguous and bounded, without rewriting or discarding archive text. */
export function buildStoryGraphEvidenceSources(input: EvidenceInput): StoryEvidenceSource[] {
  const sources: StoryEvidenceSource[] = []
  for (const archive of input.archives) {
    if (archive.eligibility !== 'usable' || !archive.content.trim()) continue
    const revision = createHash('sha256')
      .update(JSON.stringify([archive.kind, archive.content, archive.chaptersThrough]))
      .digest('hex')
      .slice(0, 20)
    const covered = new Set(input.chapters.filter((c) => c.ordinal <= archive.chaptersThrough).map((c) => c.id))
    let start = 0
    while (start < archive.content.length) {
      let end = Math.min(start + 1200, archive.content.length)
      let boundary = false
      if (end < archive.content.length) {
        const window = archive.content.slice(start, end)
        const split = Math.max(window.lastIndexOf('\n'), window.lastIndexOf('。'), window.lastIndexOf('；'))
        if (split >= 600) {
          end = start + split + 1
          boundary = true
        }
        // Avoid splitting a UTF-16 surrogate pair at the right edge.
        if (/[\uD800-\uDBFF]/.test(archive.content[end - 1]!)) end--
      }
      const quote = archive.content.slice(start, end).trim()
      if (quote.length >= 2) {
        const chapterIds = [...new Set([...quote.matchAll(/\[章节ID:([^\]\r\n]+)\]/g)].map((m) => m[1]!).filter((id) => covered.has(id)))]
        sources.push({ id: `${archive.kind}_${revision}_${start}`, kind: archive.kind, quote, chapterIds })
      }
      if (end === archive.content.length) break
      // Overlap a long unbroken entry so names and chapter markers near a cut remain usable.
      start = boundary ? end : end - 160
      if (/[\uDC00-\uDFFF]/.test(archive.content[start]!)) start--
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
        throw new AiError('invalid', `${label}（${path}）：必须引用本次档案中的 1–8 个证据 ID，请重新生成`, 422)
      }
      const evidence = node.evidenceIds.map((id: unknown, refIndex) => {
        const source = typeof id === 'string' ? catalog.get(id) : undefined
        if (!source) throw new AiError('invalid', `${label}（${path}[${refIndex}]）：证据 ID 不属于本次有效档案，请重新生成`, 422)
        return { kind: source.kind, quote: source.quote, chapterIds: [...source.chapterIds] }
      })
      return { ...node, evidence }
    })
  }
  return resolved
}
