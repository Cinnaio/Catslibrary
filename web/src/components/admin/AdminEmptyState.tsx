/**
 * AdminEmptyState — unified empty state for admin tabs.
 * Replaces dashboard-empty, table-empty, profile-empty-note.
 */
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { BookOpen } from 'lucide-react'

interface AdminEmptyStateProps {
  message: string
  icon?: ReactNode
  action?: ReactNode
  className?: string
}

export default function AdminEmptyState({
  message,
  icon,
  action,
  className,
}: AdminEmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 py-12 text-center text-muted-foreground',
        className,
      )}
    >
      {icon ?? <BookOpen className="size-8 opacity-40" />}
      <p className="text-sm">{message}</p>
      {action}
    </div>
  )
}
