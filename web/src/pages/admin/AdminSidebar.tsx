/**
 * AdminSidebar — collapsible shadcn Sidebar for the admin backend: brand mark,
 * nav groups (from the registry), footer with home, and rail.
 * Moved verbatim from the former Admin.tsx shell.
 */
import { useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { ChevronRight, Home } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
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
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarMenuAction,
  useSidebar,
} from '@/components/ui/sidebar'
import { adminTabPath, NAV_GROUPS } from './admin-registry'

interface AdminSidebarProps {
  active: string
}

function AdminNavigation({ active }: AdminSidebarProps) {
  const { setOpenMobile } = useSidebar()
  const location = useLocation()
  const [manualOpen, setManualOpen] = useState<Record<string, boolean>>({})

  function matches(to: string) {
    const target = new URL(to, window.location.origin)
    if (target.pathname !== location.pathname) return false
    const targetParams = new URLSearchParams(target.search)
    const currentParams = new URLSearchParams(location.search)
    for (const [key, value] of targetParams) {
      if (currentParams.get(key) !== value) return false
    }
    return true
  }

  function setParentOpen(id: string, open: boolean) {
    setManualOpen((current) => ({ ...current, [id]: open }))
  }

  return (
    <nav aria-label="管理导航">
      {NAV_GROUPS.map((group) => (
        <SidebarGroup key={group.label}>
          <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {group.items.map((tab) => {
                const childActive = tab.children?.some((child) => matches(child.to)) || false
                const itemActive = active === tab.id || childActive
                const parentTo = tab.children?.[0]?.to || adminTabPath(tab.id)

                if (!tab.children?.length) {
                  return (
                    <SidebarMenuItem key={tab.id}>
                      <SidebarMenuButton asChild isActive={itemActive} tooltip={tab.label}>
                        <NavLink to={parentTo} aria-current={itemActive ? 'page' : undefined} onClick={() => setOpenMobile(false)}>
                          <tab.icon />
                          <span>{tab.label}</span>
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                }

                const open = manualOpen[tab.id] ?? itemActive
                return (
                  <Collapsible key={tab.id} open={open} onOpenChange={(nextOpen) => setParentOpen(tab.id, nextOpen)} asChild>
                    <SidebarMenuItem>
                      <SidebarMenuButton asChild isActive={itemActive} tooltip={tab.label}>
                        <NavLink
                          to={parentTo}
                          aria-current={itemActive ? 'page' : undefined}
                          onClick={() => {
                            setParentOpen(tab.id, true)
                            setOpenMobile(false)
                          }}
                        >
                          <tab.icon />
                          <span>{tab.label}</span>
                        </NavLink>
                      </SidebarMenuButton>
                      <CollapsibleTrigger asChild>
                        <SidebarMenuAction aria-label={open ? `收起${tab.label}子菜单` : `展开${tab.label}子菜单`}>
                          <ChevronRight className={`transition-transform duration-200 ${open ? 'rotate-90' : ''}`} aria-hidden="true" />
                        </SidebarMenuAction>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <SidebarMenuSub>
                          {tab.children.map((child) => (
                            <SidebarMenuSubItem key={child.id}>
                              <SidebarMenuSubButton asChild isActive={matches(child.to)}>
                                <NavLink to={child.to} aria-current={matches(child.to) ? 'page' : undefined} onClick={() => setOpenMobile(false)}>
                                  <span>{child.label}</span>
                                </NavLink>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          ))}
                        </SidebarMenuSub>
                      </CollapsibleContent>
                    </SidebarMenuItem>
                  </Collapsible>
                )
              })}
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
