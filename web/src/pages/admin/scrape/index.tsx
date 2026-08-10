// ============================================================
// ScrapeTab — coordinator for the three scrape sub-views.
// ============================================================
import { useState } from 'react'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import AdminPage from '@/components/admin/AdminPage'
import CenterView from './CenterView'
import DiscoverView from './DiscoverView'
import SourcesView from './SourcesView'

export default function ScrapeTab(_props: { highlightNovelId?: string; onHighlightConsumed?: () => void }) {
  const [view, setView] = useState<'center' | 'discover' | 'sources'>('center')
  return (
    <AdminPage>
      <Tabs value={view} onValueChange={(v) => setView(v as typeof view)}>
        <TabsList className="mb-4">
          <TabsTrigger value="center">抓取中心</TabsTrigger>
          <TabsTrigger value="discover">发现小说</TabsTrigger>
          <TabsTrigger value="sources">书源管理</TabsTrigger>
        </TabsList>
      </Tabs>
      {view === 'center' && <CenterView />}
      {view === 'discover' && <DiscoverView />}
      {view === 'sources' && <SourcesView active={view === 'sources'} />}
    </AdminPage>
  )
}
