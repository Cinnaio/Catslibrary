import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Sparkles,
  Cpu,
  Feather,
  CheckCircle2,
  AlertCircle,
  XCircle,
  Clock,
  ArrowRight,
  TrendingUp,
  BookOpen,
  ChevronRight,
  Maximize2,
  Pause,
  Layers,
  Activity,
} from 'lucide-react'
import type { AiTaskInfo } from '@/lib/api'
import { parseAiTextProgress, type AiTextProgress } from '@shared/ai-text-progress'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface ExtractedEntity {
  name: string
  kind?: string
}

function extractStreamEntities(text: string): { entities: ExtractedEntity[]; labels: string[] } {
  if (!text) return { entities: [], labels: [] }
  const entityMatches = Array.from(text.matchAll(/"name"\s*:\s*"([^"]+)"(?:[^{}]*?"kind"\s*:\s*"([^"]+)")?/g))
  const entitiesMap = new Map<string, ExtractedEntity>()
  for (const m of entityMatches) {
    const name = m[1]?.trim()
    if (name && !entitiesMap.has(name)) {
      entitiesMap.set(name, { name, kind: m[2] })
    }
  }
  const labelMatches = Array.from(new Set(Array.from(text.matchAll(/"label"\s*:\s*"([^"]+)"/g)).map((m) => m[1]?.trim()))).filter(Boolean)
  return {
    entities: Array.from(entitiesMap.values()).slice(0, 8),
    labels: labelMatches.slice(0, 5) as string[],
  }
}

function getEntityIcon(kind?: string) {
  switch (kind) {
    case 'person':
      return '👤'
    case 'place':
      return '📍'
    case 'item':
      return '📦'
    case 'faction':
      return '🏛️'
    default:
      return '🏷️'
  }
}

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
  const [elapsedSeconds, setElapsedSeconds] = useState(0)

  // 任务运行时启动计时器
  useEffect(() => {
    if (!taskActive) {
      return
    }
    const timer = setInterval(() => {
      setElapsedSeconds((s) => s + 1)
    }, 1000)
    return () => clearInterval(timer)
  }, [taskActive, task?.id])

  // 重置计时器
  useEffect(() => {
    if (taskActive) {
      setElapsedSeconds(0)
    }
  }, [task?.id])

  const progress = useMemo(() => {
    if (!task) return null
    return parseAiTextProgress(task.result)
  }, [task?.result])

  const preview = progress?.preview || ''

  // 自动滚动流式输出窗口
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

  // 估算输出速度（字符/秒）
  const charSpeed = elapsedSeconds > 2 && generatedChars > 0 ? Math.round(generatedChars / elapsedSeconds) : 0

  // 目标完成百分比
  const targetTotal = targetWords || 2000
  const percentComplete = Math.min(100, Math.round((generatedChars / targetTotal) * 100))

  const { entities, labels } = extractStreamEntities(preview)

  const isCompleted = task?.status === 'completed'
  const isFailed = task?.status === 'failed'

  // 四阶推演流水线状态判定
  const stage = useMemo(() => {
    if (isCompleted) return 4
    if (progress?.phase === 'writing') return 3
    if (progress?.phase === 'thinking') return 2
    return 1
  }, [isCompleted, progress?.phase])

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60)
    const s = secs % 60
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  return (
    <div
      className={cn(
        'ai-continuation-visualizer rounded-2xl border transition-all duration-300 overflow-hidden shadow-xs',
        taskActive
          ? 'border-[#D97757]/40 bg-card ring-1 ring-[#D97757]/20'
          : isCompleted
            ? 'border-emerald-500/30 bg-emerald-500/5'
            : isFailed
              ? 'border-destructive/30 bg-destructive/5'
              : 'border-border/80 bg-card'
      )}
    >
      {/* 顶部状态条与计时 */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-muted/30 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span
            className={cn(
              'flex size-2.5 rounded-full',
              taskActive
                ? 'bg-[#D97757] animate-pulse ring-4 ring-[#D97757]/20'
                : isCompleted
                  ? 'bg-emerald-500'
                  : 'bg-muted-foreground/40'
            )}
          />
          <div className="flex items-center gap-2">
            <span className="font-semibold text-xs sm:text-sm text-foreground">
              {taskActive
                ? 'AI 创作推演监视器'
                : isCompleted
                  ? '本次创作已成功完成'
                  : isFailed
                    ? '推演未完成'
                    : '创作就绪'}
            </span>
            {task?.kind && (
              <span className="rounded-full bg-background/80 px-2 py-0.5 text-[11px] font-medium text-muted-foreground border border-border/60">
                {task.kind === 'continue' ? '篇章续写' : task.kind === 'write_outline' ? '大纲编排' : '单章创作'}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs">
          {taskActive && (
            <div className="flex items-center gap-1.5 font-mono text-muted-foreground bg-background/80 px-2.5 py-1 rounded-full border border-border/60 shadow-2xs">
              <Clock className="size-3.5 text-[#D97757]" />
              <span>{formatTime(elapsedSeconds)}</span>
              {charSpeed > 0 && <span className="text-[#D97757] font-medium ml-1">· ~{charSpeed} 字/秒</span>}
            </div>
          )}

          {taskActive && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onCancelTask}
              className="h-7 px-2.5 text-xs border-destructive/30 text-destructive hover:bg-destructive/10"
            >
              终止推演
            </Button>
          )}

          {isCompleted && task?.batchId && onViewBatch && (
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={() => onViewBatch(task.batchId)}
              className="h-7 px-3.5 text-xs font-semibold bg-[#D97757] hover:bg-[#c86646] text-white shadow-xs rounded-full"
            >
              查看草稿成果
              <ArrowRight className="size-3 ml-1" />
            </Button>
          )}
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* 四阶叙事演化流水线 */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { step: 1, label: '1. 记忆装配', desc: '风格/人物/情节对齐' },
            { step: 2, label: '2. 深度推演', desc: '逻辑构思与叙事推演' },
            { step: 3, label: '3. 流式撰写', desc: '正文实时铺展' },
            { step: 4, label: '4. 草稿收束', desc: '篇章校验归档' },
          ].map((s) => {
            const isDone = stage > s.step || (isCompleted && s.step === 4)
            const isCurrent = stage === s.step && taskActive

            return (
              <div
                key={s.step}
                className={cn(
                  'rounded-xl border p-2.5 transition-all',
                  isDone
                    ? 'border-emerald-500/30 bg-emerald-500/5 text-foreground'
                    : isCurrent
                      ? 'border-[#D97757] bg-[#D97757]/10 ring-1 ring-[#D97757]/30 shadow-2xs'
                      : 'border-border/60 bg-muted/15 text-muted-foreground'
                )}
              >
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span>{s.label}</span>
                  {isDone ? (
                    <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                  ) : isCurrent ? (
                    <Activity className="size-3.5 text-[#D97757] animate-pulse" />
                  ) : null}
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground line-clamp-1">{s.desc}</p>
              </div>
            )
          })}
        </div>

        {/* 多章进度与字数动态仪表盘 */}
        <div className="rounded-xl border border-border/70 bg-muted/20 p-3.5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-medium text-foreground">本次产出进度</span>
              {total > 1 && (
                <span className="rounded-full bg-[#D97757]/15 px-2 py-0.5 font-mono text-[11px] font-semibold text-[#D97757]">
                  第 {currentChapter} / {total} 章
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 font-mono text-xs">
              <span className="font-semibold text-foreground">
                {generatedChars.toLocaleString()} / {targetTotal.toLocaleString()} 字
              </span>
              <span className="rounded-md bg-background px-1.5 py-0.5 text-[11px] text-[#D97757] font-bold border border-border/60">
                {percentComplete}%
              </span>
            </div>
          </div>

          {/* 进度条 */}
          <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-muted/80">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-300 ease-out',
                taskActive ? 'bg-[#D97757] ai-shimmer-active' : isCompleted ? 'bg-emerald-500' : 'bg-muted-foreground/30'
              )}
              style={{ width: `${Math.max(4, Math.min(100, percentComplete))}%` }}
            />
          </div>

          {/* 章节步进小胶囊（多章时） */}
          {total > 1 && (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 pt-1">
              {Array.from({ length: total }).map((_, i) => {
                const chapNum = i + 1
                const chapDone = chapNum < currentChapter || isCompleted
                const chapActive = chapNum === currentChapter && taskActive

                return (
                  <div
                    key={chapNum}
                    className={cn(
                      'flex items-center justify-center gap-1 py-1 rounded-md text-[11px] font-mono border transition-all',
                      chapDone
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300'
                        : chapActive
                          ? 'border-[#D97757] bg-[#D97757]/15 text-[#D97757] font-bold ring-1 ring-[#D97757]/30'
                          : 'border-border/50 bg-background/50 text-muted-foreground'
                    )}
                  >
                    <span>第 {chapNum} 章</span>
                    {chapDone && <CheckCircle2 className="size-2.5" />}
                    {chapActive && <span className="size-1.5 rounded-full bg-[#D97757] animate-ping" />}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* 思考状态感知 */}
        {progress?.phase === 'thinking' && (
          <div className="flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-900 dark:text-amber-200 animate-in fade-in">
            <Cpu className="size-5 shrink-0 text-amber-600 animate-pulse" />
            <div className="space-y-0.5">
              <span className="font-semibold block">模型正在深度构建叙事逻辑与情节脉络</span>
              <p className="text-[11.5px] text-amber-800/80 dark:text-amber-300/80">
                已推演 <span className="font-mono font-bold">{reasoningChars.toLocaleString()} 个思考字符</span>，推演结束后将立即流式输出正文…
              </p>
            </div>
          </div>
        )}

        {/* 实时流式捕获要素 */}
        {(entities.length > 0 || labels.length > 0) && (
          <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-border/60 bg-muted/15 p-2.5 text-xs">
            <span className="text-[11px] font-semibold text-muted-foreground mr-1 flex items-center gap-1">
              <Sparkles className="size-3 text-[#D97757]" />
              实时捕获叙事要素:
            </span>
            {entities.map((item) => (
              <span
                key={item.name}
                className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background/90 px-2 py-0.5 text-[11px] text-foreground/80 shadow-2xs"
              >
                <span>{getEntityIcon(item.kind)}</span>
                <span className="font-medium">{item.name}</span>
              </span>
            ))}
            {labels.map((lbl) => (
              <span
                key={lbl}
                className="inline-flex items-center gap-1 rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-800 dark:text-amber-300"
              >
                <span>📋</span>
                <span className="font-medium">{lbl}</span>
              </span>
            ))}
          </div>
        )}

        {/* 实时正文流式终端视窗 */}
        {preview && (
          <div className="rounded-xl border border-border/80 bg-background overflow-hidden shadow-2xs space-y-0">
            <div className="flex items-center justify-between border-b border-border/60 bg-muted/30 px-3.5 py-2 text-xs">
              <div className="flex items-center gap-2">
                <Feather className="size-3.5 text-[#D97757]" />
                <span className="font-medium text-foreground">正文生成实时视窗</span>
                <span className="rounded-full bg-background px-2 py-0.5 text-[10.5px] font-mono text-muted-foreground border">
                  已接收 {generatedChars.toLocaleString()} 字符
                </span>
              </div>
              <span className="text-[11px] text-muted-foreground">
                {taskActive ? '流式合成中…' : '阶段快照'}
              </span>
            </div>

            <div
              ref={scrollRef}
              className="max-h-60 overflow-y-auto p-4 font-mono text-xs leading-relaxed text-foreground/90 whitespace-pre-wrap break-all select-text bg-[#FAF8F5] dark:bg-[#181715]"
            >
              {preview}
              {taskActive && (
                <span className="inline-block w-2 h-4 ml-0.5 bg-[#D97757] animate-pulse align-middle" />
              )}
            </div>
          </div>
        )}

        {/* 失败提示 */}
        {isFailed && task?.error && (
          <div className="flex items-start gap-2.5 rounded-xl border border-destructive/30 bg-destructive/10 p-3.5 text-xs text-destructive">
            <XCircle className="size-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">创作任务终止或出错</p>
              <p className="mt-0.5 text-muted-foreground">{task.error}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
