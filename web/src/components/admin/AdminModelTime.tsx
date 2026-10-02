import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'

interface AdminModelTimeProps {
  model?: string | null
  timestamp?: number | string | null
  className?: string
}

/** 后台模型与时间：模型一行，绝对日期和分钟时间一行。 */
export default function AdminModelTime({ model, timestamp, className }: AdminModelTimeProps) {
  const value = Number(timestamp)
  const valid = !!value && Number.isFinite(value) && !Number.isNaN(new Date(value).getTime())
  const label = valid ? formatDateTime(value) : '—'
  return (
    <div className={cn('admin-model-time', className)}>
      <span className="admin-model-time__model" title={model || undefined}>
        {model || '—'}
      </span>
      <time className="admin-model-time__time" dateTime={valid ? new Date(value).toISOString() : undefined} title={label}>
        {label}
      </time>
    </div>
  )
}
