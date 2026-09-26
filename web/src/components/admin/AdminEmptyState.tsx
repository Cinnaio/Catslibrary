/**
 * AdminEmptyState —— 后台统一的空状态。
 *
 * 三档信息，按需给：
 *   message —— 发生了什么（「没有待审核的规则候选」）；
 *   hint    —— 为什么空 / 下一步做什么。缺了这层，操作员只能看到「没有」，
 *              却不知道是「真的没有」还是「筛错了」「没配好」。后台的空状态
 *              绝大多数是**工作流里的一步**，而不是终点；
 *   action  —— 可执行的出口（去导入、清除筛选、重试）。
 *
 * 视觉：图标与文案都比正文弱一档——空状态是「这里现在没有东西」的陈述，
 * 不应该比它旁边有数据的表格更抢眼。
 */
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { BookOpen } from 'lucide-react'

interface AdminEmptyStateProps {
  message: string
  /** 补充说明：为什么空、下一步可以做什么。 */
  hint?: string
  icon?: ReactNode
  action?: ReactNode
  className?: string
}

export default function AdminEmptyState({
  message,
  hint,
  icon,
  action,
  className,
}: AdminEmptyStateProps) {
  return (
    <div
      className={cn(
        'admin-empty-state flex flex-col items-center justify-center gap-3 py-12 text-center text-muted-foreground',
        className,
      )}
    >
      {icon ?? <BookOpen className="size-8 opacity-40" aria-hidden="true" />}
      <p className="admin-empty-state__message">{message}</p>
      {hint && <p className="admin-empty-state__hint">{hint}</p>}
      {action}
    </div>
  )
}
