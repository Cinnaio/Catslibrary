/**
 * AdminTabHeader —— 所有后台 tab 共用的页头。
 * 一套解剖：标题 + 元信息胶囊 + 描述在左，操作区在右。
 *
 * 曾接受 kicker（眉标）与 variant（'hero' | 'section'）两个 prop：
 * 两个值渲染出的 DOM 完全相同，即「英雄页头」与普通页头视觉上无从区分——
 * 一个不改变任何渲染结果的 prop 比没有更糟，它让调用方以为自己在做选择。
 * 实际也无人传入（全库 grep 为空），故整体移除。
 */
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface AdminTabHeaderProps {
  title: string
  description?: string
  meta?: ReactNode
  actions?: ReactNode
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
        'admin-tab-header mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-border pb-4',
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-2xl font-bold tracking-tight text-foreground">
          {title}
          {meta != null && meta !== '' && (
            <span className="admin-tab-header__meta">
              {meta}
            </span>
          )}
        </h2>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && (
        <div className="admin-tab-header__actions flex min-w-0 max-w-full shrink-0 flex-wrap items-center justify-end gap-2">
          {actions}
        </div>
      )}
    </div>
  )
}
