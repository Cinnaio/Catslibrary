/**
 * 管理后台外壳 —— 薄编排器。
 * 职责已拆出：鉴权门 AdminGate、布局 AdminShell（含侧边栏/顶栏）、
 * 导航与 tab 注册表 admin-registry。本文件仅保留路由编排与副作用：
 * URL tab、上次位置持久化、sessionStorage 高亮、document.title、/ 聚焦搜索框。
 */
import { useEffect, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import AdminGate from './AdminGate'
import AdminShell from './AdminShell'
import { adminTabPath, getTabLabel, isAdminTab, TAB_COMPONENTS, TAB_KEY } from './admin-registry'

export default function Admin() {
  const navigate = useNavigate()
  const { tab } = useParams<{ tab?: string }>()
  const storedTab = localStorage.getItem(TAB_KEY) || undefined
  const fallbackTab = isAdminTab(storedTab) ? storedTab : 'dashboard'
  const active = isAdminTab(tab) ? tab : fallbackTab

  // 记住最后访问位置，让旧入口 /admin 仍能回到上次模块。
  useEffect(() => {
    if (isAdminTab(tab)) localStorage.setItem(TAB_KEY, tab)
  }, [tab])

  // 后台页面标题（便于浏览器标签识别）
  useEffect(() => {
    document.title = `${getTabLabel(active) || '管理台'} · 知舟`
    return () => {
      document.title = '知舟 — 小说阅读'
    }
  }, [active])

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
  const [highlightNovelId, setHighlightNovelId] = useState<string>(() => {
    try {
      return sessionStorage.getItem('adminEditNovel') ? (JSON.parse(sessionStorage.getItem('adminEditNovel')!) as { id?: string }).id || '' : ''
    } catch {
      return ''
    }
  })
  useEffect(() => {
    if (highlightNovelId) {
      sessionStorage.removeItem('adminEditNovel')
      if (active !== 'novels') navigate(adminTabPath('novels'), { replace: true })
    }
  }, [active, highlightNovelId, navigate])

  if (!isAdminTab(tab)) {
    return <Navigate to={adminTabPath(fallbackTab)} replace />
  }

  const TabComponent = TAB_COMPONENTS[active]
  const activeLabel = getTabLabel(active)

  return (
    <AdminGate>
      <AdminShell active={active} activeLabel={activeLabel}>
        <TabComponent highlightNovelId={highlightNovelId} onHighlightConsumed={() => setHighlightNovelId('')} />
      </AdminShell>
    </AdminGate>
  )
}

export { TAB_KEY }
