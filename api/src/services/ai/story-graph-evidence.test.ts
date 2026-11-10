import { describe, expect, it } from 'vitest'
import type { WritingAnalysisReference } from '@shared/novel-analysis'
import { buildStoryGraphEvidenceSources, resolveStoryGraphEvidence, type StoryGraphEvidenceInput } from './story-graph-evidence'
import { validateStoryGraph } from './story-graph'

const quote = '林舟与沈砚合作查案。\r\n双方仍有隐瞒。[[S1]][[S2]][[S3]][[S99]][章节ID:c2][章节ID:foreign]'
function report(content = quote, overrides: Partial<WritingAnalysisReference> = {}): WritingAnalysisReference {
  return {
    id: 'report-1', revision: 1, kind: 'relationships', content, edited: false,
    startChapter: { id: 'c1', title: '初遇' }, endChapter: { id: 'c1', title: '初遇' },
    sources: ['c1', 'c2', 'foreign'].map((chapterId, i) => ({ id: `S${i + 1}`, chapterId, chapterTitle: chapterId,
      chapterOrdinal: i + 1, part: 1, offset: 0, endOffset: 20, revision: 'original' })),
    ...overrides,
  }
}
function input(content = quote): StoryGraphEvidenceInput {
  return {
    reports: [report(content)],
    chapters: [
      { id: 'c1', title: '初遇', ordinal: 1 },
      { id: 'c2', title: '后续', ordinal: 2 },
    ],
  }
}
const modelGraph = (evidenceIds: unknown) => ({
  people: [{ id: 'p1', name: '林舟', aliases: [], summary: '调查案件', evidenceIds }],
  relationships: [],
  threads: [],
})

