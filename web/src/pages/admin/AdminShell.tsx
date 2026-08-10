/**
 * AdminShell — SidebarProvider layout for the admin backend: sidebar + inset
 * (topbar with context/page-title/status) + scrollable content region. Tabs
 * render inside as children. Moved verbatim from the former Admin.tsx shell.
 */
import type { ReactNode } from 'react'
import { Separator } from '@/components/ui/separator'
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import AdminSidebar from './AdminSidebar'

interface AdminShellProps {
  active: string
  onSelect: (id: string) => void
  activeLabel: string
  children: ReactNode
}

export default function AdminShell({ active, onSelect, activeLabel, children }: AdminShellProps) {
  return (
    <SidebarProvider className="admin-layout">
      <AdminSidebar active={active} onSelect={onSelect} />
      <SidebarInset className="admin-layout__inset min-w-0">
        <header className="admin-shell__topbar">
          <div className="flex min-w-0 items-center gap-2">
            <SidebarTrigger aria-label="打开管理导航" />
            <Separator orientation="vertical" className="mr-1 h-4" />
            <div className="min-w-0">
              <span className="admin-shell__context">运营工作区</span>
              <span className="admin-shell__page-title">{activeLabel}</span>
            </div>
          </div>
          <span className="admin-shell__status" role="status">管理员模式</span>
        </header>
        <section className="admin-layout__content min-h-0 min-w-0 flex-1 overflow-auto p-4 md:p-6" aria-label={activeLabel}>
          {children}
        </section>
      </SidebarInset>
    </SidebarProvider>
  )
}
