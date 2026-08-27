import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

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
}

export function AdminToolbar({ children, ariaLive = 'off', className }: AdminToolbarProps) {
  return (
    <div className={cn('admin-toolbar', className)} aria-live={ariaLive}>
      {children}
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
    <section className={cn('admin-metric-strip', className)} aria-label={ariaLabel}>
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
    <section className={cn('admin-queue-summary', className)} aria-label={ariaLabel}>
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

interface AdminDataPanelProps {
  children: ReactNode
  ariaLabel?: string
  className?: string
}

export function AdminDataPanel({ children, ariaLabel, className }: AdminDataPanelProps) {
  return (
    <section className={cn('admin-data-panel', className)} aria-label={ariaLabel}>
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
