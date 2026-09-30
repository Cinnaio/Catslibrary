/**
 * 总览 tab —— 库存读数行、任务状态条、最近任务/小说（只读，手动刷新）。
 * 由 Novel-KV js/admin-dashboard.js 平移。
 *
 * 库存读数原为 AdminMetricStrip（1.45rem 大数字 + 独立表面）：它吃掉首屏上半屏，
 * 而真正要看的任务状态与最近任务被推到折叠线以下。现改为一行紧凑读数
 * （.dashboard-stat-line），同屏看到全部 9 项。
 */
import AdminStatusBadge from '@/components/admin/AdminStatusBadge'
import type { AdminStatusTone } from '@/lib/admin-status'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'
import { adminApi } from '../../lib/api'
import { formatBytes, timeAgo } from '../../lib/format'
import { jobStatusLabel } from '../../lib/admin'
import AdminPage from '@/components/admin/AdminPage'
import AdminEmptyState from '@/components/admin/AdminEmptyState'
import { ErrorState, LoadingState } from '@/components/admin/AsyncStates'
import { AdminDataPanel, AdminPanelHeading } from '@/components/admin/AdminWorkspace'
import { Button } from '@/components/ui/button'

interface AdminStats {
  totals: { novels: number; chapters: number; users: number; covers: number; failedJobs: number; todayChapters: number; dbSize: number | null }
  contentRating: { general: number; restricted: number; unknown: number }
  jobStatus: { running: number; completed: number; failed: number }
  recentJobs: Array<{
    id: string
    novelId: string
    novelTitle: string
    status: string
    step: string
    current: number
    total: number
    chapterCount: number
    progress: number
    error: string
    startedAt: number
    updatedAt: number
  }>
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

const STATUS_TONE: Record<string, AdminStatusTone> = {
  running: 'info',
  completed: 'success',
  failed: 'danger',
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
  // 三项全零时 totalJobs 被 Math.max 兜成 1，三条 0% 的片段渲染成一条空轨道；
  // 必须单独判断「真的没有任务」，否则空轨道看起来像坏掉的进度条。
  const hasJobs = jobStatus.running + jobStatus.completed + jobStatus.failed > 0

  return (
    <AdminPage
      className="admin-redesign-page admin-redesign-page--dashboard"
      title="后台总览"
      description="书库、抓取任务和站点数据的即时状态。"
      actions={
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
          {/* 库存统计是总览的实义内容（它就是这个页面的「数据」），故保留为一行紧凑
              读数而非删除。但它不再用 AdminMetricStrip 的 1.45rem 大数字 + 独立表面：
              那套层级的用途是「一眼读到数」，而这里要的是同屏看到全部 9 项，
              且不能让概览把任务状态与最近任务推到折叠线以下。 */}
          <AdminDataPanel className="dashboard-stat-line" ariaLabel="书库统计">
            <dl className="dashboard-stat-line__grid">
              {STAT_CARDS.map((card) => {
                const raw = totals ? totals[card.key] : 0
                // dbSize 为 null 表示后端没取到库大小（非 PostgreSQL / 权限不足），
                // 与「库是空的」是两件事。单给一个「—」操作员无法分辨，
                // 因此把单位位换成原因说明。
                const dbSizeUnknown = card.key === 'dbSize' && (raw === null || raw === undefined)
                return (
                  <div key={card.key}>
                    <dt>{card.label}</dt>
                    <dd>
                      {card.key === 'dbSize' ? formatBytes(typeof raw === 'number' ? raw : null) : formatNumber(raw as number)}
                      {!dbSizeUnknown && card.unit && <small>{card.unit}</small>}
                    </dd>
                    {dbSizeUnknown && <span className="dashboard-stat-line__note">未统计</span>}
                  </div>
                )
              })}
              <div>
                <dt>待标注分级</dt>
                <dd>
                  {formatNumber(contentRating.unknown)}
                  <small>本</small>
                </dd>
              </div>
              <div>
                <dt>限制级</dt>
                <dd>
                  {formatNumber(contentRating.restricted)}
                  <small>本</small>
                </dd>
              </div>
            </dl>
          </AdminDataPanel>

          <AdminDataPanel className="dashboard-task-status p-5" ariaLabel="抓取任务状态">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold text-foreground">任务状态</span>
              <span className="text-xs tabular-nums text-muted-foreground">
                运行 {jobStatus.running} · 完成 {jobStatus.completed} · 失败 {jobStatus.failed}
              </span>
            </div>
            {hasJobs ? (
              <div className="mt-3 flex h-2 gap-1 overflow-hidden rounded-full bg-border" aria-hidden="true">
                {(['running', 'completed', 'failed'] as const).map((key) => (
                  <div
                    key={key}
                    className={`h-full rounded-full ${key === 'running' ? 'bg-info' : key === 'completed' ? 'bg-success' : 'bg-destructive'}`}
                    style={{ width: `${(jobStatus[key] / totalJobs) * 100}%` }}
                  />
                ))}
              </div>
            ) : (
              // 全零时原本渲染一条空轨道——看起来像「进度条坏了」而不是
              // 「还没有任务」。改为明确陈述 + 指向下一步。
              <p className="admin-empty-value mt-3 text-xs">暂无抓取任务记录，从「爬虫抓取」发起第一次抓取后这里会显示进度。</p>
            )}
          </AdminDataPanel>

          <div className="grid gap-4 lg:grid-cols-2">
            <AdminDataPanel className="overflow-hidden" ariaLabel="最近抓取任务">
              <AdminPanelHeading title="最近抓取任务" />
              <div className="px-6 py-2">
                {data.recentJobs.length === 0 ? (
                  <AdminEmptyState message="暂无抓取任务" hint="从「爬虫抓取」提交一个链接或搜索书名，任务进度与结果会汇总到这里。" />
                ) : (
                  data.recentJobs.map((j) => (
                    <div className="flex items-center justify-between gap-3 border-b border-border py-3 last:border-0" key={j.id}>
                      <div className="min-w-0">
                        <div className="truncate font-medium text-foreground">{j.novelTitle || j.novelId || j.id}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">{(j.step || '任务') + ' · ' + timeAgo(j.updatedAt)}</div>
                      </div>
                      <AdminStatusBadge tone={STATUS_TONE[j.status] || 'brand'}>{jobStatusLabel(j.status)}</AdminStatusBadge>
                    </div>
                  ))
                )}
              </div>
            </AdminDataPanel>
            <AdminDataPanel className="overflow-hidden" ariaLabel="最近更新小说">
              <AdminPanelHeading title="最近更新小说" />
              <div className="px-6 py-2">
                {data.recentNovels.length === 0 ? (
                  <AdminEmptyState message="书库还是空的" hint="抓取或手动添加小说后，最近更新的作品会出现在这里。" />
                ) : (
                  data.recentNovels.map((n) => (
                    <Link
                      className="flex items-center justify-between gap-3 border-b border-border py-3 last:border-0"
                      to={`/novel/${encodeURIComponent(n.id)}`}
                      key={n.id}
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium text-foreground">{n.title}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {(n.author || '未知作者') + ' · ' + (n.chapterCount || 0) + ' 章 · ' + timeAgo(n.updatedAt)}
                        </div>
                      </div>
                      <span className="shrink-0 text-muted-foreground" aria-hidden="true">
                        ›
                      </span>
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
