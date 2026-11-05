// ============================================================
// 抓取中心 · 带标签的表单字段 —— useId 保证 label ↔ 控件真正关联
// consumers: scrape/center/Step*.tsx
// ============================================================
import type { ReactNode } from 'react'
import FormField from "@/components/shared/FormField"

interface ScrapeFieldProps {
  label: string
  className?: string
  hint?: ReactNode
  error?: ReactNode
  /** 收到 id（给原生控件用 htmlFor 配对）与 labelId（给 SearchSelect 用 aria-labelledby）。 */
  children: (ids: { id: string; labelId: string }) => ReactNode
}

export default function ScrapeField({ label, className, hint, error, children }: ScrapeFieldProps) {
  return (
    <FormField label={label} className={className} hint={hint} error={error}>
      {children}
    </FormField>
  )
}
