import type { ComponentProps } from 'react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { AdminStatusTone } from '@/lib/admin-status'

interface AdminStatusBadgeProps extends ComponentProps<typeof Badge> {
  tone: AdminStatusTone
}

/** 状态语义由业务提供，颜色与状态底色由后台共用样式负责。 */
export default function AdminStatusBadge({ tone, className, ...props }: AdminStatusBadgeProps) {
  return <Badge className={cn('admin-status-badge', `admin-status-badge--${tone}`, className)} {...props} />
}