describe('server-owned story graph evidence', () => {
  it('preserves original punctuation and line endings and derives only covered chapter links', () => {
    const sources = buildStoryGraphEvidenceSources(input())
    expect(sources).toHaveLength(1)
    expect(sources[0]).toMatchObject({ kind: 'relationship', quote, chapterIds: ['c1'] })
    const resolved = resolveStoryGraphEvidence(modelGraph([sources[0]!.id]), sources)
    expect(validateStoryGraph(resolved, input()).people[0]?.evidence).toEqual([{ kind: 'relationship', quote, chapterIds: ['c1'] }])
  })
  it('does not trust model-authored quote, kind or chapter links alongside a valid reference', () => {
    const sources = buildStoryGraphEvidenceSources(input())
    const graph = modelGraph([sources[0]!.id])
    const raw = { ...graph, people: [{ ...graph.people[0], evidence: [{ kind: 'plot', quote: '模型改写后的摘要', chapterIds: ['foreign'] }] }] }
    expect(validateStoryGraph(resolveStoryGraphEvidence(raw, sources), input()).people[0]?.evidence[0]).toMatchObject({
      kind: 'relationship',
      quote,
      chapterIds: ['c1'],
    })
  })
  it('rejects missing, oversized, non-string and stale evidence references with their paths', () => {
    const sources = buildStoryGraphEvidenceSources(input())
    for (const ids of [undefined, [], Array(9).fill(sources[0]!.id)]) {
      expect(() => resolveStoryGraphEvidence(modelGraph(ids), sources)).toThrow('people[0].evidenceIds')
    }
    for (const ids of [[{}], ['missing'], [sources[0]!.id]]) {
      const current = buildStoryGraphEvidenceSources(input(quote + '\n报告已经更新。'))
      expect(() => resolveStoryGraphEvidence(modelGraph(ids), current)).toThrow('people[0].evidenceIds[0]')
    }
  })
  it('keeps long reports fully represented by bounded exact excerpts and stable IDs', () => {
    const content = '林舟调查。' + '长段事实😀'.repeat(700) + '[[S1]]沈砚回应。'
    const sources = buildStoryGraphEvidenceSources(input(content))
    expect(sources.length).toBeGreaterThan(1)
    expect(sources.every((s) => s.quote.length <= 1200 && content.includes(s.quote))).toBe(true)
    expect(sources.some((s) => s.chapterIds.includes('c1'))).toBe(true)
    expect(sources.every((s) => !/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(s.quote))).toBe(true)
    expect(buildStoryGraphEvidenceSources(input(content))).toEqual(sources)
    expect(new Set(sources.map((s) => s.id)).size).toBe(sources.length)
    // Every original character is covered, including entries with no line breaks.
    const covered = new Set<number>()
    for (const source of sources) {
      const start = Number(source.id.slice(source.id.lastIndexOf('_') + 1))
      for (let i = start; i < start + source.quote.length; i++) covered.add(i)
    }
    expect(covered.size).toBe(content.length)
  })
  it('does not expose reports outside the anchor or graph kinds and separates evidence kinds', () => {
    const original = input()
    const combined = { ...original, reports: [report(), report(quote, { id: 'plot', kind: 'plot' })] }
    const sources = buildStoryGraphEvidenceSources(combined)
    expect(sources).toHaveLength(2)
    expect(sources[0]!.id).not.toBe(sources[1]!.id)
    expect(buildStoryGraphEvidenceSources({ ...original, reports: [report(quote, { kind: 'style' })] })).toEqual([])
    expect(buildStoryGraphEvidenceSources({ ...original, reports: [report(quote, { endChapter: { id: 'future', title: '未来' } })] })).toEqual([])
  })
  it('keeps identical S# citations local to each report and rejects combined chapter mappings', () => {
    const content = '林舟仍在调查。[[S1]]'
    const original = input(content)
    const second = report(content, { id: 'report-2', kind: 'characters',
      startChapter: { id: 'c2', title: '后续' }, endChapter: { id: 'c2', title: '后续' },
      sources: [{ ...report().sources[0]!, chapterId: 'c2', chapterOrdinal: 2 }],
    })
    const combined = { ...original, reports: [original.reports[0]!, second] }
    const sources = buildStoryGraphEvidenceSources(combined)
    expect(sources.map(source => source.chapterIds)).toEqual([['c1'], ['c2']])
    expect(sources[0]!.id).not.toBe(sources[1]!.id)
    for (let index = 0; index < sources.length; index++) {
      expect(validateStoryGraph(resolveStoryGraphEvidence(modelGraph([sources[index]!.id]), sources), combined)
        .people[0]?.evidence[0]?.chapterIds).toEqual([`c${index + 1}`])
    }
    const tampered = { ...modelGraph([]), people: [{ id: 'p1', name: '林舟', aliases: [], summary: '调查',
      evidence: [{ kind: 'relationship', quote: content, chapterIds: ['c1', 'c2'] }] }] }
    expect(() => validateStoryGraph(tampered, combined)).toThrow('章节来源')
    expect(buildStoryGraphEvidenceSources({ ...combined, chapters: original.chapters.slice(0, 1) }).map(source => source.chapterIds)).toEqual([['c1']])
  })
  it('never treats author-entered chapter markers as report sources and changes IDs on revision', () => {
    const original = input('林舟仍在调查。[章节ID:c1]')
    const sources = buildStoryGraphEvidenceSources(original)
    expect(sources[0]?.chapterIds).toEqual([])
    const updated = buildStoryGraphEvidenceSources({ ...original, reports: [report(original.reports[0]!.content, { revision: 2 })] })
    expect(updated[0]?.id).not.toBe(sources[0]?.id)
  })
  it('resolves relationship and thread references and reports unknown references in both collections', () => {
    const original = input()
    const combined = {
      ...original,
      reports: [original.reports[0]!, report('林舟发现信件。[[S1]]', { id: 'plot', kind: 'plot' })],
    }
    const sources = buildStoryGraphEvidenceSources(combined)
    const raw = {
      people: ['林舟', '沈砚'].map((name, i) => ({ id: `p${i}`, name, aliases: [], summary: '查案', evidenceIds: [sources[0]!.id] })),
      relationships: [{ id: 'r1', from: 'p0', to: 'p1', label: '合作', summary: '共同查案', directed: false, evidenceIds: [sources[0]!.id] }],
      threads: [{ id: 't1', title: '信件', kind: 'clue', people: ['p0'], summary: '发现线索', evidenceIds: [sources[1]!.id] }],
    }
    const graph = validateStoryGraph(resolveStoryGraphEvidence(raw, sources), combined)
    expect(graph.relationships[0]?.evidence[0]?.kind).toBe('relationship')
    expect(graph.threads[0]?.evidence[0]).toMatchObject({ kind: 'plot', quote: '林舟发现信件。[[S1]]', chapterIds: ['c1'] })
    for (const key of ['relationships', 'threads'] as const) {
      const broken = { ...raw, [key]: raw[key].map((node) => ({ ...node, evidenceIds: ['unknown'] })) }
      expect(() => resolveStoryGraphEvidence(broken, sources)).toThrow(`${key}[0].evidenceIds[0]`)
    }
  })
  it('still rejects unsupported person names after resolving valid references and identifies the node', () => {
    const sources = buildStoryGraphEvidenceSources(input())
    const raw = modelGraph([sources[0]!.id])
    raw.people[0]!.name = '虚构角色'
    expect(() => validateStoryGraph(resolveStoryGraphEvidence(raw, sources), input())).toThrow('people[0]：人物名称或别名')
  })
})
