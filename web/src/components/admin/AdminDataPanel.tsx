import '@/styles/admin/components/readability.css'
import '@/styles/admin/components/table-motion.css'
import '@/styles/admin/components/tables.css'
import type { CSSProperties, ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * 数据表格列定义。
 *
 * 桌面端：据 width 生成 CSS 变量注入表格，配合 table-layout: fixed 让表头与
 * 内容严格对齐（此前 auto 布局下两者各算各的，列边界错开）。
 * 移动端：列自动转为卡片字段，见 admin-operations.css 的
 * .admin-data-panel--grid。列定义只提供 CSS 宽度/语义元数据，调用方仍需在
 * TableCell 上写 data-label、data-primary、data-actions。
 */
export interface AdminColumn {
  /** 稳定键名，用于生成单元格标签与 React key。 */
  key: string
  /** 移动端卡片里显示的字段名；不传则该列在移动端隐藏。 */
  label?: string
  /** 桌面端列宽，如 '11rem'；不传则等分剩余空间。 */
  width?: string
  /** 该列为主字段：移动端跨整行、加大字号。 */
  primary?: boolean
  /** 该列为操作区：移动端贴卡片底部并允许换行。 */
  actions?: boolean
}

interface AdminDataPanelProps {
  /** Comfortable lists provide more room around multi-line identity and metadata. */
  density?: 'compact' | 'comfortable'
  children: ReactNode
  ariaLabel?: string
  className?: string
  /** 传入后启用固定列宽 + 移动端卡片化；不传则保持原样（兼容存量用法）。 */
  columns?: readonly AdminColumn[]
  /** 含跨列详情的表格可保留窄屏横向滚动，仍共享表格外观。 */
  responsive?: 'cards' | 'scroll'
}

export function AdminDataPanel({ children, ariaLabel, className, columns, density = 'compact', responsive = 'cards' }: AdminDataPanelProps) {
  // 列宽走 CSS 变量：colgroup 必须直接位于 <table> 内，而表格由调用方渲染，
  // 故这里只注入变量，由 .admin-data-table 的 table-layout: fixed 消费。
  const style = columns ? (Object.fromEntries(columns.flatMap((col, i) => (col.width ? [[`--col-${i + 1}-w`, col.width]] : []))) as CSSProperties) : undefined

  return (
    <section
      className={cn(
        'admin-data-panel',
        columns && (responsive === 'scroll' ? 'admin-data-panel--scroll' : 'admin-data-panel--grid'),
        `admin-data-panel--${density}`,
        className,
      )}
      aria-label={ariaLabel}
      style={style}
    >
      {children}
    </section>
  )
}
