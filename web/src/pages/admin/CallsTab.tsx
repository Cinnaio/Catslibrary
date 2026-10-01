import { useMemo } from 'react'
import { ChevronRight } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import AdminPage from '@/components/admin/AdminPage'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import AiAuditPanel from './ai/AiAuditPanel'
import AiUsagePanel from './ai/AiUsagePanel'
import OutboundLogsPanel from './OutboundLogsPanel'

export default function CallsTab() {
  const [params, setParams] = useSearchParams()
  const view = params.get('view') === 'outbound' ? 'outbound' : 'ai'
  const requestedDays = Number(params.get('days'))
  const days = [7, 30, 90].includes(requestedDays) ? requestedDays : 30
  const from = useMemo(() => Date.now() - days * 86_400_000, [days])
  function update(key: string, value: string) {
    const query = new URLSearchParams(params)
    query.set(key, value)
    setParams(query)
  }
  return (
    <AdminPage title="调用与用量" description="查看 AI 消耗与调用明细，排查出站请求的路由和响应。" className="admin-monitoring-page">
      <Tabs value={view} onValueChange={(next) => update('view', next)}>
        <TabsList aria-label="调用类型">
          <TabsTrigger value="ai">AI 调用</TabsTrigger>
          <TabsTrigger value="outbound">出站请求</TabsTrigger>
        </TabsList>
        <TabsContent value="ai" className="ai-service ai-admin-page grid gap-4 min-w-0">
          <div className="calls-range-row">
            <p>最近 {days} 天 · 时间范围同时作用于趋势与明细</p>
            <div className="calls-range-control" role="group" aria-label="调用时间范围">
              {[7, 30, 90].map((value) => (
                <Button key={value} size="sm" variant="ghost" aria-pressed={days === value} onClick={() => update('days', String(value))}>
                  {value} 天
                </Button>
              ))}
            </div>
          </div>
          <details open className="admin-monitoring-trends">
            <summary>
              <ChevronRight aria-hidden="true" />
              用量趋势
            </summary>
            <AiUsagePanel key={days} days={days} />
          </details>
          <AiAuditPanel key={days} from={from} />
        </TabsContent>
        <TabsContent value="outbound">
          <OutboundLogsPanel />
        </TabsContent>
      </Tabs>
    </AdminPage>
  )
}
