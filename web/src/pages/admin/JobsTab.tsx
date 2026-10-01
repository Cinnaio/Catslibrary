/**
 * 任务管理 tab —— 抓取任务列表 + 下载日志。
 * 由 Novel-KV js/admin-jobs.js 的 Task Management 部分 + admin.html #tab-jobs 平移。
 *
 * 说明：
 * - 自适应轮询：有运行中任务 4s，否则 20s。用 useEffect + setTimeout 链（每次加载完成后再
 *   安排下一次），避免 setInterval 的重叠；document.hidden 时暂停，恢复可见立即刷新。
 * - 行内动作（终止/整本重试/重试失败章节）经 scrapePost 直发 /api/scrape POST。
 * - 原版的重试在成功后切换到「爬虫」tab 并创建任务卡；本 tab 无 tab 切换能力，
 *   故仅 toast + 重载列表（偏离点）。
 */
import { TaskDetails, TaskSummary } from './TaskWorkspace'
import AdminStatusBadge from '@/components/admin/AdminStatusBadge'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Ban, CircleMinus, Check, AlertCircle, RefreshCw } from 'lucide-react'
import { adminApi, authFetch, downloadLogsApi, newOperationId, scrapeApi } from '../../lib/api'
import { formatDateTime } from '../../lib/format'
import { formatEta, formatJobSpeed, getJobDuration, isJobRunning, isJobTerminal, jobStatusLabel, truncateId } from '../../lib/admin'
import { useConfirm, useToast } from '../../components/feedback'
import AdminEmptyState from '@/components/admin/AdminEmptyState'
import AdminPage from '@/components/admin/AdminPage'
import { AdminDataPanel, AdminPanelHeading, AdminToolbar, type AdminColumn } from '@/components/admin/AdminWorkspace'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

// ---------- Types ----------

interface Job {
  id: string
  novelId?: string
  status: string
  step?: string
  current?: number
  total?: number
  chapterCount?: number
  progress?: number
  error?: string
  startedAt?: number
  updatedAt?: number
  localMode?: boolean
  updateMode?: boolean
  successCount?: number
  failedCount?: number
  skippedCount?: number
  speed?: number
  etaSeconds?: number
  summary?: { successCount?: number; failedCount?: number; skippedCount?: number; speed?: number; etaSeconds?: number }
}

const JOB_COLUMNS: readonly AdminColumn[] = [
  { key: 'novel', label: '作品 / 类型', width: '30%', primary: true },
  { key: 'status', label: '状态', width: '14%' },
  { key: 'result', label: '进度 / 结果', width: '22%' },
  { key: 'speed', label: '速度 / 耗时', width: '16%' },
  { key: 'actions', label: '操作', width: '18%', actions: true },
]

const DOWNLOAD_COLUMNS: readonly AdminColumn[] = [
  { key: 'type', label: '类型', width: '22%' },
  { key: 'target', label: '对象', width: '42%', primary: true },
  { key: 'count', label: '数量', width: '16%' },
  { key: 'time', label: '时间', width: '20%' },
]

interface DownloadLog {
  id: string
  type: string
  targetId?: string
  targetTitle?: string
  itemCount?: number
  createdAt?: number
}

type JobFilter = 'all' | 'running' | 'completed' | 'failed'

const FILTERS: Array<{ value: JobFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'running', label: '运行中' },
  { value: 'completed', label: '已完成' },
  { value: 'failed', label: '失败/终止' },
]

const FILTER_EMPTY_LABEL: Record<JobFilter, string> = {
  all: '暂无任务',
  running: '当前没有运行中的任务',
  completed: '当前没有已完成的任务',
  failed: '当前没有失败或终止的任务',
}

const FILTER_LABEL: Record<JobFilter, string> = {
  all: '全部',
  running: '运行中',
  completed: '已完成',
  failed: '失败/终止',
}

