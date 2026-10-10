/**
 * 管理后台外壳 —— 薄编排器。
 * 职责已拆出：鉴权门 AdminGate、布局 AdminShell（含侧边栏/顶栏）、
 * 导航与 tab 注册表 admin-registry。本文件仅保留路由编排与副作用：
 * URL tab、上次位置持久化、sessionStorage 高亮、document.title、/ 聚焦搜索框。
 */
import { Suspense, useEffect, useState } from 'react'
import RouteLoading from '../../components/RouteLoading'
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import AdminGate from './AdminGate'
import { monitoringRedirect } from './monitoring-routes'
import AdminShell from './AdminShell'
import { adminTabPath, getTabLabel, isAdminTab, TAB_COMPONENTS, TAB_KEY } from './admin-registry'

export default function Admin() {
  const navigate = useNavigate()
  const location = useLocation()
  const { tab } = useParams<{ tab?: string }>()
  const storedTab = localStorage.getItem(TAB_KEY) || undefined
  const fallbackTab = isAdminTab(storedTab) ? storedTab : 'dashboard'
  const active = isAdminTab(tab) ? tab : fallbackTab

  // 记住最后访问位置，让旧入口 /admin 仍能回到上次模块。
  useEffect(() => {
    if (isAdminTab(tab)) localStorage.setItem(TAB_KEY, tab)
  }, [tab])

  // 后台页面标题由 AdminShell 写入（见该文件的说明）：标题必须属于实际
  // 可见的视图，否则鉴权门拦下内容时标签页仍会显示后台页签名。

  // 键盘路径：/ 聚焦当前 tab 的搜索框（Alex 效率收益）
  useEffect(() => {
    function onSlash(e: KeyboardEvent) {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      if (typing) return
      const search = document.querySelector<HTMLElement>('.tab-content [data-admin-search]')
      if (!search) return
      e.preventDefault()
      search.focus()
    }
    window.addEventListener('keydown', onSlash)
    return () => window.removeEventListener('keydown', onSlash)
  }, [])

  // 从小说详情页「管理」跳转：聚焦 novels tab 并高亮目标行
  const requestedNovelId = new URLSearchParams(location.search).get('novelId') || ''
  const [legacyHighlightNovelId, setLegacyHighlightNovelId] = useState<string>(() => {
    try {
      return sessionStorage.getItem('adminEditNovel') ? (JSON.parse(sessionStorage.getItem('adminEditNovel')!) as { id?: string }).id || '' : ''
    } catch {
      return ''
    }
  })
  const highlightNovelId = requestedNovelId || legacyHighlightNovelId
  useEffect(() => {
    if (highlightNovelId) {
      sessionStorage.removeItem('adminEditNovel')
      if (active !== 'novels') navigate({ pathname: adminTabPath('novels'), search: location.search }, { replace: true })
    }
  }, [active, highlightNovelId, navigate, location.search])

  if (!isAdminTab(tab)) {
    return <Navigate to={adminTabPath(fallbackTab)} replace />
  }

  const redirect = monitoringRedirect(active, location.search, localStorage.getItem('ai_active_subtab'))
  if (redirect) return <Navigate to={redirect} replace />

  const TabComponent = TAB_COMPONENTS[active]
  const activeLabel = getTabLabel(active)

  return (
    <AdminGate>
      <AdminShell active={active} activeLabel={activeLabel}>
        <Suspense key={active} fallback={<RouteLoading embedded />}>
          <TabComponent highlightNovelId={highlightNovelId} onHighlightConsumed={() => {
            setLegacyHighlightNovelId('')
            const params = new URLSearchParams(location.search)
            if (params.has('novelId')) {
              params.delete('novelId')
              navigate({ pathname: location.pathname, search: params.toString() }, { replace: true })
            }
          }} />
        </Suspense>
      </AdminShell>
    </AdminGate>
  )
}

export { TAB_KEY }
