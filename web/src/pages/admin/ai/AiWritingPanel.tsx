import type { AnalysisReferenceSelection } from '@shared/novel-analysis'
import AnalysisReferencePicker from './AnalysisReferencePicker'
import { watchAiTask } from '@/lib/ai-task-stream'
import AiStreamPreview from '@/components/shared/AiStreamPreview'
import { MotionDetails } from '@/components/ui/motion'
import WritingPreparation from './WritingPreparation'
import { useWritingPreparationState } from './writing-preparation-state'
import AiGenerationsPanel from './AiGenerationsPanel'
import styles from './writing-workspace.module.css'
import { emptyWritingBrief } from './writing-brief'
import { normalizePlotTimeoutSeconds, PLOT_TIMEOUT_MIN_SECONDS, PLOT_TIMEOUT_MAX_SECONDS } from '@shared/ai-plot-timeout'
import type { AiWritingBrief } from '@/lib/api'
/** AI 创作工作台：新写 / 续写，生成结果先保存为草稿。 */
import { parseAiTextProgress, type AiTextProgress } from '@shared/ai-text-progress'
import { getAdminTableRowStaggerDelay } from '@/lib/admin-table-motion'
import FormField from "@/components/shared/FormField"
import AdminStatusBadge from '@/components/admin/AdminStatusBadge'
import { useCallback, useEffect, useRef, useState } from 'react'
import { aiApi, chaptersApi, newOperationId, type AiTaskInfo } from '@/lib/api'
import { useToast, useConfirm } from '@/components/feedback'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogTrigger } from '@/components/ui/dialog'
import { ReadingDialog } from '@/components/shared/ReadingDialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import SearchSelect from "@/components/shared/SearchSelect"
import { kindLabel as taskKindLabel, writingTaskDigest, taskStatusLabel } from './labels'
import { formatDateTime } from '@/lib/format'
import { Textarea } from '@/components/ui/textarea'

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

export type WritingView = 'compose' | 'review' | 'outputs'

