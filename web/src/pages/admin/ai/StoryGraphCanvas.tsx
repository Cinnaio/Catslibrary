import { useEffect, useId, useMemo, useRef, useState, type PointerEvent } from 'react'
import { Focus, Minus, Plus, RotateCcw } from 'lucide-react'
import type { StoryGraph } from '@shared/story-graph'
import { fitStoryGraph, graphNeighborhood, storyGraphEdges, storyGraphLayout, type GraphPoint } from '@/lib/story-graph-layout'
import { Button } from '@/components/ui/button'

export default function StoryGraphCanvas({
  graph,
  selected,
  onSelect,
  showThreads,
  focusOnly,
}: {
  graph: StoryGraph
  selected: string
  onSelect: (id: string) => void
  showThreads: boolean
  focusOnly: boolean
}) {
  const marker = useId().replace(/:/g, '')
  const [size, setSize] = useState({ width: 900, height: 600 })
  const compact = size.width < 500
  const original = useMemo(() => storyGraphLayout(graph, compact), [graph, compact])
  const [moved, setMoved] = useState<Record<string, GraphPoint>>({})
  const positions = { ...original, ...moved }
  const [manualView, setManualView] = useState<{ key: string; x: number; y: number; scale: number } | null>(null)
  const svg = useRef<SVGSVGElement>(null)
  useEffect(() => {
    const element = svg.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width > 0) setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const gesture = useRef<{ pointerId: number; id?: string; x: number; y: number; start: GraphPoint; dragged: boolean } | null>(null)
  const neighborhood = graph.people.some((p) => p.id === selected) ? graphNeighborhood(graph, selected) : null
  const visiblePeople = focusOnly && neighborhood ? graph.people.filter((p) => neighborhood.has(p.id)) : graph.people
  const ids = new Set(visiblePeople.map((p) => p.id))
  const threads = showThreads ? graph.threads.filter((t) => t.people.some((id) => ids.has(id)) && (!neighborhood || t.people.includes(selected))) : []
  const threadPositions: Record<string, GraphPoint> = {}
  const columns = compact ? 1 : 3
  const threadTop = Math.max(...visiblePeople.map((p) => original[p.id]?.y || 410)) + 120
  threads.forEach((t, i) => {
    threadPositions[t.id] = { x: 600 + ((i % columns) - (Math.min(columns, threads.length) - 1) / 2) * 220, y: threadTop + Math.floor(i / columns) * 90 }
  })
  const visibleGraph = { ...graph, relationships: graph.relationships.filter((r) => ids.has(r.from) && ids.has(r.to)) }
  const geometry = storyGraphEdges(visibleGraph, positions, compact ? 1.6 : 1)
  const baseGeometry = storyGraphEdges(visibleGraph, original, compact ? 1.6 : 1)
  const fitted = fitStoryGraph(
    [
      ...visiblePeople.map((p) => original[p.id]!).filter(Boolean),
      ...Object.values(threadPositions).map((p) => ({ ...p, width: 190, height: 64 })),
      ...baseGeometry.flatMap((e) => [{ ...e.label, width: e.width, height: 36 }, e.control]),
    ],
    size,
  )
  const layoutKey = `${size.width}:${size.height}:${visiblePeople.map((p) => p.id)}:${threads.map((t) => t.id)}`
  const view = manualView?.key === layoutKey ? manualView : fitted

  function start(e: PointerEvent<SVGSVGElement>) {
    if (e.button !== 0 || !e.isPrimary) return
    const target = (e.target as Element).closest('[data-person]')
    const id = target?.getAttribute('data-person') || undefined
    if ((e.target as Element).closest('[data-edge], [data-thread]')) return
    gesture.current = {
      pointerId: e.pointerId,
      id,
      x: e.clientX,
      y: e.clientY,
      start: id ? positions[id] || { x: 600, y: 410 } : { x: view.x, y: view.y },
      dragged: false,
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  function move(e: PointerEvent<SVGSVGElement>) {
    const g = gesture.current
    if (!g || g.pointerId !== e.pointerId) return
    const rect = e.currentTarget.getBoundingClientRect()
    const unit = size.width / rect.width
    const dx = (e.clientX - g.x) * unit,
      dy = (e.clientY - g.y) * unit
    if (Math.abs(dx) + Math.abs(dy) > 4) g.dragged = true
    if (g.id) setMoved((old) => ({ ...old, [g.id!]: { x: g.start.x + dx / view.scale, y: g.start.y + dy / view.scale } }))
    else setManualView({ key: layoutKey, scale: view.scale, x: g.start.x + dx, y: g.start.y + dy })
  }
  function end(e: PointerEvent<SVGSVGElement>) {
    const g = gesture.current
    if (g?.pointerId !== e.pointerId) return
    if (g.id && !g.dragged) onSelect(g.id)
    gesture.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }
  function zoom(delta: number) {
    const scale = Math.max(0.1, Math.min(3, view.scale + delta))
    setManualView({ key: layoutKey, scale, x: (view.x * scale) / view.scale, y: (view.y * scale) / view.scale })
  }
  const selectKey = (event: React.KeyboardEvent, id: string) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelect(id)
    }
  }

  return (
    <div className="story-graph-canvas">
      <div className="story-graph-canvas__tools" aria-label="图谱画布工具">
        <Button variant="ghost" size="icon" aria-label="放大图谱" onClick={() => zoom(0.2)}>
          <Plus className="size-4" />
        </Button>
        <span className="story-graph-canvas__scale" aria-live="polite">
          {Math.round(view.scale * 100)}%
        </span>
        <Button variant="ghost" size="icon" aria-label="缩小图谱" onClick={() => zoom(-0.2)}>
          <Minus className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="重置布局和缩放"
          onClick={() => {
            setMoved({})
            setManualView(null)
          }}
        >
          <RotateCcw className="size-4" />
        </Button>
      </div>
      <svg
        ref={svg}
        viewBox={`0 0 ${size.width} ${size.height}`}
        role="group"
        aria-label="可交互故事图谱；可用下方人物列表选择节点"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={() => {
          gesture.current = null
        }}
      >
        <defs>
          <marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
          </marker>
        </defs>
        <g transform={`translate(${size.width / 2 + view.x} ${size.height / 2 + view.y}) scale(${view.scale}) translate(-600 -410)`}>
          {graph.relationships
            .filter((r) => ids.has(r.from) && ids.has(r.to))
            .map((r, index) => {
              const a = positions[r.from],
                b = positions[r.to]
              if (!a || !b) return null
              const edge = geometry.find((e) => e.id === r.id)
              if (!edge) return null
              const dim = neighborhood && !neighborhood.has(r.from) && !neighborhood.has(r.to)
              return (
                <g
                  key={r.id}
                  data-edge=""
                  className={`story-graph-edge ${selected === r.id ? 'is-selected' : ''} ${dim ? 'is-dimmed' : ''}`}
                  role="button"
                  tabIndex={0}
                  aria-label={`${graph.people.find((p) => p.id === r.from)?.name}${r.directed ? '到' : '与'}${graph.people.find((p) => p.id === r.to)?.name}：${r.label}`}
                  onClick={() => onSelect(r.id)}
                  onKeyDown={(e) => selectKey(e, r.id)}
                >
                  <path className="story-graph-edge__hit" d={edge.path} />
                  <path
                    className="story-graph-edge__line"
                    d={edge.path}
                    markerEnd={r.directed ? `url(#${marker})` : undefined}
                    strokeDasharray={r.certainty === 'inference' || r.certainty === 'possibility' ? '5 5' : undefined}
                  />
                  <line className="story-graph-edge__leader" x1={edge.anchor.x} y1={edge.anchor.y} x2={edge.label.x} y2={edge.label.y} />
                  <text x={edge.label.x} y={edge.label.y + 4} style={{ fontSize: Math.max(13, 10 / view.scale) }} className="story-graph-edge__label">
                    {r.label}
                  </text>
                  <title>
                    {r.summary} · 关系 {index + 1}
                  </title>
                </g>
              )
            })}
          {threads.map((t) => {
            const point = moved[t.id] || threadPositions[t.id]
            if (!point) return null
            const maxChars = Math.max(4, Math.floor((170 * view.scale - 16) / Math.max(10, 13 * view.scale)))
            return (
              <g key={t.id}>
                {t.people
                  .filter((id) => ids.has(id))
                  .map((id) => {
                    const p = positions[id]
                    return p ? <line key={id} className="story-graph-thread-link" x1={p.x} y1={p.y} x2={point.x} y2={point.y} /> : null
                  })}
                <g
                  data-thread=""
                  role="button"
                  tabIndex={0}
                  aria-label={`情节：${t.title}`}
                  className={`story-graph-thread ${selected === t.id ? 'is-selected' : ''}`}
                  transform={`translate(${point.x},${point.y})`}
                  onClick={() => onSelect(t.id)}
                  onKeyDown={(e) => selectKey(e, t.id)}
                >
                  <rect x="-85" y="-23" width="170" height="46" rx="8" />
                  <text textAnchor="middle" y="5" style={{ fontSize: Math.max(13, 10 / view.scale) }}>
                    {t.title.length > maxChars ? `${t.title.slice(0, maxChars - 1)}…` : t.title}
                  </text>
                  <title>{t.title}</title>
                </g>
              </g>
            )
          })}
          {visiblePeople.map((p) => {
            const pos = positions[p.id]
            if (!pos) return null
            return (
              <g
                key={p.id}
                data-person={p.id}
                role="button"
                tabIndex={0}
                aria-label={`人物：${p.name}`}
                aria-pressed={selected === p.id}
                className={`story-graph-person ${selected === p.id ? 'is-selected' : ''} ${neighborhood && !neighborhood.has(p.id) ? 'is-dimmed' : ''}`}
                transform={`translate(${pos.x},${pos.y})`}
                onKeyDown={(e) => selectKey(e, p.id)}
              >
                <circle r={Math.max(34, 23 / view.scale)} />
                <text textAnchor="middle" y="6" style={{ fontSize: Math.max(16, 11 / view.scale) }}>
                  {p.name.length <= 4 ? p.name : p.name.slice(0, 3) + '…'}
                </text>
                <title>
                  {p.name}：{p.summary}
                </title>
              </g>
            )
          })}
        </g>
      </svg>
      <p className="story-graph-canvas__hint">
        <Focus className="size-3.5" />
        拖动人物调整位置 · 拖动画布平移 · 点击连线查看关系
      </p>
    </div>
  )
}
