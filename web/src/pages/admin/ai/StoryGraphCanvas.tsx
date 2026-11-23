import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { Maximize2, Minus, Plus, RotateCcw } from 'lucide-react'
import type { StoryGraph } from '@shared/story-graph'
import { fitStoryGraph, graphNeighborhood, storyGraphEdges, storyGraphLayout, type GraphPoint } from '@/lib/story-graph-layout'
import { Button } from '@/components/ui/button'
import styles from './StoryGraph.module.css'

type Props = {
  graph: StoryGraph
  selected: string
  onSelect: (id: string) => void
  showThreads: boolean
  focusOnly: boolean
  searchIds?: string[]
}

export default function StoryGraphCanvas({ graph, selected, onSelect, showThreads, focusOnly, searchIds }: Props) {
  const marker = useId().replace(/:/g, '')
  const [size, setSize] = useState({ width: 900, height: 560 })
  const compact = size.width < 500
  const person = graph.people.find((p) => p.id === selected)
  const relation = graph.relationships.find((r) => r.id === selected)
  const thread = graph.threads.find((t) => t.id === selected)
  const involved = new Set(person ? [person.id] : relation ? [relation.from, relation.to] : thread?.people || [])
  const contextIds = person ? graphNeighborhood(graph, person.id) : involved
  const searchContext = searchIds === undefined ? null : new Set(searchIds.flatMap((id) => [...graphNeighborhood(graph, id)]))
  const visiblePeople = graph.people.filter((p) => (searchContext ? searchContext.has(p.id) : !focusOnly || !involved.size || contextIds.has(p.id)))
  const ids = new Set(visiblePeople.map((p) => p.id))
  const relationships = graph.relationships.filter((r) => ids.has(r.from) && ids.has(r.to))
  const threads = showThreads
    ? graph.threads.filter((t) => t.people.some((id) => ids.has(id)) && (!focusOnly || !involved.size || t.people.some((id) => involved.has(id))))
    : []
  // Layout identity changes only when the actual visible set or focal person changes.
  const personKey = JSON.stringify(visiblePeople.map((p) => p.id))
  const centerId = focusOnly ? person?.id : undefined
  const original = storyGraphLayout({ ...graph, people: visiblePeople }, compact, centerId)
  const [moved, setMoved] = useState<Record<string, GraphPoint>>({})
  const positions = Object.fromEntries(Object.entries(original).map(([id, point]) => [id, moved[id] || point]))
  const [manualView, setManualView] = useState<{ key: string; x: number; y: number; scale: number } | null>(null)
  const svg = useRef<SVGSVGElement>(null)
  const gesture = useRef<{ pointerId: number; id?: string; x: number; y: number; start: GraphPoint; dragged: boolean } | null>(null)
  const suppressClick = useRef(false)

  useEffect(() => {
    const element = svg.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width > 0 && entry.contentRect.height > 0) setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const columns = compact ? 1 : 3
  const threadTop = Math.max(410, ...visiblePeople.map((p) => positions[p.id]?.y || 410)) + 140
  const threadPositions = Object.fromEntries(
    threads.map((t, index) => [
      t.id,
      {
        x: 600 + ((index % columns) - (Math.min(columns, threads.length) - 1) / 2) * 240,
        y: threadTop + Math.floor(index / columns) * 88,
      },
    ]),
  )
  const geometry = storyGraphEdges({ ...graph, relationships }, positions, compact ? 1.4 : 1)
  const geometryById = new Map(geometry.map((edge) => [edge.id, edge]))
  const fitted = fitStoryGraph(
    [
      ...visiblePeople.map((p) => ({ ...positions[p.id]!, width: 150, height: 110 })),
      ...Object.values(threadPositions).map((p) => ({ ...p, width: 220, height: 64 })),
      ...geometry.flatMap((edge) => [{ ...edge.label, width: edge.width, height: 36 }, edge.control]),
    ],
    size,
  )
  const layoutKey = `${size.width}:${size.height}:${personKey}:${centerId || ''}:${threads.map((t) => t.id).join(':')}`
  const view = manualView?.key === layoutKey ? manualView : fitted

  useEffect(() => {
    const element = svg.current
    if (!element) return
    const wheel = (event: WheelEvent) => {
      // Ordinary scrolling continues to move the page; zoom is an intentional gesture.
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      const scale = Math.max(Math.min(0.1, fitted.scale), Math.min(3, view.scale * (event.deltaY < 0 ? 1.12 : 1 / 1.12)))
      const rect = element.getBoundingClientRect()
      const x = event.clientX - rect.left - size.width / 2
      const y = event.clientY - rect.top - size.height / 2
      const ratio = scale / view.scale
      setManualView({ key: layoutKey, scale, x: x - (x - view.x) * ratio, y: y - (y - view.y) * ratio })
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [view, size, layoutKey, fitted.scale])

  function start(event: PointerEvent<SVGSVGElement>) {
    if (event.button !== 0 || !event.isPrimary) return
    if ((event.target as Element).closest('[data-edge], [data-thread]')) return
    const id = (event.target as Element).closest('[data-person]')?.getAttribute('data-person') || undefined
    suppressClick.current = false
    // Freeze the camera before moving a node, so auto-fit never follows the pointer.
    setManualView({ ...view, key: layoutKey })
    gesture.current = {
      pointerId: event.pointerId,
      id,
      x: event.clientX,
      y: event.clientY,
      start: id ? positions[id] || { x: 600, y: 410 } : { x: view.x, y: view.y },
      dragged: false,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  function move(event: PointerEvent<SVGSVGElement>) {
    const current = gesture.current
    if (!current || current.pointerId !== event.pointerId) return
    const rect = event.currentTarget.getBoundingClientRect()
    if (!rect.width) return
    const unit = size.width / rect.width
    const dx = (event.clientX - current.x) * unit,
      dy = (event.clientY - current.y) * unit
    if (Math.abs(dx) + Math.abs(dy) > 4) current.dragged = true
    if (!current.dragged) return
    if (current.id) setMoved((old) => ({ ...old, [current.id!]: { x: current.start.x + dx / view.scale, y: current.start.y + dy / view.scale } }))
    else setManualView({ key: layoutKey, scale: view.scale, x: current.start.x + dx, y: current.start.y + dy })
  }
  function end(event: PointerEvent<SVGSVGElement>) {
    const current = gesture.current
    if (current?.pointerId !== event.pointerId) return
    suppressClick.current = current.dragged
    if (current.id && !current.dragged) onSelect(current.id)
    gesture.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  function zoom(factor: number) {
    const scale = Math.max(Math.min(0.1, fitted.scale), Math.min(3, view.scale * factor))
    setManualView({ key: layoutKey, scale, x: (view.x * scale) / view.scale, y: (view.y * scale) / view.scale })
  }
  function selectKey(event: KeyboardEvent, id: string) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelect(id)
    }
  }
  function panKey(event: KeyboardEvent<SVGSVGElement>) {
    if (event.target !== event.currentTarget) return
    const steps: Record<string, [number, number]> = { ArrowLeft: [48, 0], ArrowRight: [-48, 0], ArrowUp: [0, 48], ArrowDown: [0, -48] }
    const step = steps[event.key]
    if (step) {
      event.preventDefault()
      setManualView({ ...view, key: layoutKey, x: view.x + step[0], y: view.y + step[1] })
    }
  }

  return (
    <div className={styles.canvas}>
      <div className={styles.canvasTools} role="group" aria-label="图谱画布工具">
        <Button variant="ghost" size="icon" aria-label="放大图谱" onClick={() => zoom(1.25)}>
          <Plus size={16} />
        </Button>
        <span className={styles.scale}>{Math.round(view.scale * 100)}%</span>
        <Button variant="ghost" size="icon" aria-label="缩小图谱" onClick={() => zoom(0.8)}>
          <Minus size={16} />
        </Button>
        <Button variant="ghost" size="icon" aria-label="适应当前图谱" onClick={() => setManualView(null)}>
          <Maximize2 size={16} />
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
          <RotateCcw size={16} />
        </Button>
      </div>
      {!visiblePeople.length && (
        <div className={styles.canvasEmpty}>
          <p>星图里还没有这个名字</p>
          <small>试试别名，或清除搜索看看全景。</small>
        </div>
      )}
      <svg
        ref={svg}
        viewBox={`0 0 ${size.width} ${size.height}`}
        role="group"
        tabIndex={0}
        aria-label="可交互故事图谱；方向键平移，也可从人物索引选择节点"
        onKeyDown={panKey}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={(event) => {
          gesture.current = null
          suppressClick.current = true
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
        }}
      >
        <defs>
          <marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
          </marker>
        </defs>
        <g transform={`translate(${size.width / 2 + view.x} ${size.height / 2 + view.y}) scale(${view.scale}) translate(-600 -410)`}>
          <g className={styles.orbits} aria-hidden="true">
            <circle cx="600" cy="410" r="210" />
            <circle cx="600" cy="410" r="420" />
          </g>
          {relationships.map((r) => {
            const edge = geometryById.get(r.id)
            if (!edge) return null
            const active = selected === r.id || involved.has(r.from) || involved.has(r.to)
            const dimmed = involved.size > 0 && !active
            const labelVisible = active || relationships.length <= 12
            const labelFont = 12 / Math.min(1, Math.max(0.65, view.scale))
            const badgeWidth = Math.max(44, Array.from(r.label).length * labelFont + 20)
            return (
              <g
                key={r.id}
                data-edge=""
                className={styles.edge}
                data-active={active || undefined}
                data-dimmed={dimmed || undefined}
                data-label-visible={labelVisible || undefined}
                role="button"
                tabIndex={0}
                aria-pressed={selected === r.id}
                aria-label={`${graph.people.find((p) => p.id === r.from)?.name}${r.directed ? '到' : '与'}${graph.people.find((p) => p.id === r.to)?.name}：${r.label}`}
                onClick={() => onSelect(r.id)}
                onKeyDown={(event) => selectKey(event, r.id)}
              >
                <path className={styles.edgeHit} d={edge.path} />
                <path
                  className={styles.edgeLine}
                  d={edge.path}
                  markerEnd={r.directed ? `url(#${marker})` : undefined}
                  strokeDasharray={r.certainty === 'inference' || r.certainty === 'possibility' ? '6 5' : undefined}
                />
                <g className={styles.edgeBadge}>
                  <line x1={edge.anchor.x} y1={edge.anchor.y} x2={edge.label.x} y2={edge.label.y} />
                  <rect x={edge.label.x - badgeWidth / 2} y={edge.label.y - (labelFont + 12) / 2} width={badgeWidth} height={labelFont + 12} rx="5" />
                  <text x={edge.label.x} y={edge.label.y} dominantBaseline="central" textAnchor="middle" style={{ fontSize: labelFont }}>
                    {r.label}
                  </text>
                </g>
                <title>{r.summary}</title>
              </g>
            )
          })}
          {threads.map((t) => {
            const point = threadPositions[t.id]!
            return (
              <g key={t.id}>
                {t.people
                  .filter((id) => ids.has(id))
                  .map((id) => (
                    <line className={styles.threadLink} key={id} x1={positions[id]!.x} y1={positions[id]!.y} x2={point.x} y2={point.y} />
                  ))}
                <g
                  data-thread=""
                  role="button"
                  tabIndex={0}
                  aria-label={`情节：${t.title}`}
                  aria-pressed={selected === t.id}
                  className={styles.thread}
                  transform={`translate(${point.x},${point.y})`}
                  onClick={() => onSelect(t.id)}
                  onKeyDown={(event) => selectKey(event, t.id)}
                >
                  <rect x="-105" y="-24" width="210" height="48" rx="10" />
                  <text textAnchor="middle" dominantBaseline="central">
                    {Array.from(t.title).length > 13 ? `${Array.from(t.title).slice(0, 12).join('')}…` : t.title}
                  </text>
                  <title>{t.title}</title>
                </g>
              </g>
            )
          })}
          {visiblePeople.map((p) => {
            const point = positions[p.id]!
            const active = involved.has(p.id)
            const dimmed = involved.size > 0 && !contextIds.has(p.id)
            const match = searchIds?.includes(p.id)
            return (
              <g
                key={p.id}
                data-person={p.id}
                role="button"
                tabIndex={0}
                aria-label={`人物：${p.name}`}
                aria-pressed={selected === p.id}
                className={styles.person}
                data-active={active || undefined}
                data-dimmed={dimmed || undefined}
                data-match={match || undefined}
                transform={`translate(${point.x},${point.y})`}
                onKeyDown={(event) => selectKey(event, p.id)}
                onClick={(event) => {
                  if (event.detail === 0 && !suppressClick.current) onSelect(p.id)
                  suppressClick.current = false
                }}
              >
                <circle className={styles.personHalo} r="39" />
                <circle className={styles.personBody} r="28" />
                <text className={styles.personGlyph} textAnchor="middle" dominantBaseline="central" aria-hidden="true">
                  {Array.from(p.name)[0]}
                </text>
                <text className={styles.personName} textAnchor="middle" y="53">
                  {Array.from(p.name).length > 10 ? `${Array.from(p.name).slice(0, 9).join('')}…` : p.name}
                </text>
                <title>
                  {p.name}：{p.summary}
                </title>
              </g>
            )
          })}
        </g>
      </svg>
      <p className={styles.canvasHint}>拖动人物或空白处 · Ctrl / ⌘ + 滚轮缩放</p>
    </div>
  )
}
