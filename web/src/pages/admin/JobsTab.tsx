import { Spinner } from '@/components/ui/spinner'
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
import { TaskDetails, TaskDetailsFact, TaskDetailsFacts, TaskDetailsIdentifier, TaskDetailsResult, TaskDetailsSection, TaskDetailsSummary } from './TaskWorkspace'
import AdminStatusBadge from '@/components/admin/AdminStatusBadge'
import SearchSelect, { type SelectOption } from "@/components/shared/SearchSelect"
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Download, ListTodo, SearchX, Check, AlertCircle, RefreshCw, CirclePlus } from 'lucide-react'
import { Link } from 'react-router-dom'
import { adminApi, authFetch, downloadLogsApi, newOperationId, scrapeApi } from '../../lib/api'
import { formatDateTime } from '../../lib/format'
import { getAdminTableRowStaggerDelay } from '@/lib/admin-table-motion'
import { formatEta, formatJobSpeed, getJobDuration, isJobRunning, isJobTerminal, jobStatusLabel, truncateId } from '../../lib/admin'
import { useConfirm, useToast } from '../../components/feedback'
import EmptyState from "@/components/shared/EmptyState"
import { ErrorState } from "@/components/shared/AsyncStates"
import AdminPage from '@/components/admin/AdminPage'
import { AdminDataPanel, type AdminColumn } from '@/components/admin/AdminDataPanel'
import { AdminToolbar } from '@/components/admin/AdminToolbar'
import { SearchField } from '@/components/shared/SearchField'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import styles from './TaskWorkspace.module.css'

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

function jobSummaryCount(job: Job, key: 'successCount' | 'failedCount' | 'skippedCount'): number | undefined {
  return job[key] ?? job.summary?.[key] ?? (key === 'successCount' ? job.chapterCount : undefined)
}

function jobProcessedHint(job: Job, showZeroCounts = false): string {
  const success = jobSummaryCount(job, 'successCount')
  const failed = jobSummaryCount(job, 'failedCount')
  const skipped = jobSummaryCount(job, 'skippedCount')
  if (!showZeroCounts && (success ?? 0) + (failed ?? 0) + (skipped ?? 0) === 0) return '处理数量未提供'
  const counts = [success !== undefined ? `成功 ${success}` : '', failed !== undefined ? `失败 ${failed}` : '', skipped !== undefined ? `跳过 ${skipped}` : ''].filter(Boolean)
  if (!counts.length) return '处理数量未提供'
  const total = success !== undefined && failed !== undefined && skipped !== undefined ? `已处理 ${success + failed + skipped} 章 · ` : ''
  return `${total}${counts.join(' · ')}${total ? '' : ' 章'}`
}

function jobProgressText(job: Job): string {
  return job.total && job.total > 0 ? `${job.current ?? 0} / ${job.total} 章`
    : job.current && job.current > 0 ? `已处理 ${job.current} 章 · 总数未提供` : '处理数量未提供'
}

function jobResultText(job: Job): string {
  const kind = job.updateMode ? '更新' : '抓取'
  if (job.status === 'completed') return `${kind}完成`
  if (job.status === 'partial') return `${kind}部分完成`
  if (job.status === 'failed') return `${kind}失败`
  if (job.status === 'cancelled') return '任务已终止'
  if (job.status === 'queued') return '等待调度'
  return (job.total ?? 0) > 0 || (job.current ?? 0) > 0 ? jobProgressText(job) : job.step || jobStatusLabel(job.status)
}

