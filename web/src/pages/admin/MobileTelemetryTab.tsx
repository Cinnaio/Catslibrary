import { useCallback, useEffect, useState } from 'react'
import { Activity, RefreshCw } from 'lucide-react'
import { adminApi, type MobileTelemetryEvent, type MobileTelemetryResponse } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { useToast } from '@/components/feedback'
import AdminPage from '@/components/admin/AdminPage'
import AdminEmptyState from '@/components/admin/AdminEmptyState'
import CustomSelect from '../../components/admin/CustomSelect'
import { AdminDataPanel, AdminMetricStrip, AdminPanelHeading, AdminSearch, AdminToolbar, type AdminColumn } from '@/components/admin/AdminWorkspace'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

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

const MOBILE_TELEMETRY_COLUMNS: readonly AdminColumn[] = [
  { key: 'receivedAt', label: '接收时间', width: '10rem' },
  { key: 'event', label: '事件', primary: true },
  { key: 'device', label: '版本 / 设备', width: '12rem' },
  { key: 'properties', label: '属性' },
  { key: 'status', label: '处理状态', width: '9rem' },
]

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
      <TableCell data-label="接收时间" className="text-sm text-muted-foreground">
        {formatDateTime(event.receivedAt)}
      </TableCell>
      <TableCell data-primary="" data-label="事件">
        <div className="flex items-center gap-2">
          <Badge variant={event.type === 'error' ? 'destructive' : 'secondary'}>{TYPE_LABELS[event.type] || event.type}</Badge>
          <span className="font-medium">{event.name}</span>
        </div>
      </TableCell>
      <TableCell data-label="版本 / 设备">
        <div className="text-sm">
          {event.appVersion || '—'}
          {event.buildVersion ? ` (${event.buildVersion})` : ''}
        </div>
        <div className="text-xs text-muted-foreground">
          {event.osVersion || '系统版本未知'} · {event.deviceModel || '设备未知'}
        </div>
      </TableCell>
      <TableCell data-label="属性">
        <details className="telemetry-properties">
          <summary className="telemetry-properties__summary">查看属性</summary>
          <pre className="telemetry-properties__body">{prettyProperties(event.properties)}</pre>
          {event.adminNote && <p className="telemetry-properties__note">备注：{event.adminNote}</p>}
        </details>
      </TableCell>
      <TableCell data-label="处理状态" className="telemetry-status-cell">
        <CustomSelect
          className="telemetry-status-select admin-input--select-sm"
          compact
          options={Object.entries(STATUS_LABELS)
            .filter(([key]) => key !== 'all')
            .map(([value, label]) => ({ value, label }))}
          value={event.status}
          aria-label={`${event.name} 处理状态`}
          onChange={(next) => onStatusChange(event, next)}
        />
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
      actions={
        <Button variant="secondary" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={loading ? 'animate-spin' : undefined} aria-hidden="true" />
          刷新
        </Button>
      }
    >
      <AdminMetricStrip
        items={[
          { id: 'open', label: '待查看', value: summary?.open ?? '—', detail: '优先处理' },
          { id: 'errors', label: '近 30 天错误', value: summary?.errors ?? '—' },
          { id: 'diagnostics', label: '近 30 天诊断', value: summary?.diagnostics ?? '—' },
          { id: 'installs', label: '匿名安装数', value: summary?.installs ?? '—' },
        ]}
      />

      <AdminToolbar className="mobile-telemetry-toolbar" ariaLive="polite">
        <span className="mobile-telemetry-toolbar__label">处理状态</span>
        <CustomSelect
          className="mobile-telemetry-toolbar__status admin-input--select-sm"
          compact
          options={Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))}
          value={status}
          aria-label="筛选遥测状态"
          onChange={(next) => setStatus(next as FilterValue)}
        />
        <div className="mobile-telemetry-toolbar__search">
          <AdminSearch
            id="telemetry-search"
            label="搜索客户端事件"
            type="search"
            data-admin-search
            className="admin-input--compact"
            placeholder="搜索事件名、系统或设备…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitSearch()
            }}
          />
          <Button variant="secondary" size="sm" onClick={submitSearch}>
            搜索
          </Button>
        </div>
      </AdminToolbar>

      <AdminDataPanel className="overflow-hidden" ariaLabel="客户端监控事件列表" columns={MOBILE_TELEMETRY_COLUMNS}>
        <AdminPanelHeading
          title="事件列表"
          description="按接收时间排列用户授权上传的匿名事件，逐条确认或归档。"
          status={
            <span className={`admin-panel-status${error ? ' is-error' : ''}`}>
              {loading ? '读取中' : error ? '读取失败' : data?.events.length ? `显示 ${data.events.length} 条` : '暂无内容'}
            </span>
          }
        />
        {loading && !data ? (
          <div className="mobile-telemetry-loading" role="status">
            正在读取客户端事件…
          </div>
        ) : error ? (
          <AdminEmptyState message={error} icon={<Activity className="size-8 opacity-40" />} action={<Button variant="secondary" onClick={() => void load()}>重试</Button>} />
        ) : !data?.events.length ? (
          <AdminEmptyState message={status === 'open' ? '当前没有待查看的客户端问题' : '当前筛选条件下暂无事件'} icon={<Activity className="size-8 opacity-40" />} />
        ) : (
          <Table>
            <TableCaption className="sr-only">客户端监控事件列表，包含接收时间、事件、版本设备、属性与处理状态</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">接收时间</TableHead>
                <TableHead scope="col">事件</TableHead>
                <TableHead scope="col">版本 / 设备</TableHead>
                <TableHead scope="col">属性</TableHead>
                <TableHead scope="col">处理状态</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.events.map((event) => <EventRow key={event.id} event={event} onStatusChange={updateStatus} />)}
            </TableBody>
          </Table>
        )}
      </AdminDataPanel>

      {summary?.topEvents.length ? (
        <section className="admin-panel-card mobile-telemetry-top-events" aria-label="近 30 天高频事件">
          <AdminPanelHeading title="近 30 天高频事件" description="按出现次数排列，用于判断高频问题集中在哪些事件。" />
          <div className="mobile-telemetry-top-events__list">
            {summary.topEvents.map((item) => (
              <Badge key={item.name} variant="outline">
                {item.name} · {item.count}
              </Badge>
            ))}
          </div>
        </section>
      ) : null}

      {savingId && <span className="sr-only" role="status">正在更新客户端事件状态</span>}
    </AdminPage>
  )
}
