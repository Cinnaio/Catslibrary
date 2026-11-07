import '@/styles/admin/components/selection.css'
import { useRef, type ComponentType, type ReactNode } from 'react'
import { MoreHorizontal, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import AdminFloatingDock from './AdminFloatingDock'

interface AdminSelectionAction {
  label: string
  icon?: ComponentType<{ className?: string }>
  onSelect: () => void
  disabled?: boolean
  danger?: boolean
  /** responsive 在窄屏收进更多菜单，menu 始终收起。 */
  placement: 'responsive' | 'menu'
}

interface AdminSelectionBarProps {
  /** 已选数量；为 0 时组件自身不渲染。 */
  count: number
  /** 计数文案，如「已选 3 本」。 */
  label: ReactNode
  /** 批量动作按钮。 */
  children?: ReactNode
  actions?: readonly AdminSelectionAction[]
  onClear: () => void
  clearLabel?: string
  clearPlacement?: 'actions' | 'selection'
}

export default function AdminSelectionBar({
  count,
  label,
  children,
  actions = [],
  onClear,
  clearLabel = '取消选择',
  clearPlacement = 'actions',
}: AdminSelectionBarProps) {
  // 共享操作条负责退出周期；保留最后一份文案，避免退出时数字闪回 0。
  const isExiting = count <= 0
  const lastState = useRef({ label, children, actions })

  if (count > 0) {
    lastState.current = { label, children, actions }
  }

  const displayLabel = count > 0 ? label : lastState.current.label
  const displayChildren = count > 0 ? children : lastState.current.children
  const displayActions = count > 0 ? actions : lastState.current.actions
  const safeActions = displayActions.filter((action) => !action.danger)
  const dangerActions = displayActions.filter((action) => action.danger)
  const clearButton = (
    <Button type="button" variant="ghost" size="sm" className="admin-selection-bar__clear" onClick={onClear} disabled={isExiting || count <= 0}>
      <X className="size-3.5" aria-hidden="true" />
      {clearLabel}
    </Button>
  )

  return (
    <AdminFloatingDock
      open={count > 0}
      reserveSpace="page-end"
      className={`admin-selection-bar ${isExiting ? 'admin-selection-bar--exiting' : 'admin-selection-bar--entering'}`}
      role="region"
      aria-label="批量操作"
      inert={isExiting || count <= 0}
      data-state={isExiting ? 'closed' : 'open'}
    >
      {clearPlacement === 'selection' ? (
        <div className="admin-selection-bar__selection">
          <span className="admin-selection-bar__count" role="status" aria-live="polite">{displayLabel}</span>
          {clearButton}
        </div>
      ) : (
        <span className="admin-selection-bar__count" role="status" aria-live="polite">{displayLabel}</span>
      )}
      <div className="admin-floating-dock__actions admin-selection-bar__actions">
        {displayChildren}
        {safeActions.filter((action) => action.placement === 'responsive').map((action) => (
          <Button key={action.label} type="button" variant="ghost" size="sm" className="admin-selection-bar__responsive-action" disabled={action.disabled || isExiting || count <= 0} onClick={action.onSelect}>
            {action.icon && <action.icon className="size-3.5" aria-hidden="true" />}
            {action.label}
          </Button>
        ))}
        {displayActions.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="sm" aria-label="所选项目：更多操作" disabled={isExiting || count <= 0} className={displayActions.every((action) => action.placement === 'responsive' && !action.danger) ? 'admin-selection-bar__compact-trigger' : undefined}>
                更多
                <MoreHorizontal className="size-3.5" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="end" collisionPadding={12}>
              {safeActions.map((action) => (
                <DropdownMenuItem key={action.label} className={action.placement === 'responsive' ? 'admin-selection-bar__compact-item' : undefined} disabled={action.disabled || isExiting || count <= 0} onSelect={action.onSelect}>
                  {action.icon && <action.icon className="size-3.5" aria-hidden="true" />}
                  {action.label}
                </DropdownMenuItem>
              ))}
              {safeActions.length > 0 && dangerActions.length > 0 && <DropdownMenuSeparator />}
              {dangerActions.map((action) => (
                <DropdownMenuItem key={action.label} variant="destructive" disabled={action.disabled || isExiting || count <= 0} onSelect={action.onSelect}>
                  {action.icon && <action.icon className="size-3.5" aria-hidden="true" />}
                  {action.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {clearPlacement === 'actions' && clearButton}
    </AdminFloatingDock>
  )
}
