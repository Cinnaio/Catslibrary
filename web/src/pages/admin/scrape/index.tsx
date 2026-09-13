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

export default function ScrapeTab(_props: { highlightNovelId?: string; onHighlightConsumed?: () => void }) {
  const [searchParams] = useSearchParams()
  const urlView = searchParams.get('view')
  // URL 深链优先；没有参数时沿用上次访问的抓取子页。
  const [view, setView] = usePersistentState<ScrapeView>('scrape_active_view', 'center', (v) => SCRAPE_VIEWS.includes(v as ScrapeView))

  useEffect(() => {
    const nextView = urlView === 'discover' ? 'center' : urlView
    if (nextView && SCRAPE_VIEWS.includes(nextView as ScrapeView) && nextView !== view) {
      setView(nextView as ScrapeView)
    }
  }, [setView, urlView, view])

  return (
    <AdminPage
      className="admin-redesign-page admin-redesign-page--scrape"
      title="抓取中心"
      description="从链接、搜索或榜单进入，完成作品确认、章节校验和任务追踪。"
    >
      {view === 'center' && <CenterView />}
      {view === 'sources' && <SourcesView active={view === 'sources'} />}
      {view === 'proxy' && <ProxyView />}
    </AdminPage>
  )
}
