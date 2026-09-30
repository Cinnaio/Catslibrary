// ============================================================
// ScrapeTab — coordinator for the two scrape sub-views.
// ============================================================
import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import AdminPage from '@/components/admin/AdminPage'
import { usePersistentState } from '@/hooks/usePersistentState'
import CenterView from './CenterView'
import ProxyView from './ProxyView'

const SCRAPE_VIEWS = ['center', 'proxy'] as const
type ScrapeView = (typeof SCRAPE_VIEWS)[number]

const SCRAPE_VIEW_META: Record<ScrapeView, { title: string; description: string }> = {
  center: { title: '抓取中心', description: '从链接、搜索或榜单进入，完成作品确认、章节校验和任务追踪。' },
  proxy: { title: '代理设置', description: '配置出站代理、站点访问凭据，检查路由并查看最近的请求记录。' },
}

export default function ScrapeTab(_props: { highlightNovelId?: string; onHighlightConsumed?: () => void }) {
  const [searchParams] = useSearchParams()
  const urlView = searchParams.get('view')
  // URL 深链优先；没有参数时沿用上次访问的抓取子页。
  const [view, setView] = usePersistentState<ScrapeView>('scrape_active_view', 'center', (v) => SCRAPE_VIEWS.includes(v as ScrapeView))

  const requestedView = urlView === 'discover' ? 'center' : urlView
  const currentView: ScrapeView = requestedView
    ? SCRAPE_VIEWS.includes(requestedView as ScrapeView)
      ? (requestedView as ScrapeView)
      : 'center'
    : SCRAPE_VIEWS.includes(view)
      ? view
      : 'center'
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
      title={currentMeta.title}
      description={currentMeta.description}
    >
      {currentView === 'center' && <CenterView />}
      {currentView === 'proxy' && <ProxyView />}
    </AdminPage>
  )
}
