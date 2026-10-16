import { useMemo } from 'react'
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
    <AdminPage
      title="调用与用量"
      description="查看 AI 消耗与调用明细，排查出站请求的路由和响应。"
      className="admin-monitoring-page calls-page"
    >
      <Tabs value={view} onValueChange={(next) => update('view', next)} className="admin-capsule-tabs calls-tabs">
        {/* 单层控制导航轨：左侧胶囊分段导航，右侧时间范围胶囊（仅在 AI 调用下呈现） */}
        <div className="calls-nav-track">
          <TabsList aria-label="调用类型">
            <TabsTrigger value="ai">AI 调用</TabsTrigger>
            <TabsTrigger value="outbound">出站请求</TabsTrigger>
          </TabsList>
          {view === 'ai' && (
            <div className="flex items-center gap-1.5" role="group" aria-label="调用时间范围">
              {[7, 30, 90].map((value) => (
                <Button
                  key={value}
                  size="sm"
                  variant={days === value ? 'secondary' : 'ghost'}
                  aria-pressed={days === value}
                  onClick={() => update('days', String(value))}
                >
                  {value} 天
                </Button>
              ))}
            </div>
          )}
        </div>

        <TabsContent value="ai" className="ai-service ai-admin-page calls-view flex flex-col gap-5">
          {/* Claude 暖纸用量总账卡：包含大盘指标聚合微徽章、折叠状态与双列趋势图表 */}
          <AiUsagePanel days={days} />

          {/* 单层控制纸白作业台：包含内置标题、类型微筛选器与明细表格 */}
          <AiAuditPanel from={from} />
        </TabsContent>

        <TabsContent value="outbound">
          <OutboundLogsPanel />
        </TabsContent>
      </Tabs>
    </AdminPage>
  )
}

