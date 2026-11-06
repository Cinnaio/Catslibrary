// ============================================================
// 抓取任务记录 — 进度 / 指标 / 失败章节 / 日志
// consumers: scrape/center/JobQueue.tsx
// ============================================================
import { useId } from 'react'
import { AlertTriangle, Check, ChevronDown, MinusCircle, XCircle } from 'lucide-react'
import { formatEta, formatJobSpeed, isJobRunning, isJobTerminal, jobStatusLabel } from '@/lib/admin'
import AdminStatusBadge from '@/components/admin/AdminStatusBadge'
import type { AdminStatusTone } from '@/lib/admin-status'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import type { JobCard as JobCardData } from '../types'
import { fmtLogTime } from '../utils'
import styles from '../workbench.module.css'

interface JobCardProps {
  job: JobCardData
  onCancel: (jobId: string) => void
  onRetry: (jobId: string) => void
  onRetryFailed: (jobId: string) => void
  onDismiss: (jobId: string) => void
  onToggleLog: (jobId: string) => void
}

/** 状态 → 徽章配色与图标。 */
function statusBadge(status: string): { tone: AdminStatusTone; Icon: typeof Check | null } {
  switch (status) {
    case 'completed':
      return { tone: 'success', Icon: Check }
    case 'partial':
      return { tone: 'warning', Icon: AlertTriangle }
    case 'failed':
      return { tone: 'danger', Icon: XCircle }
    case 'cancelled':
      return { tone: 'muted', Icon: MinusCircle }
    default:
      return { tone: 'info', Icon: null }
  }
}

export default function JobCard({ job, onCancel, onRetry, onRetryFailed, onDismiss, onToggleLog }: JobCardProps) {
  const detailId = useId()
  const running = isJobRunning(job.status) || job.status === 'queued'
  const terminal = isJobTerminal(job.status)
  const { tone: statusTone, Icon: StatusIcon } = statusBadge(job.status)
  const pct = job.status === 'completed' ? 100 : Math.max(0, Math.min(100, job.total > 0 ? (job.current / job.total) * 100 : job.progress * 100))

  return (
    <article className={styles.task} aria-label={`${job.novelTitle} 抓取任务`}>
      <div className={styles.taskHead}>
        <div className={styles.taskInfo}>
          <div className={styles.connectionSummary}>
            <span className={styles.taskName}>{job.novelTitle}</span>
            <AdminStatusBadge tone={statusTone}>
              {StatusIcon && <StatusIcon className="size-3" aria-hidden="true" />}
              {jobStatusLabel(job.status)}
            </AdminStatusBadge>
          </div>
          <div className={styles.taskSummary}>
            <span>{job.total > 0 ? `${job.current || 0} / ${job.total} 章` : job.step || '正在准备'}</span>
            {terminal && <span>成功 {job.successCount} 章</span>}
            {job.failedCount > 0 && <span className={styles.danger}>失败 {job.failedCount} 章</span>}
          </div>
          {(job.total > 0 || job.progress > 0) && <Progress
            value={pct} className={styles.taskProgress}
            data-failed={job.status === 'failed'} data-cancelled={job.status === 'cancelled'}
            aria-label={`${job.novelTitle} 抓取进度`}
            aria-valuetext={job.total > 0 ? `${job.current || 0} / ${job.total} 章` : `${Math.round(pct)}%`}
          />}
        </div>
        <Button variant="ghost" onClick={() => onToggleLog(job.jobId)} aria-expanded={job.logOpen} aria-controls={detailId}>
          {job.logOpen ? '收起详情' : job.failedCount > 0 || job.status === 'failed' ? '查看失败原因' : '查看详情'}
          <ChevronDown className={`${styles.chevron} ${job.logOpen ? styles.chevronOpen : ''}`} aria-hidden="true" />
        </Button>
      </div>
      {job.logOpen && (
        <div id={detailId} className={styles.taskDetails}>
          <p className={styles.hint}>{job.step || '暂无执行说明'}</p>
          <div className={styles.taskSummary}>
            <span>成功 {job.successCount} · 失败 {job.failedCount} · 跳过 {job.skippedCount}</span>
            {running && <span>{formatJobSpeed(job.speed)} · 预计剩余 {formatEta(job.etaSeconds)}</span>}
          </div>
          {job.failedItems.length > 0 && (
            <div>
              <p className={`${styles.hint} ${styles.danger}`}>失败章节（{job.failedItems.length}）</p>
              <ul className={styles.failureList} tabIndex={0} aria-label="失败章节">
                {job.failedItems.map((item, index) => <li key={index}>
                  <strong>{item.chapterTitle || item.chapterUrl || '未知章节'}</strong>
                  <span className={styles.danger}>{item.error || '抓取失败'}</span>
                </li>)}
              </ul>
            </div>
          )}
          <div>
            <p className={styles.hint}>近期日志</p>
            {job.recentLogs.length > 0 ? <ul className={styles.logs} tabIndex={0} aria-label="近期任务日志">
              {job.recentLogs.map((log, index) => <li key={index}>
                <time>{fmtLogTime(log.createdAt)}</time>
                <strong className={log.level === 'error' ? styles.danger : undefined}>{log.message}</strong>
                {log.detail && <span>{String(log.detail).slice(0, 160)}</span>}
              </li>)}
            </ul> : <p className={styles.hint}>暂无日志，完整记录可到任务中心查看。</p>}
          </div>
          <div className={styles.taskActions}>
            {job.failedCount > 0 && <Button variant="outline" onClick={() => onRetryFailed(job.jobId)}>重试失败章节</Button>}
            {!running && ['failed', 'cancelled', 'partial'].includes(job.status) && <Button variant="outline" onClick={() => onRetry(job.jobId)}>整本重试</Button>}
            {terminal ? <Button variant="ghost" onClick={() => onDismiss(job.jobId)}>移除此记录</Button> : <Button variant="ghost" onClick={() => onCancel(job.jobId)}>终止任务</Button>}
          </div>
        </div>
      )}
    </article>
  )
}
