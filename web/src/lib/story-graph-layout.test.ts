import { describe, expect, it } from 'vitest'
import type { StoryGraph } from '@shared/story-graph'
import { fitStoryGraph, storyGraphEdges, storyGraphLayout } from './story-graph-layout'

const graph: StoryGraph = {
  version: 1,
  people: ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id, name: id, aliases: [], summary: '', evidence: [] })),
  threads: [],
  relationships: [
    ['a', 'b'],
    ['a', 'c'],
    ['a', 'd'],
    ['a', 'e'],
    ['b', 'c'],
    ['c', 'f'],
    ['d', 'b'],
  ].map(([from, to], i) => ({ id: `r${i}`, from: from!, to: to!, label: '合作与试探', summary: '', directed: true, certainty: 'inference', evidence: [] })),
}
describe('story graph diagram geometry', () => {
  it('keeps neighboring labels distinct in a six-person network', () => {
    const edges = storyGraphEdges(graph, storyGraphLayout(graph))
    for (const [index, a] of edges.entries())
      for (const b of edges.slice(index + 1)) {
        const overlap = Math.abs(a.label.x - b.label.x) < (a.width + b.width) / 2 && Math.abs(a.label.y - b.label.y) < 24
        expect(overlap).toBe(false)
      }
  })
  it('routes reversed directional relationships on separate physical curves', () => {
    const two = { ...graph, relationships: [graph.relationships[0]!, { ...graph.relationships[0]!, id: 'reverse', from: 'b', to: 'a' }] }
    const edges = storyGraphEdges(two, storyGraphLayout(two))
    expect(edges[0]!.control).not.toEqual(edges[1]!.control)
  })
  it('fits all node and thread extents within mobile padding', () => {
    const points = [...Object.values(storyGraphLayout(graph, true)), { x: 600, y: 850, width: 190, height: 64 }]
    const size = { width: 358, height: 560 },
      camera = fitStoryGraph(points, size)
    for (const p of points) {
      const width = 'width' in p ? (p.width as number) : 86
      const height = 'height' in p ? (p.height as number) : 86
      const x = size.width / 2 + camera.x + (p.x - 600) * camera.scale,
        y = size.height / 2 + camera.y + (p.y - 410) * camera.scale
      expect(x - (width / 2) * camera.scale).toBeGreaterThanOrEqual(23)
      expect(x + (width / 2) * camera.scale).toBeLessThanOrEqual(size.width - 23)
      expect(y - (height / 2) * camera.scale).toBeGreaterThanOrEqual(65)
      expect(y + (height / 2) * camera.scale).toBeLessThanOrEqual(size.height - 40)
    }
  })
})
