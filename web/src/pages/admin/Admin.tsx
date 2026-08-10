/**
 * 管理后台外壳 —— 薄编排器。
 * 职责已拆出：鉴权门 AdminGate、布局 AdminShell（含侧边栏/顶栏）、
 * 导航与 tab 注册表 admin-registry。本文件仅保留状态与副作用：
 * admin_active_tab 持久化、sessionStorage 高亮、document.title、/ 聚焦搜索框。
 */
import { useEffect, useState } from 'react'
import AdminGate from './AdminGate'
import AdminShell from './AdminShell'
import { getTabLabel, TAB_COMPONENTS, TAB_KEY } from './admin-registry'

export default function Admin() {
  const [active, setActive] = useState<string>(() => localStorage.getItem(TAB_KEY) || 'dashboard')

  // 激活 tab 持久化（与原版 admin_active_tab 一致）
  useEffect(() => {
    localStorage.setItem(TAB_KEY, active)
  }, [active])

  // 后台页面标题（便于浏览器标签识别）
  useEffect(() => {
    document.title = '知舟管理台'
    return () => {
      document.title = '知舟 — 小说阅读'
    }
  }, [])

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
      setActive('novels')
    }
  }, [highlightNovelId])

  const TabComponent = TAB_COMPONENTS[active] || TAB_COMPONENTS.dashboard!
  const activeLabel = getTabLabel(active)

  return (
    <AdminGate>
      <AdminShell active={active} onSelect={setActive} activeLabel={activeLabel}>
        <TabComponent highlightNovelId={highlightNovelId} onHighlightConsumed={() => setHighlightNovelId('')} />
      </AdminShell>
    </AdminGate>
  )
}

export { TAB_KEY }
