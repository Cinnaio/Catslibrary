/**
 * 草稿选段改写：在正文里选中一段，交给 AI 润色 / 扩写 / 精简 / 按自定义要求改写。
 *
 * 服务端契约（api/src/routes/ai.ts + services/ai/rewrite.ts）：
 *  1. 建议与应用分离 —— 先起任务拿建议，看过之后才决定是否应用，不改正文；
 *  2. 正文以 SHA-256 做乐观并发校验 —— 提交时带 baseRevision，正文变了就 409
 *     且 code='content_changed'，此时必须重新读取正文再选段；
 *  3. 选区用 UTF-16 半开区间，服务端会拒绝截断 Unicode 代理对的选区，
 *     并逐字比对 selectedText 与正文是否一致。
 *
 * 因此这里的选区必须来自 textarea 的真实 selectionStart/selectionEnd（UTF-16 偏移，
 * 与 textarea 和 JS 字符串一致），不能用 DOM Range —— 那给的是另一套坐标系。
 * 正文用 <textarea> 而非富文本，正是为了让这套偏移可用。
 */
import { useRef, useState } from 'react'
import { aiApi, newOperationId, type AiTaskInfo, type RewriteMode } from '@/lib/api'
import { useToast } from '@/components/feedback'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ArrowRight, Check, RotateCcw, Sparkles, X } from 'lucide-react'

/** 轮询改写任务；后端已把建议放在 task.result 的 JSON 里。
 *  循环里先立即查一次再等，故首次判定不受该间隔影响。 */
const REWRITE_POLL_INTERVAL = 3000

const MODE_LABELS: Record<RewriteMode, string> = {
  polish: '润色',
  expand: '扩写',
  shorten: '精简',
  custom: '自定义要求',
}

const MODE_HINTS: Record<RewriteMode, string> = {
  polish: '保留事实与叙事视角，改善表达',
  expand: '补充动作、感官或情绪细节，不改变事实',
  shorten: '保留关键信息与语气，删去重复铺陈',
  custom: '按你写的说明改写（必填）',
}

/**
 * 各模式下「建议字数 / 原选段字数」的合理区间，用于识别模型在续写而非改写。
 *
 * 依据（实测）：后端把选段前后各至多 2000 字作为上下文发给模型，system 提示词虽写了
 * 「只输出改写后的选段正文」，但当后文很长时模型会顺着写下去。实测 polish 模式提交
 * 70 字选段，返回 2069 字建议（约 30 倍），应用后正文 2555 → 4554 字、剧情重复。
 * 后端对结果只设了 12000 字上限，拦不住这种量级。故在应用前把代价摆给操作者看。
 */
const LENGTH_RATIO_RANGE: Record<RewriteMode, [number, number]> = {
  polish: [0.5, 1.8],
  expand: [1, 3],
  shorten: [0.2, 1],
  custom: [0, Number.POSITIVE_INFINITY],
}

interface Selection {
  startUTF16: number
  endUTF16: number
  text: string
}

interface Suggestion {
  /** 生成该建议所用的正文版本；应用时原样回传做并发校验 */
  baseRevision: string
  taskId: string
  mode: RewriteMode
  /** AI 给出的改写文本 */
  text: string
}

function parseSuggestion(task: AiTaskInfo, taskId: string): Suggestion | undefined {
  try {
    const raw = JSON.parse(task.result || '') as Record<string, unknown>
    if (raw.version !== 1 || typeof raw.suggestion !== 'string') return undefined
    return {
      baseRevision: String(raw.baseRevision || ''),
      taskId,
      mode: (raw.mode as RewriteMode) || 'polish',
      text: raw.suggestion,
    }
  } catch {
    return undefined
  }
}

