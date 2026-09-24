/**
 * 总览 tab —— 指标条（shadcn utilities，无同尺寸图标卡）、任务状态条、最近任务/小说（只读，手动刷新）。
 * 由 Novel-KV js/admin-dashboard.js 平移。
 */
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'
import { adminApi } from '../../lib/api'
import { formatBytes, timeAgo } from '../../lib/format'
import { jobStatusLabel } from '../../lib/admin'
import AdminPage from '@/components/admin/AdminPage'
import AdminEmptyState from '@/components/admin/AdminEmptyState'
import { ErrorState, LoadingState } from '@/components/admin/AsyncStates'
import { AdminDataPanel, AdminMetricStrip, AdminPanelHeading } from '@/components/admin/AdminWorkspace'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

interface AdminStats {
  totals: { novels: number; chapters: number; users: number; covers: number; failedJobs: number; todayChapters: number; dbSize: number | null }
  contentRating: { general: number; restricted: number; unknown: number }
  jobStatus: { running: number; completed: number; failed: number }
  recentJobs: Array<{ id: string; novelId: string; novelTitle: string; status: string; step: string; current: number; total: number; chapterCount: number; progress: number; error: string; startedAt: number; updatedAt: number }>
  recentNovels: Array<{ id: string; title: string; author: string; chapterCount: number; updatedAt: number }>
}

const STAT_CARDS: Array<{ label: string; key: keyof AdminStats['totals']; unit: string }> = [
  { label: '小说总数', key: 'novels', unit: '本' },
  { label: '章节总数', key: 'chapters', unit: '章' },
  { label: '用户数', key: 'users', unit: '人' },
  { label: '今日新增章节', key: 'todayChapters', unit: '章' },
  { label: '失败任务', key: 'failedJobs', unit: '个' },
  { label: '封面缓存', key: 'covers', unit: '张' },
  { label: '数据库大小', key: 'dbSize', unit: '' },
]

const PILL_CLASS: Record<string, string> = {
  running: 'bg-info/10 text-info',
  completed: 'bg-success/10 text-success',
  failed: 'bg-destructive/10 text-destructive',
}

function formatNumber(value: number | string): string {
  if (value === '—') return '—'
  const n = Number(value)
  return Number.isFinite(n) ? n.toLocaleString('zh-CN') : String(value)
}

