/**
 * 总览 tab —— 指标卡（shadcn Card）、任务状态条、最近任务/小说（只读，手动刷新）。
 * 由 Novel-KV js/admin-dashboard.js 平移。
 */
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'
import { adminApi } from '../../lib/api'
import { timeAgo } from '../../lib/format'
import { jobStatusLabel } from '../../lib/admin'
import AdminTabHeader from '@/components/admin/AdminTabHeader'
import AdminEmptyState from '@/components/admin/AdminEmptyState'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface AdminStats {
  totals: { novels: number; chapters: number; users: number; covers: number; failedJobs: number; todayChapters: number; dbSize: number | null }
  jobStatus: { running: number; completed: number; failed: number }
  recentJobs: Array<{ id: string; novelId: string; novelTitle: string; status: string; step: string; current: number; total: number; chapterCount: number; progress: number; error: string; startedAt: number; updatedAt: number }>
  recentNovels: Array<{ id: string; title: string; author: string; chapterCount: number; updatedAt: number }>
}

const STAT_CARDS: Array<{ label: string; key: keyof AdminStats['totals']; unit: string; mark: string }> = [
  { label: '小说总数', key: 'novels', unit: '本', mark: '馆' },
  { label: '章节总数', key: 'chapters', unit: '章', mark: '章' },
  { label: '用户数', key: 'users', unit: '人', mark: '客' },
  { label: '今日新增章节', key: 'todayChapters', unit: '章', mark: '今' },
  { label: '失败任务', key: 'failedJobs', unit: '个', mark: '警' },
  { label: '封面缓存', key: 'covers', unit: '张', mark: '封' },
  { label: '数据库大小', key: 'dbSize', unit: '', mark: '库' },
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
  const totalJobs = Math.max(1, jobStatus.running + jobStatus.completed + jobStatus.failed)

  return (
    <section className="tab-content">
      <AdminTabHeader
        kicker="OVERVIEW"
        title="后台总览"
        description="书库、抓取任务和站点数据的即时状态。"
        variant="hero"
        actions={
          <Button variant="secondary" size="sm" onClick={() => void load(true)} disabled={loading}>
            <RefreshCw className={loading ? 'size-3.5 animate-spin' : 'size-3.5'} />
            {loading ? '加载中…' : '刷新总览'}
          </Button>
        }
      />

      {error ? (
        <div className="dashboard-grid">
          <div className="dashboard-error">总览加载失败：{error}</div>
        </div>
      ) : !data ? (
        <div className="dashboard-grid">
          <div className="dashboard-loading">加载中…</div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-7">
            {STAT_CARDS.map((card) => {
              const raw = totals ? totals[card.key] : 0
              const value = card.key === 'dbSize' ? (raw || '—') : raw
              return (
                <Card key={card.key}>
                  <CardContent className="flex items-center gap-3 p-4">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-base text-primary">
                      {card.mark}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-xs text-muted-foreground">{card.label}</div>
                      <div className="text-[1.75rem] font-semibold leading-tight">
                        {formatNumber(value as number | string)}
                        {card.unit && <span className="ml-0.5 text-sm font-normal text-muted-foreground">{card.unit}</span>}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>

          <div className="dashboard-status-strip">
            <div className="dashboard-status-strip__head">
              <span className="text-sm">任务状态</span>
              <span className="text-xs text-muted">
                运行 {jobStatus.running} · 完成 {jobStatus.completed} · 失败 {jobStatus.failed}
              </span>
            </div>
            <div className="dashboard-status-bar" aria-hidden="true">
              {(['running', 'completed', 'failed'] as const).map((key) => (
                <div
                  key={key}
                  className={`dashboard-status-bar__seg dashboard-status-bar__seg--${key}`}
                  style={{ width: `${(jobStatus[key] / totalJobs) * 100}%` }}
                />
              ))}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="flex-row items-center justify-between gap-2">
                <CardTitle className="text-base">最近抓取任务</CardTitle>
                <span className="text-xs text-muted">按更新时间</span>
              </CardHeader>
              <CardContent>
                <div className="dashboard-list">
                  {data.recentJobs.length === 0 ? (
                    <AdminEmptyState message="暂无抓取任务" />
                  ) : (
                    data.recentJobs.map((j) => (
                      <div className="dashboard-list-item" key={j.id}>
                        <div className="dashboard-list-item__main">
                          <div className="dashboard-list-item__title">{j.novelTitle || j.novelId || j.id}</div>
                          <div className="dashboard-list-item__meta">
                            {(j.step || '任务') + ' · ' + timeAgo(j.updatedAt)}
                          </div>
                        </div>
                        <Badge className={PILL_CLASS[j.status] || ''}>{jobStatusLabel(j.status)}</Badge>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex-row items-center justify-between gap-2">
                <CardTitle className="text-base">最近更新小说</CardTitle>
                <span className="text-xs text-muted">书库动态</span>
              </CardHeader>
              <CardContent>
                <div className="dashboard-list">
                  {data.recentNovels.length === 0 ? (
                    <AdminEmptyState message="暂无小说" />
                  ) : (
                    data.recentNovels.map((n) => (
                      <Link className="dashboard-list-item" to={`/novel/${encodeURIComponent(n.id)}`} key={n.id}>
                        <div className="dashboard-list-item__main">
                          <div className="dashboard-list-item__title">{n.title}</div>
                          <div className="dashboard-list-item__meta">
                            {(n.author || '未知作者') + ' · ' + (n.chapterCount || 0) + ' 章 · ' + timeAgo(n.updatedAt)}
                          </div>
                        </div>
                        <div className="dashboard-list-item__arrow">›</div>
                      </Link>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </section>
  )
}
