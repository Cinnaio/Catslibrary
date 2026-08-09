/**
 * AdminTabHeader — unified page header for every admin tab.
 * Replaces the 3 legacy patterns: hero (admin-page-intro dashboard-hero),
 * section-header + titleblock, and raw preset-group toggle headers.
 */
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface AdminTabHeaderProps {
  kicker?: string
  title: string
  description?: string
  meta?: ReactNode
  actions?: ReactNode
  variant?: 'hero' | 'section'
  className?: string
}

export default function AdminTabHeader({
  kicker,
  title,
  description,
  meta,
  actions,
  variant = 'section',
  className,
}: AdminTabHeaderProps) {
  return (
    <div
      className={cn(
        'section-header',
        variant === 'hero' && 'section-header--hero',
        className,
      )}
    >
      <div className="section-header__titleblock">
        {kicker && <p className="detail-kicker">{kicker}</p>}
        <h2 className="section-title">
          {title}
          {meta != null && meta !== '' && <span className="section-header__meta ml-2">{meta}</span>}
        </h2>
        {description && (
          <p className="text-sm text-secondary">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  )
}
