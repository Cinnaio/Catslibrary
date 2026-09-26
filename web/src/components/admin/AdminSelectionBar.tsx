/**
 * AdminSelectionBar —— 跨页选择计数常驻条。
 *
 * 背景：勾选状态跨分页存活（selected 集合在换页时不清空），但计数与批量操作
 * 只出现在工具栏顶端。操作员滚到表格中段勾选时，「已选几项、能做什么」在
 * 视口之外，翻页后更是完全不可见——风险最高的批量删除反而最不显眼。
 *
 * 契约：只要 selectedCount > 0 就常驻在内容区顶部（sticky），显示计数、
 * 主批量动作与清空入口；≤640px 转静态并按整行排布按钮（触屏拇指区）。
 * aria-live="polite" 让读屏在计数变化时播报，不必重新定位。
 */
import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface AdminSelectionBarProps {
  /** 已选数量；为 0 时组件自身不渲染。 */
  count: number
  /** 计数文案，如「已选 3 本」。 */
  label: string
  /** 批量动作按钮。 */
  children?: ReactNode
  onClear: () => void
  clearLabel?: string
}

export default function AdminSelectionBar({ count, label, children, onClear, clearLabel = '取消选择' }: AdminSelectionBarProps) {
  if (count <= 0) return null

  return (
    <div className="admin-selection-bar" role="status" aria-live="polite">
      <span className="admin-selection-bar__count">{label}</span>
      <div className="admin-selection-bar__actions">
        {children}
        <Button variant="ghost" size="sm" onClick={onClear}>
          <X className="size-3.5" />
          {clearLabel}
        </Button>
      </div>
    </div>
  )
}
