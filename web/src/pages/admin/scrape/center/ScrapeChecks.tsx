// ============================================================
// 抓取中心 · 检查项列表（分析结果 / 选择器测试诊断共用）
// consumers: scrape/center/StepAnalyze.tsx, scrape/center/StepConfig.tsx
// ============================================================
import { Check, Circle } from 'lucide-react'
import type { CheckItem } from '../types'

export default function ScrapeChecks({ items }: { items: CheckItem[] }) {
  if (items.length === 0) return null
  return (
    <ul className="scrape-checks text-xs">
      {items.map((item, i) => (
        <li className={`scrape-check${item.ok ? '' : ' scrape-check--pending'}`} key={`${item.label}-${i}`}>
          {item.ok ? <Check className="size-3.5" aria-hidden="true" /> : <Circle className="size-3.5" aria-hidden="true" />}
          <span className="sr-only">{item.ok ? '已通过：' : '待检查：'}</span>
          {item.label}
          {item.detail ? <span className="scrape-check__detail">{item.detail}</span> : null}
        </li>
      ))}
    </ul>
  )
}
