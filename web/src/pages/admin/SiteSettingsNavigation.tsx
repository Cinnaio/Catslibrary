import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { NAV_GROUPS } from './admin-registry'
import styles from './site-settings-navigation.module.css'

// 六个视图共用侧栏元数据；模型与参数继续使用原有地址。
const views = NAV_GROUPS.flatMap(group => group.items).find(item => item.id === 'site-settings')?.children
  ?.map(child => {
    const target = new URL(child.to, 'https://workspace.local')
    return { value: target.searchParams.get('view') || target.searchParams.get('sub')!, label: child.label, target }
  }) || []

export default function SiteSettingsNavigation({ view, disabled = false }: { view: string; disabled?: boolean }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  return (
    <Tabs value={view} activationMode="manual" className={styles.navigation} onValueChange={value => {
      if (disabled) return
      const item = views.find(item => item.value === value)
      if (!item) return
      const next = new URLSearchParams(params)
      next.delete('view')
      next.delete('sub')
      item.target.searchParams.forEach((value, key) => next.set(key, value))
      navigate({ pathname: item.target.pathname, search: next.toString(), hash: location.hash })
    }}>
      <TabsList aria-label="站点设置视图切换">
        {views.map(item => <TabsTrigger key={item.value} value={item.value} disabled={disabled}>{item.label}</TabsTrigger>)}
      </TabsList>
    </Tabs>
  )
}
