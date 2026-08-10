// ============================================================
// 抓取中心 · 带标签的表单字段 —— useId 保证 label ↔ 控件真正关联
// consumers: scrape/center/Step*.tsx
// ============================================================
import { useId, type ReactNode } from 'react'
import { Label } from '@/components/ui/label'

interface ScrapeFieldProps {
  label: string
  className?: string
  /** 收到 id（给原生控件用 htmlFor 配对）与 labelId（给 CustomSelect 用 aria-labelledby）。 */
  children: (ids: { id: string; labelId: string }) => ReactNode
}

export default function ScrapeField({ label, className, children }: ScrapeFieldProps) {
  const id = useId()
  const labelId = `${id}-label`
  return (
    <div className={className ? `grid gap-1.5 ${className}` : 'grid gap-1.5'}>
      <Label id={labelId} htmlFor={id}>
        {label}
      </Label>
      {children({ id, labelId })}
    </div>
  )
}
