import type { StoryGraph } from '@shared/story-graph'

export interface GraphPoint {
  x: number
  y: number
}
/** Stable placement keeps the same archive from rearranging on every render. */
export function storyGraphLayout(graph: StoryGraph, compact = false): Record<string, GraphPoint> {
  const degree = new Map<string, number>()
  for (const r of graph.relationships) for (const id of [r.from, r.to]) degree.set(id, (degree.get(id) || 0) + 1)
  const people = [...graph.people].sort((a, b) => (degree.get(b.id) || 0) - (degree.get(a.id) || 0) || a.id.localeCompare(b.id))
  const positions: Record<string, GraphPoint> = {}
  people.forEach((p, i) => {
    if (i === 0) {
      positions[p.id] = { x: 600, y: 410 }
      return
    }
    const ring = i <= 10 ? 1 : i <= 30 ? 2 : 3
    const start = ring === 1 ? 1 : ring === 2 ? 11 : 31
    const count = Math.min(ring === 1 ? 10 : ring === 2 ? 20 : 30, people.length - start)
    const angle = ((i - start) / Math.max(1, count)) * Math.PI * 2 - Math.PI / 2
    positions[p.id] = { x: 600 + Math.cos(angle) * ring * (compact ? 200 : 290), y: 410 + Math.sin(angle) * ring * 210 }
  })
  return positions
}

export interface GraphEdgeGeometry {
  id: string
  path: string
  label: GraphPoint
  anchor: GraphPoint
  control: GraphPoint
  width: number
}
export function storyGraphEdges(graph: StoryGraph, positions: Record<string, GraphPoint>, labelScale = 1): GraphEdgeGeometry[] {
  const labels: Array<{ x: number; y: number; width: number }> = []
  return graph.relationships.flatMap((r) => {
    const a = positions[r.from],
      b = positions[r.to]
    if (!a || !b) return []
    const length = Math.hypot(b.x - a.x, b.y - a.y) || 1
    const from = { x: a.x + ((b.x - a.x) / length) * 38, y: a.y + ((b.y - a.y) / length) * 38 }
    const to = { x: b.x - ((b.x - a.x) / length) * 43, y: b.y - ((b.y - a.y) / length) * 43 }
    // Canonical orientation prevents reversed A→B / B→A edges from sharing a lane.
    const canonicalA = r.from < r.to ? a : b,
      canonicalB = r.from < r.to ? b : a
    const nx = -(canonicalB.y - canonicalA.y) / length,
      ny = (canonicalB.x - canonicalA.x) / length
    const siblings = graph.relationships.filter((other) => (other.from === r.from && other.to === r.to) || (other.to === r.from && other.from === r.to))
    const lane = siblings.findIndex((other) => other.id === r.id) - (siblings.length - 1) / 2
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    const throughCenter = Math.hypot(mid.x - 600, mid.y - 410) < 180 && Math.hypot(a.x - 600, a.y - 410) > 20 && Math.hypot(b.x - 600, b.y - 410) > 20
    const bend = throughCenter ? ((mid.x - 600) * nx + (mid.y - 410) * ny >= 0 ? 190 : -190) : 28
    const control = { x: mid.x + nx * (bend + lane * 110), y: mid.y + ny * (bend + lane * 110) }
    const width = Math.max(56, r.label.length * 14 * labelScale + 16)
    let best: { label: GraphPoint; anchor: GraphPoint; score: number } | undefined
    for (const t of [0.5, 0.35, 0.65, 0.22, 0.78])
      for (const offset of [14, 36, -20, 60, -44, 88, -72]) {
        const anchor = {
          x: (1 - t) ** 2 * from.x + 2 * (1 - t) * t * control.x + t * t * to.x,
          y: (1 - t) ** 2 * from.y + 2 * (1 - t) * t * control.y + t * t * to.y,
        }
        const label = { x: anchor.x + nx * offset, y: anchor.y + ny * offset }
        const overlapLabels = labels.filter((l) => Math.abs(l.x - label.x) < (l.width + width) / 2 + 10 && Math.abs(l.y - label.y) < 30).length
        const overlapPeople = Object.values(positions).filter((p) => Math.abs(p.x - label.x) < width / 2 + 45 && Math.abs(p.y - label.y) < 58).length
        const score = overlapLabels * 10000 + overlapPeople * 10000 + Math.abs(offset) * 0.1 + Math.abs(t - 0.5) * 20
        if (!best || score < best.score) best = { label, anchor, score }
      }
    const chosen = best!
    labels.push({ ...chosen.label, width })
    return [{ id: r.id, path: `M${from.x},${from.y} Q${control.x},${control.y} ${to.x},${to.y}`, label: chosen.label, anchor: chosen.anchor, control, width }]
  })
}

/** Fit all active nodes/labels, reserving space for the top tools and bottom hint. */
export function fitStoryGraph(points: Array<GraphPoint & { width?: number; height?: number }>, size: { width: number; height: number }) {
  if (!points.length) return { x: 0, y: 0, scale: 1 }
  const left = Math.min(...points.map((p) => p.x - (p.width || 86) / 2)),
    right = Math.max(...points.map((p) => p.x + (p.width || 86) / 2))
  const top = Math.min(...points.map((p) => p.y - (p.height || 86) / 2)),
    bottom = Math.max(...points.map((p) => p.y + (p.height || 86) / 2))
  const scale = Math.min(1.25, Math.max(1, size.width - 48) / (right - left), Math.max(1, size.height - 132) / (bottom - top))
  return { x: (600 - (left + right) / 2) * scale, y: (410 - (top + bottom) / 2) * scale + 12, scale }
}

export function graphNeighborhood(graph: StoryGraph, personId: string): Set<string> {
  const ids = new Set([personId])
  for (const r of graph.relationships)
    if (r.from === personId || r.to === personId) {
      ids.add(r.from)
      ids.add(r.to)
    }
  return ids
}
