/**
 * AdminTabHeader — unified page header for every admin tab.
 * One anatomy: title + meta capsule + description on the left, actions right.
 * Built on shadcn/ui tokens. The legacy `kicker` eyebrow and `hero` variant
 * are retired (eyebrows above headings and per-tab title inflation are banned);
 * both props are still accepted for API compatibility and ignored.
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
  title,
  description,
  meta,
  actions,
  className,
}: AdminTabHeaderProps) {
  return (
    <div
      className={cn(
        'mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-border pb-4',
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-2xl font-bold tracking-tight text-foreground">
          {title}
          {meta != null && meta !== '' && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
              {meta}
            </span>
          )}
        </h2>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}