const DOWNLOAD_TYPE_LABELS: Record<string, string> = {
  novel_txt: '单本 TXT',
  novel_txt_batch: '批量 TXT',
  scrape_configs: '爬虫配置',
}

const REFRESH_ACTIVE_MS = 4000
const REFRESH_IDLE_MS = 20000

/** 直发 /api/scrape POST（原版 authFetch('/scrape', {action,...})）。 */
async function scrapePost(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await authFetch('/scrape', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    const err = new Error((data.error as string) || `HTTP ${res.status}`)
    ;(err as { status?: number }).status = res.status
    throw err
  }
  return data
}

export default function JobsTab({
  view = 'all',
  embedded = false,
}: {
  highlightNovelId?: string
  onHighlightConsumed?: () => void
  view?: 'all' | 'scrape' | 'downloads'
  embedded?: boolean
}) {
  const { toast } = useToast()
  const { confirm } = useConfirm()

  const [detailsId, setDetailsId] = useState<string | null>(null)
  const [jobs, setJobs] = useState<Job[]>([])
  const [jobsLoading, setJobsLoading] = useState(true)
  const [jobsError, setJobsError] = useState<string | null>(null)
  const [downloadLogs, setDownloadLogs] = useState<DownloadLog[]>([])
  const [logsLoading, setLogsLoading] = useState(true)
  const [logsError, setLogsError] = useState<string | null>(null)
  const [filter, setFilter] = useState<JobFilter>('all')
  const [novelTitles, setNovelTitles] = useState<Map<string, string>>(new Map())

  const mountedRef = useRef(true)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const jobsRef = useRef<Job[]>([])
  const refreshAllRef = useRef<() => Promise<void>>(async () => {})

  const loadJobs = useCallback(async () => {
    try {
      const data = await scrapeApi.jobs()
      const list = Array.isArray(data.jobs) ? (data.jobs as Job[]) : []
      if (mountedRef.current) {
        jobsRef.current = list
        setJobs(list)
        setJobsError(null)
      }
    } catch (err) {
      if (mountedRef.current) {
        jobsRef.current = []
        setJobs([])
        setJobsError((err as Error).message || '任务列表加载失败')
      }
    } finally {
      if (mountedRef.current) setJobsLoading(false)
    }
  }, [])

  const loadDownloadLogs = useCallback(async () => {
    try {
      const data = await downloadLogsApi.list(50)
      const list = Array.isArray(data.logs) ? (data.logs as DownloadLog[]) : []
      if (mountedRef.current) {
        setDownloadLogs(list)
        setLogsError(null)
      }
    } catch (err) {
      if (mountedRef.current) {
        setDownloadLogs([])
        setLogsError((err as Error).message || '下载日志加载失败')
      }
    } finally {
      if (mountedRef.current) setLogsLoading(false)
    }
  }, [])

  function clearTimer() {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  function scheduleNext() {
    if (!mountedRef.current) return
    if (document.hidden) {
      clearTimer()
      return
    }
    const hasActive = jobsRef.current.some((j) => !isJobTerminal(j.status))
    const delay = hasActive ? REFRESH_ACTIVE_MS : REFRESH_IDLE_MS
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      void refreshAllRef.current()
    }, delay)
  }

  async function refreshAll() {
    await Promise.all([...(view !== 'downloads' ? [loadJobs()] : []), ...(view !== 'scrape' ? [loadDownloadLogs()] : [])])
    scheduleNext()
  }
  refreshAllRef.current = refreshAll

  // 首次挂载：立即加载一次，随后进入自适应轮询链
  useEffect(() => {
    mountedRef.current = true
    void refreshAll()
    return () => {
      mountedRef.current = false
      clearTimer()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 页面隐藏暂停轮询，恢复可见立即刷新并恢复节奏
  useEffect(() => {
    function onVisibilityChange() {
      if (document.hidden) {
        clearTimer()
      } else {
        void refreshAllRef.current()
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [])

  // 小说标题索引（一次）
  useEffect(() => {
    let cancelled = false
    if (view === 'downloads') return
    adminApi
      .novelIndex({ limit: '500' })
      .then((data) => {
        const novels = (data.novels || []) as Array<{ id: string; title: string }>
        if (cancelled) return
        setNovelTitles(new Map(novels.map((n) => [n.id, n.title])))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(() => {
    if (filter === 'running') return jobs.filter((j) => isJobRunning(j.status))
    if (filter === 'completed') return jobs.filter((j) => j.status === 'completed')
    if (filter === 'failed') return jobs.filter((j) => j.status === 'failed' || j.status === 'cancelled' || j.status === 'partial')
    return jobs
  }, [jobs, filter])

  const runningCount = jobs.filter((j) => isJobRunning(j.status)).length
  const completedCount = jobs.filter((j) => j.status === 'completed').length
  const failedCount = jobs.filter((j) => j.status === 'failed' || j.status === 'cancelled' || j.status === 'partial').length
  const hasCompleted = jobs.some((j) => j.status === 'completed' || j.status === 'partial' || j.status === 'cancelled')
  const jobStatsText = `共 ${jobs.length} 个任务 · ${runningCount} 运行中 · ${completedCount} 已完成 · ${failedCount} 失败/终止/部分完成`

  function handleRefresh() {
    if (view !== 'downloads') void loadJobs()
    if (view !== 'scrape') void loadDownloadLogs()
  }

  // ---------- 行内动作 ----------

  async function cancelJob(job: Job) {
    const ok = await confirm({
      title: '终止任务',
      message: '确定终止该任务？正在运行的抓取流程会被中断。',
      okText: '终止',
      danger: true,
      items: [job.id],
    })
    if (!ok) return
    try {
      await scrapePost({ action: 'cancel', jobId: job.id, operationId: newOperationId('cancel-scrape-job') })
      toast('任务已终止', 'default')
      void loadJobs()
    } catch (err) {
      toast(`终止失败: ${(err as Error).message}`, 'error')
    }
  }

  async function retryJob(job: Job) {
    if (!(await confirm({ title: '整本重试？', message: '将按原配置重新执行抓取任务。', items: [job.id], okText: '确认重试' }))) return
    toast('正在重试任务…', 'default')
    try {
      const data = await scrapePost({ action: 'retry', jobId: job.id })
      if ((data as { jobId?: string }).jobId) {
        toast('重试任务已启动', 'success')
        void loadJobs()
      } else {
        throw new Error((data.error as string) || '重试失败')
      }
    } catch (err) {
      toast(`重试失败: ${(err as Error).message}`, 'error')
    }
  }

  async function retryFailedJob(job: Job) {
    if (!(await confirm({ title: '重试失败章节？', message: '仅重新处理失败的章节，已保存内容会保留。', items: [job.id], okText: '重试失败章节' }))) return
    toast('正在重试失败章节…', 'default')
    try {
      const data = await scrapePost({ action: 'retry-failed', jobId: job.id })
      if ((data as { jobId?: string }).jobId) {
        toast('失败章节重试已启动', 'success')
        void loadJobs()
      } else {
        throw new Error((data.error as string) || '重试失败章节失败')
      }
    } catch (err) {
      toast(`重试失败章节失败: ${(err as Error).message}`, 'error')
    }
  }

  async function clearCompleted() {
    const jobIds = jobsRef.current
      .filter((job) => job.status === 'completed' || job.status === 'partial' || job.status === 'cancelled')
      .map((job) => job.id)
      .filter(Boolean)
      .sort()
    if (!jobIds.length) return
    const ok = await confirm({
      title: '清除已结束任务',
      message: `清除确认时的 ${jobIds.length} 个已结束任务记录？运行中任务不会受影响。`,
      items: [`目标快照：${jobIds.length} 个任务`, '只会删除已完成、部分完成或已终止记录'],
      okText: '清除',
      danger: true,
    })
    if (!ok) return
    try {
      await scrapePost({ action: 'clear-completed', jobIds, operationId: newOperationId('clear-completed-scrape-jobs') })
      toast('已清除', 'success')
      void loadJobs()
    } catch (err) {
      toast(`清除失败: ${(err as Error).message}`, 'error')
    }
  }

  // ---------- 单元格渲染 ----------

  function renderNovelTitle(j: Job): ReactNode {
    const title = j.novelId ? novelTitles.get(j.novelId) : undefined
    if (title) return title
    if (j.novelId) return <span className="text-muted-foreground text-sm">{truncateId(j.novelId)}</span>
    return '—'
  }

  function renderStatus(j: Job): ReactNode {
    const label = jobStatusLabel(j.status)
    if (isJobRunning(j.status)) {
      return (
        <AdminStatusBadge variant="secondary" tone="info">
          <span className="job-spinner"></span>
          {label}
        </AdminStatusBadge>
      )
    }
    if (j.status === 'completed')
      return (
        <AdminStatusBadge variant="secondary" tone="success">
          <Check className="size-3" aria-hidden="true" />
          {label}
        </AdminStatusBadge>
      )
    if (j.status === 'partial')
      return (
        <AdminStatusBadge variant="secondary" tone="warning">
          <AlertCircle className="size-3" aria-hidden="true" />
          {label}
        </AdminStatusBadge>
      )
    if (j.status === 'failed')
      return (
        <AdminStatusBadge variant="secondary" tone="danger">
          <AlertCircle className="size-3" aria-hidden="true" />
          {label}
        </AdminStatusBadge>
      )
    return <AdminStatusBadge tone="muted">{label}</AdminStatusBadge>
  }

  function renderActions(j: Job): ReactNode {
    const retryable = ['failed', 'cancelled', 'partial'].includes(j.status)
    return (
      <>
        {retryable &&
          ((j.failedCount ?? j.summary?.failedCount ?? 0) > 0 ? (
            <Button variant="outline" size="sm" onClick={() => void retryFailedJob(j)}>
              重试失败章节
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => void retryJob(j)}>
              重试
            </Button>
          ))}
        <Button variant="ghost" size="sm" onClick={() => setDetailsId(j.id)}>
          详情
        </Button>
      </>
    )
  }

  // ---------- 渲染 ----------

  const listStatusLabel = jobsLoading ? '读取中' : jobsError ? '读取失败' : '队列正常'
  const logsStatusLabel = logsLoading ? '读取中' : logsError ? '读取失败' : '日志正常'
  const detailJob = jobs.find((job) => job.id === detailsId)
  const attentionCount = jobs.filter((job) => job.status === 'failed' || job.status === 'partial').length
  const filterCounts = { all: jobs.length, running: runningCount, completed: completedCount, failed: failedCount }
  const hasJobs = !jobsLoading && !jobsError && filtered.length > 0

  return (
    <AdminPage
      className="admin-redesign-page admin-redesign-page--jobs"
      title={embedded ? undefined : '任务管理'}
      description="跟踪抓取与更新任务的执行情况，并对失败任务执行重试或终止。"
      actions={
        <Button variant="secondary" onClick={handleRefresh} disabled={jobsLoading || logsLoading}>
          {jobsLoading || logsLoading ? '刷新中…' : '刷新'}
        </Button>
      }
    >
      <TaskSummary
        title={
          view === 'downloads'
            ? '最近的下载记录'
            : jobsLoading
              ? '正在读取任务队列'
              : jobsError
                ? '任务队列读取失败'
                : runningCount
                  ? `${runningCount} 个任务正在处理`
                  : '当前没有运行中的任务'
        }
        hint={
          view === 'downloads'
            ? '查看内容导出与书源配置下载记录。'
            : jobsError
              ? jobsError
              : attentionCount
                ? `${attentionCount} 个任务需要处理，可在列表中查看原因。`
                : '在这里查看进度、执行结果与可用操作。'
        }
        counts={view === 'downloads' ? `共 ${downloadLogs.length} 条记录` : `全部 ${jobs.length} · 运行中 ${runningCount} · 已完成 ${completedCount}`}
        actions={
          <Button variant="outline" size="sm" aria-label="刷新任务记录" onClick={handleRefresh} disabled={view === 'downloads' ? logsLoading : jobsLoading}>
            <RefreshCw className="size-3.5" aria-hidden="true" />
            刷新
          </Button>
        }
      />
      {view !== 'downloads' && (
        <>
          <AdminToolbar className="task-workspace-toolbar" ariaLive="polite">
            <div className="task-workspace-filters" role="group" aria-label="任务状态筛选">
              {FILTERS.map((item) => (
                <Button key={item.value} variant="ghost" size="sm" aria-pressed={filter === item.value} onClick={() => setFilter(item.value)}>
                  {item.label}
                  <span>{filterCounts[item.value]}</span>
                </Button>
              ))}
            </div>
            <Button variant="ghost" size="sm" disabled={!hasCompleted || jobsLoading} onClick={() => void clearCompleted()}>
              清除已结束
            </Button>
          </AdminToolbar>
          <AdminDataPanel className="task-workspace-panel overflow-hidden" ariaLabel="抓取任务列表" columns={JOB_COLUMNS}>
            <AdminPanelHeading title="抓取任务" status={<span className={`admin-panel-status${jobsError ? ' is-error' : ''}`}>{listStatusLabel}</span>} />
            {hasJobs ? (
              <Table>
                <TableCaption className="sr-only">抓取任务列表，包含任务 ID、小说、状态、进度与行内操作</TableCaption>
                <TableHeader>
                  <TableRow>
                    {JOB_COLUMNS.map((column) => (
                      <TableHead key={column.key} scope="col">
                        {column.label}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((j) => (
                    <TableRow key={j.id}>
                      <TableCell data-primary="" data-label="作品 / 类型">
                        <div className="task-workspace-title">{renderNovelTitle(j)}</div>
                        <div className="task-workspace-meta">
                          {j.updateMode ? '更新' : '抓取'} ·{' '}
                          <span className="task-workspace-id" title={j.id}>
                            {truncateId(j.id)}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell data-label="状态">{renderStatus(j)}</TableCell>
                      <TableCell data-label="进度 / 结果">
                        <div className="task-workspace-cell">
                          <span className="tabular-nums">
                            {j.current ?? 0} / {j.total ?? '?'} 章
                          </span>
                          <span className="task-workspace-meta">
                            成功 {j.successCount ?? j.summary?.successCount ?? j.chapterCount ?? 0} · 失败 {j.failedCount ?? j.summary?.failedCount ?? 0} · 跳过{' '}
                            {j.skippedCount ?? j.summary?.skippedCount ?? 0}
                          </span>
                          {j.error && <span className="task-workspace-error">{j.error}</span>}
                        </div>
                      </TableCell>
                      <TableCell data-label="速度 / 耗时">
                        <div className="task-workspace-cell">
                          <span>{formatJobSpeed(j.speed ?? j.summary?.speed)}</span>
                          <span className="task-workspace-meta">
                            耗时 {j.startedAt ? getJobDuration(j.startedAt, isJobTerminal(j.status) ? (j.updatedAt ?? null) : null) : '—'} · 剩余{' '}
                            {formatEta(j.etaSeconds ?? j.summary?.etaSeconds)}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell data-actions="">
                        <div className="admin-cell-actions">{renderActions(j)}</div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : jobsLoading ? (
              <AdminEmptyState className="jobs-empty" icon={<span className="job-spinner" aria-hidden="true" />} message="正在读取任务队列…" />
            ) : jobsError ? (
              <AdminEmptyState
                className="jobs-empty jobs-empty--error"
                icon={<Ban className="size-8 opacity-40" aria-hidden="true" />}
                message={`任务队列加载失败：${jobsError}`}
              />
            ) : (
              <AdminEmptyState
                className="jobs-empty"
                icon={<CircleMinus className="size-8 opacity-40" aria-hidden="true" />}
                message={FILTER_EMPTY_LABEL[filter]}
              />
            )}
          </AdminDataPanel>
        </>
      )}
      {view !== 'scrape' && (
        <AdminDataPanel className="task-workspace-panel overflow-hidden" ariaLabel="下载日志" columns={DOWNLOAD_COLUMNS}>
          <AdminPanelHeading title="下载日志" status={<span className={`admin-panel-status${logsError ? ' is-error' : ''}`}>{logsStatusLabel}</span>} />
          {logsLoading ? (
            <AdminEmptyState className="jobs-empty" icon={<span className="job-spinner" aria-hidden="true" />} message="正在读取下载日志…" />
          ) : logsError ? (
            <AdminEmptyState
              className="jobs-empty jobs-empty--error"
              icon={<Ban className="size-8 opacity-40" aria-hidden="true" />}
              message={`下载日志加载失败：${logsError}`}
            />
          ) : downloadLogs.length === 0 ? (
            <AdminEmptyState className="jobs-empty" icon={<CircleMinus className="size-8 opacity-40" aria-hidden="true" />} message="暂无下载日志" />
          ) : (
            <Table>
              <TableCaption className="sr-only">下载日志列表，包含类型、对象、数量与时间</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">类型</TableHead>
                  <TableHead scope="col">对象</TableHead>
                  <TableHead scope="col">数量</TableHead>
                  <TableHead scope="col">时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {downloadLogs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell data-label="类型">{DOWNLOAD_TYPE_LABELS[log.type] || log.type}</TableCell>
                    <TableCell data-primary="" data-label="对象" className="text-sm">
                      {log.targetTitle || log.targetId || '—'}
                    </TableCell>
                    <TableCell data-label="数量">{log.itemCount || 0}</TableCell>
                    <TableCell data-label="时间" className="text-sm text-muted-foreground">
                      {formatDateTime(log.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </AdminDataPanel>
      )}
      <TaskDetails
        open={detailsId != null}
        onClose={() => setDetailsId(null)}
        actions={
          detailJob && (
            <>
              {isJobRunning(detailJob.status) && (
                <Button
                  variant="destructive"
                  onClick={() => {
                    setDetailsId(null)
                    void cancelJob(detailJob)
                  }}
                >
                  终止任务
                </Button>
              )}
              {['failed', 'cancelled', 'partial'].includes(detailJob.status) && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setDetailsId(null)
                    void retryJob(detailJob)
                  }}
                >
                  整本重试
                </Button>
              )}
            </>
          )
        }
      >
        {detailJob ? (
          <dl className="task-workspace-details">
            <dt>任务 ID</dt>
            <dd className="task-workspace-id">{detailJob.id}</dd>
            <dt>作品</dt>
            <dd>{renderNovelTitle(detailJob)}</dd>
            <dt>类型</dt>
            <dd>{detailJob.updateMode ? '更新' : '抓取'}</dd>
            <dt>状态</dt>
            <dd>{renderStatus(detailJob)}</dd>
            <dt>执行阶段</dt>
            <dd>{detailJob.step || '—'}</dd>
            <dt>进度</dt>
            <dd>
              {detailJob.current ?? 0} / {detailJob.total ?? '?'}
            </dd>
            <dt>错误</dt>
            <dd>{detailJob.error || '未记录错误'}</dd>
          </dl>
        ) : (
          <p>任务记录已不在当前列表，请刷新后查看。</p>
        )}
      </TaskDetails>
      {view !== 'downloads' && (
        <p className="task-workspace-footnote">
          {filter === 'all' ? jobStatsText : `${FILTER_LABEL[filter]}：${filtered.length} / 共 ${jobs.length} 条`}
          。清除已结束仅处理已完成、部分完成和已终止记录。
        </p>
      )}
    </AdminPage>
  )
}
