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

export function kindLabel(kind: string): string {
  return kind === 'summary' ? '前情提要'
    : kind === 'catchup' ? '回顾总结'
      : kind === 'write_outline' ? '创作大纲'
        : kind === 'write_chapter' ? '创作章节'
          : kind === 'continue' ? '续写'
            : kind === 'cover' ? '封面'
              : kind
}
