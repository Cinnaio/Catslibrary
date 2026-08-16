/**
 * AsyncStates —— 管理后台统一的异步状态呈现：
 * - LoadingState：加载骨架（role=status / aria-live=polite），替换各面板手写的「加载中…」
 * - ErrorState：首屏加载失败的错误块（role=alert），带就地重试
 * - InlineError：已有数据时的行内错误条，失败不替换旧数据，只提示 + 重试
 * 让「加载 → 失败 → 重试」在 AI 与任务面板保持一致。
 */
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { AlertCircle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface LoadingStateProps {
  /** 辅助技术可读的加载文案，默认「加载中」 */
  label?: string
  rows?: number
  className?: string
}

export function LoadingState({ label = '加载中', rows = 3, className }: LoadingStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn('flex h-32 flex-col justify-center gap-3 px-4', className)}
    >
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className="h-4 animate-pulse rounded-sm bg-muted/60"
          style={{ width: `${Math.max(40, 100 - index * 18)}%` }}
        />
      ))}
    </div>
  )
}

interface ErrorStateProps {
  message: string
  onRetry?: () => void
  className?: string
}

/** 首屏加载失败：无数据可展示时使用，明确失败原因并给就地重试。 */
export function ErrorState({ message, onRetry, className }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn('flex h-32 flex-col items-center justify-center gap-3 px-4 text-center', className)}
    >
      <AlertCircle className="size-5 text-destructive" />
      <p className="text-sm text-destructive">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="size-3.5" />
          重试
        </Button>
      )}
    </div>
  )
}

interface InlineErrorProps {
  message: string
  onRetry?: () => void
  className?: string
  children?: ReactNode
}

/** 行内错误条：已有旧数据时保留内容，只在顶部提示失败并允许重试。 */
export function InlineError({ message, onRetry, className, children }: InlineErrorProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive',
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <AlertCircle className="size-4 shrink-0" />
        <p className="min-w-0 truncate">{message}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {children}
        {onRetry && (
          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={onRetry}>
            <RefreshCw className="size-3.5" />
            重试
          </Button>
        )}
      </div>
    </div>
  )
}
