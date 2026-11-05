// ============================================================
// 抓取中心 · 检查项列表（分析结果 / 选择器测试诊断共用）
// consumers: scrape/center/StepAnalyze.tsx, scrape/center/StepConfig.tsx
// ============================================================
import { Check, Circle } from 'lucide-react'
import type { CheckItem } from '../types'
import styles from '../workbench.module.css'

export default function ScrapeChecks({ items }: { items: CheckItem[] }) {
  if (items.length === 0) return null
  return (
    <ul className={styles.checks}>
      {items.map((item, i) => (
        <li className={styles.check} data-passed={item.ok} key={`${item.label}-${i}`}>
          {item.ok ? <Check className="size-3.5" aria-hidden="true" /> : <Circle className="size-3.5" aria-hidden="true" />}
          <span className="sr-only">{item.ok ? '已通过：' : '待检查：'}</span>
          {item.label}
          {item.detail ? <span className={styles.checkDetail}>{item.detail}</span> : null}
        </li>
      ))}
    </ul>
  )
}
