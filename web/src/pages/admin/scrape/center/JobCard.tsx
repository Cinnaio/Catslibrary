// ============================================================
// 抓取任务卡 — 进度 / 指标 / 失败章节 / 日志（22rem 右栏紧凑布局）
// consumers: scrape/center/JobQueue.tsx
// ============================================================
import { useId } from 'react'
import { AlertTriangle, Check, CircleMinus, MinusCircle, RefreshCw, RotateCcw, X, XCircle } from 'lucide-react'
import { formatEta, formatJobSpeed, isJobRunning, isJobTerminal, jobStatusLabel } from '@/lib/admin'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import type { JobCard as JobCardData } from '../types'
import { fmtLogTime } from '../utils'
import ScrapeDisclosure from './ScrapeDisclosure'

interface JobCardProps {
  job: JobCardData
  onCancel: (jobId: string) => void
  onRetry: (jobId: string) => void
  onRetryFailed: (jobId: string) => void
  onDismiss: (jobId: string) => void
  onToggleLog: (jobId: string) => void
}

const ICON = 'size-3.5'

/** 状态 → 徽章配色与图标。 */
function statusBadge(status: string) {
  switch (status) {
    case 'completed':
      return { cls: 'bg-success/10 text-success', Icon: Check }
    case 'partial':
      return { cls: 'bg-warning/10 text-warning', Icon: AlertTriangle }
    case 'failed':
      return { cls: 'bg-destructive/10 text-destructive', Icon: XCircle }
    case 'cancelled':
      return { cls: 'bg-muted text-muted-foreground', Icon: MinusCircle }
    default:
      return { cls: 'bg-info/10 text-info', Icon: null }
  }
}

export default function JobCard({ job, onCancel, onRetry, onRetryFailed, onDismiss, onToggleLog }: JobCardProps) {
  const logId = useId()
  const running = isJobRunning(job.status)
  const terminal = isJobTerminal(job.status)
  const { cls: statusCls, Icon: StatusIcon } = statusBadge(job.status)

  let pct = job.progress != null ? job.progress * 100 : 5
  if (job.total > 0 && job.current != null) pct = Math.min((job.current / job.total) * 95, 95)
  if (terminal) pct = 100

  const fillCls =
    job.status === 'failed'
      ? '[&_[data-slot=progress-indicator]]:bg-destructive'
      : job.status === 'cancelled'
        ? '[&_[data-slot=progress-indicator]]:bg-muted-foreground'
        : ''

  return (
    <article className="admin-panel-card scrape-job">
      <div className="scrape-job__head">
        <span className="scrape-job__name text-sm font-medium" title={job.novelTitle}>
          {job.novelTitle}
        </span>
        <Badge className={statusCls}>
          {running ? (
            <RefreshCw className="size-3 animate-spin" aria-hidden="true" />
          ) : StatusIcon ? (
            <StatusIcon className="size-3" aria-hidden="true" />
          ) : null}
          {jobStatusLabel(job.status)}
        </Badge>
      </div>

      <Progress
        value={pct}
        className={fillCls}
        aria-label={`${job.novelTitle} 抓取进度`}
        aria-valuetext={job.total > 0 ? `${job.current || 0} / ${job.total} 章` : `${Math.round(pct)}%`}
      />

      <div className="scrape-job__metrics text-xs">
        <span>
          公开章节 <strong>{job.publicChapterCount}</strong>
        </span>
        <span>
          受保护正文 <strong>{job.protectedChapterCount}</strong>
        </span>
        <span>
          成功 <strong>{job.successCount}</strong>
        </span>
        <span>
          失败 <strong>{job.failedCount}</strong>
        </span>
        <span>
          跳过 <strong>{job.skippedCount}</strong>
        </span>
        <span>
          速度 <strong>{formatJobSpeed(job.speed)}</strong>
        </span>
        <span>
          ETA <strong>{formatEta(job.etaSeconds)}</strong>
        </span>
      </div>

      <p className="m-0 text-xs text-muted-foreground" aria-live="polite">
        {job.step}
        {job.total > 0 ? ` (${job.current || 0}/${job.total})` : ''}
      </p>

      {job.failedItems.length > 0 && (
        <div>
          <p className="scrape-job__failures-title m-0 mb-1 text-xs">失败章节</p>
          <ul className="scrape-job__failures text-xs">
            {job.failedItems.map((item, i) => (
              <li className="scrape-job__failure" key={i}>
                <span>{item.chapterTitle || item.chapterUrl || '未知章节'}</span>
                <em>{item.error || '抓取失败'}</em>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="scrape-job__foot">
        <ScrapeDisclosure open={job.logOpen} onToggle={() => onToggleLog(job.jobId)} controls={logId}>
          日志
        </ScrapeDisclosure>
        <div className="scrape-job__actions">
          {job.failedCount > 0 && (
            <Button variant="ghost" size="icon-sm" title="重试失败章节" aria-label="重试失败章节" onClick={() => onRetryFailed(job.jobId)}>
              <RotateCcw className={ICON} />
            </Button>
          )}
          {!running && (job.status === 'failed' || job.status === 'cancelled' || job.status === 'partial') && (
            <Button variant="ghost" size="icon-sm" title="整本重试" aria-label="整本重试" onClick={() => onRetry(job.jobId)}>
              <RefreshCw className={ICON} />
            </Button>
          )}
          {terminal ? (
            <Button variant="ghost" size="icon-sm" title="清除" aria-label="清除任务卡" onClick={() => onDismiss(job.jobId)}>
              <X className={ICON} />
            </Button>
          ) : (
            <Button variant="ghost" size="icon-sm" title="终止" aria-label="终止任务" onClick={() => onCancel(job.jobId)}>
              <CircleMinus className={ICON} />
            </Button>
          )}
        </div>
      </div>

      {job.logOpen && (
        <ul id={logId} className="scrape-job__logs text-xs">
          {job.recentLogs.map((log, i) => (
            <li className={`scrape-job__log scrape-job__log--${log.level || 'info'}`} key={i}>
              <span>{fmtLogTime(log.createdAt)}</span>
              <strong>{log.message}</strong>
              {log.detail ? <em>{String(log.detail).slice(0, 160)}</em> : null}
            </li>
          ))}
        </ul>
      )}
    </article>
  )
}
