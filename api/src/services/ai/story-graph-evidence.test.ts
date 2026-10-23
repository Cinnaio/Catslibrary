import { describe, expect, it } from 'vitest'
import type { StoryGraphResponse } from '@shared/story-graph'
import { buildStoryGraphEvidenceSources, resolveStoryGraphEvidence } from './story-graph-evidence'
import { validateStoryGraph } from './story-graph'

const quote = '林舟与沈砚合作查案。\r\n双方仍有隐瞒。[章节ID:c1][章节ID:c2][章节ID:foreign]'
function input(content = quote): Pick<StoryGraphResponse, 'archives' | 'chapters'> {
  return {
    archives: [{ kind: 'relationship', content, chaptersThrough: 1, eligibility: 'usable', origin: 'automatic' }],
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
      const current = buildStoryGraphEvidenceSources(input(quote + '\n档案已经更新。'))
      expect(() => resolveStoryGraphEvidence(modelGraph(ids), current)).toThrow('people[0].evidenceIds[0]')
    }
  })
  it('keeps long archives fully represented by bounded exact excerpts and stable IDs', () => {
    const content = '林舟调查。' + '长段事实😀'.repeat(700) + '[章节ID:c1]沈砚回应。'
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
  it('does not expose unusable archives and separates archive kinds', () => {
    const original = input()
    const combined = { ...original, archives: [original.archives[0]!, { ...original.archives[0]!, kind: 'plot' as const }] }
    const sources = buildStoryGraphEvidenceSources(combined)
    expect(sources).toHaveLength(2)
    expect(sources[0]!.id).not.toBe(sources[1]!.id)
    expect(buildStoryGraphEvidenceSources({ ...original, archives: [{ ...original.archives[0]!, eligibility: 'stale' }] })).toEqual([])
  })
  it('resolves relationship and thread references and reports unknown references in both collections', () => {
    const original = input()
    const combined = {
      ...original,
      archives: [original.archives[0]!, { ...original.archives[0]!, kind: 'plot' as const, content: '林舟发现信件。[章节ID:c1]' }],
    }
    const sources = buildStoryGraphEvidenceSources(combined)
    const raw = {
      people: ['林舟', '沈砚'].map((name, i) => ({ id: `p${i}`, name, aliases: [], summary: '查案', evidenceIds: [sources[0]!.id] })),
      relationships: [{ id: 'r1', from: 'p0', to: 'p1', label: '合作', summary: '共同查案', directed: false, evidenceIds: [sources[0]!.id] }],
      threads: [{ id: 't1', title: '信件', kind: 'clue', people: ['p0'], summary: '发现线索', evidenceIds: [sources[1]!.id] }],
    }
    const graph = validateStoryGraph(resolveStoryGraphEvidence(raw, sources), combined)
    expect(graph.relationships[0]?.evidence[0]?.kind).toBe('relationship')
    expect(graph.threads[0]?.evidence[0]).toMatchObject({ kind: 'plot', quote: '林舟发现信件。[章节ID:c1]', chapterIds: ['c1'] })
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
