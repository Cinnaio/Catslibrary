/**
 * AdminShell — SidebarProvider layout for the admin backend: sidebar + inset
 * (topbar with context/page-title/account/theme controls) + scrollable content region. Tabs
 * render inside as children. Moved verbatim from the former Admin.tsx shell.
 */
import { useEffect, type ReactNode } from 'react'
import { Separator } from '@/components/ui/separator'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { ThemeMenu } from '../../components/ThemeMenu'
import { AccountMenu } from '../../components/AccountMenu'
import AdminSidebar from './AdminSidebar'

interface AdminShellProps {
  active: string
  activeLabel: string
  children: ReactNode
}

export default function AdminShell({ active, activeLabel, children }: AdminShellProps) {
  /**
   * 页签标题归「实际可见的视图」所有：AdminShell 只在鉴权通过后渲染，
   * 因此把标题放在这里，被门禁拦下时就不会错误地显示后台页签名。
   * 此前该副作用在 Admin.tsx 无条件执行，即使 AdminGate 拦下了内容，
   * 浏览器标签仍显示「爬虫抓取 · 知舟」。
   */
  useEffect(() => {
    document.title = `${activeLabel || '管理台'} · 知舟`
    return () => {
      document.title = '知舟 — 小说阅读'
    }
  }, [activeLabel])

  return (
    <SidebarProvider className="admin-layout">
      <AdminSidebar active={active} />
      <SidebarInset className="admin-layout__inset min-w-0">
        <header className="admin-shell__topbar flex min-h-14 items-center justify-between gap-3 px-5 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <SidebarTrigger aria-label="打开管理导航" />
            <Separator orientation="vertical" className="mr-1 h-4" />
            <span className="truncate text-sm font-semibold text-foreground">{activeLabel}</span>
          </div>
          <div className="admin-shell__actions shrink-0">
            <AccountMenu variant="admin" />
            <ThemeMenu className="theme-btn admin-shell__theme-btn" ariaLabel="主题设置" title="主题设置" />
          </div>
        </header>
        <section className="admin-layout__content min-h-0 min-w-0 flex-1 overflow-auto p-4 md:p-6" aria-label={activeLabel}>
          {children}
        </section>
      </SidebarInset>
    </SidebarProvider>
  )
}
