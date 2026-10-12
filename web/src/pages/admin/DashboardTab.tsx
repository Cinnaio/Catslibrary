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
import AdminEmptyState from '@/components/admin/AdminEmptyState'
import { ErrorState, InlineError, LoadingState } from '@/components/admin/AsyncStates'
import { AdminDataPanel, AdminPanelHeading } from '@/components/admin/AdminWorkspace'
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
      <AdminEmptyState
        message={view === 'issues' ? '没有需要处理的追更异常' : view === 'recent' ? '还没有检查结果' : '暂无自动追更安排'}
        hint={
          view === 'issues'
            ? '检查失败、待补章节或受保护章节会汇总在这里。'
            : view === 'recent'
              ? '完成检查后，这里会显示结果与新增章节。'
              : '在小说管理中为有来源的书籍开启追更。'
        }
      />
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
                <AdminStatusBadge tone={tone}>{label}</AdminStatusBadge>
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
              <ChevronRight className="size-3.5" aria-hidden="true" />
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
          <div className="dashboard-primary-grid">
            <AdminDataPanel ariaLabel="自动追更" className="dashboard-followups">
              <AdminPanelHeading
                title="自动追更"
                actions={
                  <Link className="dashboard-panel-link" to="/admin/novels">
                    管理书籍
                    <ArrowUpRight className="size-3.5" />
                  </Link>
                }
              />
              {followups ? (
                <>
                  <dl className="dashboard-followup-counts">
                    {(
                      [
                        ['已开启', followups.enabled],
                        ['等待调度', followups.waiting],
                        ['检查中', followups.running],
                        ['需要处理', followups.attention],
                      ] as const
                    ).map(([label, value]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>
                          {number(value)}
                          <small>本</small>
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <Tabs value={activeView} onValueChange={setView} className="dashboard-followup-tabs">
                    <TabsList aria-label="追更记录">
                      <TabsTrigger value="issues">需要处理</TabsTrigger>
                      <TabsTrigger value="scheduled">检查安排</TabsTrigger>
                      <TabsTrigger value="recent">最近结果</TabsTrigger>
                    </TabsList>
                    {(['issues', 'scheduled', 'recent'] as const).map((key) => (
                      <TabsContent key={key} value={key}>
                        <FollowupRows books={followups[key]} view={key} now={data.snapshotAt || 0} onSelect={setSelectedFollowup} />
                      </TabsContent>
                    ))}
                  </Tabs>
                  <p className="dashboard-panel-note">展示最多 6 本。到期书籍按队列调度，检查时间会随任务占用和失败重试调整。</p>
                </>
              ) : (
                <AdminEmptyState message="追更概况暂不可用" hint="请确认 API 已更新后刷新总览。" />
              )}
            </AdminDataPanel>
            <AdminDataPanel ariaLabel="运营事项" className="dashboard-operations">
              <AdminPanelHeading title="运营事项" />
              <div className="dashboard-operation-lead">
                <span>今日入库</span>
                <strong>
                  {number(data.totals.todayChapters)}
                  <small>章</small>
                </strong>
                <p>今日新增章节，包含抓取与手动添加。</p>
              </div>
              <div className="dashboard-operation-links">
                <Link to="/admin/tasks?view=scrape">
                  <div>
                    <strong>抓取任务</strong>
                    <span>{data.jobStatus.running ? `${number(data.jobStatus.running)} 个正在运行` : '当前没有运行中的任务'}</span>
                  </div>
                  <ChevronRight className="size-4" />
                </Link>
                <Link to="/admin/tasks?view=scrape">
                  <div>
                    <strong>失败记录</strong>
                    <span>{number(data.jobStatus.failed)} 条历史失败 · 进入任务中心查看</span>
                  </div>
                  <ChevronRight className="size-4" />
                </Link>
                <Link to="/admin/content-ratings">
                  <div>
                    <strong>分级标注</strong>
                    <span>{data.contentRating.unknown ? `${number(data.contentRating.unknown)} 本尚未标注` : '现有书籍均已标注'}</span>
                  </div>
                  <ChevronRight className="size-4" />
                </Link>
              </div>
              <p className="dashboard-panel-note">{data.snapshotAt ? `数据更新于 ${formatDateTime(data.snapshotAt)}` : '数据来自最近一次刷新'}</p>
            </AdminDataPanel>
          </div>
          <div className="dashboard-secondary-grid">
            <AdminDataPanel ariaLabel="最近抓取任务">
              <AdminPanelHeading
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
                  <AdminEmptyState message="暂无抓取任务" />
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
                      <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" />
                    </button>
                  ))
                )}
              </div>
            </AdminDataPanel>
            <AdminDataPanel ariaLabel="书库动态">
              <AdminPanelHeading
                title="书库动态"
                status={
                  <span className="dashboard-heading-status">
                    {number(data.totals.novels)} 本 · {number(data.totals.chapters)} 章
                  </span>
                }
              />
              <div className="dashboard-rows">
                {!data.recentNovels.length ? (
                  <AdminEmptyState message="书库还是空的" />
                ) : (
                  data.recentNovels.map((book) => (
                    <Link key={book.id} to={manageNovel(book.id)} className="dashboard-row">
                      <div className="dashboard-row__body">
                        <span className="dashboard-row__title">{book.title}</span>
                        <div className="dashboard-row__meta">
                          {book.author || '未知作者'} · {number(book.chapterCount)} 章 · {timeAgo(book.updatedAt)}
                        </div>
                      </div>
                      <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" />
                    </Link>
                  ))
                )}
              </div>
              <div className="dashboard-library-footer">
                <span>封面 {number(data.totals.covers)} 张</span>
                <span>数据库 {data.totals.dbSize === null ? '未统计' : formatBytes(data.totals.dbSize)}</span>
                <span>用户 {number(data.totals.users)} 人</span>
                <span>限制级 {number(data.contentRating.restricted)} 本</span>
              </div>
            </AdminDataPanel>
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
