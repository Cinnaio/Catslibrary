import { useNavigate, useSearchParams } from 'react-router-dom'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { NAV_GROUPS, adminTabPath } from './admin-registry'
import styles from './site-settings-navigation.module.css'

// 站点设置内部视图与侧栏使用同一份导航元数据；模型与参数仍保留各自的工作区。
const views = NAV_GROUPS.flatMap(group => group.items).find(item => item.id === 'site-settings')?.children
  ?.filter(child => child.to.startsWith(`${adminTabPath('site-settings')}?`))
  .map(child => ({ value: new URLSearchParams(child.to.split('?')[1]).get('view')!, label: child.label })) || []

export default function SiteSettingsNavigation({ view }: { view: string }) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  return (
    <Tabs value={view} className={styles.navigation} onValueChange={value => {
      const next = new URLSearchParams(params)
      next.set('view', value)
      navigate({ pathname: adminTabPath('site-settings'), search: next.toString() })
    }}>
      <TabsList aria-label="站点设置视图切换" variant="line">
        {views.map(item => <TabsTrigger key={item.value} value={item.value}>{item.label}</TabsTrigger>)}
      </TabsList>
    </Tabs>
  )
}
