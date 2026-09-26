/**
 * AdminRowActions —— 表格行内操作区的统一容器。
 *
 * 背景：操作列的按钮数量随行状态变化（进行中有取消、失败有重试、有产出才有查看），
 * 超过 3 颗按钮时窄一点的桌面视口（901~1200px）会把操作列挤到折行，行高在行与行
 * 之间不一致，整张表的纵向节奏被打断；同时低频/危险操作与主操作同权重并列，误点
 * 风险上升。
 *
 * 契约（三段式，与 --admin-table-action-gap 几何对齐）：
 *   inline   —— 永远可见的主操作（最多 2 颗），保持图标按钮触控尺寸；
 *   overflow —— 次级操作收进「更多」下拉，菜单项含图标 + 文字 + 危险态；
 *   danger   —— 危险操作单独成段，桌面端靠右对齐形成固定右基线（肌肉记忆）。
 *
 * 移动端（≤900px 卡片布局）下 overflow 段整体保持可见，菜单改为全宽纵向列表，
 * 避免在触屏上引入额外的两跳操作。
 */
import type { ComponentType, ReactNode } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export interface AdminRowActionItem {
  /** 菜单项文案。 */
  label: string
  icon?: ComponentType<{ className?: string }>
  onSelect: () => void
  disabled?: boolean
  /** 危险操作：菜单项文字用危险色，并与其上方的普通项分隔。 */
  danger?: boolean
}

interface AdminRowActionsProps {
  /** 常驻主操作，建议不超过 2 个。 */
  children?: ReactNode
  /** 收进下拉菜单的次级操作。 */
  items?: readonly AdminRowActionItem[]
  /** 触发菜单的名称，用于 aria-label 与读屏定位（如「第 3 章」）。 */
  label: string
  className?: string
}

export default function AdminRowActions({ children, items = [], label, className }: AdminRowActionsProps) {
  const safeItems = items.filter((item) => !item.danger)
  const dangerItems = items.filter((item) => item.danger)

  return (
    <div className={cn('admin-cell-actions', className)}>
      {children}
      {items.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="admin-icon-button"
              aria-label={`${label}：更多操作`}
              title="更多操作"
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="admin-row-actions__menu min-w-[11rem]">
            <DropdownMenuLabel className="admin-row-actions__menu-label">{label}</DropdownMenuLabel>
            {safeItems.map((item) => (
              <DropdownMenuItem
                key={item.label}
                disabled={item.disabled}
                onSelect={() => item.onSelect()}
                className="admin-row-actions__item"
              >
                {item.icon && <item.icon className="admin-row-actions__item-icon" aria-hidden="true" />}
                <span>{item.label}</span>
              </DropdownMenuItem>
            ))}
            {safeItems.length > 0 && dangerItems.length > 0 && <DropdownMenuSeparator />}
            {dangerItems.map((item) => (
              <DropdownMenuItem
                key={item.label}
                disabled={item.disabled}
                onSelect={() => item.onSelect()}
                variant="destructive"
                className="admin-row-actions__item admin-row-actions__item--danger"
              >
                {item.icon && <item.icon className="admin-row-actions__item-icon" aria-hidden="true" />}
                <span>{item.label}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}