export default function DraftRewrite(props: {
  draftId: string
  /** 当前正文；选区与偏移都以它为坐标系 */
  content: string
  /** 正文版本；应用建议时必须与建议生成时一致 */
  contentRevision: string
  disabled?: boolean
  /** 应用成功后把权威正文与新版版本号交回父级 */
  onApplied: (result: { result: string; contentRevision: string }) => void
  /** 正文已变（他人编辑或保存过），父级需要重新读取 */
  onStale: () => void
}) {
  const { toast } = useToast()
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [mode, setMode] = useState<RewriteMode>('polish')
  const [instruction, setInstruction] = useState('')
  const [generating, setGenerating] = useState(false)
  const [applying, setApplying] = useState(false)
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null)
  const [selectedText, setSelectedText] = useState('')

  // 正文换了（保存/应用/切换草稿）就作废旧选区与旧建议 —— 偏移可能已失效。
  // 用「渲染期间比对并重置」而不是 useEffect：effect 里同步 setState 会多一轮渲染，
  // 且在那之前组件已用陈旧偏移渲染过一帧（旧建议会闪现）。官方推荐此写法。
  const [tracked, setTracked] = useState({ draftId: props.draftId, contentRevision: props.contentRevision })
  if (tracked.draftId !== props.draftId || tracked.contentRevision !== props.contentRevision) {
    setTracked({ draftId: props.draftId, contentRevision: props.contentRevision })
    setSelection(null)
    setSuggestion(null)
    setSelectedText('')
  }

  function captureSelection() {
    const el = bodyRef.current
    if (!el) return
    const start = el.selectionStart
    const end = el.selectionEnd
    if (start === end) {
      setSelection(null)
      return
    }
    setSelection({ startUTF16: start, endUTF16: end, text: props.content.slice(start, end) })
  }

  async function generate() {
    if (!selection) return
    if (mode === 'custom' && !instruction.trim()) {
      toast('自定义要求需要填写改写说明', 'error')
      return
    }
    setGenerating(true)
    setSuggestion(null)
    try {
      const { taskId } = await aiApi.writing.rewriteDraft(props.draftId, {
        baseRevision: props.contentRevision,
        startUTF16: selection.startUTF16,
        endUTF16: selection.endUTF16,
        selectedText: selection.text,
        mode,
        instruction: instruction.trim(),
        clientRequestId: newOperationId('ai-rewrite'),
      })
      // 轮询到终态。先立即查一次：模型很快时（或任务已由他人完成）不必白等一个周期。
      // 页面隐藏时跳过查询，恢复可见后继续。
      const deadline = Date.now() + 600_000
      for (;;) {
        if (Date.now() > deadline) throw new Error('改写建议生成超时，请到「AI 任务」查看')
        if (!document.hidden) {
          const { task } = await aiApi.task(taskId)
          if (task.status === 'completed') {
            const parsed = parseSuggestion(task, taskId)
            if (!parsed) throw new Error('改写建议格式异常，请重试')
            setSuggestion(parsed)
            setSelectedText(selection.text)
            return
          }
          if (task.status === 'failed') throw new Error(task.error || '改写建议生成失败')
          if (task.status === 'cancelled') throw new Error('改写任务已取消')
        }
        await new Promise((resolve) => setTimeout(resolve, REWRITE_POLL_INTERVAL))
      }
    } catch (err) {
      toast((err as Error).message || '改写建议生成失败', 'error')
    } finally {
      setGenerating(false)
    }
  }

  async function apply() {
    if (!suggestion) return
    setApplying(true)
    try {
      const result = await aiApi.writing.applyDraftRewrite(props.draftId, suggestion.taskId, {
        baseRevision: suggestion.baseRevision,
        operationId: newOperationId('ai-rewrite-apply'),
      })
      props.onApplied({ result: result.result, contentRevision: result.contentRevision })
      setSuggestion(null)
      setSelection(null)
      setSelectedText('')
      toast('改写已应用', 'success')
    } catch (err) {
      const apiError = err as { status?: number; data?: { code?: string }; message?: string }
      if (apiError.status === 409) {
        // 正文已变化：必须重新读取，旧选区与旧建议都不可再用
        setSuggestion(null)
        setSelection(null)
        props.onStale()
        toast('正文已被改动，请重新选择要改写的段落', 'error')
      } else {
        toast(apiError.message || '应用改写失败', 'error')
      }
    } finally {
      setApplying(false)
    }
  }

  const canGenerate = Boolean(selection) && !generating && !props.disabled && (mode !== 'custom' || instruction.trim())

  // 建议字数与原选段字数的比值；超出该模式的合理区间时提示可能是在续写而非改写
  const originCount = Array.from(selectedText).length
  const suggestionCount = suggestion ? Array.from(suggestion.text).length : 0
  const ratio = originCount > 0 && suggestion ? suggestionCount / originCount : 0
  const [low, high] = suggestion ? LENGTH_RATIO_RANGE[suggestion.mode] : [0, Number.POSITIVE_INFINITY]
  const ratioOutOfRange = Boolean(suggestion) && originCount > 0 && (ratio < low || ratio > high)

  return (
    <div className="ai-rewrite grid gap-3 rounded-md border bg-muted/10 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor="draft-rewrite-mode" className="text-xs font-medium">
          选段改写
        </Label>
        <Select value={mode} onValueChange={(v) => setMode(v as RewriteMode)}>
          <SelectTrigger size="sm" id="draft-rewrite-mode" className="w-auto min-w-[7rem]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" align="start" sideOffset={4}>
            {(Object.keys(MODE_LABELS) as RewriteMode[]).map((value) => (
              <SelectItem key={value} value={value}>
                {MODE_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {/* 提示独占一行：与下拉同排时会被挤成两行，且窄屏下更明显 */}
        <span className="basis-full text-xs leading-5 text-muted-foreground sm:basis-auto">{MODE_HINTS[mode]}</span>
      </div>

      {mode === 'custom' && (
        <div className="grid gap-1.5">
          <Label htmlFor="draft-rewrite-instruction" className="text-xs text-muted-foreground">
            改写要求（必填）
          </Label>
          <Textarea
            id="draft-rewrite-instruction"
            className="field-sizing-fixed min-h-[4.5rem] resize-none shadow-none text-sm"
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder="例如：把这段的心理描写改得更克制，删掉直接说破心意的句子"
            disabled={generating}
          />
        </div>
      )}

      <div className="grid gap-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label htmlFor="draft-rewrite-body" className="text-xs text-muted-foreground">
            正文（选中要改写的段落）
          </Label>
          <span className="text-xs text-muted-foreground">
            {selection
              ? `已选 ${Array.from(selection.text).length} 字 · 第 ${selection.startUTF16}–${selection.endUTF16} 字符`
              : '尚未选中段落'}
          </span>
        </div>
        {/* 用 textarea 而非富文本：selectionStart/End 给出的 UTF-16 偏移与
            服务端要求的坐标系完全一致，避免再做一套偏移换算。
            高度给到 20rem 起：草稿动辄两三千字（实测 2555 字 / 131 行），
            160px 只露出四五行，选段时几乎无法定位。 */}
        <Textarea
          id="draft-rewrite-body"
          ref={bodyRef}
          className="field-sizing-fixed min-h-[20rem] resize-y shadow-none text-sm leading-7"
          value={props.content}
          readOnly
          onSelect={captureSelection}
          onKeyUp={captureSelection}
          onMouseUp={captureSelection}
          aria-describedby="draft-rewrite-hint"
        />
        <p id="draft-rewrite-hint" className="text-xs leading-5 text-muted-foreground">
          用鼠标拖选，或点击段首后按 Shift+方向键选择。改写只替换选中的部分，其余不动。
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={!canGenerate} onClick={() => void generate()}>
          <Sparkles className="size-3.5" aria-hidden="true" />
          {generating ? '生成建议中…' : '生成改写建议'}
        </Button>
        {selection && !generating && (
          <Button variant="ghost" size="sm" onClick={() => setSelection(null)}>
            <RotateCcw className="size-3.5" aria-hidden="true" />
            清除选区
          </Button>
        )}
      </div>

      {suggestion && (
        <div className="ai-rewrite__compare grid gap-2 border-t pt-3">
          <div className="grid gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">原文</span>
            <p className="ai-rewrite__origin whitespace-pre-wrap text-sm leading-7 text-muted-foreground line-through decoration-muted-foreground/40">
              {selectedText}
            </p>
          </div>
          <div className="grid gap-1.5">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <ArrowRight className="size-3 text-[var(--accent)]" aria-hidden="true" />
              改写建议（{MODE_LABELS[suggestion.mode]}）
            </span>
            <p className="whitespace-pre-wrap text-sm leading-7">{suggestion.text}</p>
          </div>
          {/* 把字数变化显式摆出来：模型偶发「顺着写下去」时，若不给这个数字，
              操作者要读完上下两段才能发现建议比原文长了一个数量级。 */}
          <p className={ratioOutOfRange ? 'text-xs leading-5 text-[var(--color-warning)]' : 'text-xs leading-5 text-muted-foreground'}>
            原选段 {originCount} 字 → 建议 {suggestionCount} 字
            {ratioOutOfRange && (
              <span>
                ，差异较大。请核对建议是否只改写了选段 —— 若它在往后续写，应用后正文会变长且可能重复。
              </span>
            )}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={applying || props.disabled} onClick={() => void apply()}>
              <Check className="size-3.5" aria-hidden="true" />
              {applying ? '应用中…' : '应用改写'}
            </Button>
            <Button variant="ghost" size="sm" disabled={applying} onClick={() => setSuggestion(null)}>
              <X className="size-3.5" aria-hidden="true" />
              放弃建议
            </Button>
            <span className="text-xs text-muted-foreground">应用前正文不会被修改</span>
          </div>
        </div>
      )}
    </div>
  )
}