function jobDurationText(job: Job): string {
  const start = job.startedAt
  const end = isJobTerminal(job.status) ? job.updatedAt : Date.now()
  if (!start || !end || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) return '耗时未记录'
  if (end - start < 1000) return '耗时小于 1 秒'
  return `耗时 ${getJobDuration(start, end)}`
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
  const [downloadType, setDownloadType] = useState<string>('all')
  const [search, setSearch] = useState('')
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
    let list = jobs
    if (filter === 'running') list = jobs.filter((j) => isJobRunning(j.status))
    else if (filter === 'completed') list = jobs.filter((j) => j.status === 'completed')
    else if (filter === 'failed') list = jobs.filter((j) => j.status === 'failed' || j.status === 'cancelled' || j.status === 'partial')
    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter((j) => {
        const id = (j.id || '').toLowerCase()
        const title = (j.novelId ? novelTitles.get(j.novelId) || '' : '').toLowerCase()
        const nid = (j.novelId || '').toLowerCase()
        return id.includes(q) || title.includes(q) || nid.includes(q)
      })
    }
    return list
  }, [jobs, filter, search, novelTitles])

  const downloadTypeCounts = useMemo(() => {
    const counts: Record<string, number> = {
      novel_txt: 0,
      novel_txt_batch: 0,
      scrape_configs: 0,
    }
    for (const log of downloadLogs) {
      if (log.type in counts) {
        counts[log.type] = (counts[log.type] ?? 0) + 1
      }
    }
    return counts
  }, [downloadLogs])

  const downloadTypeOptions = useMemo<SelectOption[]>(
    () => [
      { value: 'all', label: `全部类型 (${downloadLogs.length})` },
      { value: 'novel_txt', label: `单本 TXT (${downloadTypeCounts.novel_txt || 0})` },
      { value: 'novel_txt_batch', label: `批量 TXT (${downloadTypeCounts.novel_txt_batch || 0})` },
      { value: 'scrape_configs', label: `书源配置 (${downloadTypeCounts.scrape_configs || 0})` },
    ],
    [downloadLogs.length, downloadTypeCounts],
  )

  const filteredDownloads = useMemo(() => {
    let list = downloadLogs
    if (downloadType !== 'all') {
      list = list.filter((log) => log.type === downloadType)
    }
    const q = search.trim().toLowerCase()
    if (!q) return list
    return list.filter((log) => {
      const target = (log.targetTitle || log.targetId || '').toLowerCase()
      const type = (DOWNLOAD_TYPE_LABELS[log.type] || log.type || '').toLowerCase()
      return target.includes(q) || type.includes(q)
    })
  }, [downloadLogs, downloadType, search])

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
          <Spinner size="sm"  />
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
      <div className="admin-cell-actions">
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
      </div>
    )
  }

  // ---------- 渲染 ----------

  const detailJob = jobs.find((job) => job.id === detailsId)
  const attentionCount = jobs.filter((job) => job.status === 'failed' || job.status === 'partial').length
  const statusOptions = useMemo<SelectOption[]>(
    () => [
      { value: 'all', label: `全部状态 (${jobs.length})` },
      { value: 'running', label: `运行中 (${runningCount})` },
      { value: 'completed', label: `已完成 (${completedCount})` },
      { value: 'failed', label: `失败/终止 (${failedCount})` },
    ],
    [jobs.length, runningCount, completedCount, failedCount],
  )
  const hasJobs = !jobsLoading && !jobsError && filtered.length > 0

  const content = (
    <>
      {view !== 'downloads' && (
        <>
          <AdminToolbar layout="inline" className="admin-filter-rail task-workspace-toolbar" ariaLive="polite">
            <SearchField
              id="scrape-jobs-search"
              label="搜索抓取任务"
              type="search"
              data-search-field
              placeholder="搜索作品标题、任务 ID 或类型…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="select-filter-chips">
              <SearchSelect
                compact
                chip
                filterChip
                leadingIcon={<CirclePlus className="size-[var(--select-filter-chip-icon-size,1rem)]" />}
                aria-label="按抓取任务状态筛选"
                options={statusOptions}
                value={filter}
                onChange={(v) => setFilter(v as JobFilter)}
              />
              {attentionCount > 0 && (
                <button
                  type="button"
                  className={cn(
                    'task-workspace-alert-badge cursor-pointer transition-colors',
                    filter === 'failed' && 'ring-1 ring-[#d97757] font-semibold',
                  )}
                  onClick={() => setFilter(filter === 'failed' ? 'all' : 'failed')}
                  title={filter === 'failed' ? '点击查看全部任务' : '点击快速筛选需处理任务'}
                >
                  <AlertCircle className="size-3.5" aria-hidden="true" />
                  {attentionCount} 个任务需处理
                  {filter === 'failed' && <span className="ml-1 text-[11px] opacity-75">✕</span>}
                </button>
              )}
              <Button
                variant="outline"
                size="sm"
                aria-label="刷新任务记录"
                onClick={handleRefresh}
                disabled={jobsLoading}
              >
                <RefreshCw className={cn('size-3.5', jobsLoading && 'animate-spin')} aria-hidden="true" />
                刷新
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!hasCompleted || jobsLoading}
                onClick={() => void clearCompleted()}
              >
                清除已结束
              </Button>
            </div>
          </AdminToolbar>
          <AdminDataPanel className="jobs-data-panel overflow-hidden" ariaLabel="抓取任务列表" columns={JOB_COLUMNS} density="comfortable">
            {hasJobs ? (
              <Table className={cn('admin-data-table admin-data-table--animated', jobsLoading && 'admin-data-table--transitioning')}>
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
                  {filtered.map((j, index) => (
                    <TableRow key={j.id} style={{ animationDelay: `${getAdminTableRowStaggerDelay(index, filtered.length)}ms` }}>
                      <TableCell data-primary="" data-label="作品 / 类型">
                        <strong className="task-workspace-title font-medium">{renderNovelTitle(j)}</strong>
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
                            {jobResultText(j)}
                          </span>
                          <span className="task-workspace-meta">
                            {jobProcessedHint(j, !isJobTerminal(j.status))}
                          </span>
                          {j.error && <span className={cn('task-workspace-error', styles.listError)} title={j.error}>{j.error}</span>}
                        </div>
                      </TableCell>
                      <TableCell data-label="速度 / 耗时">
                        <div className="task-workspace-cell">
                          {isJobRunning(j.status) ? (
                            <>
                              <span>{(j.speed ?? j.summary?.speed ?? 0) > 0 ? formatJobSpeed(j.speed ?? j.summary?.speed) : '速度统计中'}</span>
                              <span className="task-workspace-meta">
                                {jobDurationText(j)}
                                {(j.etaSeconds ?? j.summary?.etaSeconds ?? 0) > 0 && ` · 预计剩余 ${formatEta(j.etaSeconds ?? j.summary?.etaSeconds)}`}
                              </span>
                            </>
                          ) : (
                            <span>{j.status === 'queued' ? '等待开始' : jobDurationText(j)}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell data-actions="">
                        {renderActions(j)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : jobsLoading ? (
              <EmptyState icon={<Spinner size="sm" aria-hidden="true" />} message="正在读取任务队列…" />
            ) : jobsError ? (
              <ErrorState message={`任务队列加载失败：${jobsError}`} />
            ) : (
              <EmptyState
                icon={search.trim() || filter !== 'all' ? <SearchX aria-hidden="true" /> : <ListTodo aria-hidden="true" />}
                message={search.trim() ? `未找到与「${search.trim()}」相关的抓取任务` : FILTER_EMPTY_LABEL[filter]}
                hint={search.trim() || filter !== 'all'
                  ? '调整搜索关键词或任务状态后再试。'
                  : '在抓取中心启动任务后，这里会显示执行进度。'}
                action={
                  search.trim() || filter !== 'all' ? (
                    <Button variant="outline" size="sm" onClick={() => { setSearch(''); setFilter('all') }}>
                      清除筛选
                    </Button>
                  ) : undefined
                }
              />
            )}
          </AdminDataPanel>
        </>
      )}
      {view !== 'scrape' && (
        <>
          <AdminToolbar layout="inline" className="task-workspace-toolbar admin-filter-rail" ariaLive="polite">
            <SearchField
              id="download-logs-search"
              label="搜索下载记录"
              type="search"
              data-search-field
              placeholder="搜索下载对象或类型…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="select-filter-chips">
              <SearchSelect
                compact
                chip
                filterChip
                leadingIcon={<CirclePlus className="size-[var(--select-filter-chip-icon-size,1rem)]" />}
                aria-label="按下载类型筛选"
                options={downloadTypeOptions}
                value={downloadType}
                onChange={(v) => setDownloadType(v)}
              />
              <Button
                variant="outline"
                size="sm"
                aria-label="刷新下载日志"
                onClick={handleRefresh}
                disabled={logsLoading}
              >
                <RefreshCw className={cn('size-3.5', logsLoading && 'animate-spin')} aria-hidden="true" />
                刷新
              </Button>
            </div>
          </AdminToolbar>
          <AdminDataPanel className="jobs-data-panel overflow-hidden" ariaLabel="下载日志" columns={DOWNLOAD_COLUMNS} density="comfortable">
          {logsLoading ? (
            <EmptyState icon={<Spinner size="sm" aria-hidden="true" />} message="正在读取下载日志…" />
          ) : logsError ? (
            <ErrorState message={`下载日志加载失败：${logsError}`} />
          ) : filteredDownloads.length === 0 ? (
            <EmptyState
              icon={search.trim() || downloadType !== 'all' ? <SearchX aria-hidden="true" /> : <Download aria-hidden="true" />}
              message={
                search.trim() || downloadType !== 'all'
                  ? '未找到符合条件的下载记录'
                  : '暂无下载记录'
              }
              hint={search.trim() || downloadType !== 'all'
                ? '调整搜索关键词或下载类型后再试。'
                : '导出内容或下载书源配置后，记录会显示在这里。'}
              action={
                search.trim() || downloadType !== 'all' ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSearch('')
                      setDownloadType('all')
                    }}
                  >
                    清除筛选
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <Table className={cn('admin-data-table admin-data-table--animated', logsLoading && 'admin-data-table--transitioning')}>
              <TableCaption className="sr-only">下载日志列表，包含类型、对象、数量与时间</TableCaption>
              <TableHeader>
                <TableRow>
                  {DOWNLOAD_COLUMNS.map((column) => (
                    <TableHead key={column.key} scope="col">
                      {column.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredDownloads.map((log, index) => (
                  <TableRow key={log.id} style={{ animationDelay: `${getAdminTableRowStaggerDelay(index, filteredDownloads.length)}ms` }}>
                    <TableCell data-label="类型">{DOWNLOAD_TYPE_LABELS[log.type] || log.type}</TableCell>
                    <TableCell data-primary="" data-label="对象">
                      <strong className="task-workspace-title font-medium">{log.targetTitle || log.targetId || '—'}</strong>
                    </TableCell>
                    <TableCell data-label="数量">
                      <span className="tabular-nums">{log.itemCount || 0}</span>
                    </TableCell>
                    <TableCell data-label="时间" className="text-sm text-muted-foreground">
                      {formatDateTime(log.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </AdminDataPanel>
        </>
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
              {['failed', 'cancelled', 'partial'].includes(detailJob.status) && (jobSummaryCount(detailJob, 'failedCount') ?? 0) > 0 && (
                <Button variant="outline" onClick={() => {
                  setDetailsId(null)
                  void retryFailedJob(detailJob)
                }}>
                  重试失败章节
                </Button>
              )}
              {detailJob.novelId && (
                <Button asChild>
                  <Link to={`/novel/${encodeURIComponent(detailJob.novelId)}`}>查看作品</Link>
                </Button>
              )}
            </>
          )
        }
      >
        {detailJob ? (
          <>
            <TaskDetailsSummary
              title={renderNovelTitle(detailJob)}
              meta={`${detailJob.updateMode ? '更新' : '抓取'}任务${detailJob.localMode ? ' · 本地模式' : ''}`}
              status={renderStatus(detailJob)}
            />
            <TaskDetailsSection label={isJobTerminal(detailJob.status) ? '执行结果' : '执行进度'}>
              <TaskDetailsResult
                value={['failed', 'cancelled'].includes(detailJob.status) ? jobStatusLabel(detailJob.status) : detailJob.step || jobStatusLabel(detailJob.status)}
                hint={isJobTerminal(detailJob.status) ? jobProcessedHint(detailJob) : jobProgressText(detailJob)}
              />
            </TaskDetailsSection>
            {detailJob.error && (
              <TaskDetailsSection label="错误原因" tone="danger">{detailJob.error}</TaskDetailsSection>
            )}
            <TaskDetailsSection label="执行记录">
              <TaskDetailsFacts>
                {['failed', 'cancelled'].includes(detailJob.status) && detailJob.step && (
                  <TaskDetailsFact label="最后阶段">{detailJob.step}</TaskDetailsFact>
                )}
                <TaskDetailsFact label="开始时间">{formatDateTime(detailJob.startedAt) || '未记录'}</TaskDetailsFact>
                <TaskDetailsFact label={isJobTerminal(detailJob.status) ? '结束时间' : '最近更新'}>
                  {formatDateTime(detailJob.updatedAt) || '未记录'}
                </TaskDetailsFact>
                <TaskDetailsFact label="耗时">
                  {jobDurationText(detailJob).replace(/^耗时/, '')}
                </TaskDetailsFact>
                {isJobRunning(detailJob.status) && (
                  <>
                    <TaskDetailsFact label="处理速度">{formatJobSpeed(detailJob.speed ?? detailJob.summary?.speed)}</TaskDetailsFact>
                    <TaskDetailsFact label="预计剩余">{formatEta(detailJob.etaSeconds ?? detailJob.summary?.etaSeconds)}</TaskDetailsFact>
                  </>
                )}
              </TaskDetailsFacts>
            </TaskDetailsSection>
            <TaskDetailsIdentifier id={detailJob.id} />
          </>
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
      {view === 'downloads' && (
        <p className="task-workspace-footnote">
          共 {downloadLogs.length} 条下载记录。记录内容导出与书源配置下载，仅用于查看历史。
        </p>
      )}
    </>
  )

  if (embedded) {
    return <>{content}</>
  }

  return (
    <AdminPage
      className="admin-redesign-page admin-redesign-page--jobs"
      title="任务管理"
      description="跟踪抓取与更新任务的执行情况，并对失败任务执行重试或终止。"
      actions={
        <Button variant="secondary" onClick={handleRefresh} disabled={jobsLoading || logsLoading}>
          {jobsLoading || logsLoading ? '刷新中…' : '刷新'}
        </Button>
      }
    >
      {content}
    </AdminPage>
  )
}
