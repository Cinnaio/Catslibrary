// ============================================================
// 抓取任务队列 — 工作台右栏，有任务时才出现
// consumers: scrape/CenterView.tsx
// ============================================================
import type { JobCard as JobCardData } from '../types'
import JobCard from './JobCard'

interface JobQueueProps {
  jobs: JobCardData[]
  onCancel: (jobId: string) => void
  onRetry: (jobId: string) => void
  onRetryFailed: (jobId: string) => void
  onDismiss: (jobId: string) => void
  onToggleLog: (jobId: string) => void
}

export default function JobQueue({ jobs, ...handlers }: JobQueueProps) {
  if (jobs.length === 0) return null
  return (
    <aside className="scrape-workbench__aside" aria-label="抓取任务队列">
      <h3 className="m-0 mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
        任务队列
        <span className="admin-shell__status tabular-nums">{jobs.length}</span>
      </h3>
      <div className="scrape-job-queue">
        {jobs.map((job) => (
          <JobCard key={job.jobId} job={job} {...handlers} />
        ))}
      </div>
    </aside>
  )
}
