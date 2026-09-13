import type { ComponentProps, CSSProperties, ReactNode } from 'react'
import { Search as SearchIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export interface AdminMetricItem {
  id?: string
  label: ReactNode
  value: ReactNode
  detail?: ReactNode
  detailTone?: 'muted' | 'success'
}

export interface AdminQueueStat {
  id?: string
  label: ReactNode
  value: ReactNode
  detail?: ReactNode
}

interface AdminToolbarProps {
  children: ReactNode
  ariaLive?: 'off' | 'polite' | 'assertive'
  className?: string
  /**
   * 'inline'（默认）：搜索与筛选排一行，按容器宽度伸缩。
   * 'stacked'：搜索在上、批量操作独立成第二行（分隔线区隔）。
   */
  layout?: 'inline' | 'stacked'
}

export function AdminToolbar({ children, ariaLive = 'off', className, layout = 'inline' }: AdminToolbarProps) {
  return (
    <div className={cn('admin-toolbar', `admin-toolbar--${layout}`, className)} aria-live={ariaLive} data-layout={layout}>
      {children}
    </div>
  )
}

interface AdminSearchProps extends ComponentProps<'input'> {
  /** 读屏用的标签文字；视觉上隐藏。 */
  label: string
}

/**
 * 工具栏搜索框：在输入框内左侧嵌入放大镜图标。
 * 光秃的 Input 只有一个 placeholder 作为「这是搜索」的线索，一旦输入内容
 * 线索就消失；图标提供常驻的视觉锚点，也是搜索控件的通用惯例。
 */
export function AdminSearch({ label, className, id, ...props }: AdminSearchProps) {
  return (
    <div className="admin-search">
      <SearchIcon className="admin-search__icon" aria-hidden="true" />
      <Label htmlFor={id} className="sr-only">
        {label}
      </Label>
      <Input id={id} className={cn('admin-search__input', className)} {...props} />
    </div>
  )
}

interface AdminContextPanelProps {
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  aside?: ReactNode
  className?: string
}

export function AdminContextPanel({ eyebrow, title, description, aside, className }: AdminContextPanelProps) {
  return (
    <section className={cn('admin-context-panel', className)}>
      <div className="admin-context-panel__copy">
        {eyebrow && <span className="admin-section-kicker">{eyebrow}</span>}
        <h3>{title}</h3>
        {description && <p>{description}</p>}
      </div>
      {aside && <div className="admin-context-panel__aside">{aside}</div>}
    </section>
  )
}

interface AdminMetricStripProps {
  items: readonly AdminMetricItem[]
  ariaLabel?: string
  className?: string
}

export function AdminMetricStrip({ items, ariaLabel = '数据概览', className }: AdminMetricStripProps) {
  return (
    <section
      className={cn('admin-metric-strip', className)}
      aria-label={ariaLabel}
      // 列数跟随实际项数：默认 4 列在只传 3 项时会在末尾留一块空白格
      // （背景色来自 .admin-metric-strip 的 gap 填充色，视觉上像坏的占位块）。
      style={{ '--admin-metric-columns': items.length || 1 } as CSSProperties}
    >
      {items.map((item, index) => (
        <div className="admin-metric-strip__item" key={item.id ?? `metric-${index}`}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
          {item.detail && <small className={item.detailTone === 'success' ? 'admin-metric-strip__detail--success' : undefined}>{item.detail}</small>}
        </div>
      ))}
    </section>
  )
}

interface AdminQueueSummaryProps {
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  stats: readonly AdminQueueStat[]
  ariaLabel?: string
  className?: string
}

export function AdminQueueSummary({ eyebrow, title, description, stats, ariaLabel = '队列概览', className }: AdminQueueSummaryProps) {
  return (
    <section
      className={cn('admin-queue-summary', className)}
      aria-label={ariaLabel}
      // 列数跟随实际项数：CSS 里硬编码 repeat(3, …)，传入 2 或 4 项时
      // 会留空白格或溢出。
      style={{ '--admin-queue-columns': stats.length || 1 } as CSSProperties}
    >
      <div className="admin-queue-summary__lead">
        {eyebrow && <span className="admin-section-kicker">{eyebrow}</span>}
        <strong>{title}</strong>
        {description && <span>{description}</span>}
      </div>
      {stats.map((stat, index) => (
        <div className="admin-queue-summary__stat" key={stat.id ?? `queue-stat-${index}`}>
          <span>{stat.label}</span>
          <strong>{stat.value}</strong>
          {stat.detail && <small>{stat.detail}</small>}
        </div>
      ))}
    </section>
  )
}

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
  children: ReactNode
  ariaLabel?: string
  className?: string
  /** 传入后启用固定列宽 + 移动端卡片化；不传则保持原样（兼容存量用法）。 */
  columns?: readonly AdminColumn[]
}

export function AdminDataPanel({ children, ariaLabel, className, columns }: AdminDataPanelProps) {
  // 列宽走 CSS 变量：colgroup 必须直接位于 <table> 内，而表格由调用方渲染，
  // 故这里只注入变量，由 .admin-data-table 的 table-layout: fixed 消费。
  const style = columns ? (Object.fromEntries(columns.flatMap((col, i) => (col.width ? [[`--col-${i + 1}-w`, col.width]] : []))) as CSSProperties) : undefined

  return (
    <section className={cn('admin-data-panel', columns && 'admin-data-panel--grid', className)} aria-label={ariaLabel} style={style}>
      {children}
    </section>
  )
}

interface AdminPanelHeadingProps {
  title: ReactNode
  description?: ReactNode
  status?: ReactNode
  actions?: ReactNode
  className?: string
}

export function AdminPanelHeading({ title, description, status, actions, className }: AdminPanelHeadingProps) {
  return (
    <div className={cn('admin-panel-heading', className)}>
      <div className="admin-panel-heading__copy">
        <h3>{title}</h3>
        {description && <p>{description}</p>}
      </div>
      {(status || actions) && (
        <div className="admin-panel-heading__actions">
          {status}
          {actions}
        </div>
      )}
    </div>
  )
}
