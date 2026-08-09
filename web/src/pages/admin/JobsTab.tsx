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
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CircleMinus, RotateCcw, RotateCw } from 'lucide-react'
import { adminApi, authFetch, downloadLogsApi, scrapeApi } from '../../lib/api'
import { formatDateTime } from '../../lib/format'
import { formatEta, formatJobSpeed, getJobDuration, isJobRunning, isJobTerminal, jobStatusLabel, truncateId } from '../../lib/admin'
import { useConfirm, useToast } from '../../components/feedback'
import AdminTabHeader from '@/components/admin/AdminTabHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

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
  const data = await res.json().catch(() => ({})) as Record<string, unknown>
  if (!res.ok) {
    const err = new Error((data.error as string) || `HTTP ${res.status}`)
    ;(err as { status?: number }).status = res.status
    throw err
  }
  return data
}

export default function JobsTab(_props: { highlightNovelId?: string; onHighlightConsumed?: () => void }) {
  const { toast } = useToast()
  const { confirm } = useConfirm()

  const [jobs, setJobs] = useState<Job[]>([])
  const [jobsLoading, setJobsLoading] = useState(true)
  const [downloadLogs, setDownloadLogs] = useState<DownloadLog[]>([])
  const [logsLoading, setLogsLoading] = useState(true)
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
      }
    } catch {
      if (mountedRef.current) {
        jobsRef.current = []
        setJobs([])
      }
    } finally {
      if (mountedRef.current) setJobsLoading(false)
    }
  }, [])

  const loadDownloadLogs = useCallback(async () => {
    try {
      const data = await downloadLogsApi.list(50)
      const list = Array.isArray(data.logs) ? (data.logs as DownloadLog[]) : []
      if (mountedRef.current) setDownloadLogs(list)
    } catch {
      if (mountedRef.current) setDownloadLogs([])
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
    await Promise.all([loadJobs(), loadDownloadLogs()])
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
  const hasCompleted = jobs.some((j) => j.status === 'completed')
  const jobStatsText = `共 ${jobs.length} 个任务 · ${runningCount} 运行中 · ${completedCount} 已完成 · ${failedCount} 失败/终止/部分完成`

  function handleRefresh() {
    void loadJobs()
    void loadDownloadLogs()
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
      await scrapePost({ action: 'cancel', jobId: job.id })
      toast('任务已终止', 'default')
      void loadJobs()
    } catch (err) {
      toast(`终止失败: ${(err as Error).message}`, 'error')
    }
  }

  async function retryJob(job: Job) {
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
    const ok = await confirm({
      title: '清除已完成任务',
      message: '确定清除所有已完成的任务记录？运行中任务不会受影响。',
      okText: '清除',
      danger: true,
    })
    if (!ok) return
    try {
      await scrapePost({ action: 'clear-completed' })
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
    if (j.novelId) return <span className="text-muted text-sm">{truncateId(j.novelId)}</span>
    return '—'
  }

  function renderStatus(j: Job): ReactNode {
    const label = jobStatusLabel(j.status)
    if (isJobRunning(j.status)) {
      return (
        <Badge variant="secondary" className="bg-info/10 text-info">
          <span className="job-spinner"></span>
          {label}
        </Badge>
      )
    }
    if (j.status === 'completed') return <Badge variant="secondary" className="bg-success/10 text-success">✓ {label}</Badge>
    if (j.status === 'partial') return <Badge variant="secondary" className="bg-warning/10 text-warning">⚠ {label}</Badge>
    if (j.status === 'failed') return <Badge variant="secondary" className="bg-destructive/10 text-destructive">✕ {label}</Badge>
    return <Badge variant="secondary" className="text-muted">— {label}</Badge>
  }

  function renderActions(j: Job): ReactNode {
    if (isJobRunning(j.status)) {
      return (
        <Button variant="ghost" size="icon" title="终止" onClick={() => void cancelJob(j)}>
          <CircleMinus />
        </Button>
      )
    }
    if (j.status === 'failed' || j.status === 'cancelled' || j.status === 'partial') {
      return (
        <>
          {(j.failedCount || 0) > 0 && (
            <Button variant="ghost" size="icon" title="重试失败章节" onClick={() => void retryFailedJob(j)}>
              <RotateCcw />
            </Button>
          )}
          <Button variant="ghost" size="icon" title="整本重试" onClick={() => void retryJob(j)}>
            <RotateCw />
          </Button>
        </>
      )
    }
    return '—'
  }

  // ---------- 渲染 ----------

  return (
    <section className="tab-content">
      <AdminTabHeader
        title="任务管理"
        actions={
          <>
            {FILTERS.map((f) => (
              <Button
                key={f.value}
                size="sm"
                variant={filter === f.value ? 'default' : 'secondary'}
                onClick={() => setFilter(f.value)}
              >
                {f.label}
              </Button>
            ))}
            <Button variant="secondary" size="sm" onClick={handleRefresh}>
              刷新
            </Button>
          </>
        }
      />

      <div className="table-wrapper">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>任务 ID</TableHead>
              <TableHead>小说</TableHead>
              <TableHead>类型</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>进度</TableHead>
              <TableHead>结果</TableHead>
              <TableHead>速度/ETA</TableHead>
              <TableHead>耗时</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="table-empty">
                  {jobsLoading ? '加载中…' : '暂无任务'}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((j) => (
                <TableRow key={j.id}>
                  <TableCell className="admin-mono-cell text-sm text-muted">{truncateId(j.id)}</TableCell>
                  <TableCell className="text-sm">{renderNovelTitle(j)}</TableCell>
                  <TableCell>{j.updateMode ? '更新' : '抓取'}</TableCell>
                  <TableCell>{renderStatus(j)}</TableCell>
                  <TableCell>
                    {j.current || 0}/{j.total || '?'}
                  </TableCell>
                  <TableCell>
                    <span className="job-result-mini">✓{j.successCount || j.chapterCount || 0}</span>{' '}
                    <span className="job-result-mini job-result-mini--failed">✕{j.failedCount || 0}</span>{' '}
                    <span className="job-result-mini">↷{j.skippedCount || 0}</span>
                  </TableCell>
                  <TableCell className="text-sm text-muted">
                    {formatJobSpeed(j.speed)} · {formatEta(j.etaSeconds)}
                  </TableCell>
                  <TableCell className="text-sm text-muted">
                    {j.startedAt ? getJobDuration(j.startedAt, isJobTerminal(j.status) ? (j.updatedAt ?? null) : null) : '—'}
                  </TableCell>
                  <TableCell className="table-actions job-table-actions">{renderActions(j)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="admin-table-meta-row">
        <span className="text-xs text-muted">{jobStatsText}</span>
        {hasCompleted && (
          <Button variant="destructive" size="sm" onClick={() => void clearCompleted()}>
            清除已完成
          </Button>
        )}
      </div>

      <div className="mt-8">
        <AdminTabHeader
          title="下载日志"
          actions={
            <Button variant="secondary" size="sm" onClick={() => void loadDownloadLogs()}>
              刷新
            </Button>
          }
        />
      </div>
      <div className="table-wrapper">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>类型</TableHead>
              <TableHead>对象</TableHead>
              <TableHead>数量</TableHead>
              <TableHead>时间</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {downloadLogs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="table-empty">
                  {logsLoading ? '加载中…' : '暂无下载日志'}
                </TableCell>
              </TableRow>
            ) : (
              downloadLogs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell>{DOWNLOAD_TYPE_LABELS[log.type] || log.type}</TableCell>
                  <TableCell className="text-sm">{log.targetTitle || log.targetId || '—'}</TableCell>
                  <TableCell>{log.itemCount || 0}</TableCell>
                  <TableCell className="text-sm text-muted">{formatDateTime(log.createdAt)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}
