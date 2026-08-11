/**
 * 固定行高虚拟列表 —— 由 read.js createVirtualList 平移。
 * 仅渲染可视区行（含缓冲），行绝对定位在 sizer 内。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'

interface VirtualListProps<T> {
  items: T[]
  rowHeight: number
  renderRow: (item: T, index: number) => ReactNode
  /** 初始滚动到某索引（如当前章节）。 */
  scrollToIndex?: number
  className?: string
  ariaLabel?: string
}

export function VirtualList<T>({ items, rowHeight, renderRow, scrollToIndex, className, ariaLabel }: VirtualListProps<T>) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [range, setRange] = useState<[number, number]>([0, 0])
  const rafId = useRef(0)
  const rangeRef = useRef<[number, number] | null>(null)

  const paint = () => {
    const el = scrollRef.current
    if (!el) return
    const viewH = el.clientHeight || rowHeight * 8
    const first = Math.max(0, Math.floor(el.scrollTop / rowHeight) - 4)
    const last = Math.min(items.length, Math.ceil((el.scrollTop + viewH) / rowHeight) + 4)
    if (rangeRef.current && rangeRef.current[0] === first && rangeRef.current[1] === last) return
    rangeRef.current = [first, last]
    setRange([first, last])
  }

  // 数据变化重算
  useEffect(() => {
    rangeRef.current = null
    paint()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length])

  // 初始滚动定位
  useEffect(() => {
    if (scrollToIndex !== undefined && scrollToIndex >= 0 && scrollRef.current) {
      // 下拉由 display:none 切到 flex，max-height 在本帧尚未约束容器，
      // 此时 clientHeight === scrollHeight，scrollTop 会被钳为 0。
      // 推迟到下一帧再定位，等布局稳定。
      const raf = requestAnimationFrame(() => {
        const el = scrollRef.current
        if (!el) return
        const viewH = el.clientHeight || rowHeight * 8
        el.scrollTop = Math.max(0, scrollToIndex * rowHeight - (viewH - rowHeight) / 2)
        rangeRef.current = null
        paint()
      })
      return () => cancelAnimationFrame(raf)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToIndex, rowHeight])

  return (
    <div
      ref={scrollRef}
      className={className}
      role={ariaLabel ? 'listbox' : undefined}
      aria-label={ariaLabel}
      onScroll={() => {
        if (rafId.current) return
        rafId.current = requestAnimationFrame(() => {
          rafId.current = 0
          paint()
        })
      }}
    >
      <div style={{ height: items.length * rowHeight, position: 'relative' }}>
        {items.slice(range[0], range[1]).map((item, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              top: (range[0] + i) * rowHeight,
              left: 0,
              right: 0,
              height: rowHeight,
            }}
          >
            {renderRow(item, range[0] + i)}
          </div>
        ))}
      </div>
    </div>
  )
}
