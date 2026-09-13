/**
 * AdminSidebar — collapsible shadcn Sidebar for the admin backend: brand mark,
 * nav groups (from the registry), footer with home, and rail.
 * Moved verbatim from the former Admin.tsx shell.
 */
import { Link, NavLink } from 'react-router-dom'
import { Home } from 'lucide-react'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar'
import { adminTabPath, NAV_GROUPS } from './admin-registry'

interface AdminSidebarProps {
  active: string
}

function AdminNavigation({ active }: AdminSidebarProps) {
  const { setOpenMobile } = useSidebar()

  return (
    <nav aria-label="管理导航">
      {NAV_GROUPS.map((group) => (
        <SidebarGroup key={group.label}>
          <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {group.items.map((tab) => (
                <SidebarMenuItem key={tab.id}>
                  <SidebarMenuButton asChild isActive={active === tab.id} tooltip={tab.label}>
                    <NavLink to={adminTabPath(tab.id)} aria-current={active === tab.id ? 'page' : undefined} onClick={() => setOpenMobile(false)}>
                      <tab.icon />
                      <span>{tab.label}</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </nav>
  )
}

export default function AdminSidebar({ active }: AdminSidebarProps) {
  return (
    <Sidebar className="admin-sidebar" variant="floating" collapsible="icon">
      <SidebarHeader className="admin-shell__brand">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" className="gap-3" aria-label="知舟管理台">
              <span className="admin-shell__brand-mark" aria-hidden="true">
                <img src="/images/logo.png" alt="" />
              </span>
              <span className="admin-shell__brand-copy">
                <strong>知舟</strong>
                <small>馆藏运营台</small>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent className="admin-shell__navigation">
        <AdminNavigation active={active} />
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="回主页">
              <Link to="/">
                <Home />
                <span>回主页</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
