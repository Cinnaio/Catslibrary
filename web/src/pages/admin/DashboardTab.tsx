import '../../styles/admin/pages/overview.css'
/** 后台总览：追更安排与异常优先，书库规模作为次级信息。 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, ChevronRight, RefreshCw } from 'lucide-react'
import type { DashboardFollowupBook, DashboardFollowups } from '@shared/admin-dashboard'
import AdminStatusBadge from '@/components/admin/AdminStatusBadge'
import type { AdminStatusTone } from '@/lib/admin-status'
import { adminApi } from '@/lib/api'
import { formatBytes, formatDateTime, timeAgo } from '@/lib/format'
import { jobStatusLabel } from '@/lib/admin'
import AdminPage from '@/components/admin/AdminPage'
import EmptyState from "@/components/shared/EmptyState"
import { ErrorState, InlineError, LoadingState } from "@/components/shared/AsyncStates"
import { AdminDataPanel } from '@/components/admin/AdminDataPanel'
import { PanelHeading } from '@/components/shared/PanelHeading'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import NovelFollowupDialog from '@/components/admin/NovelFollowupDialog'
import ScrapeTaskDetailsDialog from '@/components/admin/ScrapeTaskDetailsDialog'

interface AdminStats {
  snapshotAt?: number
  followups?: DashboardFollowups
  totals: { novels: number; chapters: number; users: number; covers: number; failedJobs: number; todayChapters: number; dbSize: number | null }
  contentRating: { general: number; restricted: number; unknown: number }
  jobStatus: { running: number; completed: number; failed: number }
  recentJobs: Array<{ id: string; novelId: string; novelTitle: string; status: string; step: string; error: string; updatedAt: number }>
  recentNovels: Array<{ id: string; title: string; author: string; chapterCount: number; updatedAt: number }>
}

const FOLLOWUP_RESULT: Record<string, [string, AdminStatusTone]> = {
  running: ['检查中', 'info'],
  updated: ['有新章', 'success'],
  no_change: ['暂无新章', 'neutral'],
  failed: ['检查失败', 'danger'],
  partial: ['部分失败', 'warning'],
  pending: ['待补章节', 'warning'],
  protected: ['章节受保护', 'warning'],
  cancelled: ['已取消', 'neutral'],
  idle: ['尚未检查', 'neutral'],
}
const JOB_TONE: Record<string, AdminStatusTone> = {
  starting: 'info',
  running: 'info',
  completed: 'success',
  failed: 'danger',
  partial: 'warning',
  cancelled: 'neutral',
}
const number = (value: number) => value.toLocaleString('zh-CN')
const manageNovel = (id: string) => `/admin/novels?novelId=${encodeURIComponent(id)}`

function FollowupRows({
  books,
  view,
  now,
  onSelect,
}: {
  books: DashboardFollowupBook[]
  view: string
  now: number
  onSelect: (book: DashboardFollowupBook) => void
}) {
  if (!books.length)
    return (
      <div className="dashboard-inline-empty">
        <p className="dashboard-inline-empty__message">
          {view === 'issues' ? '没有需要处理的追更异常' : view === 'recent' ? '还没有检查结果' : '暂无自动追更安排'}
        </p>
        <span className="dashboard-inline-empty__hint">
          {view === 'issues'
            ? '检查失败、待补章节或受保护章节会汇总在这里。'
            : view === 'recent'
              ? '完成检查后，这里会显示结果与新增章节。'
              : '在小说管理中为有来源的书籍开启追更。'}
        </span>
      </div>
    )
  return (
    <div className="dashboard-rows">
      {books.map((book) => {
        const [label, tone] = FOLLOWUP_RESULT[book.result] || [book.result || '尚未检查', 'neutral']
        return (
          <button
            type="button"
            key={book.novelId}
            onClick={() => onSelect(book)}
            className="dashboard-row dashboard-followup-row"
            aria-label={`查看追更事件：${book.title}`}
          >
            <div className="dashboard-row__body">
              <div className="dashboard-row__identity">
                <span className="dashboard-row__title">{book.title}</span>
                <AdminStatusBadge tone={tone}>
                  {book.result === 'running' && <span className="status-dot-pulse" aria-hidden="true" />}
                  {label}
                </AdminStatusBadge>
              </div>
              <p className="dashboard-row__detail">
                {book.result === 'updated' && book.addedCount > 0
                  ? `已新增 ${number(book.addedCount)} 章`
                  : book.message || (book.checkedAt ? '检查已完成' : '等待首次检查')}
              </p>
              <div className="dashboard-row__meta">
                {book.checkedAt ? `上次检查 ${timeAgo(book.checkedAt)}` : '尚未检查'} · {book.enabled ? `每 ${book.intervalHours} 小时检查` : '未安排自动检查'}
              </div>
            </div>
            <div className="dashboard-row__aside">
              <span>{book.result === 'running' ? '正在执行' : !book.enabled ? '未调度' : book.nextCheckAt <= now ? '等待调度' : '下次检查'}</span>
              {book.enabled && book.result !== 'running' && book.nextCheckAt > now && (
                <time dateTime={new Date(book.nextCheckAt).toISOString()}>{formatDateTime(book.nextCheckAt)}</time>
              )}
              <ChevronRight className="size-3.5 dashboard-row__arrow" aria-hidden="true" />
            </div>
          </button>
        )
      })}
    </div>
  )
}

export default function DashboardTab(_props: { highlightNovelId?: string; onHighlightConsumed?: () => void }) {
  const [data, setData] = useState<AdminStats | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<string | null>(null)
  const [selectedFollowup, setSelectedFollowup] = useState<DashboardFollowupBook | null>(null)
  const [selectedJob, setSelectedJob] = useState<AdminStats['recentJobs'][number] | null>(null)
  const revision = useRef(0)
  const load = useCallback(async () => {
    const seq = ++revision.current
    setLoading(true)
    setError('')
    try {
      const stats = (await adminApi.stats()) as unknown as AdminStats
      if (seq === revision.current) setData({ ...stats, snapshotAt: stats.snapshotAt || Date.now() })
    } catch (err) {
      if (seq === revision.current) setError((err as Error).message || '未知错误')
    } finally {
      if (seq === revision.current) setLoading(false)
    }
  }, [])
  useEffect(() => {
    void load()
    return () => {
      revision.current++
    }
  }, [load])
  const followups = data?.followups
  const activeView = view || (followups?.attention ? 'issues' : 'scheduled')

  return (
    <AdminPage
      className="admin-redesign-page--dashboard"
      title="后台总览"
      description="查看追更安排、检查结果与需要处理的事项。"
      actions={
        <Button variant="secondary" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`size-3.5${loading ? ' animate-spin' : ''}`} />
          {loading ? '刷新中…' : '刷新总览'}
        </Button>
      }
    >
      {!data ? (
        error ? (
          <ErrorState message={`总览加载失败：${error}`} onRetry={() => void load()} />
        ) : (
          <LoadingState label="正在加载总览数据" />
        )
      ) : (
        <div className="dashboard-workspace" aria-busy={loading}>
          {error && <InlineError message={`刷新失败：${error}，当前显示上次成功读取的数据。`} />}

          {/* Claude 风格全局宏观看板指标条 */}
          <div className="dashboard-hero-metrics">
            <div className="dashboard-metric-card">
              <span className="dashboard-metric-card__label">自动追更已开启</span>
              <strong className="dashboard-metric-card__value">
                {number(followups?.enabled || 0)}
                <small>本</small>
              </strong>
              <span className="dashboard-metric-card__hint">已安排周期性巡检</span>
            </div>
            <div className={`dashboard-metric-card${(followups?.attention || 0) > 0 ? ' dashboard-metric-card--alert' : ''}`}>
              <span className="dashboard-metric-card__label">需要处理事项</span>
              <strong className="dashboard-metric-card__value">
                {number(followups?.attention || 0)}
                <small>本</small>
              </strong>
              <span className="dashboard-metric-card__hint">异常、受保护或待补</span>
            </div>
            <div className="dashboard-metric-card">
              <span className="dashboard-metric-card__label">检查执行中</span>
              <strong className="dashboard-metric-card__value">
                {(followups?.running || 0) > 0 && <span className="status-dot-pulse" aria-hidden="true" />}
                {number(followups?.running || 0)}
                <small>本</small>
              </strong>
              <span className="dashboard-metric-card__hint">当前运行追更任务</span>
            </div>
            <div className="dashboard-metric-card">
              <span className="dashboard-metric-card__label">今日入库章节</span>
              <strong className="dashboard-metric-card__value">
                {number(data.totals.todayChapters)}
                <small>章</small>
              </strong>
              <span className="dashboard-metric-card__hint">抓取与手动导入新增</span>
            </div>
            <div className="dashboard-metric-card">
              <span className="dashboard-metric-card__label">运行中抓取任务</span>
              <strong className="dashboard-metric-card__value">
                {data.jobStatus.running > 0 && <span className="status-dot-pulse" aria-hidden="true" />}
                {number(data.jobStatus.running)}
                <small>个</small>
              </strong>
              <span className="dashboard-metric-card__hint">爬虫工作台执行中</span>
            </div>
          </div>

          {/* 统一纵向对齐的双列工作台 */}
          <div className="dashboard-main-grid">
            <div className="dashboard-column dashboard-column--primary">
              <AdminDataPanel ariaLabel="自动追更调度" className="dashboard-followups">
                <PanelHeading
                  title="自动追更调度"
                  actions={
                    <Link className="dashboard-panel-link" to="/admin/novels">
                      进入小说管理
                      <ArrowUpRight className="size-3.5" />
                    </Link>
                  }
                />
                {followups ? (
                  <>
                    <Tabs value={activeView} onValueChange={setView} className="dashboard-followup-tabs">
                      <TabsList aria-label="追更记录">
                        <TabsTrigger value="issues">
                          需要处理
                          {(followups.attention > 0) && (
                            <span className="dashboard-tab-badge">{followups.attention}</span>
                          )}
                        </TabsTrigger>
                        <TabsTrigger value="scheduled">检查安排</TabsTrigger>
                        <TabsTrigger value="recent">最近结果</TabsTrigger>
                      </TabsList>
                      {(['issues', 'scheduled', 'recent'] as const).map((key) => (
                        <TabsContent key={key} value={key} className="dashboard-tab-content">
                          <FollowupRows books={followups[key]} view={key} now={data.snapshotAt || 0} onSelect={setSelectedFollowup} />
                        </TabsContent>
                      ))}
                    </Tabs>
                    <p className="dashboard-panel-note">展示最多 6 本。到期书籍按队列自动调度，检查时间会随爬虫占用和重试间隔动态平衡。</p>
                  </>
                ) : (
                  <EmptyState message="追更概况暂不可用" hint="请确认 API 已更新后刷新总览。" />
                )}
              </AdminDataPanel>

              <AdminDataPanel ariaLabel="最近抓取任务" className="dashboard-jobs">
                <PanelHeading
                  title="最近抓取任务"
                  actions={
                    <Link className="dashboard-panel-link" to="/admin/tasks?view=scrape">
                      任务中心
                      <ArrowUpRight className="size-3.5" />
                    </Link>
                  }
                />
                <div className="dashboard-rows">
                  {!data.recentJobs.length ? (
                    <EmptyState message="暂无抓取任务" hint="在抓取中心添加任务后，此处将实时展示进度。" />
                  ) : (
                    data.recentJobs.map((job) => (
                      <button
                        type="button"
                        key={job.id}
                        onClick={() => setSelectedJob(job)}
                        className="dashboard-row"
                        aria-label={`查看抓取任务：${job.novelTitle || job.id}`}
                      >
                        <div className="dashboard-row__body">
                          <div className="dashboard-row__identity">
                            <span className="dashboard-row__title">{job.novelTitle || job.novelId || job.id}</span>
                            <AdminStatusBadge tone={JOB_TONE[job.status] || 'neutral'}>{jobStatusLabel(job.status)}</AdminStatusBadge>
                          </div>
                          <p className="dashboard-row__detail">{job.error || job.step || '等待任务进度'}</p>
                          <div className="dashboard-row__meta">{timeAgo(job.updatedAt)}</div>
                        </div>
                        <ChevronRight className="size-3.5 shrink-0 dashboard-row__arrow" aria-hidden="true" />
                      </button>
                    ))
                  )}
                </div>
              </AdminDataPanel>
            </div>

            <div className="dashboard-column dashboard-column--secondary">
              <AdminDataPanel ariaLabel="运营事项" className="dashboard-operations">
                <PanelHeading title="运营与治理事项" />
                <div className="dashboard-operation-links">
                  <Link to="/admin/tasks?view=scrape" className="dashboard-op-item">
                    <div>
                      <strong>抓取任务排队</strong>
                      <span>{data.jobStatus.running ? `${number(data.jobStatus.running)} 个任务正在运行中` : '当前没有运行中的抓取任务'}</span>
                    </div>
                    <ChevronRight className="size-4 shrink-0 dashboard-row__arrow" />
                  </Link>
                  <Link to="/admin/tasks?view=scrape" className="dashboard-op-item">
                    <div>
                      <strong>历史异常排查</strong>
                      <span>{data.jobStatus.failed > 0 ? `${number(data.jobStatus.failed)} 条失败记录待处理` : '没有未处理的失败记录'}</span>
                    </div>
                    <ChevronRight className="size-4 shrink-0 dashboard-row__arrow" />
                  </Link>
                  <Link to="/admin/content-ratings" className="dashboard-op-item">
                    <div>
                      <strong>内容分级治理</strong>
                      <span>{data.contentRating.unknown ? `${number(data.contentRating.unknown)} 本书籍尚未完成分级标注` : '现有全量书籍均已标注完成'}</span>
                    </div>
                    <ChevronRight className="size-4 shrink-0 dashboard-row__arrow" />
                  </Link>
                </div>
                <p className="dashboard-panel-note">{data.snapshotAt ? `数据更新于 ${formatDateTime(data.snapshotAt)}` : '数据来自最近一次刷新'}</p>
              </AdminDataPanel>

              <AdminDataPanel ariaLabel="书库全景动态" className="dashboard-library">
                <PanelHeading
                  title="书库全景动态"
                  status={
                    <span className="dashboard-heading-status">
                      {number(data.totals.novels)} 本 · {number(data.totals.chapters)} 章
                    </span>
                  }
                />
                <div className="dashboard-rows">
                  {!data.recentNovels.length ? (
                    <EmptyState message="书库还是空的" hint="导入书籍后将在此展示最新入库记录。" />
                  ) : (
                    data.recentNovels.map((book) => (
                      <Link key={book.id} to={manageNovel(book.id)} className="dashboard-row">
                        <div className="dashboard-row__body">
                          <span className="dashboard-row__title">{book.title}</span>
                          <div className="dashboard-row__meta">
                            {book.author || '未知作者'} · {number(book.chapterCount)} 章 · {timeAgo(book.updatedAt)}
                          </div>
                        </div>
                        <ChevronRight className="size-3.5 shrink-0 dashboard-row__arrow" aria-hidden="true" />
                      </Link>
                    ))
                  )}
                </div>
                <div className="dashboard-library-footer">
                  <span>封面 {number(data.totals.covers)} 张</span>
                  <span>数据库 {data.totals.dbSize === null ? '未统计' : formatBytes(data.totals.dbSize)}</span>
                  <span>读者 {number(data.totals.users)} 人</span>
                  <span>限制级 {number(data.contentRating.restricted)} 本</span>
                </div>
              </AdminDataPanel>
            </div>
          </div>
        </div>
      )}
      {selectedFollowup && (
        <NovelFollowupDialog
          key={selectedFollowup.novelId}
          variant="event"
          novel={{ id: selectedFollowup.novelId, title: selectedFollowup.title }}
          onClose={() => {
            setSelectedFollowup(null)
            void load()
          }}
        />
      )}
      {selectedJob && (
        <ScrapeTaskDetailsDialog
          key={selectedJob.id}
          jobId={selectedJob.id}
          title={selectedJob.novelTitle}
          onClose={() => {
            setSelectedJob(null)
            void load()
          }}
        />
      )}
    </AdminPage>
  )
}
