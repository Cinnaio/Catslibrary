// ============================================================
// ScrapeTab — coordinator for the three scrape sub-views.
// ============================================================
import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import AdminPage from '@/components/admin/AdminPage'
import { usePersistentState } from '@/hooks/usePersistentState'
import CenterView from './CenterView'
import DiscoverView from './DiscoverView'
import SourcesView from './SourcesView'
import ProxyView from './ProxyView'

const SCRAPE_VIEWS = ['center', 'discover', 'sources', 'proxy'] as const
type ScrapeView = (typeof SCRAPE_VIEWS)[number]

export default function ScrapeTab(_props: { highlightNovelId?: string; onHighlightConsumed?: () => void }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const urlView = searchParams.get('view')
  // URL 深链优先；没有参数时沿用上次访问的抓取子页。
  const [view, setView] = usePersistentState<ScrapeView>('scrape_active_view', 'center', (v) => SCRAPE_VIEWS.includes(v as ScrapeView))

  useEffect(() => {
    if (urlView && SCRAPE_VIEWS.includes(urlView as ScrapeView) && urlView !== view) {
      setView(urlView as ScrapeView)
    }
  }, [setView, urlView, view])

  function handleViewChange(nextView: string) {
    if (!SCRAPE_VIEWS.includes(nextView as ScrapeView)) return
    setView(nextView as ScrapeView)
    const next = new URLSearchParams(searchParams)
    next.set('view', nextView)
    setSearchParams(next)
  }

  return (
    <AdminPage title="爬虫抓取" description="发现外部作品、配置书源，并追踪抓取任务与出站代理。">
      <Tabs value={view} onValueChange={handleViewChange}>
        <TabsList className="mb-4">
          <TabsTrigger value="center">抓取中心</TabsTrigger>
          <TabsTrigger value="discover">发现小说</TabsTrigger>
          <TabsTrigger value="sources">书源管理</TabsTrigger>
          <TabsTrigger value="proxy">代理设置</TabsTrigger>
        </TabsList>
      </Tabs>
      {view === 'center' && <CenterView />}
      {view === 'discover' && <DiscoverView />}
      {view === 'sources' && <SourcesView active={view === 'sources'} />}
      {view === 'proxy' && <ProxyView />}
    </AdminPage>
  )
}