export default function DashboardTab(_props: { highlightNovelId?: string; onHighlightConsumed?: () => void }) {
  const [data, setData] = useState<AdminStats | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (force = false) => {
    setLoading(true)
    setError('')
    try {
      const stats = (await adminApi.stats()) as unknown as AdminStats
      setData(stats)
    } catch (err) {
      setError((err as Error).message || '未知错误')
    } finally {
      setLoading(false)
    }
    void force
  }, [])

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const totals = data?.totals
  const jobStatus = data?.jobStatus || { running: 0, completed: 0, failed: 0 }
  const contentRating = data?.contentRating || { general: 0, restricted: 0, unknown: 0 }
  const totalJobs = Math.max(1, jobStatus.running + jobStatus.completed + jobStatus.failed)

  return (
    <AdminPage className="admin-redesign-page admin-redesign-page--dashboard" title="后台总览" description="书库、抓取任务和站点数据的即时状态。" actions={
          <Button variant="secondary" size="sm" onClick={() => void load(true)} disabled={loading}>
            <RefreshCw className={loading ? 'size-3.5 animate-spin' : 'size-3.5'} />
            {loading ? '加载中…' : '刷新总览'}
          </Button>
        }
      >

      {error ? (
        <ErrorState className="admin-panel-card" message={`总览加载失败：${error}`} onRetry={() => void load(true)} />
      ) : !data ? (
        <LoadingState className="admin-panel-card" label="正在加载总览数据" />
      ) : (
        <div className="space-y-4">
          <AdminMetricStrip
            className="admin-metric-strip--dashboard"
            ariaLabel="后台总览指标"
            items={[
              ...STAT_CARDS.map((card) => {
                const raw = totals ? totals[card.key] : 0
                return {
                  label: card.label,
                  value: card.key === 'dbSize' ? formatBytes(typeof raw === 'number' ? raw : null) : formatNumber(raw as number),
                  detail: card.unit,
                }
              }),
              // 标注进度：unknown 就是「还没人工判定的存量」。没有这个数字，
              // 存量书的标注工作没有方向盘，也无法判断何时可以弃用正则兜底。
              {
                label: '待标注分级',
                value: formatNumber(contentRating.unknown),
                detail: '本',
                detailTone: contentRating.unknown > 0 ? ('muted' as const) : ('success' as const),
              },
              {
                label: '限制级',
                value: formatNumber(contentRating.restricted),
                detail: '本',
              },
            ]}
          />

          <AdminDataPanel className="dashboard-task-status p-5" ariaLabel="抓取任务状态">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold text-foreground">任务状态</span>
              <span className="text-xs tabular-nums text-muted-foreground">
                运行 {jobStatus.running} · 完成 {jobStatus.completed} · 失败 {jobStatus.failed}
              </span>
            </div>
            <div className="mt-3 flex h-2 gap-1 overflow-hidden rounded-full bg-border" aria-hidden="true">
              {(['running', 'completed', 'failed'] as const).map((key) => (
                <div
                  key={key}
                  className={`h-full rounded-full ${key === 'running' ? 'bg-info' : key === 'completed' ? 'bg-success' : 'bg-destructive'}`}
                  style={{ width: `${(jobStatus[key] / totalJobs) * 100}%` }}
                />
              ))}
            </div>
          </AdminDataPanel>

          <div className="grid gap-4 lg:grid-cols-2">
            <AdminDataPanel className="overflow-hidden" ariaLabel="最近抓取任务">
              <AdminPanelHeading
                title="最近抓取任务"
                status={<span className="text-xs text-muted-foreground">按更新时间</span>}
              />
              <div className="px-6 py-2">
                {data.recentJobs.length === 0 ? (
                  <AdminEmptyState message="暂无抓取任务" />
                ) : (
                  data.recentJobs.map((j) => (
                    <div className="flex items-center justify-between gap-3 border-b border-border py-3 last:border-0" key={j.id}>
                      <div className="min-w-0">
                        <div className="truncate font-medium text-foreground">{j.novelTitle || j.novelId || j.id}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {(j.step || '任务') + ' · ' + timeAgo(j.updatedAt)}
                        </div>
                      </div>
                      <Badge className={PILL_CLASS[j.status] || ''}>{jobStatusLabel(j.status)}</Badge>
                    </div>
                  ))
                )}
              </div>
            </AdminDataPanel>
            <AdminDataPanel className="overflow-hidden" ariaLabel="最近更新小说">
              <AdminPanelHeading
                title="最近更新小说"
                status={<span className="text-xs text-muted-foreground">书库动态</span>}
              />
              <div className="px-6 py-2">
                {data.recentNovels.length === 0 ? (
                  <AdminEmptyState message="暂无小说" />
                ) : (
                  data.recentNovels.map((n) => (
                    <Link className="flex items-center justify-between gap-3 border-b border-border py-3 last:border-0" to={`/novel/${encodeURIComponent(n.id)}`} key={n.id}>
                      <div className="min-w-0">
                        <div className="truncate font-medium text-foreground">{n.title}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {(n.author || '未知作者') + ' · ' + (n.chapterCount || 0) + ' 章 · ' + timeAgo(n.updatedAt)}
                        </div>
                      </div>
                      <span className="shrink-0 text-muted-foreground" aria-hidden="true">›</span>
                    </Link>
                  ))
                )}
              </div>
            </AdminDataPanel>
          </div>
        </div>
      )}
    </AdminPage>
  )
}