export default function AiWritingPanel(props: {
  active?: boolean
  view: WritingView
  novelId: string
  focusBatchId?: string
  onAfterChapterChange?: (chapterId: string) => void
  onViewBatch?: (batchId?: string, novelId?: string, view?: 'review' | 'outputs') => void
  onOpenGraph?: (novelId: string, afterChapterId?: string) => void
  onOpenAnalysis: () => void
  initialAfterChapterId?: string
  model?: string
}) {
  const { toast } = useToast()
  const { confirm } = useConfirm()
  // AI 创作的主要使用场景是给既有小说续写；新写仍保留为并列入口，而非默认落点。
  const [mode, setMode] = useState<'new' | 'continue'>('continue')
  const [recentTasks, setRecentTasks] = useState<AiTaskInfo[]>([])
  const { novelId, view } = props
  function openDrafts(batchId?: string, targetNovelId = novelId, nextView: 'review' | 'outputs' = 'review') {
    props.onViewBatch?.(batchId, targetNovelId, nextView)
  }
  const initialGraphAnchor = useRef({ novelId, chapterId: props.initialAfterChapterId })
  const [title, setTitle] = useState('')
  const [requestProgress, setRequestProgress] = useState<{ kind: string; value: AiTextProgress } | null>(null)
  const [chapterTitle, setChapterTitle] = useState('')
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
  const referenceKey = `${novelId}:${afterChapterId}`
  const [referenceSelections, setReferenceSelections] = useState<Record<string, AnalysisReferenceSelection[]>>({})
  const analysisReferences = referenceSelections[referenceKey]
  const setAnalysisReferences = useCallback((next: AnalysisReferenceSelection[]) => {
    setReferenceSelections(previous => ({ ...previous, [referenceKey]: next }))
  }, [referenceKey])
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
  const [focus, setFocus] = useState('')
  /** 用选中的情节方向生成多章大纲。 */
  const [outlineBusy, setOutlineBusy] = useState(false)
  /** 作者本次任务的成人内容参数；不传时后端按关闭处理，与旧客户端行为一致。 */
  const [adultContentMode, setAdultContentMode] = useState<'off' | 'explicit'>('off')
  const [consentRuleTier, setConsentRuleTier] = useState<'default' | 'fictional_nonconsent'>('default')
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
  }, [draftKey, afterChapterId])
  const taskActive = !!task && (task.status === 'queued' || task.status === 'running')
  const isContinuationMode = mode === 'continue'
  const isMultiChapter = isContinuationMode && chapterCount > 1
  useEffect(() => {
    initialGraphAnchor.current = { novelId, chapterId: props.initialAfterChapterId }
    setAfterChapterId(props.initialAfterChapterId || '')
  }, [props.initialAfterChapterId, novelId])

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
    return () => { cancelled = true }
  }, [view, novelId, loadChapterOptions])

  useEffect(() => {
    let cancelled = false
    setChapterOptions([])
    if (novelId) void loadChapterOptions(novelId, () => cancelled)
    return () => { cancelled = true }
  }, [novelId, loadChapterOptions])

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
      () => aiApi.writing.outline({ novelId, title, instruction, analysisReferences, afterChapterId, targetWords: words, chapterCount: count, operationId: newOperationId('ai-writing-outline') }),
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
          analysisReferences,
          novelId,
          afterChapterId,
          title: chapterTitle,
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
          analysisReferences,
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

  /** 取情节方向候选。开启成人内容模式时后端会给出以成人场景为主体的方向。 */
  async function loadSuggestions() {
    if (!novelId) return toast('请选择小说', 'error')
    const seq = ++suggestionSeq.current
    const requestedNovelId = novelId
    setSuggestBusy(true)
    setDeckOpen(true)
    setDeckTab('suggestions')
    setRequestProgress(null)
    try {
      const res = await aiApi.writing.plotSuggestions({
          analysisReferences,
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
   * 按本次情节和当前章节数生成大纲，填进大纲框。
   * 大纲会被后端按章拆分后逐章下发，因此要按「第N章」逐段给出。
   */
  async function generateOutlineForContinuation() {
    if (!novelId) return toast('请选择小说', 'error')
    const seq = ++outlineSeq.current
    const direction = instruction.trim()
    setOutlineBusy(true)
    setDeckOpen(true)
    setDeckTab('outline')
    setRequestProgress(null)
    try {
      const res = await aiApi.writing.plotSuggestions({
          analysisReferences,
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

  const rawBrief = briefs[novelId] || emptyWritingBrief()
  const preparationState = useWritingPreparationState(novelId, rawBrief.characters?.join('、') || '')
  const currentWritingBrief = { ...rawBrief, chapterGoals: rawBrief.chapterGoals.filter((goal) => goal.index <= chapterCount) }
  const parsedOutlineSections = parseOutlineSections(outline)
  const materialRequest = {
    novelId,
    title: chapterTitle,
    instruction,
    outline: useOutline ? outline : '',
    afterChapterId,
    analysisReferences,
    chapterCount,
    targetWords: Number(targetWordsInput.text) || 2000,
    writingBrief: currentWritingBrief,
    contentPreferences: buildContentPreferences(),
  }
  const materialKey = JSON.stringify(materialRequest)
  const instructionLength = instruction.replace(/\s/g, '').length

  return (
    <div className={styles.root}>
      <section aria-label="作品创作台">
          <div hidden={view !== 'compose'}>
            <div className={styles.compose}>
              <section className={styles.editor}>
                <div className={styles.editorHeader}>
                  <div className={styles.editorHeading}>
                    <h2><label htmlFor="ai-writing-instruction">本次情节</label></h2>
                  </div>
                  <Tabs className={styles.mode} value={mode} onValueChange={(value) => setMode(value as 'new' | 'continue')}>
                    <TabsList aria-label="创作方式">
                      <TabsTrigger value="continue">续写</TabsTrigger>
                      <TabsTrigger value="new">新写</TabsTrigger>
                    </TabsList>
                  </Tabs>
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
                    <FormField label="章节标题" htmlFor="ai-writing-chapter-title">
                      <Input
                        id="ai-writing-chapter-title"
                        value={chapterTitle}
                        onChange={(event) => setChapterTitle(event.target.value)}
                        placeholder="例如：第一章 雾中来客"
                      />
                    </FormField>
                  </div>
                )}
                <div className={styles.storySheet}>
                  <Textarea
                    id="ai-writing-instruction"
                    className={styles.storyInput}
                    value={instruction}
                    onChange={(event) => setInstruction(event.target.value)}
                    aria-describedby="ai-writing-instruction-hint"
                    placeholder={mode === 'continue' ? '写下接下来想发生的情节…' : '写下开篇的场景、人物或悬念…'}
                  />
                  <div className={styles.storyFooter}>
                    <p id="ai-writing-instruction-hint" className={styles.caption}>
                      {mode === 'new' ? '大纲和章节会参考本次情节。' : '可留空，由模型构思后续情节。'}
                    </p>
                    <span className={styles.wordCount}>{instructionLength} 字</span>
                  </div>
                </div>
                <div className={styles.assist} aria-busy={suggestBusy || outlineBusy}>
                  <h3 className={styles.assistHeading}>需要一点灵感？</h3>
                  <FormField label="推荐侧重点" htmlFor="ai-writing-focus">
                    <Input
                      id="ai-writing-focus"
                      aria-label="推荐侧重点（可选）"
                      value={focus}
                      onChange={(event) => setFocus(event.target.value)}
                      placeholder="选填，例如：人物关系升温"
                      className={styles.focusInput}
                    />
                  </FormField>
                  <div className={styles.assistActions}>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={busy || suggestBusy || outlineBusy || !novelId}
                      onClick={() => void loadSuggestions()}
                    >
                      {suggestBusy ? '推荐中…' : '寻找灵感'}
                    </Button>
                    {mode === 'continue' && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={busy || taskActive || suggestBusy || outlineBusy || !novelId}
                        onClick={() => void generateOutlineForContinuation()}
                        aria-label={isMultiChapter ? '整理成分章大纲' : '整理成大纲'}
                      >
                        {outlineBusy ? '生成中…' : isMultiChapter ? '整理成分章大纲' : '整理成大纲'}
                      </Button>
                    )}
                  </div>
                </div>
                {requestProgress && <section className={styles.editorProgress} aria-label={requestProgress.kind}>
                  <AiStreamPreview progress={requestProgress.value} structured={requestProgress.kind === '情节方向'} />
                </section>}
                <MotionDetails
                  className={styles.outline}
                  open={deckOpen}
                  onToggle={(event) => setDeckOpen(event.currentTarget.open)}
                >
                  <summary>
                    <span className={styles.outlineLabel}>大纲与灵感</span>
                    <span>{outline.trim() ? '已有大纲' : '选填'}{suggestions.length > 0 && ` · ${suggestions.length} 条灵感`}</span>
                  </summary>
                  <Tabs className={styles.deck} value={deckTab} onValueChange={(value) => setDeckTab(value as 'outline' | 'suggestions')}>
                    <TabsList variant="line" aria-label="构思材料">
                      <TabsTrigger value="outline">{mode === 'continue' ? '续写大纲' : '大纲'}</TabsTrigger>
                      <TabsTrigger value="suggestions">灵感候选{suggestions.length > 0 ? ` · ${suggestions.length}` : ''}</TabsTrigger>
                    </TabsList>
                    <TabsContent value={deckTab} className={styles.deckBody}>
                      {deckTab === 'outline' && mode === 'new' ? (
                        <div className="grid gap-3">
                          <Label htmlFor="ai-writing-outline-new">大纲（生成章节时使用）</Label>
                          <Textarea
                            id="ai-writing-outline-new"
                            className="field-sizing-fixed min-h-[140px] shadow-none"
                            value={outline}
                            onChange={(event) => setOutline(event.target.value)}
                            placeholder="先生成大纲，或直接粘贴已有大纲"
                          />
                        </div>
                      ) : deckTab === 'outline' ? (
                        /* 大纲推演视图 */
                        <div className="grid gap-2.5">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <Label htmlFor="ai-writing-outline" className="text-foreground/90">
                              {isMultiChapter ? '多章续写大纲' : '本章大纲（可选）'}
                            </Label>
                            <div className="flex items-center gap-3">
                              <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
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
                                  className="h-6 px-1.5 text-muted-foreground hover:text-destructive"
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
                            className="field-sizing-fixed min-h-[140px] shadow-none leading-relaxed"
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
                              <span className="text-xs text-muted-foreground shrink-0">点击填入本次情节：</span>
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
                          <p className={styles.caption} aria-live="polite">
                            {suggestBusy ? '正在寻找合适的情节方向…' : suggestions.length > 0
                              ? '选择一个方向填入本次情节，再编辑或整理成大纲。'
                              : '点击「寻找灵感」获取候选情节。'}
                          </p>
                          <div id="ai-writing-suggest-list" className="ai-writing-suggest" aria-busy={suggestBusy}>
                            {suggestions.map((item, index) => (
                              <div
                                key={`${index}-${item.direction.slice(0, 12)}`}
                                style={{ animationDelay: `${getAdminTableRowStaggerDelay(index, suggestions.length)}ms` }}
                              >
                                <button
                                  type="button"
                                  className="ai-writing-suggest__item"
                                  aria-pressed={instruction === item.direction}
                                  onClick={() => {
                                    if (instruction !== item.direction) {
                                      setSuggestionFill({ applied: item.direction, previous: instruction })
                                    }
                                    setInstruction(item.direction)
                                  }}
                                >
                                  <span className="ai-writing-suggest__body">
                                    <span className="ai-writing-suggest__direction">{item.direction}</span>
                                    {item.effect && (
                                      <span className="ai-writing-suggest__effect">{item.effect}</span>
                                    )}
                                  </span>
                                </button>
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
                                className="h-6 px-2"
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
                    </TabsContent>
                  </Tabs>
                </MotionDetails>
              </section>
              <section className={styles.runSettings} aria-labelledby="ai-writing-settings-heading">
                <header className={styles.runHeader}>
                  <h2 id="ai-writing-settings-heading">生成安排</h2>
                  <div className={styles.model}>
                    <span>{props.model || '未配置模型'}</span>
                  </div>
                </header>
                <div className={styles.runControls} data-mode={mode} data-multiple={isMultiChapter || undefined}>
                  {isContinuationMode && (
                    <>
                      <FormField className={styles.anchor} label="续写起点" labelId="ai-writing-after-chapter-label">
                        <SearchSelect
                          options={chapterOptions}
                          value={afterChapterId}
                          onChange={(id) => {
                            setAfterChapterId(id)
                            props.onAfterChapterChange?.(id)
                          }}
                          placeholder={novelId ? '从最新章节续写' : '请先选择作品'}
                          disabled={chapterOptions.length <= 1}
                          searchable
                          searchPlaceholder="搜索章节…"
                          dropdownSide="bottom"
                          aria-labelledby="ai-writing-after-chapter-label"
                        />
                      </FormField>
                      <div className={styles.strategy}>
                        <span id="ai-writing-strategy-label">续写策略</span>
                        <ToggleGroup
                          type="single"
                          className={styles.scaleChoices}
                          aria-labelledby="ai-writing-strategy-label"
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
                      {isMultiChapter && (
                        <FormField className={styles.numberField} label="续写章节数" htmlFor="ai-writing-chapter-count">
                          <div className={styles.numberInput}>
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
                    </>
                  )}
                  <FormField className={`${styles.numberField} ${styles.wordField}`} label={isMultiChapter ? '每章目标字数' : '目标字数'} htmlFor="ai-writing-target-words">
                    <div className={styles.numberInput}>
                      <Input
                        id="ai-writing-target-words"
                        type="number"
                        min={300}
                        max={30000}
                        step={100}
                        value={targetWordsInput.text}
                        onChange={(event) => targetWordsInput.onChangeText(event.target.value)}
                        onBlur={targetWordsInput.commit}
                        aria-describedby="ai-writing-length-note"
                      />
                      <span>字</span>
                    </div>
                  </FormField>
                  <div className={styles.wordPresets} role="group" aria-label="常用目标字数">
                    {[1500, 3000, 5000].map(words => (
                      <Button
                        key={words} type="button" variant="ghost" size="sm"
                        aria-pressed={targetWordsInput.value === words}
                        disabled={busy || taskActive}
                        onClick={() => targetWordsInput.setCommittedValue(words)}
                      >{words.toLocaleString('zh-CN')} 字</Button>
                    ))}
                  </div>
                </div>
                <p className={`${styles.caption} ${styles.lengthNote}`} id="ai-writing-length-note">篇幅包含标点，标题和空白不计入。</p>
                {mode === 'continue' && pendingDrafts > 0 && (
                  <div className={styles.draftNotice}>
                    <p>本书有 {pendingDrafts} 章未发布的续写草稿，当前续写只参考已发布正文。</p>
                    <Button type="button" variant="outline" size="sm" onClick={() => openDrafts()}>
                      先审阅草稿
                    </Button>
                  </div>
                )}
                <div className={styles.referenceEntry}>
                  <Dialog key={`${novelId}:${view}:${props.active !== false}`}>
                    <DialogTrigger asChild>
                      <Button type="button" variant="outline" aria-describedby="ai-writing-reference-state">
                        <span>参考与约束</span>
                      </Button>
                    </DialogTrigger>
                    <ReadingDialog
                      className={styles.root}
                      title="参考与约束"
                      description="按需选择分析参考、调整内容尺度，或补充创作约束。"
                      bodyLabel="本次创作参考设置"
                      footer={
                        <div className={styles.dialogActions}>
                          <p className={styles.caption}>关闭后保留本页设置</p>
                          <DialogClose asChild><Button type="button">完成设置</Button></DialogClose>
                        </div>
                      }
                    >
                      <Tabs defaultValue="analysis" className={styles.referenceTabs}>
                        <div className={styles.referenceNavigation}>
                          <TabsList aria-label="参考设置分类">
                            <TabsTrigger value="analysis">分析参考</TabsTrigger>
                            <TabsTrigger value="content">内容尺度</TabsTrigger>
                            <TabsTrigger value="preparation">约束与材料</TabsTrigger>
                          </TabsList>
                        </div>
                        <TabsContent value="analysis" forceMount className={styles.referencePanel}>
                          <AnalysisReferencePicker
                            key={referenceKey} novelId={novelId} afterChapterId={afterChapterId}
                            active={props.active !== false && view === 'compose'}
                            value={analysisReferences} onChange={setAnalysisReferences}
                            disabled={busy || taskActive} onOpenAnalysis={props.onOpenAnalysis}
                          />
                        </TabsContent>
                        <TabsContent value="content" forceMount className={styles.referencePanel}>
                          <label className={styles.contentOption}>
                            <span className={styles.contentOptionText}>
                              <span className={styles.fieldLabel}>开启露骨 R18 模式</span>
                              <span className={styles.caption}>
                                以成人场景为章节主体，灵感推荐也采用相同尺度。
                              </span>
                            </span>
                            <Switch
                              checked={adultContentMode === 'explicit'}
                              disabled={busy || taskActive}
                              onCheckedChange={(checked) => setAdultContentMode(checked ? 'explicit' : 'off')}
                            />
                          </label>
                          {adultContentMode === 'explicit' ? (
                            <FormField label="同意规则档位" labelId="ai-writing-consent-tier-label" hint="放宽档仅适用于原作主线涉及对应题材、且角色均为成年人的情况；不解除成年前提。">
                              <SearchSelect
                                options={[
                                  { value: 'default', label: '严格（默认，适用于绝大多数作品）' },
                                  { value: 'fictional_nonconsent', label: '虚构题材分级（原作主线即含强迫/下药等情节时使用）' },
                                ]}
                                value={consentRuleTier}
                                onChange={(value) => setConsentRuleTier(value as 'default' | 'fictional_nonconsent')}
                                disabled={busy || taskActive}
                                className={styles.contextSelect}
                                aria-labelledby="ai-writing-consent-tier-label"
                              />
                            </FormField>
                          ) : (
                            <p className={styles.caption}>当前采用常规内容尺度。</p>
                          )}
                        </TabsContent>
                        <TabsContent value="preparation" forceMount className={styles.referencePanel}>
                          <WritingPreparation
                            {...preparationState}
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
                        </TabsContent>
                      </Tabs>
                    </ReadingDialog>
                  </Dialog>
                  <p id="ai-writing-reference-state" className={styles.caption}>
                    {analysisReferences === undefined ? '分析自动选择' : `已选 ${analysisReferences.length} 份分析`} · {adultContentMode === 'explicit' ? 'R18 已启用' : '常规内容'}
                  </p>
                </div>
                <footer className={styles.runFooter}>
                  <div className={styles.runReceipt}>
                    <p className={styles.runPlan}>
                      {isMultiChapter ? `${chapterCount} 章 · 每章` : '目标篇幅'} {targetWordsInput.value.toLocaleString('zh-CN')} 字
                    </p>
                    <p className={styles.caption}>{isContinuationMode && !novelId ? '先选择当前作品，即可开始续写。' : '生成后保存为草稿，审阅后可发布。'}</p>
                  </div>
                  <section className={styles.launchButtons} aria-label="生成操作">
                    {mode === 'new' ? (
                      <>
                        <Button variant="outline" disabled={busy || taskActive} onClick={() => void generateOutline()}>
                          {taskActive && task?.kind === 'write_outline' ? '生成中…' : '生成大纲'}
                        </Button>
                        <Button size="lg" disabled={busy || taskActive} onClick={() => void generateChapter()}>
                          {taskActive && task?.kind === 'write_chapter' ? '生成中…' : '生成章节'}
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="lg"
                        disabled={busy || taskActive || !novelId}
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
                  </section>
                </footer>
              </section>
              {task && <section className={styles.taskRegion} aria-label="本次任务">
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
                        className="ml-auto h-8"
                        onClick={() => void cancelTask()}
                      >
                        取消任务
                      </Button>
                    )}
                    {!taskActive && task.current > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="ml-auto h-8"
                        onClick={() => openDrafts(task.batchId || undefined, task.novelId || novelId)}
                      >
                        {task.batchId ? `查看本批草稿（${task.current} 章）` : '查看草稿'}
                      </Button>
                    )}
                  </div>
                  <p role="status" className="text-xs text-muted-foreground">{task.step || '等待处理'}</p>
                  {taskActive && <AiStreamPreview progress={parseAiTextProgress(task.result)} />}
                  {task.error && <p className="text-xs text-destructive">{task.error}</p>}
                </div>
              </section>}
              {recentTasks.length > 0 && (
                <MotionDetails className={styles.recentTasks}>
                  <summary>
                    <span className={styles.recentTasksLabel}>最近创作任务</span>
                    <span className={styles.recentTasksCount}>{recentTasks.length} 项</span>
                  </summary>
                  <ul className={styles.recentTaskList} aria-label="最近创作任务">
                    {recentTasks.map((item, index) => {
                      const digest = writingTaskDigest(item, 64)
                      const createdAt = new Date(item.createdAt)
                      const hasCreatedAt = item.createdAt > 0 && Number.isFinite(createdAt.getTime())
                      return (
                        <li
                          key={item.id}
                          style={{ animationDelay: `${getAdminTableRowStaggerDelay(index, recentTasks.length)}ms` }}
                          className={styles.recentTask}
                        >
                          <div className={styles.recentTaskHeading}>
                            <div className={styles.recentTaskIdentity}>
                              <span className={styles.recentTaskKind}>{taskKindLabel(item.kind)}</span>
                              {item.novelId !== novelId && item.novelTitle && (
                                <span className={styles.recentTaskBook} title={item.novelTitle}>{item.novelTitle}</span>
                              )}
                            </div>
                            <AdminStatusBadge
                              tone={item.status === 'completed' ? 'success' : item.status === 'failed' ? 'danger' : 'muted'}
                            >
                              {taskStatusLabel(item.status)}
                            </AdminStatusBadge>
                          </div>
                          {digest && <p className={styles.recentTaskTitle}>{digest}</p>}
                          <div className={styles.recentTaskFooter}>
                            <p className={styles.recentTaskMeta}>
                              {hasCreatedAt && <time dateTime={createdAt.toISOString()}>{formatDateTime(item.createdAt)}</time>}
                              <span>{item.current} / {item.total} {item.kind === 'write_outline' ? '项' : '章'}</span>
                            </p>
                            {item.batchId && (
                              <Button
                                variant="link"
                                size="sm"
                                onClick={() => openDrafts(item.batchId, item.novelId || novelId, 'outputs')}
                              >
                                查看产出
                              </Button>
                            )}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </MotionDetails>
              )}
            </div>
          </div>
          {view !== 'compose' && (
            novelId ? (
              <AiGenerationsPanel
                key={`${novelId}:${view}`}
                scope="writing"
                status={view === 'review' ? 'draft' : 'all'}
                novelId={novelId}
                focusBatchId={props.focusBatchId}
                refreshToken={!taskActive && task?.novelId === novelId ? `${task.id}:${task.status}` : undefined}
              />
            ) : (
              <p className={styles.caption}>先在上方选择作品，再查看本书的草稿与产出。</p>
            )
          )}
        <footer className={styles.footer}>
          <span>离开本页后，已提交的任务仍会在后台继续。</span>
          <div>
            <a href="/admin/tasks">任务中心</a>
            <a href="/admin/calls">调用与用量</a>
          </div>
        </footer>
      </section>
    </div>
  )
}
