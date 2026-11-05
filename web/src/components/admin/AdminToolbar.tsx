import './AdminToolbar.css'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

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
