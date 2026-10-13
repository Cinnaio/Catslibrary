import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { scrapeApi } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { isJobRunning, jobStatusLabel } from '@/lib/admin'
import { Button } from '@/components/ui/button'
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AdminDialogBody, AdminDialogContent } from './AdminDialog'
import { ErrorState, InlineError, LoadingState } from './AsyncStates'
import AdminStatusBadge from './AdminStatusBadge'

interface JobDetail {
  id: string
  status: string
  step?: string
  current?: number
  total?: number
  chapterCount?: number
  error?: string
  startedAt?: number
  updatedAt?: number
  recentLogs?: Array<{ id: string; message: string; detail?: string; createdAt: number }>
  failedItems?: Array<{ id: string; chapterTitle?: string; error?: string }>
}

/** 每次打开按任务 ID 读取详情，不依赖总览的六条任务快照。 */
export default function ScrapeTaskDetailsDialog({ jobId, title, onClose }: { jobId: string; title?: string; onClose: () => void }) {
  const [job, setJob] = useState<JobDetail | null>(null)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const [returnFocus] = useState(() => document.activeElement as HTMLElement | null)
  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    async function load() {
      try {
        const data = (await scrapeApi.status(jobId)) as unknown as JobDetail
        if (!active) return
        setJob(data)
        setError('')
        if (isJobRunning(data.status)) timer = setTimeout(() => void load(), 3000)
      } catch (err) {
        if (active) setError((err as Error).message || '读取任务失败')
      }
    }
    void load()
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [jobId, refresh])
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <AdminDialogContent
        variant="form"
        className="dashboard-task-dialog"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          titleRef.current?.focus()
        }}
        onCloseAutoFocus={(event) => {
          if (returnFocus?.isConnected) {
            event.preventDefault()
            returnFocus.focus()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle ref={titleRef} tabIndex={-1}>
            抓取任务详情
          </DialogTitle>
          <DialogDescription>{title || '查看执行进度、完整错误与最近日志。'}</DialogDescription>
        </DialogHeader>
        <AdminDialogBody>
          {error &&
            (job ? (
              <InlineError message={`详情刷新失败：${error}`} onRetry={() => setRefresh((r) => r + 1)} />
            ) : (
              <ErrorState message={`无法读取任务：${error}。记录可能已清理。`} onRetry={() => setRefresh((r) => r + 1)} />
            ))}
          {!job && !error && <LoadingState label="正在读取任务详情" />}
          {job && (
            <div className="dashboard-event-details">
              <dl className="task-workspace-details">
                <dt>任务 ID</dt>
                <dd>{job.id}</dd>
                <dt>状态</dt>
                <dd>
                  <AdminStatusBadge tone={job.status === 'failed' ? 'danger' : job.status === 'completed' ? 'success' : 'neutral'}>
                    {isJobRunning(job.status) && <span className="status-dot-pulse" aria-hidden="true" />}
                    {jobStatusLabel(job.status)}
                  </AdminStatusBadge>
                </dd>
                <dt>执行阶段</dt>
                <dd>{job.step || '未记录'}</dd>
                <dt>章节进度</dt>
                <dd>
                  {job.current ?? 0} / {job.total ?? 0}
                </dd>
                <dt>已入库</dt>
                <dd>{job.chapterCount ?? 0} 章</dd>
                <dt>开始时间</dt>
                <dd>{formatDateTime(job.startedAt) || '未记录'}</dd>
                <dt>最近更新</dt>
                <dd>{formatDateTime(job.updatedAt) || '未记录'}</dd>
                <dt>完整错误</dt>
                <dd className="dashboard-event-message">{job.error || '未记录错误'}</dd>
              </dl>
              {!!job.failedItems?.length && (
                <section aria-label="失败章节">
                  <h3 className="admin-dialog-section-label">失败章节（最近 12 条）</h3>
                  <ul className="dashboard-event-log">
                    {job.failedItems.map((item) => (
                      <li key={item.id}>
                        <strong>{item.chapterTitle || item.id}</strong>
                        <p>{item.error || '未记录原因'}</p>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              <section aria-label="任务日志">
                <h3 className="admin-dialog-section-label">最近日志（最多 30 条）</h3>
                {job.recentLogs?.length ? (
                  <ol className="dashboard-event-log">
                    {job.recentLogs.map((log) => (
                      <li key={log.id}>
                        <time>{formatDateTime(log.createdAt)}</time>
                        <p>{log.message}</p>
                        {log.detail && <p>{log.detail}</p>}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="admin-dialog-hint">暂无日志记录。</p>
                )}
              </section>
            </div>
          )}
        </AdminDialogBody>
        <DialogFooter>
          <Button variant="outline" asChild>
            <Link to="/admin/tasks?view=scrape">进入任务中心处理</Link>
          </Button>
          <Button variant="secondary" onClick={onClose}>
            关闭
          </Button>
        </DialogFooter>
      </AdminDialogContent>
    </Dialog>
  )
}
