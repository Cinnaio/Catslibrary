// ============================================================
// 抓取任务队列与配置迁移 — Claude 风格工作台卡片
// consumers: scrape/CenterView.tsx
// ============================================================
import { Download, FileUp } from 'lucide-react'
import { Link } from 'react-router-dom'
import { isJobRunning } from '@/lib/admin'
import { Spinner } from '@/components/ui/spinner'
import styles from '../workbench.module.css'
import { Button } from '@/components/ui/button'
import type { JobCard as JobCardData } from '../types'
import JobCard from './JobCard'

interface JobQueueProps {
  jobs: JobCardData[]
  restoring: boolean
  restoreError: string
  onCancel: (jobId: string) => void
  onRetry: (jobId: string) => void
  onRetryFailed: (jobId: string) => void
  onDismiss: (jobId: string) => void
  onToggleLog: (jobId: string) => void
  onExportConfigs?: () => void
  onImportConfigs?: () => void
  configImportStatus?: string
}

export default function JobQueue({
  jobs, restoring, restoreError, onExportConfigs, onImportConfigs, configImportStatus, ...handlers
}: JobQueueProps) {
  // Stable ordering within each group prevents polling from moving a row under the pointer.
  const rank = (job: JobCardData) => isJobRunning(job.status) || job.status === 'queued' ? 0 : job.failedCount > 0 || job.status === 'failed' || job.status === 'partial' ? 1 : 2
  const ordered = [...jobs].sort((a, b) => rank(a) - rank(b))

  return (
    <section className={styles.queue} aria-labelledby="scrape-recent-title">
      <div className={styles.heading}>
        <h2 id="scrape-recent-title" className={styles.title}>近期任务</h2>
        <div className={styles.queueActions}>
          <Button variant="ghost" asChild><Link to="/admin/tasks?view=scrape">全部任务</Link></Button>
          {onExportConfigs && <Button variant="outline" onClick={onExportConfigs}><Download aria-hidden="true" />导出配置</Button>}
          {onImportConfigs && <Button variant="outline" onClick={onImportConfigs} disabled={Boolean(configImportStatus)}><FileUp aria-hidden="true" />导入配置</Button>}
        </div>
      </div>
      <p className={`${styles.hint} ${styles.queueNote}`}>显示进行中与本页启动的任务，完整历史见任务中心。</p>
      {configImportStatus && <p role="status" className={styles.hint}>{configImportStatus}</p>}
      {restoreError && <p role="status" className={`${styles.hint} ${styles.danger}`}>{restoreError}</p>}
      <div className={styles.taskList}>
        {ordered.map((job) => <JobCard key={job.jobId} job={job} {...handlers} />)}
      </div>
      {jobs.length === 0 && (
        <div className={`${styles.empty} ${styles.hint}`} role="status">
          {restoring ? <><Spinner size="sm" aria-hidden="true" /> 正在读取任务…</> : restoreError ? '当前任务尚未载入。' : '暂无抓取任务，从上方导入作品后，进度会显示在这里。'}
        </div>
      )}
    </section>
  )
}
