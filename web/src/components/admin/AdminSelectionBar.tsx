import { useEffect, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import AdminFloatingDock from './AdminFloatingDock'

interface AdminSelectionBarProps {
  /** 已选数量；为 0 时组件自身不渲染。 */
  count: number
  /** 计数文案，如「已选 3 本」。 */
  label: string
  /** 批量动作按钮。 */
  children?: ReactNode
  onClear: () => void
  clearLabel?: string
  clearPlacement?: 'actions' | 'selection'
}

export default function AdminSelectionBar({
  count,
  label,
  children,
  onClear,
  clearLabel = '取消选择',
  clearPlacement = 'actions',
}: AdminSelectionBarProps) {
  // 维护退出动画渲染周期：当 count 变为 0 时保持渲染至退出动画结束
  const [rendered, setRendered] = useState(count > 0)
  const [isExiting, setIsExiting] = useState(false)
  const lastState = useRef({ label, children })
  const exitTimer = useRef<number | null>(null)

  if (count > 0) {
    lastState.current = { label, children }
  }

  useEffect(() => {
    if (count > 0) {
      if (exitTimer.current) {
        clearTimeout(exitTimer.current)
        exitTimer.current = null
      }
      setRendered(true)
      setIsExiting(false)
    } else if (rendered) {
      setIsExiting(true)
      exitTimer.current = window.setTimeout(() => {
        setRendered(false)
        setIsExiting(false)
      }, 220) // 与 CSS 退出动画时长一致
    }

    return () => {
      if (exitTimer.current) clearTimeout(exitTimer.current)
    }
  }, [count, rendered])

  if (!rendered && count <= 0) return null

  const displayLabel = count > 0 ? label : lastState.current.label
  const displayChildren = count > 0 ? children : lastState.current.children

  return (
    <AdminFloatingDock
      className={`admin-selection-bar ${isExiting ? 'admin-selection-bar--exiting' : 'admin-selection-bar--entering'}`}
      role="status"
      aria-live="polite"
      data-state={isExiting ? 'closed' : 'open'}
    >
      {clearPlacement === 'selection' ? (
        <div className="admin-selection-bar__selection">
          <span className="admin-selection-bar__count">{displayLabel}</span>
          <Button variant="ghost" size="sm" onClick={onClear} disabled={isExiting}>
            <X className="size-3.5" />
            {clearLabel}
          </Button>
        </div>
      ) : (
        <span className="admin-selection-bar__count">{displayLabel}</span>
      )}
      <div className="admin-floating-dock__actions admin-selection-bar__actions">
        {displayChildren}
        {clearPlacement === 'actions' && (
          <Button variant="ghost" size="sm" onClick={onClear} disabled={isExiting}>
            <X className="size-3.5" />
            {clearLabel}
          </Button>
        )}
      </div>
    </AdminFloatingDock>
  )
}
