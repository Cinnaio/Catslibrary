import { useCallback, useEffect, useState } from 'react'
import { Activity, RefreshCw } from 'lucide-react'
import { adminApi, type MobileTelemetryEvent, type MobileTelemetryResponse } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { useToast } from '@/components/feedback'
import AdminPage from '@/components/admin/AdminPage'
import AdminEmptyState from '@/components/admin/AdminEmptyState'
import { AdminDataPanel, AdminMetricStrip, AdminToolbar } from '@/components/admin/AdminWorkspace'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

type FilterValue = 'all' | 'open' | 'acknowledged' | 'resolved' | 'ignored'

const STATUS_LABELS: Record<string, string> = {
  all: '全部状态',
  open: '待查看',
  acknowledged: '已确认',
  resolved: '已解决',
  ignored: '已忽略',
}

const TYPE_LABELS: Record<string, string> = {
  event: '事件',
  error: '错误',
  metric: '指标',
  diagnostic: '诊断',
}

function prettyProperties(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    return value || '{}'
  }
}

function EventRow({ event, onStatusChange }: { event: MobileTelemetryEvent; onStatusChange: (event: MobileTelemetryEvent, status: string) => void }) {
  return (
    <TableRow>
      <TableCell className="text-sm text-muted-foreground">{formatDateTime(event.receivedAt)}</TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <Badge variant={event.type === 'error' ? 'destructive' : 'secondary'}>{TYPE_LABELS[event.type] || event.type}</Badge>
          <span className="font-medium">{event.name}</span>
        </div>
      </TableCell>
      <TableCell>
        <div className="text-sm">{event.appVersion || '—'}{event.buildVersion ? ` (${event.buildVersion})` : ''}</div>
        <div className="text-xs text-muted-foreground">{event.osVersion || '系统版本未知'} · {event.deviceModel || '设备未知'}</div>
      </TableCell>
      <TableCell>
        <details className="max-w-[28rem]">
          <summary className="cursor-pointer text-sm text-primary">查看属性</summary>
          <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-xs leading-relaxed">{prettyProperties(event.properties)}</pre>
          {event.adminNote && <p className="mt-2 text-xs text-muted-foreground">备注：{event.adminNote}</p>}
        </details>
      </TableCell>
      <TableCell>
        <select
          className="h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={event.status}
          aria-label={`${event.name} 状态`}
          onChange={(e) => onStatusChange(event, e.target.value)}
        >
          {Object.entries(STATUS_LABELS).filter(([key]) => key !== 'all').map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </TableCell>
    </TableRow>
  )
}

export default function MobileTelemetryTab() {
  const { toast } = useToast()
  const [data, setData] = useState<MobileTelemetryResponse | null>(null)
  const [status, setStatus] = useState<FilterValue>('open')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await adminApi.mobileTelemetry.list({ status, search, limit: '80' })
      setData(result)
    } catch (err) {
      setError((err as Error).message || '客户端监控加载失败')
    } finally {
      setLoading(false)
    }
  }, [search, status])

  useEffect(() => {
    void load()
  }, [load])

  function submitSearch() {
    setSearch(searchInput.trim())
  }

  async function updateStatus(event: MobileTelemetryEvent, nextStatus: string) {
    if (nextStatus === event.status) return
    setSavingId(event.id)
    try {
      await adminApi.mobileTelemetry.update(event.id, nextStatus, event.adminNote)
      toast(`已标记为${STATUS_LABELS[nextStatus] || nextStatus}`, 'success')
      await load()
    } catch (err) {
      toast((err as Error).message || '更新状态失败', 'error')
    } finally {
      setSavingId('')
    }
  }

  const summary = data?.summary

  return (
    <AdminPage
      className="admin-redesign-page admin-redesign-page--mobile-telemetry"
      title="客户端监控"
      description="查看用户主动授权后上传的匿名错误、性能与诊断事件；不包含小说正文或账号信息。"
      actions={<Button variant="secondary" size="sm" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? 'animate-spin' : undefined} />刷新</Button>}
    >
      <AdminMetricStrip
        items={[
          { id: 'open', label: '待查看', value: summary?.open ?? '—', detail: '优先处理' },
          { id: 'errors', label: '近 30 天错误', value: summary?.errors ?? '—' },
          { id: 'diagnostics', label: '近 30 天诊断', value: summary?.diagnostics ?? '—' },
          { id: 'installs', label: '匿名安装数', value: summary?.installs ?? '—' },
        ]}
      />

      <AdminToolbar className="flex-wrap">
        <select
          className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={status}
          aria-label="筛选遥测状态"
          onChange={(e) => setStatus(e.target.value as FilterValue)}
        >
          {Object.entries(STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        <div className="flex min-w-60 flex-1 gap-2 sm:max-w-md">
          <Input
            data-admin-search
            value={searchInput}
            placeholder="搜索事件名、系统或设备…"
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submitSearch() }}
          />
          <Button variant="secondary" onClick={submitSearch}>搜索</Button>
        </div>
      </AdminToolbar>

      <AdminDataPanel className="overflow-hidden" ariaLabel="客户端监控事件列表">
        {loading && !data ? (
          <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">正在读取客户端事件…</div>
        ) : error ? (
          <AdminEmptyState message={error} icon={<Activity className="size-8 opacity-40" />} action={<Button variant="secondary" onClick={() => void load()}>重试</Button>} />
        ) : !data?.events.length ? (
          <AdminEmptyState message={status === 'open' ? '当前没有待查看的客户端问题' : '当前筛选条件下暂无事件'} icon={<Activity className="size-8 opacity-40" />} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>接收时间</TableHead>
                <TableHead>事件</TableHead>
                <TableHead>版本 / 设备</TableHead>
                <TableHead>属性</TableHead>
                <TableHead>处理状态</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.events.map((event) => <EventRow key={event.id} event={event} onStatusChange={updateStatus} />)}
            </TableBody>
          </Table>
        )}
      </AdminDataPanel>

      {summary?.topEvents.length ? (
        <div className="mt-4 rounded-lg border border-border bg-card p-4">
          <h3 className="text-sm font-semibold">近 30 天高频事件</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {summary.topEvents.map((item) => <Badge key={item.name} variant="outline">{item.name} · {item.count}</Badge>)}
          </div>
        </div>
      ) : null}

      {savingId && <span className="sr-only" role="status">正在更新客户端事件状态</span>}
    </AdminPage>
  )
}
