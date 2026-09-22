/** AI 后台各面板共用的小组件与格式化工具。 */
import type { ReactNode } from 'react'

export interface Provider {
  configured: boolean
  host: string
  model: string
  hasKey: boolean
}

export function UsageCell({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="bg-card px-4 py-3">
      <div className="truncate text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold leading-tight tabular-nums tracking-tight text-foreground">
        {typeof value === 'string' ? value : value.toLocaleString()}
      </div>
    </div>
  )
}

export function DetailItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="truncate">{value}</span>
    </div>
  )
}

export function formatCost(millicents: number): string {
  return (Number(millicents) / 100_000).toFixed(4)
}

/* 枚举与文案映射已移到 ./labels.ts（纯 .ts，避免本文件的 fast-refresh 被
   非组件导出破坏，见该文件顶部说明）。本文件只保留组件。 */
