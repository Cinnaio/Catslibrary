import type { ContentRating } from '@shared/types'
import type { ComponentProps } from 'react'
import AdminStatusBadge from './AdminStatusBadge'
import type { AdminStatusTone } from '@/lib/admin-status'

const RATINGS: Record<ContentRating, { label: string; tone: AdminStatusTone }> = {
  general: { label: '一般', tone: 'info' },
  restricted: { label: '限制级', tone: 'danger' },
  unknown: { label: '未标注', tone: 'muted' },
}

interface AdminContentRatingBadgeProps extends Omit<ComponentProps<typeof AdminStatusBadge>, 'tone'> {
  rating?: ContentRating
}

/** 未标注始终保持独立语义；不将 unknown 当成 general。 */
export default function AdminContentRatingBadge({ rating = 'unknown', children, ...props }: AdminContentRatingBadgeProps) {
  const status = RATINGS[rating]
  return (
    <AdminStatusBadge tone={status.tone} {...props}>
      {children ?? status.label}
    </AdminStatusBadge>
  )
}
