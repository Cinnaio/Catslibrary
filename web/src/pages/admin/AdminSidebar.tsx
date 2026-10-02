/**
 * AdminSidebar — collapsible shadcn Sidebar for the admin backend: brand mark,
 * nav groups (from the registry), footer with home, and rail.
 * Moved verbatim from the former Admin.tsx shell.
 */
import { useCallback, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { AccountMenu } from '../../components/AccountMenu'
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
                    <SidebarMenuItem className="admin-nav-parent">
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
                        <SidebarMenuSub className="admin-nav-sub">
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
  const { setOpenMobile } = useSidebar()
  const observeNavigation = useCallback((node: HTMLDivElement | null) => {
    if (!node) return
    const updateEdge = () => {
      node.dataset.scrollRemaining = String(node.scrollHeight - node.clientHeight - node.scrollTop > 1)
    }
    updateEdge()
    const observer = new ResizeObserver(updateEdge)
    observer.observe(node)
    if (node.firstElementChild) observer.observe(node.firstElementChild)
    node.addEventListener('scroll', updateEdge, { passive: true })
    return () => {
      observer.disconnect()
      node.removeEventListener('scroll', updateEdge)
    }
  }, [])

  return (
    <Sidebar className="admin-sidebar" variant="floating" collapsible="icon">
      <SidebarHeader className="admin-shell__brand">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg" className="gap-3">
              <Link to="/" aria-label="返回知舟首页" onClick={() => setOpenMobile(false)}>
                <span className="admin-shell__brand-mark" aria-hidden="true">
                  <img src="/images/logo.png" alt="" />
                </span>
                <span className="admin-shell__brand-copy">
                  <strong>知舟</strong>
                  <small>馆藏运营台</small>
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent ref={observeNavigation} className="admin-shell__navigation">
        <AdminNavigation active={active} />
      </SidebarContent>
      <SidebarFooter className="admin-shell__footer">
        <AccountMenu variant="admin" wrapperClassName="admin-shell__sidebar-account" onNavigate={() => setOpenMobile(false)} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
