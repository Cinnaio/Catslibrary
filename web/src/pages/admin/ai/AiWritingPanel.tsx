import { watchAiTask } from '@/lib/ai-task-stream'
import AiStreamPreview from '@/components/shared/AiStreamPreview'
import { MotionDetails } from '@/components/ui/motion'
import { Link } from 'react-router-dom'
import WritingPreparation from './WritingPreparation'
import AiGenerationsPanel from './AiGenerationsPanel'
import styles from './writing-workspace.module.css'
import { emptyWritingBrief } from './writing-brief'
import { normalizePlotTimeoutSeconds, PLOT_TIMEOUT_MIN_SECONDS, PLOT_TIMEOUT_MAX_SECONDS } from '@shared/ai-plot-timeout'
import type { AiWritingBrief } from '@/lib/api'
/** AI 创作工作台：新写 / 续写，生成结果先保存为草稿。 */
import type { AdminNovelIndexItem } from '@shared/types'
import { parseAiTextProgress, type AiTextProgress } from '@shared/ai-text-progress'
import FormField from "@/components/shared/FormField"
import AdminStatusBadge from '@/components/admin/AdminStatusBadge'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { aiApi, chaptersApi, newOperationId, type AiEffectiveProfile, type AiTaskInfo } from '@/lib/api'
import { loadAdminNovelIndex } from '@/lib/admin-novel-index'
import { useToast, useConfirm } from '@/components/feedback'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Dialog, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { DialogBody, DialogFrame } from "@/components/shared/DialogFrame"
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import SearchSelect from "@/components/shared/SearchSelect"
import { kindLabel as taskKindLabel, taskStatusLabel } from './labels'
import ProfileOverrideEditor from './ProfileOverrideEditor'
import MemoryRebuildDialog from './MemoryRebuildDialog'
import { Textarea } from '@/components/ui/textarea'
import { url } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Sparkles, ArrowRight, ChevronRight, Network, Pause, BookOpen, Cpu, FileText } from 'lucide-react'

// 后台化的创作任务类型
const WRITING_TASK_KINDS = new Set(['continue', 'write_outline', 'write_chapter'])
// 超过该章数的批量续写需要二次确认（成本意识）
const CONFIRM_CHAPTER_COUNT = 5

/**
 * 数值输入的文字态与数值态分离。
 * 直接把受控值写成 number 会让清空输入框的瞬间被塞回默认值（「300」跳回来），
 * 编辑期无法出现空串，等于数字改不动。这里保留文字态，非法或空输入只留在文字上，
 * 失焦或提交时才归一化回合法数值。
 */
function useEditableNumber(initial: number, min: number, max: number) {
  const [value, setValue] = useState(initial)
  const [text, setText] = useState(String(initial))
  const valueRef = useRef(initial)

  const onChangeText = useCallback(
    (raw: string) => {
      setText(raw)
      const parsed = Math.trunc(Number(raw))
      // 编辑期只接受范围内的合法值；空串或非法输入保留文字态，等失焦归一化
      if (raw.trim() !== '' && Number.isFinite(parsed)) {
        const next = Math.max(min, Math.min(max, parsed))
        valueRef.current = next
        setValue(next)
      }
    },
    [min, max],
  )

  /** 把文字态归一化成合法数值并回写，返回可直接提交的值。 */
  const commit = useCallback(() => {
    const parsed = Math.trunc(Number(text))
    const next = text.trim() !== '' && Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : valueRef.current
    valueRef.current = next
    setValue(next)
    setText(String(next))
    return next
  }, [text, min, max])

  /** 供明确的任务规模切换直接落入一个合法值，不经过编辑态的空串。 */
  const setCommittedValue = useCallback(
    (raw: number) => {
      const next = Math.max(min, Math.min(max, Math.trunc(raw)))
      valueRef.current = next
      setValue(next)
      setText(String(next))
    },
    [min, max],
  )

  return { value, text, onChangeText, commit, setCommittedValue }
}

/**
 * 数出大纲里有几个章节段落。
 * 与后端 splitOutlineByChapter 用同一套标记规则（「第N章」或「N.」），
 * 让作者在提交前就知道大纲章数与续写章数是否对得上。
 */
function countOutlineChapters(outline: string): number {
  const marker = /^\s*(?:#{1,6}\s*)?(?:第\s*[0-9一二三四五六七八九十百零两]+\s*[章节回]|[0-9]+\s*[.、)）:])\s*/
  const seen = new Set<string>()
  for (const line of String(outline || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')) {
    const match = marker.exec(line)
    if (match) seen.add(match[0].trim())
  }
  return seen.size
}

/** 解析大纲中的章节段落（提取章节标记、标题与段落内容）供快速填入本次情节 */
function parseOutlineSections(outline: string): Array<{ chapter: string; title: string; content: string }> {
  const result: Array<{ chapter: string; title: string; content: string }> = []
  const lines = String(outline || '').replace(/\r\n?/g, '\n').split('\n')
  const marker = /^\s*(?:#{1,6}\s*)?((?:第\s*[0-9一二三四五六七八九十百零两]+\s*[章节回]|[0-9]+\s*[.、)）:]))\s*(.*)$/
  let currentChapter = ''
  let currentTitle = ''
  let contentLines: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    const match = marker.exec(trimmed)
    if (match) {
      if (currentChapter) {
        result.push({ chapter: currentChapter, title: currentTitle, content: contentLines.join('\n').trim() })
      }
      currentChapter = (match[1] || '').trim()
      currentTitle = (match[2] || '').trim()
      contentLines = []
    } else if (trimmed) {
      contentLines.push(trimmed)
    }
  }
  if (currentChapter) {
    result.push({ chapter: currentChapter, title: currentTitle, content: contentLines.join('\n').trim() })
  }
  return result
}

/** 任务状态圆点：排队琥珀、运行中主色呼吸、完成绿、失败红、取消灰。 */
function taskDotClass(status: string): string {
  if (status === 'running') return 'bg-primary motion-safe:animate-pulse'
  if (status === 'queued') return 'bg-[var(--color-warning)]'
  if (status === 'completed') return 'bg-[var(--color-success)]'
  if (status === 'failed') return 'bg-[var(--color-danger)]'
  return 'bg-muted-foreground/40'
}

/** 画像正文：按空行分段排版，保留段内换行；超出可视高度时提示可继续滚动。 */
function ProfileText({ text }: { text: string }) {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [overflowing, setOverflowing] = useState(false)
  useEffect(() => {
    const el = scrollRef.current
    setOverflowing(!!el && el.scrollHeight > el.clientHeight + 4)
  }, [text])
  return (
    <div className="relative">
      <div ref={scrollRef} className="max-h-60 space-y-3 overflow-y-auto pr-1 sm:max-h-44">
        {paragraphs.map((paragraph, index) => (
          <p key={index} className="whitespace-pre-line text-sm leading-7 text-foreground/80 sm:text-[13px] sm:leading-6">
            {paragraph}
          </p>
        ))}
      </div>
      {overflowing && (
        <span className="pointer-events-none absolute bottom-1 right-2 rounded-full bg-background/90 px-2 py-0.5 text-[11px] leading-4 text-muted-foreground shadow-sm">
          共 {text.replace(/\s/g, '').length} 字 · 滚动查看
        </span>
      )}
    </div>
  )
}

function memoryRunning(profile: AiEffectiveProfile | null): boolean {
  return !!profile?.progress?.running || profile?.memoryTask?.status === 'queued' || profile?.memoryTask?.status === 'running'
}

function TextProgressPreview({ progress }: { progress?: AiTextProgress | null }) {
  return <AiStreamPreview progress={progress} />
}

function MemoryAttemptNote({ profile }: { profile: AiEffectiveProfile | null }) {
  const attempt = profile?.lastAttempt
  if (!attempt) return null
  if (attempt.status === 'timeout') {
    return (
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <span className="font-medium text-destructive">
          最近提取：请求超时 · 等待上限 {Math.round((attempt.timeoutMs || 0) / 1000)} 秒 · 用量未确认
        </span>
        {attempt.elapsedMs != null && <span>· 耗时 {Math.round(attempt.elapsedMs / 1000)} 秒</span>}
        <span className="text-[11px] text-muted-foreground/80">（已保留已提交内容）</span>
      </div>
    )
  }

  const isReasoningExhausted =
    attempt.status === 'truncated' &&
    !!attempt.reasoningTokens &&
    !!attempt.completionTokens &&
    attempt.reasoningTokens >= attempt.completionTokens * 0.85

  const statusMap: Record<string, { label: string; tone: string }> = {
    complete: { label: '完整返回', tone: 'text-foreground/90 font-medium' },
    truncated: {
      label: isReasoningExhausted ? '思考耗尽全部预算（请关闭思考模式或换通用大模型）' : '输出被截断，请提高此档案预算',
      tone: 'text-amber-600 dark:text-amber-400 font-medium',
    },
    refused: { label: '模型拒答，增加预算不能解决', tone: 'text-destructive font-medium' },
    empty: { label: '返回空内容，未确认截断', tone: 'text-muted-foreground font-medium' },
  }
  const statusInfo = attempt.status === 'complete' && attempt.error
    ? { label: '校验未通过，未推进该章', tone: 'text-destructive font-medium' }
    : statusMap[attempt.status] || { label: attempt.status, tone: 'text-muted-foreground' }

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-muted-foreground">
      <span className="inline-flex items-center gap-1 rounded bg-muted/60 px-1.5 py-0.5 text-foreground/80">
        最近提取：<span className={statusInfo.tone}>{statusInfo.label}</span>
      </span>
      <span>
        预算 {attempt.maxTokens.toLocaleString()} / 输出{' '}
        <span className="font-mono text-foreground/80">{attempt.completionTokens?.toLocaleString() ?? '未知'}</span> Token
      </span>
      {attempt.reasoningTokens !== null && (
        <span className="rounded bg-muted/40 px-1.5 py-0.5 font-mono text-[11px]">
          推理 {attempt.reasoningTokens.toLocaleString()}
        </span>
      )}
      {attempt.firstContentMs != null && (
        <span>首段正文 {(attempt.firstContentMs / 1000).toFixed(1)} 秒</span>
      )}
    </div>
  )
}

/** 画像提取模块的统一骨架：可展开的标题行（画像名 + 状态徽标 + 操作区）+ 内容面板或空态提示。
 *
 * 已提取时默认折叠：画像正文实测每张 200~290px，三张合计占续写模式整页 43%，
 * 但它们是提取一次、长期复用的资产，不该在每次执行任务时都被滚过。
 * 未提取时没有可折叠的内容，标题行退回纯文本（不可点），空态提示保持常显 ——
 * 否则「未提取」会被折叠成一行无信息量的标题，反而看不出该怎么开始。 */
export function ProfileSection(props: {
  label: string
  extracted: boolean
  statusText?: string
  busy: boolean
  disabled: boolean
  actionText: string
  onAction: () => void
  onPause?: () => void
  extraActions?: ReactNode
  pausing?: boolean
  running?: boolean
  progressNote?: string
  effective?: AiEffectiveProfile | null
  emptyHint: string
  /** 取样章数输入框的可访问名称；同一页有多个实例，故由调用方给出唯一名称 */
  sampleLabel?: string
  sampleCaption?: string
  sample?: { value: string; min: number; max: number; onChange: (value: string) => void; onBlur: () => void }
  content?: ReactNode
  footnote?: ReactNode
}) {
  const sample = props.sample
  const contentId = `ai-profile-${props.label}`
  const collapsible = Boolean(props.content)
  const progress = props.effective?.progress
  const incomplete = progress?.complete === false
  const processed = progress?.processedChapters ?? 0
  const total = progress?.totalChapters ?? 0
  const preview = incomplete ? progress?.previewContent : ''
  const taskStatus = props.effective?.memoryTask?.status
  const isRunning = props.busy || props.running || taskStatus === 'running'
  const status = props.pausing
    ? '正在暂停'
    : isRunning
    ? '分析中'
    : taskStatus === 'failed'
    ? '更新失败'
    : taskStatus === 'cancelled'
    ? '已暂停'
    : incomplete
    ? progress?.paused
      ? '已暂停'
      : '部分完成'
    : props.statusText || (props.extracted ? '已提取' : '未提取')
  // 已提取则默认收起；正文较长，展开态按需触发，与「提取一次、复看少数几次」的使用频率一致
  const [open, setOpen] = useState(false)
  const isWarningStatus = Boolean(props.statusText) || (!props.extracted && !isRunning)
  const isSuccessStatus = props.extracted && !props.statusText && !isRunning

  const heading = (
    <>
      <span className="font-semibold text-foreground tracking-tight">{props.label}</span>
      {/* 状态徽标加 aria-hidden：否则按钮的可访问名称会把两段连读成
          「风格画像已提取」（实测），既啰嗦又让「已提取/未提取」抢掉主体名。
          状态改由 aria-expanded 与展开后的内容表达，不再重复播报。 */}
      <span
        aria-hidden={collapsible || undefined}
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
          isRunning
            ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
            : isSuccessStatus
            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
            : isWarningStatus && props.extracted
            ? 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300'
            : 'border-border bg-muted/40 text-muted-foreground'
        }`}
      >
        <span
          className={`size-1.5 rounded-full ${
            isRunning
              ? 'bg-amber-600 motion-safe:animate-pulse dark:bg-amber-400'
              : isSuccessStatus
              ? 'bg-emerald-600 dark:bg-emerald-400'
              : isWarningStatus && props.extracted
              ? 'bg-amber-500 dark:bg-amber-400'
              : 'bg-muted-foreground/40'
          }`}
        />
        {status}
      </span>
    </>
  )

  return (
    <div className="ai-analysis-row grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex shrink-0 items-center gap-2.5 min-w-0">
          {collapsible ? (
            <button type="button" className="ai-profile-trigger" aria-expanded={open} aria-controls={contentId} onClick={() => setOpen((value) => !value)}>
              <ChevronRight className={`ai-profile-trigger__caret size-3.5 transition-transform duration-200 ${open ? 'rotate-90' : ''}`} aria-hidden="true" />
              {heading}
              <span className="ai-profile-trigger__hint">{open ? '收起内容' : '查看内容'}</span>
            </button>
          ) : (
            <span className="inline-flex items-center gap-2.5 text-sm font-medium" title={props.emptyHint}>
              {heading}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0 ml-auto">
          {sample && (
            <div className="ai-analysis-sample-pill shrink-0 inline-flex items-center gap-1 h-7 rounded-full border border-border/80 bg-muted/30 px-2 text-xs text-muted-foreground">
              <span className="whitespace-nowrap text-[11px] text-muted-foreground select-none">{props.sampleCaption || '每批'}</span>
              <Input
                type="number"
                min={sample.min}
                max={sample.max}
                aria-label={props.sampleLabel || '取样章数'}
                value={sample.value}
                disabled={props.busy || props.running}
                onChange={(event) => sample.onChange(event.target.value)}
                onBlur={sample.onBlur}
                className="h-5 w-7 shrink-0 rounded-none border-0 bg-transparent p-0 text-center font-semibold text-xs text-foreground shadow-none focus-visible:outline-none focus-visible:ring-0 focus-visible:bg-background/80"
              />
              <span className="whitespace-nowrap text-[11px] text-muted-foreground select-none">章</span>
            </div>
          )}
          {props.onPause && props.running && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 min-h-7 shrink-0 whitespace-nowrap rounded-full border-amber-500/40 text-amber-700 hover:bg-amber-500/10 hover:text-amber-800 dark:border-amber-400/40 dark:text-amber-300 dark:hover:bg-amber-400/10 px-2.5 text-xs font-medium transition-all"
              disabled={props.pausing}
              onClick={props.onPause}
            >
              <Pause className="size-3 mr-1" />
              {props.pausing ? '正在暂停…' : '暂停更新'}
            </Button>
          )}
          <Button
            className={cn(
              "h-7 min-h-7 shrink-0 whitespace-nowrap px-3 text-xs font-semibold rounded-full shadow-none transition-all",
              (!props.extracted || props.statusText) && !isRunning && "ai-analysis-btn-primary"
            )}
            variant="outline"
            size="sm"
            disabled={props.disabled}
            onClick={props.onAction}
          >
            {props.actionText}
          </Button>
          {props.extraActions}
        </div>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">{props.emptyHint}</p>

      {/* 错误提示 */}
      {props.effective?.memoryTask?.status === 'failed' && (
        <p role="alert" className="text-xs leading-5 text-destructive">
          后台分析未完成：{props.effective.memoryTask.error} 已保存的检查点会保留，可继续更新。
        </p>
      )}

      {props.progressNote && (
        <p role="status" className="text-xs leading-5 text-muted-foreground">
          {props.progressNote}
        </p>
      )}

      {/* 宏观分章覆盖进度条（一体化仪表卡） */}
      {incomplete && total > 0 && (
        <div className="ai-analysis-progress-card rounded-xl border border-border/80 bg-muted/20 p-3 grid gap-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 font-medium text-foreground/90">
              <span>覆盖进度</span>
              <span className="font-mono text-xs font-semibold text-primary">
                {processed} / {total} 章
              </span>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                {Math.min(100, Math.round((processed / total) * 100))}%
              </span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground text-[11.5px]">
              {isRunning && (
                <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 font-medium">
                  <span className="size-1.5 rounded-full bg-amber-500 motion-safe:animate-pulse" />
                  分析第 {Math.min(processed + 1, total)} 章中
                </span>
              )}
              <span>尚余 {Math.max(0, total - processed)} 章</span>
            </div>
          </div>

          <progress
            className="sr-only"
            aria-label={`${props.label}章节覆盖进度`}
            max={total}
            value={Math.min(processed, total)}
          />

          <div
            className="relative h-2 w-full overflow-hidden rounded-full bg-muted/60"
          >
            <div
              className={`h-full rounded-full bg-primary transition-all duration-500 ease-out ${
                isRunning ? 'ai-shimmer-active' : ''
              }`}
              style={{ width: `${Math.min(100, Math.max(3, Math.round((processed / total) * 100)))}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>尚余 {Math.max(0, total - processed)} 章；阶段内容仅供查看，完整覆盖目标后才用于续写。</span>
            <span className="hidden sm:inline">离开页面不中断 · 暂停可断点恢复</span>
          </div>
        </div>
      )}

      {/* 实时流式正文预览（微观当前步骤） */}
      {props.effective?.memoryTask?.status === 'running' && (
        <TextProgressPreview progress={props.effective.memoryTask.livePreview} />
      )}

      {/* 已保存阶段内容折叠 */}
      {preview && (
        <MotionDetails className="ai-analysis-preview">
          <summary>查看已保存的阶段内容</summary>
          <p className="text-xs leading-5 text-muted-foreground">
            截至本次目标中的第 {processed} 章 · 此内容尚未作为本次完整档案生效。
          </p>
          <ProfileText text={preview} />
        </MotionDetails>
      )}

      {/* 底部元信息 */}
      {props.effective && props.extracted && (
        <div className="flex flex-wrap items-center gap-1.5 pt-1.5 border-t border-border/40 text-xs text-muted-foreground leading-relaxed">
          <span className={props.effective.effectiveContent ? '' : 'text-amber-700 dark:text-amber-400 font-medium'}>
            {props.effective.effectiveContent ? `续写将参考：${props.effective.effectiveOrigin === 'manual' ? '人工校正版' : '自动分析版'}` : '已保存档案，当前不可用于续写；请更新或检查续写起点。'}
          </span>
          {props.effective.source?.sampleCount ? <span>· 来源 {props.effective.source.sampleCount} 章</span> : null}
          {props.effective.updatedAt ? <span>· 更新于 {new Date(props.effective.updatedAt).toLocaleString('zh-CN', { hour12: false })}</span> : null}
        </div>
      )}
      {props.content ? (
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleContent id={contentId}>
            <div className="ai-analysis-content">
              {props.effective?.effectiveOrigin === 'manual' && (
                <div>
                  <p className="mb-2 text-xs font-medium">当前用于续写的人工校正版</p>
                  <ProfileText text={props.effective.effectiveContent} />
                </div>
              )}
              <p className="text-xs font-medium">自动分析原文</p>
              {props.content}
            </div>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
      {(!incomplete || total === 0 || props.extracted) && props.footnote}
      {props.effective?.lastAttempt && <MemoryAttemptNote profile={props.effective} />}
    </div>
  )
}

