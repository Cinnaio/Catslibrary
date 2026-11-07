import { useEffect, type ReactNode } from 'react'
import { requiresSuperAdministratorPage } from '@shared/roles'
import { useSession } from '@/context/SessionContext'
import WorkspaceShell, { type WorkspaceNavGroup } from '../../components/workspace/WorkspaceShell'
import { NAV_GROUPS, adminTabPath } from './admin-registry'
import { useSiteBranding } from '../../lib/site-branding'
import { ControlAppearance, ControlSurface } from '@/components/ui/control-appearance'

const navigation: WorkspaceNavGroup[] = NAV_GROUPS.map((group) => ({
  label: group.label,
  items: group.items.map((item) => ({ ...item, to: item.children?.[0]?.to || adminTabPath(item.id) })),
}))

function canVisitAsAdministrator(item: { to: string }) {
  const url = new URL(item.to, 'https://workspace.local')
  return !requiresSuperAdministratorPage(url.pathname, url.search)
}

export default function AdminShell({ activeLabel, children }: { active: string; activeLabel: string; children: ReactNode }) {
  const branding = useSiteBranding()
  const { user } = useSession()
  const visibleNavigation = user?.role === 'super_admin' ? navigation : navigation.map(group => ({
    ...group,
    items: group.items.flatMap(item => {
      if (item.children) {
        const children = item.children.filter(canVisitAsAdministrator)
        // 先筛选子入口，父入口指向首个可访问视图，避免排序隐藏整个分组。
        const firstChild = children[0]
        return firstChild ? [{ ...item, to: firstChild.to, children }] : []
      }
      return canVisitAsAdministrator(item) ? [item] : []
    }),
  })).filter(group => group.items.length)
  useEffect(() => {
    document.title = `${activeLabel || '管理台'} · ${branding.name}`
    return () => {
      document.title = branding.homeTitle
    }
  }, [activeLabel, branding.name, branding.homeTitle])
  return (
    <WorkspaceShell groups={visibleNavigation} title={activeLabel} admin>
      <ControlAppearance appearance="management"><ControlSurface className="admin-layout">{children}</ControlSurface></ControlAppearance>
    </WorkspaceShell>
  )
}
