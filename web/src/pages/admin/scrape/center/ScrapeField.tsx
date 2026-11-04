// ============================================================
// 抓取中心 · 带标签的表单字段 —— useId 保证 label ↔ 控件真正关联
// consumers: scrape/center/Step*.tsx
// ============================================================
import type { ReactNode } from 'react'
import FormField from "@/components/shared/FormField"
import { cn } from '@/lib/utils'

interface ScrapeFieldProps {
  label: string
  className?: string
  /** 收到 id（给原生控件用 htmlFor 配对）与 labelId（给 SearchSelect 用 aria-labelledby）。 */
  children: (ids: { id: string; labelId: string }) => ReactNode
}

export default function ScrapeField({ label, className, children }: ScrapeFieldProps) {
  return (
    <FormField label={label} className={cn('scrape-field', className)}>
      {children}
    </FormField>
  )
}
