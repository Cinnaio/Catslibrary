// ============================================================
// 抓取任务队列与配置迁移 — Claude 风格工作台卡片
// consumers: scrape/CenterView.tsx
// ============================================================
import { Download, FileUp, Layers } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AdminDataPanel } from '@/components/admin/AdminDataPanel'
import type { JobCard as JobCardData } from '../types'
import JobCard from './JobCard'

interface JobQueueProps {
  jobs: JobCardData[]
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
  jobs,
  onExportConfigs,
  onImportConfigs,
  configImportStatus,
  ...handlers
}: JobQueueProps) {
  return (
    <AdminDataPanel className="scrape-queue-card" ariaLabel="抓取任务队列">
      <div className="scrape-queue-head">
        <div className="scrape-queue-head__title-group">
          <h3 className="scrape-queue-head__title">任务队列</h3>
          <span className="scrape-workbench__count">{jobs.length} 个</span>
        </div>
        {(onExportConfigs || onImportConfigs) && (
          <div className="scrape-queue-head__actions">
            {onExportConfigs && (
              <Button variant="outline" size="sm" className="h-8 text-xs px-3 rounded-lg" onClick={onExportConfigs}>
                <Download className="size-3.5 mr-1" aria-hidden="true" />
                导出配置
              </Button>
            )}
            {onImportConfigs && (
              <Button variant="outline" size="sm" className="h-8 text-xs px-3 rounded-lg" onClick={onImportConfigs}>
                <FileUp className="size-3.5 mr-1" aria-hidden="true" />
                导入配置
              </Button>
            )}
            {configImportStatus && <span aria-live="polite" className="text-xs text-muted-foreground">{configImportStatus}</span>}
          </div>
        )}
      </div>

      <div className="scrape-job-queue">
        {jobs.length > 0 ? (
          jobs.map((job) => <JobCard key={job.jobId} job={job} {...handlers} />)
        ) : (
          <div className="scrape-queue-empty-calm">
            <Layers className="size-4 text-[#D97757] shrink-0" aria-hidden="true" />
            <span>当前队列暂无进行中的抓取任务。在上方输入链接或搜索作品开始抓取。</span>
          </div>
        )}
      </div>
    </AdminDataPanel>
  )
}
