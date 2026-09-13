// ============================================================
// ScrapeTab — coordinator for the three scrape sub-views.
// ============================================================
import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import AdminPage from '@/components/admin/AdminPage'
import { usePersistentState } from '@/hooks/usePersistentState'
import CenterView from './CenterView'
import SourcesView from './SourcesView'
import ProxyView from './ProxyView'

const SCRAPE_VIEWS = ['center', 'sources', 'proxy'] as const
type ScrapeView = (typeof SCRAPE_VIEWS)[number]

const SCRAPE_VIEW_META: Record<ScrapeView, { title: string; description: string }> = {
  center: { title: '抓取中心', description: '从链接、搜索或榜单进入，完成作品确认、章节校验和任务追踪。' },
  sources: { title: '书源管理', description: '导入、筛选、检测并维护可用于抓取的书源规则。' },
  proxy: { title: '代理设置', description: '配置出站代理、检查路由并查看最近的请求记录。' },
}

export default function ScrapeTab(_props: { highlightNovelId?: string; onHighlightConsumed?: () => void }) {
  const [searchParams] = useSearchParams()
  const urlView = searchParams.get('view')
  // URL 深链优先；没有参数时沿用上次访问的抓取子页。
  const [view, setView] = usePersistentState<ScrapeView>('scrape_active_view', 'center', (v) => SCRAPE_VIEWS.includes(v as ScrapeView))

  const requestedView = urlView === 'discover' ? 'center' : urlView
  const currentView: ScrapeView = SCRAPE_VIEWS.includes(requestedView as ScrapeView)
    ? (requestedView as ScrapeView)
    : SCRAPE_VIEWS.includes(view) ? view : 'center'
  const currentMeta = SCRAPE_VIEW_META[currentView]

  useEffect(() => {
    const nextView = urlView === 'discover' ? 'center' : urlView
    if (nextView && SCRAPE_VIEWS.includes(nextView as ScrapeView) && nextView !== view) {
      setView(nextView as ScrapeView)
    }
  }, [setView, urlView, view])

  return (
    <AdminPage
      className={`admin-redesign-page admin-redesign-page--scrape admin-redesign-page--${currentView}`}
      // SourcesView 已经拥有带操作区的页头，避免父级再渲染第二个“书源管理”。
      title={currentView === 'sources' ? undefined : currentMeta.title}
      description={currentView === 'sources' ? undefined : currentMeta.description}
    >
      {currentView === 'center' && <CenterView />}
      {currentView === 'sources' && <SourcesView active={currentView === 'sources'} />}
      {currentView === 'proxy' && <ProxyView />}
    </AdminPage>
  )
}
