import '@/styles/loading-indicators.css'
/**
 * AsyncStates —— 管理后台统一的异步状态呈现：
 * - LoadingState：加载骨架（role=status / aria-live=polite），替换各面板手写的「加载中…」
 * - ErrorState：首屏加载失败的错误块（role=alert），带就地重试
 * - InlineError：已有数据时的行内错误条，失败不替换旧数据，只提示 + 重试
 * 让「加载 → 失败 → 重试」在 AI 与任务面板保持一致。
 */
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { AlertCircle, Ban, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import EmptyState from '@/components/shared/EmptyState'
import styles from './AsyncStates.module.css'

interface LoadingStateProps {
  /** 辅助技术可读的加载文案，默认「加载中」 */
  label?: string
  rows?: number
  className?: string
}

export function LoadingState({ label = '加载中', rows = 3, className }: LoadingStateProps) {
  return (
    <div role="status" aria-live="polite" className={cn(styles.loading, className)}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className={styles.bar} style={{ width: `${Math.max(40, 100 - index * 18)}%` }} />
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
    <EmptyState
      role="alert"
      className={cn(styles.error, className)}
      icon={<Ban aria-hidden="true" />}
      message={message}
      action={
        onRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw className="size-3.5" aria-hidden="true" />
            重试
          </Button>
        ) : undefined
      }
    />
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
    <div role="alert" className={cn(styles.inline, className)}>
      <div className={styles.copy}>
        <AlertCircle aria-hidden="true" />
        <p>{message}</p>
      </div>
      <div className={styles.actions}>
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
