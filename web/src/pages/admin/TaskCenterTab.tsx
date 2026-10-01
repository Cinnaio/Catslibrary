import { useNavigate, useSearchParams } from 'react-router-dom'
import AdminPage from '@/components/admin/AdminPage'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import JobsTab from './JobsTab'
import AiTasksPanel from './ai/AiTasksPanel'

export default function TaskCenterTab() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const view = ['ai', 'downloads'].includes(params.get('view') || '') ? params.get('view')! : 'scrape'
  return (
    <AdminPage title="任务中心" description="跟踪抓取与 AI 任务，处理失败重试，并查看下载记录。" className="admin-monitoring-page task-center-page">
      <Tabs
        value={view}
        onValueChange={(next) => {
          const query = new URLSearchParams(params)
          query.set('view', next)
          setParams(query)
        }}
      >
        <TabsList aria-label="任务类型">
          <TabsTrigger value="scrape">抓取任务</TabsTrigger>
          <TabsTrigger value="ai">AI 任务</TabsTrigger>
          <TabsTrigger value="downloads">下载记录</TabsTrigger>
        </TabsList>
        <TabsContent value="scrape">
          <JobsTab key="scrape" view="scrape" embedded />
        </TabsContent>
        <TabsContent value="ai" className="ai-service ai-admin-page">
          <AiTasksPanel
            onViewBatch={(batchId) => {
              const query = new URLSearchParams({ sub: 'content' })
              if (batchId) query.set('batch', batchId)
              navigate(`/admin/ai?${query}`)
            }}
          />
        </TabsContent>
        <TabsContent value="downloads">
          <JobsTab key="downloads" view="downloads" embedded />
        </TabsContent>
      </Tabs>
    </AdminPage>
  )
}
