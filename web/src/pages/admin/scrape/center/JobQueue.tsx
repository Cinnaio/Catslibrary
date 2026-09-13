// ============================================================
// 抓取任务队列 — 工作台右栏，常驻显示当前状态
// consumers: scrape/CenterView.tsx
// ============================================================
import { Inbox } from 'lucide-react'
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
  return (
    <aside className="scrape-workbench__aside" aria-label="抓取任务队列">
      <div className="scrape-workbench__aside-heading">
        <div>
          <h3>任务队列</h3>
          <p>{jobs.length > 0 ? '任务会在后台持续更新' : '启动任务后会显示在这里'}</p>
        </div>
        <span className="scrape-workbench__count">{jobs.length}</span>
      </div>
      <div className="scrape-job-queue">
        {jobs.length > 0 ? (
          jobs.map((job) => <JobCard key={job.jobId} job={job} {...handlers} />)
        ) : (
          <div className="scrape-job-queue__empty">
            <Inbox aria-hidden="true" />
            <strong>队列还是空的</strong>
            <span>分析一本作品并完成章节配置，任务进度会在这里集中追踪。</span>
          </div>
        )}
      </div>
    </aside>
  )
}
