/**
 * AdminPage — shared content-area scaffold for every admin tab.
 * Owns the .tab-content wrapper (scroll region lives in AdminShell) plus the
 * AdminTabHeader, so tabs only render their own content. Rendered DOM is
 * identical to the previous per-tab `<section className="tab-content">` +
 * `<AdminTabHeader>` pair; extra classes (e.g. SettingsTab's `account-admin`)
 * pass through via className.
 */
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import AdminTabHeader from './AdminTabHeader'

interface AdminPageProps {
  kicker?: string
  title?: string // 可选：scrape 视图切换器无标题头
  description?: string
  meta?: ReactNode
  actions?: ReactNode
  variant?: 'hero' | 'section'
  className?: string // 附加到 .tab-content，如 SettingsTab 的 account-admin
  children: ReactNode
}

export default function AdminPage({ title, className, children, ...header }: AdminPageProps) {
  return (
    // admin-redesign-page 提供后台页面统一的区块间距（CSS 里的 grid + 1rem gap）
    // 与卡片表面归一化。它是所有 tab 共用的容器契约，不可省略：此前 novels
    // 缺失该类，导致工作对象卡与数据面板之间实测 0 间距。
    <section className={cn('tab-content', 'admin-redesign-page', className)}>
      {title != null && <AdminTabHeader {...header} title={title} />}
      {children}
    </section>
  )
}
