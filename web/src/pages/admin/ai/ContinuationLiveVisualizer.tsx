import { useEffect, useMemo, useRef } from 'react'
import { Sparkles, ArrowRight, XCircle } from 'lucide-react'
import type { AiTaskInfo } from '@/lib/api'
import { parseAiTextProgress } from '@shared/ai-text-progress'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export default function ContinuationLiveVisualizer({
  task,
  taskActive,
  onCancelTask,
  onViewBatch,
  targetWords,
  totalChapters,
}: {
  task: AiTaskInfo | null
  taskActive: boolean
  onCancelTask: () => void
  onViewBatch?: (batchId?: string) => void
  targetWords: number
  totalChapters: number
}) {
  const scrollRef = useRef<HTMLDivElement>(null)

  const progress = useMemo(() => {
    if (!task) return null
    return parseAiTextProgress(task.result)
  }, [task?.result])

  const preview = progress?.preview || ''

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [preview])

  if (!task && !taskActive) {
    return null
  }

  const generatedChars = progress?.generatedCharacters || 0
  const reasoningChars = progress?.reasoningCharacters || 0
  const currentChapter = Math.max(1, task?.current || 1)
  const total = Math.max(1, task?.total || totalChapters || 1)
  const percentComplete = Math.min(100, Math.round((generatedChars / (targetWords || 2000)) * 100))

  const isCompleted = task?.status === 'completed'
  const isFailed = task?.status === 'failed'

  return (
    <div
      className={cn(
        'ai-continuation-visualizer rounded-lg border transition-all duration-200 overflow-hidden',
        taskActive
          ? 'border-[#D97757]/40 bg-card'
          : isCompleted
            ? 'border-emerald-500/30 bg-emerald-500/5'
            : isFailed
              ? 'border-destructive/30 bg-destructive/5'
              : 'border-border bg-card'
      )}
    >
      {/* 极简顶栏 */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 bg-muted/20 text-xs">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'size-2 rounded-full',
              taskActive
                ? 'bg-[#D97757] animate-pulse'
                : isCompleted
                  ? 'bg-emerald-500'
                  : 'bg-muted-foreground/40'
            )}
          />
          <span className="font-medium text-foreground">
            {taskActive
              ? total > 1
                ? `正在续写第 ${currentChapter} / ${total} 章…`
                : '正在生成章节正文…'
              : isCompleted
                ? `创作任务已完成（${total > 1 ? `${total} 章` : '单章'}草稿已就绪）`
                : isFailed
                  ? '创作任务未完成'
                  : '任务就绪'}
          </span>

          {taskActive && progress?.phase === 'thinking' && (
            <span className="text-[11.5px] text-muted-foreground">
              · 思考推演中 ({reasoningChars.toLocaleString()} 字符)
            </span>
          )}

          {taskActive && progress?.phase === 'writing' && (
            <span className="text-[11.5px] font-mono text-muted-foreground">
              · 已输出 {generatedChars.toLocaleString()} 字 ({percentComplete}%)
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {taskActive && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onCancelTask}
              className="h-6 px-2 text-xs text-destructive hover:bg-destructive/10"
            >
              终止
            </Button>
          )}

          {isCompleted && task?.batchId && onViewBatch && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onViewBatch(task.batchId)}
              className="h-6 px-2.5 text-xs font-medium border-[#D97757]/40 text-[#D97757] hover:bg-[#D97757]/10 rounded-full"
            >
              查看草稿
              <ArrowRight className="size-3 ml-1" />
            </Button>
          )}
        </div>
      </div>

      {/* 纤细进度条 */}
      {taskActive && (
        <div className="h-0.5 w-full bg-muted/60 overflow-hidden">
          <div
            className="h-full bg-[#D97757] transition-all duration-300"
            style={{ width: `${Math.max(5, Math.min(100, percentComplete))}%` }}
          />
        </div>
      )}

      {/* 实时正文流视窗（仅在有正文时展开） */}
      {preview && taskActive && (
        <div
          ref={scrollRef}
          className="max-h-48 overflow-y-auto p-3 font-mono text-xs leading-relaxed text-foreground/85 whitespace-pre-wrap break-all select-text bg-[#FAF8F5] dark:bg-[#181715] border-t border-border/50"
        >
          {preview}
          <span className="inline-block w-1.5 h-3.5 ml-0.5 bg-[#D97757] animate-pulse align-middle" />
        </div>
      )}

      {/* 失败提示 */}
      {isFailed && task?.error && (
        <div className="flex items-center gap-2 px-3.5 py-2 text-xs text-destructive border-t border-destructive/20">
          <XCircle className="size-3.5 shrink-0" />
          <span>{task.error}</span>
        </div>
      )}
    </div>
  )
}
