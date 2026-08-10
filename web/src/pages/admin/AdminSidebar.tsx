/**
 * AdminSidebar — collapsible shadcn Sidebar for the admin backend: brand mark,
 * nav groups (from the registry), footer with home / theme toggle, and rail.
 * Moved verbatim from the former Admin.tsx shell.
 */
import { Link } from 'react-router-dom'
import { Home, Moon, Sun } from 'lucide-react'
import { useTheme } from '../../context/ThemeContext'
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
import { NAV_GROUPS } from './admin-registry'

interface AdminSidebarProps {
  active: string
  onSelect: (id: string) => void
}

function AdminNavigation({ active, onSelect }: AdminSidebarProps) {
  const { setOpenMobile } = useSidebar()

  function select(id: string) {
    onSelect(id)
    setOpenMobile(false)
  }

  return (
    <nav aria-label="管理导航">
      {NAV_GROUPS.map((group) => (
        <SidebarGroup key={group.label}>
          <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {group.items.map((tab) => (
                <SidebarMenuItem key={tab.id}>
                  <SidebarMenuButton
                    isActive={active === tab.id}
                    tooltip={tab.label}
                    aria-current={active === tab.id ? 'page' : undefined}
                    onClick={() => select(tab.id)}
                  >
                    <tab.icon />
                    <span>{tab.label}</span>
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

export default function AdminSidebar({ active, onSelect }: AdminSidebarProps) {
  const { theme, toggleTheme } = useTheme()

  return (
    <Sidebar collapsible="icon">
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
        <AdminNavigation active={active} onSelect={onSelect} />
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
          <SidebarMenuItem>
            <SidebarMenuButton onClick={toggleTheme} tooltip="切换主题">
              {theme === 'dark' ? <Sun /> : <Moon />}
              <span>{theme === 'dark' ? '切换浅色' : '切换暗色'}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
