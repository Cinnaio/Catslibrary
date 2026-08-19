// ============================================================
// ScrapeTab — coordinator for the three scrape sub-views.
// ============================================================
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
  // 子视图持久化：刷新后停留在上次选的子页（抓取中心/发现小说/书源管理）
  const [view, setView] = usePersistentState<ScrapeView>('scrape_active_view', 'center', (v) => SCRAPE_VIEWS.includes(v as ScrapeView))
  return (
    <AdminPage>
      <Tabs value={view} onValueChange={(v) => setView(v as ScrapeView)}>
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
