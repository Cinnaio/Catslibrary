/**
 * AdminPanel — thin wrapper around shadcn Card for admin content surfaces.
 * Replaces raw <div class="card admin-panel-card"> usage.
 */
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface AdminPanelProps {
  title?: string
  description?: string
  className?: string
  children: ReactNode
}

export default function AdminPanel({
  title,
  description,
  className,
  children,
}: AdminPanelProps) {
  return (
    <Card
      className={cn('admin-panel-card', className)}
    >
      {title && (
        <CardHeader>
          <CardTitle className="text-base">{title}</CardTitle>
          {description && (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
        </CardHeader>
      )}
      <CardContent>{children}</CardContent>
    </Card>
  )
}
