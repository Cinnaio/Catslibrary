import { useCallback, useEffect, useState } from 'react'
import { LoaderCircle, RefreshCw, ScrollText } from 'lucide-react'
import { scrapeApi } from '@/lib/api'
import AdminStatusBadge from '@/components/admin/AdminStatusBadge'
import AdminEmptyState from '@/components/admin/AdminEmptyState'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AdminDataPanel, AdminPanelHeading, type AdminColumn } from '@/components/admin/AdminWorkspace'
type ProxySource = 'environment' | 'runtime' | 'none'
type ProxyLog = Awaited<ReturnType<typeof scrapeApi.proxyLogs>>['logs'][number]

/** 出站日志列契约：目标为主字段，移动端折成卡片时跨整行。宽度合计 100%。 */
const LOG_COLUMNS: readonly AdminColumn[] = [
  { key: 'time', label: '时间', width: '14%' },
  { key: 'scope', label: '范围', width: '10%' },
  { key: 'target', label: '目标', width: '34%', primary: true },
  { key: 'chain', label: '链路', width: '16%' },
  { key: 'result', label: '结果', width: '16%' },
  { key: 'duration', label: '耗时', width: '10%' },
]

function logSourceLabel(source: ProxySource): string {
  if (source === 'environment') return '环境代理'
  if (source === 'runtime') return '管理端代理'
  return '直连'
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false })
}

export default function OutboundLogsPanel() {
  const [logsLoading, setLogsLoading] = useState(true)
  const [logs, setLogs] = useState<ProxyLog[]>([])
  const [error, setError] = useState('')
  const loadLogs = useCallback(async () => {
    setLogsLoading(true)
    try {
      setLogs((await scrapeApi.proxyLogs(100)).logs)
      setError('')
    } catch (err) {
      setError((err as Error).message || '代理日志加载失败')
    } finally {
      setLogsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadLogs()
  }, [loadLogs])
  return (
    <AdminDataPanel className="proxy-logs-panel overflow-hidden" ariaLabel="出站请求日志" columns={LOG_COLUMNS}>
      <AdminPanelHeading
        title="出站请求"
        actions={
          <Button variant="ghost" size="icon" onClick={() => void loadLogs()} disabled={logsLoading} title="刷新日志" aria-label="刷新日志">
            <RefreshCw className={`size-4 ${logsLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
          </Button>
        }
      />
      {error && (
        <p role="alert" className="px-5 py-3 text-sm text-destructive">
          {error}；可点击刷新重试。
        </p>
      )}
      {logsLoading && !logs.length ? (
        <AdminEmptyState icon={<LoaderCircle className="size-8 animate-spin opacity-40" aria-hidden="true" />} message="正在读取出站请求记录…" />
      ) : !logs.length ? (
        <AdminEmptyState icon={<ScrollText className="size-8 opacity-40" aria-hidden="true" />} message="暂无出站请求记录" />
      ) : (
        <Table>
          <TableCaption className="sr-only">出站请求记录，含时间、范围、目标、代理链路、结果与耗时</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">时间</TableHead>
              <TableHead scope="col">范围</TableHead>
              <TableHead scope="col">目标</TableHead>
              <TableHead scope="col">链路</TableHead>
              <TableHead scope="col">结果</TableHead>
              <TableHead scope="col" className="text-right">
                耗时
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logs.map((log) => (
              <TableRow key={log.id}>
                <TableCell data-label="时间" className="whitespace-nowrap text-xs text-muted-foreground">
                  {formatTime(log.timestamp)}
                </TableCell>
                <TableCell data-label="范围">
                  <code className="text-xs">{log.scope}</code>
                </TableCell>
                <TableCell data-primary="" data-label="目标" className="max-w-[360px] truncate text-xs" title={log.target}>
                  {log.method} {log.target}
                </TableCell>
                <TableCell data-label="链路">
                  <div className="grid gap-0.5">
                    <span className="text-xs">{logSourceLabel(log.proxySource)}</span>
                    {log.proxyHost && <code className="text-xs text-muted-foreground">{log.proxyHost}</code>}
                  </div>
                </TableCell>
                <TableCell data-label="结果">
                  <AdminStatusBadge tone={log.ok ? 'success' : 'danger'}>
                    <span className="inline-block max-w-[240px] truncate align-bottom" title={log.status !== null ? String(log.status) : log.error || '失败'}>
                      {log.status ?? (log.error || '失败')}
                    </span>
                  </AdminStatusBadge>
                </TableCell>
                <TableCell data-label="耗时" className="text-right text-xs text-muted-foreground">
                  {log.durationMs} ms
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <p className="px-5 pb-4 text-xs leading-relaxed text-muted-foreground">仅保留最近 100 条；目标查询参数、请求头、正文及代理凭据不会记录。</p>
    </AdminDataPanel>
  )
}
