/**
 * AdminShell — SidebarProvider layout for the admin backend: sidebar + inset
 * (topbar with context/page-title/account/theme controls) + scrollable content region. Tabs
 * render inside as children. Moved verbatim from the former Admin.tsx shell.
 */
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Separator } from '@/components/ui/separator'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { useSession } from '../../context/SessionContext'
import { url } from '../../lib/api'
import { ThemeMenu } from '../../components/ThemeMenu'
import AdminSidebar from './AdminSidebar'

interface AdminShellProps {
  active: string
  activeLabel: string
  children: ReactNode
}

export default function AdminShell({ active, activeLabel, children }: AdminShellProps) {
  const { user } = useSession()
  const [failedAvatarUrl, setFailedAvatarUrl] = useState('')
  const name = user?.displayName || user?.username || '管理员'
  const avatarUrl = user?.avatarUrl ? url(user.avatarUrl) : ''
  const showAvatar = !!avatarUrl && failedAvatarUrl !== avatarUrl

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
            <Link to="/profile" className="admin-shell__account" aria-label={`我的账户：${name}`} title={name}>
              <span className="admin-shell__account-avatar" aria-hidden="true">
                {showAvatar ? <img src={avatarUrl} alt="" onError={() => setFailedAvatarUrl(avatarUrl)} /> : <span>{name.slice(0, 1)}</span>}
              </span>
              <span className="admin-shell__account-name">{name}</span>
            </Link>
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
