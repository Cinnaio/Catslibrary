import { useEffect, type ReactNode } from 'react'
import WorkspaceShell, { type WorkspaceNavGroup } from '../../components/workspace/WorkspaceShell'
import { NAV_GROUPS, adminTabPath } from './admin-registry'
import { useSiteBranding } from '../../lib/site-branding'

const navigation: WorkspaceNavGroup[] = NAV_GROUPS.map((group) => ({
  label: group.label,
  items: group.items.map((item) => ({ ...item, to: item.children?.[0]?.to || adminTabPath(item.id) })),
}))

export default function AdminShell({ activeLabel, children }: { active: string; activeLabel: string; children: ReactNode }) {
  const branding = useSiteBranding()
  useEffect(() => {
    document.title = `${activeLabel || '管理台'} · ${branding.name}`
    return () => {
      document.title = branding.homeTitle
    }
  }, [activeLabel, branding.name, branding.homeTitle])
  return (
    <WorkspaceShell groups={navigation} title={activeLabel} admin>
      <div className="admin-layout">{children}</div>
    </WorkspaceShell>
  )
}
