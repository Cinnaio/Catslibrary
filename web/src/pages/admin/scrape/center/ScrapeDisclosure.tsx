// ============================================================
// 抓取中心 · 可访问折叠触发器（高级配置 / 任务日志共用）
// consumers: scrape/center/StepConfig.tsx, scrape/center/JobCard.tsx
// ============================================================
import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ScrapeDisclosureProps {
  open: boolean
  onToggle: () => void
  /** 受控面板的 id，供 aria-controls 指向。 */
  controls: string
  className?: string
  children: ReactNode
}

export default function ScrapeDisclosure({ open, onToggle, controls, className, children }: ScrapeDisclosureProps) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
      className={cn(
        'inline-flex w-fit items-center gap-1 py-1 text-sm text-muted-foreground transition-colors hover:text-primary',
        className,
      )}
    >
      <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} aria-hidden="true" />
      {children}
    </button>
  )
}