export type WritingView = 'compose' | 'review' | 'outputs'

export default function AiWritingPanel(props: {
  view?: WritingView
  onViewChange?: (view: WritingView) => void
  focusBatchId?: string
  onNovelChange?: (novelId: string) => void
  onAfterChapterChange?: (chapterId: string) => void
  onViewBatch?: (batchId?: string, novelId?: string, view?: 'review' | 'outputs') => void
  onOpenGraph?: (novelId: string, afterChapterId?: string) => void
  initialNovelId?: string
  initialAfterChapterId?: string
  model?: string
} = {}) {
  const { toast } = useToast()
  const { confirm } = useConfirm()
  // AI 创作的主要使用场景是给既有小说续写；新写仍保留为并列入口，而非默认落点。
  const [mode, setMode] = useState<'new' | 'continue'>('continue')
  const [recentTasks, setRecentTasks] = useState<AiTaskInfo[]>([])
  const [novels, setNovels] = useState<AdminNovelIndexItem[]>([])
  const [novelsLoading, setNovelsLoading] = useState(true)
  const [novelsError, setNovelsError] = useState('')
  const [novelsReload, setNovelsReload] = useState(0)
  const [novelId, setNovelId] = useState('')
  const appliedRouteNovel = useRef<string | undefined>(undefined)
  const [localView, setLocalView] = useState<WritingView>('compose')
  const [localBatchId, setLocalBatchId] = useState<string>()
  const view = props.view ?? localView
  function changeView(next: WritingView) {
    setLocalBatchId(undefined)
    setLocalView(next)
    props.onViewChange?.(next)
  }
  function openDrafts(batchId?: string, targetNovelId = novelId, nextView: 'review' | 'outputs' = 'review') {
    setLocalBatchId(batchId)
    setLocalView(nextView)
    if (targetNovelId !== novelId) setNovelId(targetNovelId)
    props.onViewBatch?.(batchId, targetNovelId, nextView)
  }
  function selectNovel(id: string) {
    setNovelId(id)
    setLocalBatchId(undefined)
    props.onNovelChange?.(id)
  }
  const initialGraphAnchor = useRef({ novelId: props.initialNovelId, chapterId: props.initialAfterChapterId })
  const [title, setTitle] = useState('')
  const [requestProgress, setRequestProgress] = useState<{ kind: string; value: AiTextProgress } | null>(null)
  const [memoryLive, setMemoryLive] = useState<Record<string, AiTextProgress | null>>({})
  const [chapterTitle, setChapterTitle] = useState('')
  const [analysisDialogOpen, setAnalysisDialogOpen] = useState(false)
  const draftKey = `${novelId}:${mode}`
  const [instructions, setInstructions] = useState<Record<string, string>>({})
  const instruction = instructions[draftKey] || ''
  const setInstruction = (value: string) => setInstructions((previous) => ({ ...previous, [draftKey]: value }))
  const [novelOutlines, setNovelOutlines] = useState<Record<string, string>>({})
  const [novelUseOutline, setNovelUseOutline] = useState<Record<string, boolean>>({})
  const outline = novelOutlines[draftKey] || ''
  const useOutline = novelUseOutline[draftKey] ?? true
  /** 协同台当前标签页：大纲推演 vs 灵感候选 */
  const [deckOpen, setDeckOpen] = useState(false)
  const [deckTab, setDeckTab] = useState<'outline' | 'suggestions'>('outline')

  const setOutline = useCallback(
    (val: string | ((prev: string) => string)) => {
      setNovelOutlines((previous) => ({ ...previous, [draftKey]: typeof val === 'function' ? val(previous[draftKey] || '') : val }))
    },
    [draftKey],
  )

  const setUseOutline = useCallback(
    (val: boolean) => {
      setNovelUseOutline((all) => ({ ...all, [draftKey]: val }))
    },
    [draftKey],
  )
  useEffect(() => {
    // 只在作品／模式切换时恢复；输入期间由编辑器直接更新，不覆盖未提交内容。
    const remembered = novelOutlines[draftKey] || ''
    setDeckOpen(Boolean(remembered.trim()))
    setDeckTab('outline')
  }, [draftKey])
  /** 目标字数与章节数的文字态/数值态分离：编辑期允许为空，失焦或提交时归一化。
   *  目标字数的数值本身只在提交时通过 commit() 取用（展示走 text），故不单独解构 value。
   *  章数的数值参与 UI 判断（批量确认阈值、大纲章数对比），需要保留。 */
  const targetWordsInput = useEditableNumber(2000, 300, 30000)
  const chapterCountInput = useEditableNumber(1, 1, 20)
  const chapterCount = chapterCountInput.value
  const [busy, setBusy] = useState(false)
  /** 当前创作后台任务；null 表示未启动过 */
  const [task, setTask] = useState<AiTaskInfo | null>(null)
  /** 选中小说的未发布续写草稿数：续写上下文只取已发布章节，草稿积压会导致剧情断档 */
  const [pendingDrafts, setPendingDrafts] = useState(0)
  /** 续写起点：选中小说的章节列表（倒序）与选定的起点章节 id，空串表示从最新章节续写 */
  const [chapterOptions, setChapterOptions] = useState<Array<{ value: string; label: string }>>([])
  const [briefs, setBriefs] = useState<Record<string, AiWritingBrief>>({})
  const [materialPreview, setMaterialPreview] = useState<{ revision: string; key: string } | null>(null)
  const [afterChapterId, setAfterChapterId] = useState('')
  /** 选中小说的风格画像（已提取则展示，续写时自动注入 system prompt） */
  const [styleProfile, setStyleProfile] = useState('')
  /**
   * 三份画像的完整回包。除了原文，还带人工校正层与基准版本号：
   * 人工校正必须回传 baseProfileRevision，且「已保存」与「正在生效」是两回事，
   * 所以不能只存一个字符串。
   */
  const [styleEffective, setStyleEffective] = useState<AiEffectiveProfile | null>(null)
  const [styleBusy, setStyleBusy] = useState(false)
  /** 选中小说的情节状态（已提取则展示，续写时自动注入 user 消息） */
  const [plotState, setPlotState] = useState('')
  const [plotEffective, setPlotEffective] = useState<AiEffectiveProfile | null>(null)
  const [plotChaptersThrough, setPlotChaptersThrough] = useState(0)
  const [plotChapterCount, setPlotChapterCount] = useState(0)
  const [plotBusy, setPlotBusy] = useState(false)
  const plotSampleInput = useEditableNumber(8, 1, 30)
  const [plotPausing, setPlotPausing] = useState(false)
  const [relationshipPausing, setRelationshipPausing] = useState(false)
  /** 选中小说的关系画像（已提取则展示，续写时自动注入 system prompt） */
  const [relationshipProfile, setRelationshipProfile] = useState('')
  const [relationshipEffective, setRelationshipEffective] = useState<AiEffectiveProfile | null>(null)
  const [relationshipBusy, setRelationshipBusy] = useState(false)
  const relationshipSampleInput = useEditableNumber(10, 1, 30)
  /** 情节方向候选：想不出写什么时先取候选，选中一条填入创作要求。 */
  const [suggestions, setSuggestions] = useState<Array<{ direction: string; effect: string }>>([])
  const [suggestBusy, setSuggestBusy] = useState(false)
  const [savedPlotTimeout] = useState(() => {
    try { return normalizePlotTimeoutSeconds(JSON.parse(localStorage.getItem('zz-ai-plot-timeout-seconds') || 'null')) }
    catch { return normalizePlotTimeoutSeconds(undefined) }
  })
  const plotTimeoutInput = useEditableNumber(savedPlotTimeout, PLOT_TIMEOUT_MIN_SECONDS, PLOT_TIMEOUT_MAX_SECONDS)
  function commitPlotTimeout() {
    const seconds = plotTimeoutInput.commit()
    try { localStorage.setItem('zz-ai-plot-timeout-seconds', String(seconds)) } catch { /* storage unavailable */ }
    return seconds
  }
  /**
   * 最近一次由候选填入的内容，以及被它替换掉的原文。
   * 点一条候选会整段覆盖创作要求，此前没有回退手段——用户手写的草稿点错一下就没了。
   * 记录替换前的原文，提供一个「撤销填入」，让这个动作可逆。
   */
  const [suggestionFill, setSuggestionFill] = useState<{ applied: string; previous: string } | null>(null)
  /**
   * 候选列表的展开 / 收起。
   * 收起只隐藏列表，不清空已取回的数据 —— 此前「收起」直接 setSuggestions([])，
   * 右列随即退回「这里会列出可直接填入的续写方向」的空态，与用户刚取回候选的
   * 事实相矛盾；想再看只能重新点「推荐情节」，等于为一个已经拿到的结果重复付费。
   */
  const [suggestCollapsed, setSuggestCollapsed] = useState(false)
  const [focus, setFocus] = useState('')
  /** 用选中的情节方向生成多章大纲。 */
  const [outlineBusy, setOutlineBusy] = useState(false)
  useEffect(() => {
    if (outlineBusy || suggestBusy || suggestions.length > 0) setDeckOpen(true)
  }, [outlineBusy, suggestBusy, suggestions.length])
  /** 作者本次任务的成人内容参数；不传时后端按关闭处理，与旧客户端行为一致。 */
  const [adultContentMode, setAdultContentMode] = useState<'off' | 'explicit'>('off')
  const [consentRuleTier, setConsentRuleTier] = useState<'default' | 'fictional_nonconsent'>('default')
  // 初始读取与手动重新提取可能并发；只让每类画像最新一轮请求更新页面。
  const styleRequestVersion = useRef(0)
  const plotRequestVersion = useRef(0)
  const relationshipRequestVersion = useRef(0)
  /**
   * 候选请求序号：只让最后一次请求的结果生效。
   * 切书后旧书的响应可能才回来，若无守卫会把上一部的方向写进新书的候选列表；
   * 手动连点「推荐情节」同理，先发的慢响应不该覆盖后发的。
   */
  const suggestionSeq = useRef(0)
  const outlineSeq = useRef(0)
  useEffect(() => {
    // 作品、模式或承接位置改变后，旧请求不能回写到新的构思中。
    suggestionSeq.current++
    outlineSeq.current++
    setOutlineBusy(false)
    setRequestProgress(null)
    setSuggestions([])
    setSuggestionFill(null)
    setSuggestBusy(false)
    setOutlineBusy(false)
  }, [draftKey, afterChapterId])
  /** 自增即触发整组画像重读：人工校正保存/删除后，需要拿到新的基准版本与修订号 */
  const [profileReloadToken, setProfileReloadToken] = useState(0)
  const taskActive = !!task && (task.status === 'queued' || task.status === 'running')
  const isContinuationMode = mode === 'continue'
  const isMultiChapter = isContinuationMode && chapterCount > 1
  const selectedNovel = novels.find((novel) => novel.id === novelId)
  const selectedNovelTitle = selectedNovel?.title || ''
  const activeProfileLabels = [
    styleEffective?.effectiveContent ? '文风画像' : null,
    mode === 'continue' && relationshipEffective?.effectiveContent ? '关系画像' : null,
    mode === 'continue' && plotEffective?.effectiveContent ? '情节状态' : null,
  ].filter((value): value is string => Boolean(value))
  const memoryStatus = (effective: AiEffectiveProfile | null) => {
    if (effective?.eligibility === 'rebuilding') return '待重建'
    if (effective?.eligibility === 'legacy_unknown') return '待初始化'
    if (effective?.eligibility === 'stale') return '待更新'
    if (effective?.eligibility === 'source_changed') return '正文已变化'
    if (effective?.eligibility === 'beyond_anchor') return '晚于当前起点'
    return undefined
  }

  useEffect(() => {
    let active = true
    setNovelsLoading(true)
    setNovelsError('')
    void loadAdminNovelIndex('', () => active)
      .then((items) => { if (active) setNovels(items) })
      .catch((err) => { if (active) setNovelsError((err as Error).message || '书目加载失败') })
      .finally(() => { if (active) setNovelsLoading(false) })
    return () => { active = false }
  }, [novelsReload])

  // URL 往返更新所选作品；同一作品内切换审阅不会覆盖编辑中的输入。
  useEffect(() => {
    const id = props.initialNovelId?.trim() || ''
    if (appliedRouteNovel.current === id || novelsLoading || novelsError) return
    appliedRouteNovel.current = id
    if (!id || novels.some((novel) => novel.id === id)) setNovelId(id)
  }, [novels, novelsLoading, novelsError, props.initialNovelId])

  useEffect(() => {
    initialGraphAnchor.current = { novelId: props.initialNovelId, chapterId: props.initialAfterChapterId }
    if (novelId === (props.initialNovelId || '')) setAfterChapterId(props.initialAfterChapterId || '')
  }, [props.initialNovelId, props.initialAfterChapterId, novelId])

  // 挂载时恢复正在运行的创作任务：切换 tab 回来后进度不丢
  useEffect(() => {
    let cancelled = false
    aiApi
      .tasks({ limit: 20 })
      .then((result) => {
        if (cancelled) return
        setRecentTasks(result.items.filter((item) => WRITING_TASK_KINDS.has(item.kind)).slice(0, 3))
        const running = result.items.find((item) => WRITING_TASK_KINDS.has(item.kind) && (item.status === 'queued' || item.status === 'running'))
        if (running) setTask((prev) => prev ?? running)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  /**
   * 按类型读取画像。人工校正保存/删除、以及重新提取之后都要重读（拿新的基准版本号），
   * 但只重读受影响的那一种 —— 三种一起读会把无关的慢请求变成别人的等待。
   * 用 useCallback 固定身份：它只依赖 setState 与 ref（都稳定），
   * 否则下面的 effect 每渲染一次就会重跑一次。
   */
  const loadProfile = useCallback(async (kind: 'style' | 'plot' | 'relationship', id: string, cancelled: () => boolean) => {
    if (kind === 'style') {
      const version = ++styleRequestVersion.current
      const res = await aiApi.writing.getStyleProfile(id).catch(() => null)
      if (!res || cancelled() || version !== styleRequestVersion.current) return
      setStyleProfile(res.profile || '')
      setStyleEffective(res)
      return
    }
    if (kind === 'plot') {
      const version = ++plotRequestVersion.current
      const res = await aiApi.writing.getPlotState(id).catch(() => null)
      if (!res || cancelled() || version !== plotRequestVersion.current) return
      setPlotState(res.state || '')
      setPlotEffective(res)
      if (!memoryRunning(res)) setPlotPausing(false)
      setPlotChaptersThrough(res.chaptersThrough || 0)
      setPlotChapterCount(res.chapterCount || 0)
      return
    }
    const version = ++relationshipRequestVersion.current
    const res = await aiApi.writing.getRelationshipProfile(id).catch(() => null)
    if (!res || cancelled() || version !== relationshipRequestVersion.current) return
    setRelationshipProfile(res.profile || '')
    setRelationshipEffective(res)
    if (!memoryRunning(res)) setRelationshipPausing(false)
  }, [])

  /**
   * 只同步人工校正所需的元数据（baseProfileRevision / manualOverride / effectiveOrigin），
   * 不动画像正文。重新提取后用：正文以 POST 回包为准，第二次 GET 只为拿新基准版本号，
   * 若让它连正文一起写回，反而可能用一次更早发起的读取盖掉刚提取出来的结果。
   */
  const syncEffective = useCallback(async (kind: 'style' | 'plot' | 'relationship', id: string) => {
    if (kind === 'style') {
      const version = styleRequestVersion.current
      const res = await aiApi.writing.getStyleProfile(id).catch(() => null)
      if (res && version === styleRequestVersion.current) setStyleEffective(res)
      return
    }
    if (kind === 'plot') {
      const version = plotRequestVersion.current
      const res = await aiApi.writing.getPlotState(id).catch(() => null)
      if (res && version === plotRequestVersion.current) {
        setPlotEffective(res)
        setPlotChaptersThrough(res.chaptersThrough || 0)
        setPlotChapterCount(res.chapterCount || 0)
      }
      return
    }
    const version = relationshipRequestVersion.current
    const res = await aiApi.writing.getRelationshipProfile(id).catch(() => null)
    if (res && version === relationshipRequestVersion.current) setRelationshipEffective(res)
  }, [])

  /** 切书时把三份画像一次读全。 */
  const loadAllProfiles = useCallback(
    async (id: string, cancelled: () => boolean) => {
      await Promise.all([loadProfile('style', id, cancelled), loadProfile('plot', id, cancelled), loadProfile('relationship', id, cancelled)])
    },
    [loadProfile],
  )
  const loadChapterOptions = useCallback(async (id: string, cancelled: () => boolean) => {
    try {
      const res = await chaptersApi.list(id)
      if (cancelled()) return
      const options = [...res.chapters]
        .sort((a, b) => (b.order || 0) - (a.order || 0))
        .map((chapter) => ({ value: chapter.id, label: `第 ${chapter.order} 章${chapter.title ? ` ${chapter.title}` : ''}` }))
      setChapterOptions([{ value: '', label: '从最新章节续写（默认）' }, ...options])
    } catch {
      if (!cancelled()) setChapterOptions([])
    }
  }, [])
  const previousView = useRef(view)
  useEffect(() => {
    const returning = previousView.current !== 'compose' && view === 'compose'
    previousView.current = view
    if (!returning || !novelId) return
    let cancelled = false
    // 审阅期间可能发布了章节；返回构思时只刷新基线材料，保留情节、候选与大纲。
    void loadChapterOptions(novelId, () => cancelled)
    void loadAllProfiles(novelId, () => cancelled)
    return () => { cancelled = true }
  }, [view, novelId, loadAllProfiles, loadChapterOptions])

  const memoryTaskIds = [plotEffective?.memoryTask, relationshipEffective?.memoryTask].filter((task) => task && ['queued', 'running'].includes(task.status)).map((task) => task!.id).sort().join(',')
  useEffect(() => {
    let active = true
    const stops = memoryTaskIds.split(',').filter(Boolean).map((id) => watchAiTask(id, (task) => {
      setMemoryLive((current) => ({ ...current, [id]: parseAiTextProgress(task.result) }))
      if (!['queued', 'running'].includes(task.status)) void loadProfile(task.kind === 'plot_state' ? 'plot' : 'relationship', novelId, () => !active)
    }))
    return () => { active = false; stops.forEach((stop) => stop()) }
  }, [memoryTaskIds, novelId, loadProfile])

  // 后台任务独立执行；刷新页面只恢复观察，不再由浏览器驱动付费批次。
  useEffect(() => {
    if (!novelId) return
    let cancelled = false
    let polling = false
    const timer = window.setInterval(() => {
      if (polling) return
      polling = true
      // 状态读取不递增提交版本，避免旧轮询覆盖刚提交的新任务。
      const poll = async (kind: 'plot' | 'relationship') => {
        const versionRef = kind === 'plot' ? plotRequestVersion : relationshipRequestVersion
        const version = versionRef.current
        const res = await (kind === 'plot' ? aiApi.writing.getPlotState(novelId) : aiApi.writing.getRelationshipProfile(novelId)).catch(() => null)
        if (!res || cancelled || version !== versionRef.current) return
        const setEffective = kind === 'plot' ? setPlotEffective : setRelationshipEffective
        setEffective(res)
        if ('state' in res) {
          setPlotState(res.state || '')
          setPlotChaptersThrough(res.chaptersThrough || 0)
          setPlotChapterCount(res.chapterCount || 0)
          if (!memoryRunning(res)) setPlotPausing(false)
        } else {
          setRelationshipProfile(res.profile || '')
          if (!memoryRunning(res)) setRelationshipPausing(false)
        }
      }
      void Promise.all([
        !plotBusy && memoryRunning(plotEffective) ? poll('plot') : undefined,
        !relationshipBusy && memoryRunning(relationshipEffective) ? poll('relationship') : undefined,
      ]).finally(() => { polling = false })
    }, 10000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [novelId, plotBusy, relationshipBusy, memoryRunning(plotEffective), memoryRunning(relationshipEffective)])

  // 选中小说后加载章节列表（倒序），用于选择续写起点
  useEffect(() => {
    setAfterChapterId(novelId === initialGraphAnchor.current.novelId ? initialGraphAnchor.current.chapterId || '' : '')
    // 切书（包括清空选择）立即作废上一部小说的所有在途画像请求。
    let cancelled = false
    // 候选属于某一部小说：切到另一部必须清掉，否则 A 书的方向会留在右列，
    // 而标题仍写「点一条填入左侧创作要求」，用户会以为这是 B 书的方向。
    // 与封面页切书清空候选同理，且一并递增序号，挡住在途响应回写。
    suggestionSeq.current++
    outlineSeq.current++
    setOutlineBusy(false)
    setRequestProgress(null)
    setSuggestions([])
    setSuggestionFill(null)
    setSuggestCollapsed(false)
    // 忙碌态必须在这里一并归零：在途请求返回时 finally 的守卫会拦住它的
    // setSuggestBusy(false)（序号已对不上），不重置的话按钮会永久停在「推荐中…」。
    // 新书此时并没有在途的候选请求，归零是安全的。
    setSuggestBusy(false)
    setPlotBusy(false)
    setStyleBusy(false)
    setRelationshipBusy(false)
    setPlotPausing(false)
    setRelationshipPausing(false)
    if (!novelId) {
      setChapterOptions([])
      setStyleProfile('')
      setStyleEffective(null)
      setPlotState('')
      setPlotEffective(null)
      setPlotChaptersThrough(0)
      setPlotChapterCount(0)
      setRelationshipProfile('')
      setRelationshipEffective(null)
      // 递增版本号，令在途请求的结果被丢弃
      styleRequestVersion.current++
      plotRequestVersion.current++
      relationshipRequestVersion.current++
      return
    }
    void loadChapterOptions(novelId, () => cancelled)
    void loadAllProfiles(novelId, () => cancelled)
    const memoryRequestVersions = [plotRequestVersion, relationshipRequestVersion]
    return () => {
      cancelled = true
      for (const version of memoryRequestVersions) version.current++
    }
  }, [novelId, loadAllProfiles, loadChapterOptions])

  // 人工校正变更后重读画像：只刷新画像，不动续写起点与章节列表
  useEffect(() => {
    if (!novelId || profileReloadToken === 0) return
    let cancelled = false
    void loadAllProfiles(novelId, () => cancelled)
    return () => {
      cancelled = true
    }
  }, [novelId, profileReloadToken, loadAllProfiles])

  // 统计选中小说的未发布续写草稿；任务结束后刷新（新草稿刚落库）
  const taskStatus = task?.status || ''
  useEffect(() => {
    if (!novelId) {
      setPendingDrafts(0)
      return
    }
    let cancelled = false
    aiApi
      .generations({ scope: 'writing', status: 'draft', limit: 100 })
      .then((res) => {
        if (cancelled) return
        setPendingDrafts(res.items.filter((item) => item.kind === 'continue' && item.novelId === novelId).length)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [novelId, taskStatus, view])

  // Subscribe to progress; reconnects recover persisted snapshots without resubmitting.
  const streamingTaskId = task && ['queued', 'running'].includes(task.status) ? task.id : ''
  useEffect(() => {
    if (!streamingTaskId) return
    return watchAiTask(streamingTaskId, (next) => {
      setTask(next)
      if (next.status === 'completed') toast(`${taskKindLabel(next.kind)}生成完成，草稿已保存，可在“草稿审阅”查看`, 'success')
      else if (next.status === 'failed') toast(next.error || 'AI 生成失败', 'error')
    })
  }, [streamingTaskId, toast])

  /** 启动后台任务并挂上进度轮询。 */
  async function startTask(start: () => Promise<{ taskId: string }>, startedMessage: string) {
    setBusy(true)
    try {
      const res = await start()
      const { task: created } = await aiApi.task(res.taskId)
      setTask(created)
      toast(startedMessage, 'success')
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  async function generateOutline() {
    if (!title.trim()) return toast('请填写作品标题', 'error')
    // 提交前归一化：用户可能没触发失焦就点了按钮，文字态里的值必须先落成合法数值
    const words = targetWordsInput.commit()
    const count = chapterCountInput.commit()
    await startTask(
      () => aiApi.writing.outline({ novelId, title, instruction, targetWords: words, chapterCount: count, operationId: newOperationId('ai-writing-outline') }),
      '大纲生成已开始，完成后在“草稿审阅”查看',
    )
  }

  /**
   * 组装本次任务的成人内容参数。
   * 关闭模式一律回传 off，由后端归一化为默认值；开启模式按作者本次选定的
   * 同意规则档位下发，不再在生成前插入额外的确认卡点。
   */
  function buildContentPreferences() {
    if (adultContentMode !== 'explicit') {
      return { version: 1, adultContentMode: 'off', intimacyWeight: 'none', adultCharactersConfirmed: false }
    }
    return {
      version: 1,
      adultContentMode: 'explicit',
      intimacyWeight: 'high',
      adultCharactersConfirmed: true,
      consentRuleTier,
    }
  }

  async function generateChapter() {
    if (!novelId || !chapterTitle.trim()) return toast('请选择小说并填写章节标题', 'error')
    const words = targetWordsInput.commit()
    const count = chapterCountInput.commit()
    await startTask(
      () =>
        aiApi.writing.chapter({
          novelId,
          title,
          outline,
          instruction,
          targetWords: words,
          chapterCount: count,
          contentPreferences: buildContentPreferences(),
          writingBrief: currentWritingBrief,
          operationId: newOperationId('ai-writing-chapter'),
        }),
      '章节生成已开始，完成后在“草稿审阅”查看',
    )
  }

  async function continueNovel() {
    if (!novelId) return toast('请选择小说', 'error')
    const words = targetWordsInput.commit()
    const count = chapterCountInput.commit()
    const effectiveOutline = useOutline && outline.trim() ? outline.trim() : undefined
    // 批量续写是连续 N 次模型调用，超过阈值先确认，避免误触烧钱
    if (count > CONFIRM_CHAPTER_COUNT) {
      const ok = await confirm({
        title: `批量续写 ${count} 章？`,
        message: `将按顺序连续调用 AI ${count} 次（每章一次），生成期间可随时取消，已生成章节会保留为草稿。`,
        okText: '开始续写',
        cancelText: '取消',
      })
      if (!ok) return
    }
    await startTask(
      () =>
        aiApi.writing.continue({
          novelId,
          title: chapterTitle,
          instruction,
          targetWords: words,
          chapterCount: count,
          contentPreferences: buildContentPreferences(),
          writingBrief: currentWritingBrief,
          ...(materialPreview?.key === materialKey ? { materialRevision: materialPreview.revision } : {}),
          ...(effectiveOutline ? { outline: effectiveOutline } : {}),
          ...(afterChapterId ? { afterChapterId } : {}),
          operationId: newOperationId('ai-writing-continue'),
        }),
      '续写任务已开始，完成后在“草稿审阅”查看',
    )
  }

  async function refreshStyleProfile() {
    if (!novelId) return toast('请选择小说', 'error')
    const version = ++styleRequestVersion.current
    setStyleBusy(true)
    try {
      setRequestProgress(null)
      const res = await aiApi.writing.refreshStyleProfile(novelId, (value) => { if (version === styleRequestVersion.current) setRequestProgress({ kind: '风格画像', value }) })
      // 用 POST 回包立刻更新界面：提取结果是权威内容，不该等第二次 GET 才显示
      if (version !== styleRequestVersion.current) return
      setStyleProfile(res.profile)
      toast('风格画像已更新，后续续写将自动套用', 'success')
      // 再同步基准版本号：重新提取会改变 baseProfileRevision，人工校正的基准随之失效，
      // 不同步的话校正编辑器会拿着旧基准去保存（必然 409）。只补元数据、不覆盖正文。
      await syncEffective('style', novelId)
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      if (version === styleRequestVersion.current) { setStyleBusy(false); setRequestProgress(null) }
    }
  }

  /** 取情节方向候选。开启成人内容模式时后端会给出以成人场景为主体的方向。 */
  async function loadSuggestions() {
    if (!novelId) return toast('请选择小说', 'error')
    const seq = ++suggestionSeq.current
    const requestedNovelId = novelId
    setSuggestBusy(true)
    setDeckTab('suggestions')
    setSuggestCollapsed(false)
    setRequestProgress(null)
    try {
      const res = await aiApi.writing.plotSuggestions({
        novelId,
        timeoutSeconds: commitPlotTimeout(),
        ...(afterChapterId ? { afterChapterId } : {}),
        ...(focus.trim() ? { focus: focus.trim() } : {}),
        contentPreferences: buildContentPreferences(),
        writingBrief: currentWritingBrief,
      }, (value) => { if (seq === suggestionSeq.current) setRequestProgress({ kind: '情节方向', value }) })
      // 期间切了书或又发起了新一轮：这一份已过期，丢弃而不是写进当前页面
      if (seq !== suggestionSeq.current || requestedNovelId !== novelId) return
      setSuggestions(res.suggestions)
      // 取回新一批就展开：用户刚点过按钮，期待看到结果
      setSuggestCollapsed(false)
      if (!res.suggestions.length) toast('未返回可用的情节方向', 'error')
    } catch (err) {
      if (seq !== suggestionSeq.current) return
      toast((err as Error).message, 'error')
    } finally {
      if (seq === suggestionSeq.current) setRequestProgress(null)
      if (seq === suggestionSeq.current) setSuggestBusy(false)
    }
  }

  /**
   * 按当前章节数生成多章大纲，填进大纲框。
   * 大纲会被后端按章拆分后逐章下发，因此要按「第N章」逐段给出。
   */
  async function generateOutlineForContinuation(overrideDirection?: string) {
    if (!novelId) return toast('请选择小说', 'error')
    const seq = ++outlineSeq.current
    const direction = (overrideDirection ?? instruction).trim()
    setOutlineBusy(true)
    setDeckTab('outline')
    setSuggestCollapsed(false)
    setRequestProgress(null)
    try {
      const res = await aiApi.writing.plotSuggestions({
        novelId,
        timeoutSeconds: commitPlotTimeout(),
        chapterCount,
        ...(afterChapterId ? { afterChapterId } : {}),
        ...(focus.trim() ? { focus: focus.trim() } : {}),
        // 创作要求里往往就是「推荐情节」里选定的那一条，或作者手写的剧情设想
        ...(direction ? { plotDirection: direction } : {}),
        contentPreferences: buildContentPreferences(),
        writingBrief: currentWritingBrief,
      }, (value) => { if (seq === outlineSeq.current) setRequestProgress({ kind: '分章大纲', value }) })
      if (seq !== outlineSeq.current) return
      if (!res.outline) return toast('未返回可用的大纲', 'error')
      setOutline(res.outline)
      setUseOutline(true)
      const parsed = countOutlineChapters(res.outline)
      toast(
        parsed >= chapterCount
          ? `已生成 ${parsed} 章大纲，已启用为续写大纲`
          : `已生成 ${parsed} 章大纲，不足 ${chapterCount} 章，建议补足或调小续写章数`,
        parsed >= chapterCount ? 'success' : 'error',
      )
    } catch (err) {
      if (seq !== outlineSeq.current) return
      toast((err as Error).message, 'error')
    } finally {
      if (seq === outlineSeq.current) setRequestProgress(null)
      if (seq === outlineSeq.current) setOutlineBusy(false)
    }
  }

  async function pauseMemory(kind: 'plot' | 'relationship') {
    if (kind === 'plot' ? plotPausing : relationshipPausing) return
    const requestVersion = kind === 'plot' ? plotRequestVersion : relationshipRequestVersion
    const version = requestVersion.current
    const setPausing = kind === 'plot' ? setPlotPausing : setRelationshipPausing
    setPausing(true)
    try {
      await aiApi.writing.pauseMemory(novelId, kind)
    } catch (err) {
      if (version === requestVersion.current) {
        setPausing(false)
        toast(`暂停请求失败：${(err as Error).message}，请重试`, 'error')
      }
    }
  }

  function memoryProgressNote(profile: AiEffectiveProfile | null, pausing: boolean, active = false) {
    if (pausing) return '正在取消当前请求，已完成的检查点会保留；继续时重新处理未完成批次。'
    const progress = profile?.progress
    if (!progress || progress.complete !== false) return memoryRunning(profile) ? '后台分析中，正在校验正文并处理章节；离开页面后仍会继续。' : undefined
    const running = active || memoryRunning(profile)
    return `${running ? '更新中' : progress.paused ? '已暂停' : '可继续'} · 已保存 ${progress.processedChapters} / ${progress.totalChapters} 章。${running ? '正在分析后续章节，可请求暂停当前更新。' : '继续时会校验正文，并从有效检查点恢复。'}`
  }

  async function startMemoryTask(kind: 'plot' | 'relationship') {
    if (!novelId) return toast('请选择小说', 'error')
    const requestVersion = kind === 'plot' ? plotRequestVersion : relationshipRequestVersion
    const version = ++requestVersion.current
    const setBusy = kind === 'plot' ? setPlotBusy : setRelationshipBusy
    const setPausing = kind === 'plot' ? setPlotPausing : setRelationshipPausing
    const setEffective = kind === 'plot' ? setPlotEffective : setRelationshipEffective
    const profile = kind === 'plot' ? plotEffective : relationshipEffective
    const target = afterChapterId || (profile?.progress?.complete === false ? profile.progress.targetChapterId : undefined)
    setBusy(true)
    setPausing(false)
    try {
      const sampleChapters = kind === 'plot' ? plotSampleInput.commit() : relationshipSampleInput.commit()
      const res = await aiApi.writing.startMemoryTask(novelId, kind, sampleChapters, target)
      if (version !== requestVersion.current) return
      setEffective((previous) => ({
        ...(previous || { eligibility: 'missing', isOlderThanAnchor: false, effectiveContent: '', effectiveOrigin: 'none', baseProfileRevision: '' }),
        memoryTask: res.task,
      }))
      // A cache hit or a reused task may already be terminal before the acknowledgement arrives.
      if (res.task.status !== 'queued' && res.task.status !== 'running') {
        const latest = await (kind === 'plot' ? aiApi.writing.getPlotState(novelId) : aiApi.writing.getRelationshipProfile(novelId))
        if (version !== requestVersion.current) return
        setEffective(latest)
        if ('state' in latest) {
          setPlotState(latest.state || '')
          setPlotChaptersThrough(latest.chaptersThrough || 0)
          setPlotChapterCount(latest.chapterCount || 0)
        } else setRelationshipProfile(latest.profile || '')
      }
      if (res.task.status === 'failed') toast(res.task.error || '后台分析未完成，请查看错误详情', 'error')
      else toast(res.task.status === 'completed' ? '分析已完成，档案已刷新。' : res.task.status === 'cancelled' ? '分析已暂停，检查点已保留。' : '已提交后台分析，离开页面后仍会继续，可随时返回查看或暂停。', 'success')
    } catch (err) {
      if (version === requestVersion.current) toast((err as Error).message, 'error')
    } finally {
      if (version === requestVersion.current) setBusy(false)
    }
  }

  const refreshPlotState = () => startMemoryTask('plot')
  const refreshRelationshipProfile = () => startMemoryTask('relationship')

  async function cancelTask() {
    if (!task) return
    const ok = await confirm({
      title: '终止 AI 创作任务？',
      message: '已生成的草稿和用量记录会保留，未完成的后续章节不会继续生成。',
      items: [`操作目标：${task.id}`],
      okText: '终止任务',
      cancelText: '取消',
      danger: true,
    })
    if (!ok) return
    try {
      await aiApi.cancelTask(task.id, newOperationId('ai-task-cancel'))
      const { task: next } = await aiApi.task(task.id)
      setTask(next)
      toast('任务已取消', 'success')
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  /** 内容边界收在上下文区域；折叠标题持续展示真实生效状态。 */
  const continuationContentScale =
    mode === 'continue' ? (
      <section className="ai-writing-content-scope mt-3.5 pt-3.5 border-t border-border/60" aria-labelledby="ai-writing-content-scope-title">
        <div className="ai-writing-section-heading flex items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-2">
            <h3 id="ai-writing-content-scope-title" className="text-xs font-semibold text-foreground">
              内容尺度
            </h3>
            <span className="text-[11px] text-muted-foreground hidden sm:inline">
              影响续写正文与情节推荐方向
            </span>
          </div>
          <AdminStatusBadge tone={adultContentMode === 'explicit' ? 'accent' : 'muted'} className="text-[10px]">
            {adultContentMode === 'explicit' ? 'R18 已启用' : '常规内容'}
          </AdminStatusBadge>
        </div>
        <label className="ai-writing-content-scope__toggle">
          <span className="min-w-0">
            <span className="block text-xs font-medium text-foreground">开启露骨 R18 模式</span>
            <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
              开启后以成人场景为章节主体；推荐情节也会按相同尺度提供方向。
            </span>
          </span>
          <Switch
            checked={adultContentMode === 'explicit'}
            disabled={busy || taskActive}
            onCheckedChange={(checked) => {
              setAdultContentMode(checked ? 'explicit' : 'off')
            }}
          />
        </label>
        {adultContentMode === 'explicit' && (
          <div className="ai-writing-consent grid gap-2 mt-2.5">
            <div className="grid gap-1.5">
              <Label id="ai-writing-consent-tier-label" className="text-xs">
                同意规则档位
              </Label>
              <SearchSelect
                options={[
                  { value: 'default', label: '严格（默认，适用于绝大多数作品）' },
                  { value: 'fictional_nonconsent', label: '虚构题材分级（原作主线即含强迫/下药等情节时使用）' },
                ]}
                value={consentRuleTier}
                onChange={(value) => setConsentRuleTier(value as 'default' | 'fictional_nonconsent')}
                className={styles.contextSelect}
                aria-labelledby="ai-writing-consent-tier-label"
              />
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                放宽档只适用于原作主线本身涉及对应题材且角色均为成年人的情况；它不解除成年前提。
              </p>
            </div>
          </div>
        )}
      </section>
    ) : null

  const continuationAnalysisDialog = (
    <Dialog open={analysisDialogOpen} onOpenChange={setAnalysisDialogOpen}>
      <DialogFrame size="wide" className={cn(styles.analysis, 'sm:max-w-[780px] max-h-[85vh] flex flex-col p-0')}>
        <DialogHeader className="shrink-0">
          <DialogTitle id="ai-writing-analysis-title">
            续写档案
          </DialogTitle>
          <DialogDescription>
            用于续写的完整档案保存在本书中。展开可查看内容与人工校正。
          </DialogDescription>
          {props.onOpenGraph && (
            <Button
              variant="ghost"
              size="sm"
              className="absolute left-4 top-4 h-7 px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
              disabled={!novelId}
              onClick={() => {
                setAnalysisDialogOpen(false)
                props.onOpenGraph?.(novelId, afterChapterId || undefined)
              }}
            >
              <Network className="size-3.5" />
              故事图谱
            </Button>
          )}
        </DialogHeader>

        <DialogBody className="px-6 py-4 overflow-y-auto space-y-4">
          <Button asChild variant="outline"><Link onClick={() => setAnalysisDialogOpen(false)} to={`/admin/ai?sub=analysis&novel=${encodeURIComponent(novelId)}`}>阅读独立分析报告</Link></Button>
          <div className="ai-writing-profile-list space-y-3">
            <ProfileSection
              label="风格画像"
              key={`style-${novelId}`}
              effective={styleEffective}
              statusText={memoryStatus(styleEffective)}
              extracted={!!styleProfile}
              busy={styleBusy}
              disabled={busy || styleBusy || taskActive || !novelId}
              actionText={styleBusy ? '提取中…' : styleProfile ? '重新提取' : '提取风格画像'}
              onAction={() => void refreshStyleProfile()}
              emptyHint="分析最近最多 5 章的句式、叙事节奏、对话与表达边界，让续写延续原作文风。"
              content={
                styleProfile ? (
                  <>
                    <ProfileText text={styleProfile} />
                    {styleEffective && (
                      <ProfileOverrideEditor
                        novelId={novelId}
                        kind="style"
                        effective={styleEffective}
                        onChanged={() => setProfileReloadToken((n) => n + 1)}
                        disabled={busy || taskActive}
                      />
                    )}
                  </>
                ) : undefined
              }
            />
            <ProfileSection
              label="关系画像"
              key={`relationship-${novelId}`}
              effective={relationshipEffective?.memoryTask && memoryLive[relationshipEffective.memoryTask.id] ? { ...relationshipEffective, memoryTask: { ...relationshipEffective.memoryTask, livePreview: memoryLive[relationshipEffective.memoryTask.id] } } : relationshipEffective}
              extracted={!!relationshipProfile}
              statusText={memoryStatus(relationshipEffective)}
              busy={relationshipBusy}
              disabled={busy || relationshipBusy || memoryRunning(relationshipEffective) || taskActive || !novelId}
              actionText={
                relationshipBusy ? '更新中…' : relationshipEffective?.progress?.complete === false ? '继续更新关系档案' : '更新关系档案'
              }
              onAction={() => void refreshRelationshipProfile()}
              extraActions={<MemoryRebuildDialog key={`rebuild-relationship-${novelId}`} triggerMode="dropdown" novelId={novelId} kind="relationship" chapters={chapterOptions} disabled={busy || relationshipBusy || memoryRunning(relationshipEffective) || taskActive || !novelId} onChanged={() => setProfileReloadToken(n => n + 1)} />}
              onPause={() => void pauseMemory('relationship')}
              pausing={relationshipPausing}
              running={memoryRunning(relationshipEffective)}
              progressNote={memoryProgressNote(relationshipEffective, relationshipPausing, relationshipBusy) || (relationshipBusy ? '正在提交后台分析…' : undefined)}
              emptyHint="梳理人物之间的关系、立场与变化，保留正文依据，供续写承接人物互动。"
              footnote={
                <p className="text-xs leading-5 text-muted-foreground">
                  后台覆盖目标起点前全部正文，后续增量更新；离开页面后仍会继续，暂停后可从检查点恢复。
                </p>
              }
              sampleCaption="每批"
              sampleLabel="关系画像每批章数"
              sample={{ value: relationshipSampleInput.text, min: 1, max: 30, onChange: relationshipSampleInput.onChangeText, onBlur: relationshipSampleInput.commit }}
              content={
                relationshipProfile ? (
                  <>
                    <ProfileText text={relationshipProfile} />
                    {relationshipEffective && (
                      <ProfileOverrideEditor
                        novelId={novelId}
                        kind="relationship"
                        effective={relationshipEffective?.memoryTask && memoryLive[relationshipEffective.memoryTask.id] ? { ...relationshipEffective, memoryTask: { ...relationshipEffective.memoryTask, livePreview: memoryLive[relationshipEffective.memoryTask.id] } } : relationshipEffective}
                        onChanged={() => setProfileReloadToken((n) => n + 1)}
                        disabled={busy || taskActive}
                      />
                    )}
                  </>
                ) : undefined
              }
            />
            <ProfileSection
              label="情节状态"
              key={`plot-${novelId}`}
              effective={plotEffective?.memoryTask && memoryLive[plotEffective.memoryTask.id] ? { ...plotEffective, memoryTask: { ...plotEffective.memoryTask, livePreview: memoryLive[plotEffective.memoryTask.id] } } : plotEffective}
              extracted={!!plotState}
              statusText={memoryStatus(plotEffective)}
              busy={plotBusy}
              disabled={busy || plotBusy || memoryRunning(plotEffective) || taskActive || !novelId}
              actionText={plotBusy ? '更新中…' : plotEffective?.progress?.complete === false ? '继续更新情节档案' : '更新情节档案'}
              onAction={() => void refreshPlotState()}
              extraActions={<MemoryRebuildDialog key={`rebuild-plot-${novelId}`} triggerMode="dropdown" novelId={novelId} kind="plot" chapters={chapterOptions} disabled={busy || plotBusy || memoryRunning(plotEffective) || taskActive || !novelId} onChanged={() => setProfileReloadToken(n => n + 1)} />}
              onPause={() => void pauseMemory('plot')}
              pausing={plotPausing}
              running={memoryRunning(plotEffective)}
              progressNote={memoryProgressNote(plotEffective, plotPausing, plotBusy) || (plotBusy ? '正在提交后台分析…' : undefined)}
              emptyHint="整理角色现状、重要物品与地点、未解伏笔和冲突，帮助续写承接已有情节。"
              sampleCaption="每批"
              sampleLabel="情节状态每批章数"
              sample={{ value: plotSampleInput.text, min: 1, max: 30, onChange: plotSampleInput.onChangeText, onBlur: plotSampleInput.commit }}
              content={
                plotState ? (
                  <>
                    <ProfileText text={plotState} />
                    {plotEffective && (
                      <ProfileOverrideEditor
                        novelId={novelId}
                        kind="plot"
                        effective={plotEffective?.memoryTask && memoryLive[plotEffective.memoryTask.id] ? { ...plotEffective, memoryTask: { ...plotEffective.memoryTask, livePreview: memoryLive[plotEffective.memoryTask.id] } } : plotEffective}
                        onChanged={() => setProfileReloadToken((n) => n + 1)}
                        disabled={busy || taskActive}
                      />
                    )}
                  </>
                ) : undefined
              }
              footnote={
                plotState ? (
                  <p className="text-xs leading-5 text-muted-foreground">
                    {plotEffective?.source?.coverage === 'full'
                      ? `档案截至第 ${plotChaptersThrough} 章${plotChapterCount > 0 ? `（本书共 ${plotChapterCount} 章）` : ''}；覆盖该起点前全部正文，未解决的伏笔随增量更新保留。`
                      : '当前为旧版取样结果，请更新档案以完成全部历史初始化。'}
                  </p>
                ) : (
                  <p className="text-xs leading-5 text-muted-foreground">后台覆盖目标起点前全部正文，后续只处理新增章节；离开页面后仍会继续，暂停后可恢复。</p>
                )
              }
            />
          </div>
        </DialogBody>
      </DialogFrame>
    </Dialog>
  )

  const rawBrief = briefs[novelId] || emptyWritingBrief()
  const currentWritingBrief = { ...rawBrief, chapterGoals: rawBrief.chapterGoals.filter((goal) => goal.index <= chapterCount) }
  const parsedOutlineSections = parseOutlineSections(outline)
  const materialRequest = {
    novelId,
    title: chapterTitle,
    instruction,
    outline: useOutline ? outline : '',
    afterChapterId,
    chapterCount,
    targetWords: Number(targetWordsInput.text) || 2000,
    writingBrief: currentWritingBrief,
    contentPreferences: buildContentPreferences(),
  }
  const materialKey = JSON.stringify(materialRequest)

  return (
    <div className={styles.root}>
      {requestProgress && <section aria-label={requestProgress.kind}><AiStreamPreview progress={requestProgress.value} structured={requestProgress.kind === '情节方向'} /></section>}
      <section className={styles.workbench} aria-label="作品创作台">
        <div className={styles.toolbar}>
          <FormField label="当前作品" labelId="ai-writing-novel-label">
            <SearchSelect
              options={novels.map((novel) => ({ value: novel.id, label: novel.title, sub: `${novel.author || '未知作者'} · ${novel.chapterCount} 章` }))}
              value={novelId}
              onChange={selectNovel}
              placeholder={novelsLoading ? '正在加载书目…' : '选择小说'}
              disabled={novelsLoading || !!novelsError}
              searchable
              searchPlaceholder="搜索书名或作者…"
              filter={(option, query) => `${option.label} ${option.sub || ''}`.toLowerCase().includes(query)}
              dropdownSide="bottom"
              aria-labelledby="ai-writing-novel-label"
            />
            {novelsError && (
              <div role="alert" className="text-sm text-destructive">
                {novelsError}
                <Button variant="ghost" size="sm" onClick={() => setNovelsReload((value) => value + 1)}>重新加载书目</Button>
              </div>
            )}
          </FormField>
          {mode === 'continue' && (
            <div className={styles.anchor}>
              {chapterOptions.length > 1 && (
                <FormField
                  label="续写起点"
                  labelId="ai-writing-after-chapter-label"
                  className="ai-writing-continuation-start"
                >
                  <SearchSelect
                    options={chapterOptions}
                    value={afterChapterId}
                    onChange={(id) => {
                      setAfterChapterId(id)
                      props.onAfterChapterChange?.(id)
                    }}
                    placeholder="从最新章节续写（默认）"
                    searchable
                    searchPlaceholder="搜索章节…"
                    dropdownSide="bottom"
                    aria-labelledby="ai-writing-after-chapter-label"
                  />
                </FormField>
              )}
              {chapterOptions.length <= 1 && (
                <p className="ai-writing-continuation-start__status">
                  {novelId ? '续写起点：将从最新已发布章节继续。' : '选择小说后，可在这里确认续写起点。'}
                </p>
              )}
            </div>
          )}
          <div className={styles.mode}>
            <span className={styles.caption}>创作方式</span>
            <Tabs value={mode} onValueChange={(value) => setMode(value as 'new' | 'continue')}>
              <TabsList aria-label="创作方式">
                <TabsTrigger value="continue">续写</TabsTrigger>
                <TabsTrigger value="new">新写</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>
        <Tabs value={view} onValueChange={(value) => changeView(value as WritingView)} className={styles.viewTabs}>
          <div className={styles.navigation}>
            <TabsList variant="line" aria-label="本书创作视图">
              <TabsTrigger value="compose">构思与生成</TabsTrigger>
              <TabsTrigger value="review">草稿审阅</TabsTrigger>
              <TabsTrigger value="outputs">本书产出</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="compose" forceMount hidden={view !== 'compose'}>
            <div className={styles.layout}>
              <div className={styles.editor}>
                <div className={styles.sectionHeading}>
                  <h2>{mode === 'continue' ? '接下来，故事如何发展？' : '从一个故事设想开始'}</h2>
                  <span className={styles.caption}>
                    {mode === 'continue' ? '承接已发布正文' : '先构思大纲，再生成章节'}
                  </span>
                </div>
                {mode === 'new' && (
                  <div className={styles.newFields}>
                    <FormField label="作品标题" htmlFor="ai-writing-title">
                      <Input
                        id="ai-writing-title"
                        value={title}
                        onChange={(event) => setTitle(event.target.value)}
                        placeholder="例如：雾城来信"
                      />
                    </FormField>
                    {mode === 'new' && (
                      <FormField
                        label="章节标题"
                        htmlFor="ai-writing-chapter-title"
                        className="ai-writing-chapter-title"
                      >
                        <Input
                          id="ai-writing-chapter-title"
                          value={chapterTitle}
                          onChange={(event) => setChapterTitle(event.target.value)}
                          placeholder="例如：第一章 雾中来客"
                        />
                      </FormField>
                    )}
                    {mode === 'new' && (
                      <div className={styles.newWords}>
                        {' '}
                        <FormField label="目标字数" htmlFor="ai-writing-target-words">
                          <div className="ai-writing-number-input">
                            <Input
                              id="ai-writing-target-words"
                              type="number"
                              min={300}
                              max={30000}
                              step={100}
                              value={targetWordsInput.text}
                              onChange={(event) => targetWordsInput.onChangeText(event.target.value)}
                              onBlur={targetWordsInput.commit}
                            />
                            <span>字</span>
                          </div>
                        </FormField>
                      </div>
                    )}
                  </div>
                )}
                <section className="ai-writing-brief">
                  <div className="ai-writing-brief__head">
                    <Label htmlFor="ai-writing-instruction">本次情节</Label>
                    <span className="ai-writing-brief__count">
                      {instruction.replace(/\s/g, '').length > 0
                        ? `${instruction.replace(/\s/g, '').length} 字`
                        : '未填写'}
                    </span>
                  </div>
                  <Textarea
                    id="ai-writing-instruction"
                    className="field-sizing-fixed min-h-[8rem] shadow-none text-sm"
                    value={instruction}
                    onChange={(event) => setInstruction(event.target.value)}
                    aria-describedby="ai-writing-instruction-hint"
                    placeholder={
                      '写下本章要发生的事、人物的选择，以及你希望留下的悬念。\n例如：主角循着旧信来到渡口，却与失踪多年的师兄重逢。'
                    }
                  />
                  <p id="ai-writing-instruction-hint" className="ai-writing-brief__hint">
                    {instruction.trim()
                      ? mode === 'continue' && chapterCount > 1
                        ? `本要求会随续写任务下发。可点击下方「整理成大纲」推演各章安排，确认后开启按纲续写。`
                        : '本要求会随生成请求下发；可先「寻找灵感」挑选方向，或点击「整理成大纲」推演剧情细纲。'
                      : '留空时模型自行发挥。建议先在下方「寻找灵感」挑一条，或写下设想后「整理成大纲」。'}
                  </p>
                </section>
                <div className={styles.assist}>
                  <span className="text-xs font-medium text-foreground/80 shrink-0">推荐侧重点</span>
                  <Input
                    aria-label="推荐侧重点（可选）"
                    value={focus}
                    onChange={(event) => setFocus(event.target.value)}
                    placeholder="可留空，例如：感情升温的日常互动"
                    className={styles.focusInput}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"

                    disabled={busy || suggestBusy || !novelId}
                    onClick={() => void loadSuggestions()}
                  >
                    {suggestBusy ? (
                      '推荐中…'
                    ) : (
                      <>
                        <Sparkles className="size-3.5 mr-1" aria-hidden="true" />
                        寻找灵感
                      </>
                    )}
                  </Button>
                  {mode === 'continue' && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"

                      disabled={busy || taskActive || outlineBusy || !novelId}
                      onClick={() => void generateOutlineForContinuation()}
                      aria-label={isMultiChapter ? '整理成分章大纲' : '整理成大纲'}
                    >
                      {outlineBusy ? (
                        '生成中…'
                      ) : (
                        <>
                          <FileText className="size-3.5 mr-1" aria-hidden="true" />
                          {isMultiChapter ? '整理成分章大纲' : '整理成大纲'}
                        </>
                      )}
                    </Button>
                  )}
                </div>
                {mode === 'continue' && (
                  <MotionDetails
                    className={styles.outline}
                    open={deckOpen}
                    onToggle={(event) => setDeckOpen(event.currentTarget.open)}
                  >
                    <summary>
                      大纲与灵感 <span>可手写大纲，或先寻找灵感</span>
                    </summary>
                    <div className="ai-writing-deck-block">
                      {/* 头部 Tab 切换与控制 */}
                      <div className="ai-writing-deck-head">
                        <Tabs
                          value={deckTab}
                          onValueChange={(value) => {
                            setDeckTab(value as 'outline' | 'suggestions')
                            setSuggestCollapsed(false)
                          }}
                        >
                          <TabsList aria-label="构思材料">
                            <TabsTrigger value="outline">续写大纲</TabsTrigger>
                            <TabsTrigger value="suggestions">
                              灵感候选{suggestions.length > 0 ? ` · ${suggestions.length}` : ''}
                            </TabsTrigger>
                          </TabsList>
                        </Tabs>
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs text-muted-foreground"
                            aria-expanded={!suggestCollapsed}
                            onClick={() => setSuggestCollapsed((v) => !v)}
                          >
                            {suggestCollapsed ? '展开' : '收起'}
                          </Button>
                        </div>
                      </div>

                      {!suggestCollapsed && (
                        <div className="ai-writing-deck-body pt-2 space-y-3">
                          {deckTab === 'outline' ? (
                            /* 大纲推演视图 */
                            <div className="grid gap-2.5">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <Label htmlFor="ai-writing-outline" className="text-xs font-medium text-foreground/90">
                                  {isMultiChapter ? '多章续写大纲' : '本章大纲（可选）'}
                                </Label>
                                <div className="flex items-center gap-3">
                                  <label className="inline-flex items-center gap-1.5 cursor-pointer text-xs select-none">
                                    <Switch
                                      checked={useOutline && Boolean(outline.trim())}
                                      disabled={!outline.trim()}
                                      onCheckedChange={(checked) => setUseOutline(checked)}
                                    />
                                    <span
                                      className={
                                        useOutline && outline.trim()
                                          ? 'font-medium text-foreground'
                                          : 'text-muted-foreground'
                                      }
                                    >
                                      续写时采用此大纲
                                    </span>
                                  </label>
                                  {outline.trim() && (
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      className="h-6 px-1.5 text-xs text-muted-foreground hover:text-destructive"
                                      onClick={() => {
                                        setOutline('')
                                        setUseOutline(false)
                                      }}
                                    >
                                      清空
                                    </Button>
                                  )}
                                </div>
                              </div>

                              <Textarea
                                id="ai-writing-outline"
                                className="field-sizing-fixed min-h-[140px] shadow-none text-xs leading-relaxed"
                                value={outline}
                                onChange={(event) => setOutline(event.target.value)}
                                placeholder={
                                  isMultiChapter
                                    ? '点击上方「整理成大纲」，或直接在此编写/粘贴：\n第1章 渡口重逢\n主角与师兄试探彼此来意。\n第2章 旧信之谜\n旧物揭示信中隐藏的线索。'
                                    : '可留空。单章建议优先写清本次情节；若有详细分镜头或剧情转折，可在此补充提纲。'
                                }
                              />

                              {outlineBusy && (
                                <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
                                  <div className="size-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                                  <span>正在基于你的设想与前文脉络生成大纲…</span>
                                </div>
                              )}

                              {/* 识别章节段落快速填入胶囊 */}
                              {parsedOutlineSections.length > 0 && (
                                <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                                  <span className="text-[11px] text-muted-foreground shrink-0">点击填入本次情节：</span>
                                  {parsedOutlineSections.map((sec, idx) => (
                                    <Button
                                      key={idx}
                                      type="button"
                                      variant="ghost"
                                      size="sm"

                                      title={`点击将「${sec.chapter}${sec.title ? ` ${sec.title}` : ''}」内容填入本次情节`}
                                      onClick={() => {
                                        const textToFill =
                                          `${sec.chapter}${sec.title ? ` ${sec.title}` : ''}\n${sec.content}`.trim()
                                        setSuggestionFill({ applied: textToFill, previous: instruction })
                                        setInstruction(textToFill)
                                        toast(`已将「${sec.chapter}」大纲填入本次情节`)
                                      }}
                                    >
                                      <span>
                                        {sec.chapter}
                                        {sec.title ? ` · ${sec.title}` : ''}
                                      </span>
                                    </Button>
                                  ))}
                                </div>
                              )}

                              {/* 大纲章数状态对比 */}
                              {isMultiChapter && outline.trim() && (
                                <div
                                  className={`ai-writing-outline-status${countOutlineChapters(outline) >= chapterCount ? ' is-ok' : ' is-short'}`}
                                >
                                  <span className="ai-writing-outline-status__figure">
                                    {countOutlineChapters(outline)}
                                    <span aria-hidden="true"> / </span>
                                    {chapterCount}
                                  </span>
                                  <span className="ai-writing-outline-status__text">
                                    {countOutlineChapters(outline) >= chapterCount
                                      ? `已识别 ${countOutlineChapters(outline)} 个章节段落，够这 ${chapterCount} 章逐章下发。${useOutline ? '（已启用续写下发）' : '（当前未勾选采用，仅作备忘）'}`
                                      : `已识别 ${countOutlineChapters(outline)} 个章节段落，不足 ${chapterCount} 章：多出的续写章会按创作要求生成，可能与已写内容重复。建议补足大纲或调小续写章数。`}
                                  </span>
                                </div>
                              )}
                            </div>
                          ) : (
                            /* 灵感候选视图 */
                            <div className="ai-writing-suggest-block">
                              <p className="text-xs text-muted-foreground">
                                点选方向填入本次情节，填入后可继续编辑或以此生成大纲
                              </p>
                              <div id="ai-writing-suggest-list" className="ai-writing-suggest">
                                {suggestions.map((item, index) => (
                                  <div
                                    key={`${index}-${item.direction.slice(0, 12)}`}
                                    className="flex items-start gap-1"
                                  >
                                    <button
                                      type="button"
                                      className="ai-writing-suggest__item flex-1"
                                      aria-pressed={instruction === item.direction}
                                      onClick={() => {
                                        if (instruction !== item.direction) {
                                          setSuggestionFill({ applied: item.direction, previous: instruction })
                                        }
                                        setInstruction(item.direction)
                                      }}
                                    >
                                      <span className="ai-writing-suggest__index" aria-hidden="true">
                                        {index + 1}
                                      </span>
                                      <span className="ai-writing-suggest__body">
                                        <span className="ai-writing-suggest__direction">{item.direction}</span>
                                        {item.effect && (
                                          <span className="ai-writing-suggest__effect">
                                            <ArrowRight className="size-3" aria-hidden="true" />
                                            <span>{item.effect}</span>
                                          </span>
                                        )}
                                      </span>
                                    </button>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"

                                      title="以此方向作为设想，直接生成分章大纲"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        setInstruction(item.direction)
                                        void generateOutlineForContinuation(item.direction)
                                      }}
                                    >
                                      <FileText className="size-3 mr-1" />
                                      生大纲
                                    </Button>
                                  </div>
                                ))}
                              </div>
                              {suggestionFill && instruction === suggestionFill.applied && (
                                <div className="ai-writing-suggest-undo">
                                  <span>已填入该条候选，原内容已被替换</span>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 px-2 text-xs"
                                    onClick={() => {
                                      setInstruction(suggestionFill.previous)
                                      setSuggestionFill(null)
                                    }}
                                  >
                                    撤销填入
                                  </Button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </MotionDetails>
                )}
                {mode === 'new' && (
                  <MotionDetails className="ai-writing-outline-details">
                    <summary>
                      大纲 <span>生成章节时使用</span>
                    </summary>
                    <div className="grid gap-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Label htmlFor="ai-writing-outline-new">大纲（生成章节时使用）</Label>
                      </div>
                      <Textarea
                        id="ai-writing-outline-new"
                        className="field-sizing-fixed min-h-[140px] shadow-none text-sm"
                        value={outline}
                        onChange={(event) => setOutline(event.target.value)}
                        placeholder="先生成大纲，或直接粘贴已有大纲"
                      />
                    </div>
                  </MotionDetails>
                )}

                {mode === 'continue' && (
                  <section className={styles.scale} aria-label="生成安排">
                    <div className={styles.sectionHeading}>
                      <h3>生成安排</h3>
                      <ToggleGroup
                        type="single"
                        className="ai-writing-run-scale__choices shrink-0"
                        aria-label="续写策略"
                        value={isMultiChapter ? 'multiple' : 'single'}
                        disabled={busy || taskActive}
                        onValueChange={(value) => {
                          if (value === 'single') chapterCountInput.setCommittedValue(1)
                          else if (value === 'multiple') chapterCountInput.setCommittedValue(Math.max(2, chapterCount))
                        }}
                      >
                        <ToggleGroupItem value="single">单章精写</ToggleGroupItem>
                        <ToggleGroupItem value="multiple">多章规划</ToggleGroupItem>
                      </ToggleGroup>
                    </div>
                    <div className="ai-writing-baseline-scale-fields grid grid-cols-2 gap-3 items-start">
                      {isMultiChapter && (
                        <FormField label="续写章节数" htmlFor="ai-writing-chapter-count">
                          <div className="ai-writing-number-input">
                            <Input
                              id="ai-writing-chapter-count"
                              type="number"
                              min={1}
                              max={20}
                              value={chapterCountInput.text}
                              onChange={(event) => chapterCountInput.onChangeText(event.target.value)}
                              onBlur={chapterCountInput.commit}
                            />
                            <span>章</span>
                          </div>
                        </FormField>
                      )}
                      <FormField
                        label={isMultiChapter ? '每章目标字数' : '目标字数'}
                        htmlFor="ai-writing-target-words"
                        className={isMultiChapter ? '' : 'col-span-2'}
                      >
                        <div className="ai-writing-number-input">
                          <Input
                            id="ai-writing-target-words"
                            type="number"
                            min={300}
                            max={30000}
                            step={100}
                            value={targetWordsInput.text}
                            onChange={(event) => targetWordsInput.onChangeText(event.target.value)}
                            onBlur={targetWordsInput.commit}
                          />
                          <span>字</span>
                        </div>
                      </FormField>
                    </div>
                  </section>
                )}
                <div className="ai-writing-actions grid gap-3 border-t pt-5">
                  {isContinuationMode && (
                    <MotionDetails className="ai-writing-submit-preview text-xs text-muted-foreground">
                      <summary className="cursor-pointer hover:text-foreground inline-flex items-center gap-1 select-none py-0.5">
                        <span>查看本次上下文摘要</span>
                      </summary>
                      <p className="ai-writing-launch-summary" aria-live="polite">
                        {novelId ? (
                          <>
                            将续写《{selectedNovelTitle || '当前小说'}》
                            {afterChapterId ? '指定章节之后' : '最新已发布章节之后'} ·{' '}
                            {isMultiChapter ? `${chapterCount} 章规划` : '单章精写'} ·{' '}
                            {adultContentMode === 'explicit' ? 'R18 已启用' : '常规内容'}
                            {activeProfileLabels.length > 0
                              ? ` · 已注入：${activeProfileLabels.join('、')}`
                              : ' · 尚无可用续写档案'}
                            {useOutline && outline.trim()
                              ? ` · 已挂载大纲(${countOutlineChapters(outline)}章)`
                              : outline.trim()
                                ? ' · 大纲未勾选采用(自由发挥)'
                                : ''}
                          </>
                        ) : (
                          '先选择小说；续写基线会随所选作品加载。'
                        )}
                      </p>
                    </MotionDetails>
                  )}
                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    {mode === 'new' ? (
                      <>
                        <Button
                          variant="outline"

                          disabled={busy || taskActive}
                          onClick={() => void generateOutline()}
                        >
                          {taskActive && task?.kind === 'write_outline' ? '生成中…' : '生成大纲'}
                        </Button>
                        <Button disabled={busy || taskActive} onClick={() => void generateChapter()}>
                          <Sparkles className="size-4 mr-1.5" />
                          {taskActive && task?.kind === 'write_chapter' ? '生成中…' : '生成章节'}
                        </Button>
                      </>
                    ) : (
                      <Button
                        disabled={busy || taskActive}
                        onClick={() => void continueNovel()}
                        aria-label={
                          taskActive && task?.kind === 'continue'
                            ? '生成中…'
                            : useOutline && outline.trim()
                              ? isMultiChapter
                                ? `按大纲批量续写 ${chapterCount} 章`
                                : '生成续写（按大纲）'
                              : isMultiChapter
                                ? `批量续写 ${chapterCount} 章`
                                : '生成续写'
                        }
                      >
                        <Sparkles className="size-4 mr-1.5" />
                        {taskActive && task?.kind === 'continue'
                          ? '生成中…'
                          : useOutline && outline.trim()
                            ? isMultiChapter
                              ? `按大纲续写 ${chapterCount} 章`
                              : '按大纲生成续写'
                            : isMultiChapter
                              ? `批量续写 ${chapterCount} 章`
                              : '生成续写'}
                      </Button>
                    )}
                    <span className="ai-writing-draft-note text-xs text-muted-foreground ml-1">
                      生成结果先保存为草稿，审阅后再发布。
                    </span>
                  </div>
                  {task && (
                    <div className="ai-writing-live-task rounded-xl border border-border/80 bg-muted/20 p-4 space-y-3 mt-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`size-2 shrink-0 rounded-full ${taskDotClass(task.status)}`}
                          aria-hidden="true"
                        />
                        <span className="font-semibold text-sm text-foreground">
                          本次任务：{taskKindLabel(task.kind)} · {taskStatusLabel(task.status)}
                        </span>
                        {task.kind === 'continue' && (
                          <span className="text-xs text-muted-foreground font-mono">
                            {task.current} / {task.total} 章
                          </span>
                        )}
                        {taskActive && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="ml-auto h-8 text-xs font-medium"
                            onClick={() => void cancelTask()}
                          >
                            取消任务
                          </Button>
                        )}
                        {!taskActive && task.current > 0 && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="ml-auto h-8 text-xs font-medium"
                            onClick={() => openDrafts(task.batchId || undefined, task.novelId || novelId)}
                          >
                            {task.batchId ? `查看本批草稿（${task.current} 章）` : '查看草稿'}
                          </Button>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">{task.step || '等待处理'}</p>
                      {taskActive && <AiStreamPreview progress={parseAiTextProgress(task.result)} />}
                      {task.error && <p className="text-xs text-destructive">{task.error}</p>}
                    </div>
                  )}
                </div>
              </div>
              <aside className={styles.context} aria-label="本次上下文">
                <h2>本次上下文</h2>
                {selectedNovel ? (
                  <div className={styles.book}>
                    <div className={styles.cover}>
                      <BookOpen className="size-4" aria-hidden="true" />
                      <img
                        key={selectedNovel.id}
                        src={url(
                          `/cover/${encodeURIComponent(selectedNovel.id)}?v=${encodeURIComponent(selectedNovel.updatedAt || 0)}&cover=4`,
                        )}
                        alt=""
                        onError={(event) => {
                          event.currentTarget.style.display = 'none'
                        }}
                      />
                    </div>
                    <div>
                      <p>{selectedNovel.title}</p>
                      <span className={styles.caption}>{selectedNovel.author || '未知作者'}</span>
                    </div>
                  </div>
                ) : (
                  <p className={styles.caption}>选择作品后，查看本次使用的档案与写作材料。</p>
                )}
                <div className={styles.contextSection}>
                  <span className={styles.caption}>续写档案 · {activeProfileLabels.length} 项可用</span>
                  <dl className={styles.profileStatus}>
                    <div>
                      <dt>文风画像</dt>
                      <dd>{styleEffective?.effectiveContent ? '可用' : '未就绪'}</dd>
                    </div>
                    {mode === 'continue' && (
                      <>
                        <div>
                          <dt>人物关系</dt>
                          <dd>
                            {memoryRunning(relationshipEffective)
                              ? '分析中'
                              : relationshipEffective?.effectiveContent
                                ? '可用'
                                : '未就绪'}
                          </dd>
                        </div>
                        <div>
                          <dt>情节档案</dt>
                          <dd>
                            {memoryRunning(plotEffective)
                              ? '分析中'
                              : plotEffective?.effectiveContent
                                ? '可用'
                                : '未就绪'}
                          </dd>
                        </div>
                      </>
                    )}
                  </dl>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    aria-label={`可用 ${activeProfileLabels.length} 项续写档案`}
                    disabled={!novelId}
                    onClick={() => setAnalysisDialogOpen(true)}
                  >
                    查看续写档案
                  </Button>
                </div>
                {mode === 'continue' && pendingDrafts > 0 && (
                  <div className={styles.draftNotice}>
                    <p>本书有 {pendingDrafts} 章未发布的续写草稿，当前续写只参考已发布正文。</p>
                    <Button type="button" variant="outline" size="sm" onClick={() => openDrafts()}>
                      先审阅草稿
                    </Button>
                  </div>
                )}
                <MotionDetails className={styles.contextDetails}>
                  <summary>
                    内容尺度 <span>{adultContentMode === 'explicit' ? 'R18 已启用' : '常规内容'}</span>
                  </summary>
                  {continuationContentScale}
                  {mode === 'new' && (
                    <div className="grid gap-3 border-t pt-5">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium">成人内容</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            开启后本次任务按成人向写作；推荐情节也会给出以成人场景为主体的方向。关闭时行为与以往一致。
                          </p>
                        </div>
                        {/* 状态徽标与「AI 设置」页的「已配置 / 未配置」同构：
                    开关收起时正文没有「当前是否启用」的落点，徽标把它提到标题行。 */}
                        <AdminStatusBadge tone={adultContentMode === 'explicit' ? 'accent' : 'muted'}>
                          {adultContentMode === 'explicit' ? '已启用' : '未启用'}
                        </AdminStatusBadge>
                      </div>
                      {/* 用 Switch 替代原生 checkbox：原生框实测 13×13，低于 WCAG 2.2 AA
                  的 24×24；同面板族的「参数调优」也用 Switch 表达同一类布尔开关。

                  外层用 <label> 包裹即可，不必手写 onClick + aria-labelledby：
                  button 是 labelable 元素，label 既转发点击又提供可访问名称
                  （最小复现页与真实页面均实测转发，CDP 无障碍树确认名称正确）。
                  刻意不抄一份切换逻辑到文字上 —— 那样会有两处需要同步。 */}
                      <label className="flex items-start justify-between gap-4 rounded-lg border border-border bg-muted/30 p-4">
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-foreground">开启露骨 R18 模式</span>
                          <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                            按作者本次给出的成人内容参数写作；成人场景是章节主体而非情节之外的点缀。
                          </span>
                        </span>
                        <Switch
                          checked={adultContentMode === 'explicit'}
                          disabled={busy || taskActive}
                          onCheckedChange={(checked) => {
                            setAdultContentMode(checked ? 'explicit' : 'off')
                          }}
                        />
                      </label>
                      {adultContentMode === 'explicit' && (
                        <div className="ai-writing-consent grid gap-3">
                          <div className="grid gap-1.5">
                            <Label id="ai-writing-consent-tier-label" className="text-xs">
                              同意规则档位
                            </Label>
                            <SearchSelect
                              options={[
                                { value: 'default', label: '严格（默认，适用于绝大多数作品）' },
                                {
                                  value: 'fictional_nonconsent',
                                  label: '虚构题材分级（原作主线即含强迫/下药等情节时使用）',
                                },
                              ]}
                              value={consentRuleTier}
                              onChange={(value) => setConsentRuleTier(value as 'default' | 'fictional_nonconsent')}
                              className={styles.contextSelect}
                              aria-labelledby="ai-writing-consent-tier-label"
                            />
                            <p className="text-xs text-muted-foreground">
                              放宽档只在作品原作本身即以此类情节为主线、且角色均为成年人时使用；它解除的是写法与篇幅限制，不解除成年前提。
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </MotionDetails>
                <WritingPreparation
                  key={novelId}
                  brief={currentWritingBrief}
                  onChange={(brief) => setBriefs((previous) => ({ ...previous, [novelId]: brief }))}
                  request={materialRequest}
                  requestKey={materialKey}
                  chapterCount={chapterCount}
                  disabled={busy || taskActive}
                  continuation={mode === 'continue'}
                  onPreview={(revision, key) => setMaterialPreview({ revision, key })}
                  plotTimeout={{
                    value: plotTimeoutInput.text,
                    min: PLOT_TIMEOUT_MIN_SECONDS,
                    max: PLOT_TIMEOUT_MAX_SECONDS,
                    onChange: plotTimeoutInput.onChangeText,
                    onBlur: commitPlotTimeout,
                  }}
                />
                {mode === 'new' && (
                  <div className="grid gap-4 border-t pt-5">
                    <div>
                      <p className="text-sm font-medium">续写档案</p>
                      <p className="text-xs text-muted-foreground">
                        提取后自动注入续写：风格画像定文风，关系画像定人设边界，情节状态防断档。
                      </p>
                    </div>
                    <ProfileSection
                      label="风格画像"
                      extracted={!!styleProfile}
                      busy={styleBusy}
                      disabled={busy || styleBusy || taskActive || !novelId}
                      actionText={styleBusy ? '提取中…' : styleProfile ? '重新提取' : '提取风格画像'}
                      onAction={() => void refreshStyleProfile()}
                      emptyHint="续写时会按通用的「保持风格一致」约束兜底；提取后则按本作原文的句式、节奏、语气、设定续写，文风一致性更好。建议在有 2 章以上正文后提取一次。"
                      content={
                        styleProfile ? (
                          <>
                            <ProfileText text={styleProfile} />
                            {styleEffective && (
                              <ProfileOverrideEditor
                                novelId={novelId}
                                kind="style"
                                effective={styleEffective}
                                onChanged={() => setProfileReloadToken((n) => n + 1)}
                                disabled={busy || taskActive}
                              />
                            )}
                          </>
                        ) : undefined
                      }
                    />
                  </div>
                )}

                <div className={styles.model}>
                  <Cpu className="size-3.5" aria-hidden="true" />
                  <span>{props.model || '未配置模型'}</span>
                </div>
              </aside>
            </div>
            {recentTasks.length > 0 && (
              <MotionDetails className="ai-writing-recent-drawer border-t pt-4 text-xs">
                <summary className="flex cursor-pointer select-none items-center justify-between text-muted-foreground hover:text-foreground font-medium py-1">
                  <span>最近创作任务 ({recentTasks.length})</span>
                  <span className="text-[11px] font-normal text-muted-foreground/80">展开 / 收起</span>
                </summary>
                <ul className="mt-3 space-y-2">
                  {recentTasks.map((item) => (
                    <li
                      key={item.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/20 p-2.5 transition-colors hover:bg-muted/40"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-medium text-xs text-foreground truncate">
                          {item.novelTitle || taskKindLabel(item.kind)}
                        </span>
                        <span className="text-muted-foreground text-[11px]">·</span>
                        <span className="text-xs text-muted-foreground">
                          {taskKindLabel(item.kind)} ·{' '}
                          <span className="font-mono text-foreground/80">
                            {item.current} / {item.total}
                          </span>{' '}
                          章
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <AdminStatusBadge
                          tone={item.status === 'completed' ? 'success' : item.status === 'failed' ? 'danger' : 'muted'}
                          className="text-[10px]"
                        >
                          {taskStatusLabel(item.status)}
                        </AdminStatusBadge>
                        {item.batchId && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs text-accent hover:text-accent/80 font-medium"
                            onClick={() => openDrafts(item.batchId, item.novelId || novelId, 'outputs')}
                          >
                            查看产出 →
                          </Button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </MotionDetails>
            )}
          </TabsContent>
          {view !== 'compose' && (
            <TabsContent value={view} className={styles.results}>
              {novelId ? (
                <AiGenerationsPanel
                  key={`${novelId}:${view}`}
                  scope="writing"
                  status={view === 'review' ? 'draft' : 'all'}
                  novelId={novelId}
                  focusBatchId={props.focusBatchId || localBatchId}
                  refreshToken={!taskActive && task?.novelId === novelId ? `${task.id}:${task.status}` : undefined}
                />
              ) : (
                <p className={styles.caption}>先在上方选择作品，再查看本书的草稿与产出。</p>
              )}
            </TabsContent>
          )}
        </Tabs>
        <footer className={styles.footer}>
          <span>离开本页后，已提交的任务仍会在后台继续。</span>
          <div>
            <a href="/admin/tasks">任务中心</a>
            <a href="/admin/calls">调用与用量</a>
          </div>
        </footer>
      </section>
      {continuationAnalysisDialog}
    </div>
  )
}
