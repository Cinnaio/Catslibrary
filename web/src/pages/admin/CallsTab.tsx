import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useSession } from '@/context/SessionContext'
import AdminPage from '@/components/admin/AdminPage'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import AiAuditPanel from './ai/AiAuditPanel'
import AiUsagePanel from './ai/AiUsagePanel'
import OutboundLogsPanel from './OutboundLogsPanel'
import styles from './calls.module.css'

export default function CallsTab() {
  const { user } = useSession()
  const isSuper = user?.role === 'super_admin'
  const [params, setParams] = useSearchParams()
  const view = isSuper && params.get('view') === 'outbound' ? 'outbound' : 'ai'
  const requestedDays = Number(params.get('days'))
  const days = [7, 30, 90].includes(requestedDays) ? requestedDays : 30
  const [refreshKey, setRefreshKey] = useState(0)
  const [usageLoading, setUsageLoading] = useState(true)
  const [auditLoading, setAuditLoading] = useState(true)
  const from = useMemo(() => Date.now() - days * 86_400_000, [days])

  function update(key: string, value: string) {
    const query = new URLSearchParams(params)
    query.set(key, value)
    setParams(query)
  }

  return (
    <AdminPage
      title="调用与用量"
      description={isSuper ? '查看 AI 消耗与调用明细，排查出站请求的路由和响应。' : '查看 AI 消耗与调用明细。'}
      className={styles.page}
    >
      <Tabs value={view} onValueChange={(next) => update('view', next)} className={styles.tabs}>
        <div className={styles.nav}>
          <TabsList aria-label="调用类型">
            <TabsTrigger value="ai">AI 调用</TabsTrigger>
            {isSuper && <TabsTrigger value="outbound">出站请求</TabsTrigger>}
          </TabsList>
          {view === 'ai' && (
            <div className={styles.period} role="group" aria-label="调用时间范围">
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

        <TabsContent value="ai" className={styles.view}>
          <AiUsagePanel days={days} refreshKey={refreshKey} onLoadingChange={setUsageLoading} />
          <AiAuditPanel
            from={from}
            refreshKey={refreshKey}
            onLoadingChange={setAuditLoading}
            onRefresh={() => setRefreshKey((value) => value + 1)}
            refreshBusy={usageLoading || auditLoading}
          />
        </TabsContent>

        {isSuper && <TabsContent value="outbound" className={styles.outbound}>
          <OutboundLogsPanel />
        </TabsContent>}
      </Tabs>
    </AdminPage>
  )
}

