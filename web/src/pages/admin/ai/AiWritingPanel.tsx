/** AI 创作工作台：新写 / 续写，生成结果先保存为草稿。 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { aiApi, chaptersApi, newOperationId, novelsApi, type AiEffectiveProfile, type AiTaskInfo } from '@/lib/api'
import { useToast, useConfirm } from '@/components/feedback'
import { AdminPanelHeading } from '@/components/admin/AdminWorkspace'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import CustomSelect from '@/components/admin/CustomSelect'
import ProfileOverrideEditor from './ProfileOverrideEditor'
import { Textarea } from '@/components/ui/textarea'
import { PenLine, Sparkles, ArrowRight, ChevronRight } from 'lucide-react'

// 后台创作任务的进度轮询间隔
const TASK_POLL_INTERVAL = 3000
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

function taskStatusLabel(status: string): string {
  return status === 'queued'
    ? '排队中'
    : status === 'running'
      ? '生成中'
      : status === 'completed'
        ? '已完成'
        : status === 'cancelled'
          ? '已取消'
          : status === 'failed'
            ? '失败'
            : status
}

function taskKindLabel(kind: string): string {
  return kind === 'continue' ? '续写' : kind === 'write_outline' ? '大纲' : kind === 'write_chapter' ? '章节' : kind === 'cover' ? '封面' : kind
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

/** 画像提取模块的统一骨架：可展开的标题行（画像名 + 状态徽标 + 操作区）+ 内容面板或空态提示。
 *
 * 已提取时默认折叠：画像正文实测每张 200~290px，三张合计占续写模式整页 43%，
 * 但它们是提取一次、长期复用的资产，不该在每次执行任务时都被滚过。
 * 未提取时没有可折叠的内容，标题行退回纯文本（不可点），空态提示保持常显 ——
 * 否则「未提取」会被折叠成一行无信息量的标题，反而看不出该怎么开始。 */
function ProfileSection(props: {
  label: string
  extracted: boolean
  busy: boolean
  disabled: boolean
  actionText: string
  onAction: () => void
  emptyHint: string
  /** 取样章数输入框的可访问名称；同一页有多个实例，故由调用方给出唯一名称 */
  sampleLabel?: string
  sample?: { value: number; min: number; max: number; onChange: (value: number) => void }
  content?: ReactNode
  footnote?: ReactNode
}) {
  const sample = props.sample
  const contentId = `ai-profile-${props.label}`
  const collapsible = Boolean(props.content)
  // 已提取则默认收起；正文较长，展开态按需触发，与「提取一次、复看少数几次」的使用频率一致
  const [open, setOpen] = useState(false)

  const heading = (
    <>
      <span>{props.label}</span>
      {/* 状态徽标加 aria-hidden：否则按钮的可访问名称会把两段连读成
          「风格画像已提取」（实测），既啰嗦又让「已提取/未提取」抢掉主体名。
          状态改由 aria-expanded 与展开后的内容表达，不再重复播报。 */}
      <span
        aria-hidden={collapsible || undefined}
        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground"
      >
        <span className={`size-1.5 rounded-full ${props.extracted ? 'bg-[var(--color-success)]' : 'bg-muted-foreground/40'}`} />
        {props.extracted ? '已提取' : '未提取'}
      </span>
    </>
  )

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 sm:justify-between">
        <div className="flex shrink-0 items-center gap-2.5">
          {collapsible ? (
            <button type="button" className="ai-profile-trigger" aria-expanded={open} aria-controls={contentId} onClick={() => setOpen((value) => !value)}>
              <ChevronRight className="ai-profile-trigger__caret size-3.5" aria-hidden="true" />
              {heading}
            </button>
          ) : (
            <span className="inline-flex items-center gap-2.5 text-sm font-medium">{heading}</span>
          )}
        </div>
        <div className="flex basis-full items-center justify-between border-t border-border/70 pt-2.5 sm:ml-auto sm:basis-auto sm:border-t-0 sm:pt-0">
          {sample && (
            <div className="flex shrink-0 items-center gap-2">
              <span className="whitespace-nowrap text-xs text-muted-foreground">取样</span>
              <Input
                type="number"
                min={sample.min}
                max={sample.max}
                /* 「取样」是裸文本，与输入框没有程序化关联；单位「章」在控件之后，
                   套 label 会把单位一并读进名称，故用 aria-label。 */
                aria-label={props.sampleLabel || '取样章数'}
                className="h-10 w-13 px-1 text-center sm:h-8 sm:w-[4.5rem]"
                value={sample.value}
                onChange={(event) => sample.onChange(Number(event.target.value))}
              />
              <span className="whitespace-nowrap text-xs text-muted-foreground">章</span>
            </div>
          )}
          <Button
            className="min-h-10 shrink-0 whitespace-nowrap px-3 sm:min-h-0"
            variant="outline"
            size="sm"
            disabled={props.disabled}
            onClick={props.onAction}
          >
            {props.actionText}
          </Button>
        </div>
      </div>
      {props.content ? (
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleContent id={contentId}>
            <div className="rounded-lg border bg-muted/30 px-4 py-3.5 sm:rounded-md sm:px-3.5 sm:py-3">{props.content}</div>
          </CollapsibleContent>
        </Collapsible>
      ) : (
        <div className="rounded-lg border border-dashed px-4 py-3.5 sm:rounded-md sm:px-3.5 sm:py-3">
          <p className="text-sm leading-6 text-muted-foreground sm:text-[13px]">{props.emptyHint}</p>
        </div>
      )}
      {props.footnote}
    </div>
  )
}

export default function AiWritingPanel(props: { onViewBatch?: (batchId?: string) => void } = {}) {
  const { toast } = useToast()
  const { confirm } = useConfirm()
  // AI 创作的主要使用场景是给既有小说续写；新写仍保留为并列入口，而非默认落点。
  const [mode, setMode] = useState<'new' | 'continue'>('continue')
  const [novels, setNovels] = useState<Array<{ id: string; title: string }>>([])
  const [novelId, setNovelId] = useState('')
  const [title, setTitle] = useState('')
  const [chapterTitle, setChapterTitle] = useState('')
  const [instruction, setInstruction] = useState('')
  const [outline, setOutline] = useState('')
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
  const [plotSample, setPlotSample] = useState(8)
  /** 选中小说的关系画像（已提取则展示，续写时自动注入 system prompt） */
  const [relationshipProfile, setRelationshipProfile] = useState('')
  const [relationshipEffective, setRelationshipEffective] = useState<AiEffectiveProfile | null>(null)
  const [relationshipBusy, setRelationshipBusy] = useState(false)
  const [relationshipSample, setRelationshipSample] = useState(10)
  /** 情节方向候选：想不出写什么时先取候选，选中一条填入创作要求。 */
  const [suggestions, setSuggestions] = useState<Array<{ direction: string; effect: string }>>([])
  const [suggestBusy, setSuggestBusy] = useState(false)
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
  /** 自增即触发整组画像重读：人工校正保存/删除后，需要拿到新的基准版本与修订号 */
  const [profileReloadToken, setProfileReloadToken] = useState(0)
  const taskActive = !!task && (task.status === 'queued' || task.status === 'running')
  const isContinuationMode = mode === 'continue'
  const isMultiChapter = isContinuationMode && chapterCount > 1
  const selectedNovelTitle = novels.find((novel) => novel.id === novelId)?.title || ''
  const activeProfileLabels = [
    styleProfile ? '文风画像' : null,
    mode === 'continue' && relationshipProfile ? '关系画像' : null,
    mode === 'continue' && plotState ? '情节状态' : null,
  ].filter((value): value is string => Boolean(value))

  useEffect(() => {
    void novelsApi
      .list({ limit: 100, page: 1 })
      .then((data) => setNovels(data.novels.map((novel) => ({ id: novel.id, title: novel.title }))))
      .catch((err) => toast((err as Error).message, 'error'))
  }, [toast])

  // 挂载时恢复正在运行的创作任务：切换 tab 回来后进度不丢
  useEffect(() => {
    let cancelled = false
    aiApi
      .tasks({ limit: 20 })
      .then((result) => {
        if (cancelled) return
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
      setPlotChaptersThrough(res.chaptersThrough || 0)
      setPlotChapterCount(res.chapterCount || 0)
      return
    }
    const version = ++relationshipRequestVersion.current
    const res = await aiApi.writing.getRelationshipProfile(id).catch(() => null)
    if (!res || cancelled() || version !== relationshipRequestVersion.current) return
    setRelationshipProfile(res.profile || '')
    setRelationshipEffective(res)
  }, [])

  /**
   * 只同步人工校正所需的元数据（baseProfileRevision / manualOverride / effectiveOrigin），
   * 不动画像正文。重新提取后用：正文以 POST 回包为准，第二次 GET 只为拿新基准版本号，
   * 若让它连正文一起写回，反而可能用一次更早发起的读取盖掉刚提取出来的结果。
   */
  const syncEffective = useCallback(async (kind: 'style' | 'plot' | 'relationship', id: string) => {
    if (kind === 'style') {
      const res = await aiApi.writing.getStyleProfile(id).catch(() => null)
      if (res) setStyleEffective(res)
      return
    }
    if (kind === 'plot') {
      const res = await aiApi.writing.getPlotState(id).catch(() => null)
      if (res) {
        setPlotEffective(res)
        setPlotChaptersThrough(res.chaptersThrough || 0)
        setPlotChapterCount(res.chapterCount || 0)
      }
      return
    }
    const res = await aiApi.writing.getRelationshipProfile(id).catch(() => null)
    if (res) setRelationshipEffective(res)
  }, [])

  /** 切书时把三份画像一次读全。 */
  const loadAllProfiles = useCallback(
    async (id: string, cancelled: () => boolean) => {
      await Promise.all([loadProfile('style', id, cancelled), loadProfile('plot', id, cancelled), loadProfile('relationship', id, cancelled)])
    },
    [loadProfile],
  )

  // 选中小说后加载章节列表（倒序），用于选择续写起点
  useEffect(() => {
    setAfterChapterId('')
    // 切书（包括清空选择）立即作废上一部小说的所有在途画像请求。
    let cancelled = false
    // 候选属于某一部小说：切到另一部必须清掉，否则 A 书的方向会留在右列，
    // 而标题仍写「点一条填入左侧创作要求」，用户会以为这是 B 书的方向。
    // 与封面页切书清空候选同理，且一并递增序号，挡住在途响应回写。
    suggestionSeq.current++
    setSuggestions([])
    setSuggestionFill(null)
    setSuggestCollapsed(false)
    // 忙碌态必须在这里一并归零：在途请求返回时 finally 的守卫会拦住它的
    // setSuggestBusy(false)（序号已对不上），不重置的话按钮会永久停在「推荐中…」。
    // 新书此时并没有在途的候选请求，归零是安全的。
    setSuggestBusy(false)
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
    chaptersApi
      .list(novelId)
      .then((res) => {
        if (cancelled) return
        const options = [...res.chapters]
          .sort((a, b) => (b.order || 0) - (a.order || 0))
          .map((ch) => ({ value: ch.id, label: `第 ${ch.order} 章${ch.title ? ` ${ch.title}` : ''}` }))
        setChapterOptions([{ value: '', label: '从最新章节续写（默认）' }, ...options])
      })
      .catch(() => setChapterOptions([]))
    void loadAllProfiles(novelId, () => cancelled)
    return () => {
      cancelled = true
    }
  }, [novelId, loadAllProfiles])

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
  }, [novelId, taskStatus])

  // 轮询后台创作任务：setTask 触发下一轮 effect，形成 3 秒间隔的轮询链，任务结束自然停止
  useEffect(() => {
    if (!task || (task.status !== 'queued' && task.status !== 'running')) return
    const timer = setTimeout(() => {
      if (document.hidden) {
        // 页面不可见时跳过本轮请求，仅续上轮询链
        setTask((prev) => (prev ? { ...prev } : prev))
        return
      }
      aiApi
        .task(task.id)
        .then(({ task: next }) => {
          setTask(next)
          if (next.status === 'completed') toast(`${taskKindLabel(next.kind)}生成完成，草稿已保存到“已生成内容”`, 'success')
          else if (next.status === 'failed') toast(next.error || `AI ${taskKindLabel(next.kind)}生成失败`, 'error')
        })
        .catch(() => setTask((prev) => (prev ? { ...prev } : prev)))
    }, TASK_POLL_INTERVAL)
    return () => clearTimeout(timer)
  }, [task, toast])

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
      '大纲生成已开始，完成后到“已生成内容”查看',
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
          operationId: newOperationId('ai-writing-chapter'),
        }),
      '章节生成已开始，完成后到“已生成内容”查看',
    )
  }

  async function continueNovel() {
    if (!novelId) return toast('请选择小说', 'error')
    const words = targetWordsInput.commit()
    const count = chapterCountInput.commit()
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
          ...(outline.trim() ? { outline } : {}),
          ...(afterChapterId ? { afterChapterId } : {}),
          operationId: newOperationId('ai-writing-continue'),
        }),
      '续写任务已开始，完成后草稿在“已生成内容”',
    )
  }

  async function refreshStyleProfile() {
    if (!novelId) return toast('请选择小说', 'error')
    const version = ++styleRequestVersion.current
    setStyleBusy(true)
    try {
      const res = await aiApi.writing.refreshStyleProfile(novelId)
      // 用 POST 回包立刻更新界面：提取结果是权威内容，不该等第二次 GET 才显示
      if (version === styleRequestVersion.current) setStyleProfile(res.profile)
      toast('风格画像已更新，后续续写将自动套用', 'success')
      // 再同步基准版本号：重新提取会改变 baseProfileRevision，人工校正的基准随之失效，
      // 不同步的话校正编辑器会拿着旧基准去保存（必然 409）。只补元数据、不覆盖正文。
      await syncEffective('style', novelId)
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setStyleBusy(false)
    }
  }

  /** 取情节方向候选。开启成人内容模式时后端会给出以成人场景为主体的方向。 */
  async function loadSuggestions() {
    if (!novelId) return toast('请选择小说', 'error')
    const seq = ++suggestionSeq.current
    const requestedNovelId = novelId
    setSuggestBusy(true)
    try {
      const res = await aiApi.writing.plotSuggestions({
        novelId,
        ...(afterChapterId ? { afterChapterId } : {}),
        ...(focus.trim() ? { focus: focus.trim() } : {}),
        contentPreferences: buildContentPreferences(),
      })
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
      if (seq === suggestionSeq.current) setSuggestBusy(false)
    }
  }

  /**
   * 按当前章节数生成多章大纲，填进大纲框。
   * 大纲会被后端按章拆分后逐章下发，因此要按「第N章」逐段给出。
   */
  async function generateOutlineForContinuation() {
    if (!novelId) return toast('请选择小说', 'error')
    setOutlineBusy(true)
    try {
      const res = await aiApi.writing.plotSuggestions({
        novelId,
        chapterCount,
        ...(afterChapterId ? { afterChapterId } : {}),
        ...(focus.trim() ? { focus: focus.trim() } : {}),
        contentPreferences: buildContentPreferences(),
      })
      if (!res.outline) return toast('未返回可用的大纲', 'error')
      setOutline(res.outline)
      const parsed = countOutlineChapters(res.outline)
      toast(
        parsed >= chapterCount ? `已生成 ${parsed} 章大纲，可编辑后直接续写` : `已生成 ${parsed} 章大纲，不足 ${chapterCount} 章，建议补足或调小续写章数`,
        parsed >= chapterCount ? 'success' : 'error',
      )
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setOutlineBusy(false)
    }
  }

  async function refreshPlotState() {
    if (!novelId) return toast('请选择小说', 'error')
    const version = ++plotRequestVersion.current
    setPlotBusy(true)
    try {
      const res = await aiApi.writing.refreshPlotState(novelId, plotSample)
      // 与 refreshStyleProfile 同理：正文立即用 POST 回包，再补元数据
      if (version === plotRequestVersion.current) {
        setPlotState(res.state)
        setPlotChaptersThrough(res.chaptersThrough)
      }
      toast('情节状态已更新，后续续写将自动套用', 'success')
      await syncEffective('plot', novelId)
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setPlotBusy(false)
    }
  }

  async function refreshRelationshipProfile() {
    if (!novelId) return toast('请选择小说', 'error')
    const version = ++relationshipRequestVersion.current
    setRelationshipBusy(true)
    try {
      const res = await aiApi.writing.refreshRelationshipProfile(novelId, relationshipSample)
      if (version === relationshipRequestVersion.current) setRelationshipProfile(res.profile)
      toast('关系画像已更新，后续续写将自动套用', 'success')
      await syncEffective('relationship', novelId)
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setRelationshipBusy(false)
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

  /**
   * 成人内容不是隐藏的技术参数，而是本次续写的内容边界。
   * 续写模式把它放入「续写基线」首屏；新写模式沿用后方的完整表单，避免两条
   * 工作流互相挤压。两处都复用同一份状态和提交参数，不会产生两套 R18 配置。
   */
  const continuationContentScale =
    mode === 'continue' ? (
      <section className="ai-writing-content-scope" aria-labelledby="ai-writing-content-scope-title">
        <div className="ai-writing-section-heading">
          <div>
            <h3 id="ai-writing-content-scope-title">内容尺度</h3>
            <p>它会同时影响续写和推荐情节；生成前必须在这里确认本次尺度。</p>
          </div>
          <Badge className={adultContentMode === 'explicit' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}>
            {adultContentMode === 'explicit' ? 'R18 已启用' : '常规内容'}
          </Badge>
        </div>
        <label className="ai-writing-content-scope__toggle">
          <span className="min-w-0">
            <span className="block text-sm font-medium text-foreground">开启露骨 R18 模式</span>
            <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">开启后以成人场景为章节主体；推荐情节也会按相同尺度提供方向。</span>
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
              <CustomSelect
                options={[
                  { value: 'default', label: '严格（默认，适用于绝大多数作品）' },
                  { value: 'fictional_nonconsent', label: '虚构题材分级（原作主线即含强迫/下药等情节时使用）' },
                ]}
                value={consentRuleTier}
                onChange={(value) => setConsentRuleTier(value as 'default' | 'fictional_nonconsent')}
                aria-labelledby="ai-writing-consent-tier-label"
              />
              <p className="text-xs text-muted-foreground">放宽档只适用于原作主线本身涉及对应题材且角色均为成年人的情况；它不解除成年前提。</p>
            </div>
          </div>
        )}
      </section>
    ) : null

  const continuationAnalysis =
    mode === 'continue' ? (
      <section className="ai-writing-analysis" aria-labelledby="ai-writing-analysis-title">
        <div className="ai-writing-section-heading">
          <div>
            <h3 id="ai-writing-analysis-title">小说分析</h3>
            <p>文风定表达，关系定人物边界，情节状态防止续写断档。状态始终可见，正文按需展开。</p>
          </div>
          <span className="ai-writing-analysis__count" aria-label={`已提取 ${activeProfileLabels.length} 项小说分析`}>
            已就绪 {activeProfileLabels.length} / 3
          </span>
        </div>
        <div className="ai-writing-profile-list">
          <ProfileSection
            label="风格画像"
            extracted={!!styleProfile}
            busy={styleBusy}
            disabled={busy || styleBusy || taskActive || !novelId}
            actionText={styleBusy ? '提取中…' : styleProfile ? '重新提取' : '提取风格画像'}
            onAction={() => void refreshStyleProfile()}
            emptyHint="提取后续写会参考本作原文的句式、节奏、语气和设定；建议有两章以上正文后提取。"
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
            extracted={!!relationshipProfile}
            busy={relationshipBusy}
            disabled={busy || relationshipBusy || taskActive || !novelId}
            actionText={relationshipBusy ? '提取中…' : relationshipProfile ? '重新提取' : '提取关系画像'}
            onAction={() => void refreshRelationshipProfile()}
            emptyHint="提取角色关系、权力结构和互动尺度，避免续写时把人物关系写偏。"
            sampleLabel="关系画像取样章数"
            sample={{ value: relationshipSample, min: 1, max: 30, onChange: (value) => setRelationshipSample(Math.max(1, Math.min(30, value || 10))) }}
            content={
              relationshipProfile ? (
                <>
                  <ProfileText text={relationshipProfile} />
                  {relationshipEffective && (
                    <ProfileOverrideEditor
                      novelId={novelId}
                      kind="relationship"
                      effective={relationshipEffective}
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
            extracted={!!plotState}
            busy={plotBusy}
            disabled={busy || plotBusy || taskActive || !novelId}
            actionText={plotBusy ? '提取中…' : plotState ? '重新提取' : '提取情节状态'}
            onAction={() => void refreshPlotState()}
            emptyHint="提取角色处境、伏笔和待解决冲突；建议每次关键更新后重新提取。"
            sampleLabel="情节状态取样章数"
            sample={{ value: plotSample, min: 1, max: 30, onChange: (value) => setPlotSample(Math.max(1, Math.min(30, value || 8))) }}
            content={
              plotState ? (
                <>
                  <ProfileText text={plotState} />
                  {plotEffective && (
                    <ProfileOverrideEditor
                      novelId={novelId}
                      kind="plot"
                      effective={plotEffective}
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
                  基于最近 {plotChaptersThrough} 章提取{plotChapterCount > 0 ? `（本书共 ${plotChapterCount} 章）` : ''}；情节状态反映当前进展，取最近章节即可。
                </p>
              ) : undefined
            }
          />
        </div>
      </section>
    ) : null

  return (
    <div className="ai-writing-panel space-y-4">
      <Card className="admin-panel-card ai-writing-card">
        <AdminPanelHeading
          title={
            <span className="admin-panel-title">
              <PenLine className="size-4" aria-hidden="true" />
              创作工作台
            </span>
          }
          description="生成结果先保存为草稿，编辑确认后再发布为正式章节。"
          actions={
            <Tabs value={mode} onValueChange={(value) => setMode(value as 'new' | 'continue')}>
              <TabsList>
                <TabsTrigger value="continue">续写</TabsTrigger>
                <TabsTrigger value="new">新写</TabsTrigger>
              </TabsList>
            </Tabs>
          }
        />
        <CardContent className="ai-writing-workspace">
          <section className="ai-writing-identity" aria-labelledby="ai-writing-identity-title">
            <div className="ai-writing-section-heading">
              <div>
                <h3 id="ai-writing-identity-title">{mode === 'continue' ? '续写目标' : '创作目标'}</h3>
                <p>{mode === 'continue' ? '先确定续写的作品、起点与任务规模，再补齐本次的创作方向。' : '设定作品与章节目标，再组织大纲和本次创作要求。'}</p>
              </div>
              {mode === 'continue' && <span className="ai-writing-identity__mode">{isMultiChapter ? `多章规划 · ${chapterCount} 章` : '单章精写'}</span>}
            </div>
            <div className="ai-form-grid ai-writing-basics grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label id="ai-writing-novel-label">目标小说</Label>
                {/* CustomSelect 渲染的是 button[role=combobox]，不接受 id，故用
                  aria-labelledby 指向标签，保留可见文案作为可访问名称。 */}
                <CustomSelect
                  options={novels.map((novel) => ({ value: novel.id, label: novel.title }))}
                  value={novelId}
                  onChange={setNovelId}
                  placeholder="选择小说"
                  searchable
                  searchPlaceholder="搜索小说名称…"
                  dropdownSide="bottom"
                  className="ai-writing-novel-select"
                  aria-labelledby="ai-writing-novel-label"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ai-writing-title">{mode === 'new' ? '作品标题' : '章节标题（可选）'}</Label>
                <Input
                  id="ai-writing-title"
                  value={mode === 'new' ? title : chapterTitle}
                  onChange={(event) => (mode === 'new' ? setTitle(event.target.value) : setChapterTitle(event.target.value))}
                  placeholder={mode === 'new' ? '例如：雾城来信' : '例如：第十二章 暴雨前夜'}
                />
              </div>
            </div>
            {mode === 'new' && (
              <div className="ai-writing-chapter-title grid gap-1.5">
                <Label htmlFor="ai-writing-chapter-title">章节标题</Label>
                <Input
                  id="ai-writing-chapter-title"
                  value={chapterTitle}
                  onChange={(event) => setChapterTitle(event.target.value)}
                  placeholder="例如：第一章 雾中来客"
                />
              </div>
            )}
            <div className="ai-form-grid ai-writing-options grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className="grid gap-1.5">
                <Label htmlFor="ai-writing-target-words">{mode === 'continue' ? '每章目标字数' : '目标字数'}</Label>
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
              </div>
              {isContinuationMode && (
                <div className="ai-writing-run-scale grid gap-1.5">
                  <Label id="ai-writing-run-scale-label">续写策略</Label>
                  <div className="ai-writing-run-scale__choices" role="group" aria-labelledby="ai-writing-run-scale-label">
                    <Button
                      type="button"
                      variant={isMultiChapter ? 'outline' : 'secondary'}
                      size="sm"
                      aria-pressed={!isMultiChapter}
                      disabled={busy || taskActive}
                      onClick={() => chapterCountInput.setCommittedValue(1)}
                    >
                      单章精写
                    </Button>
                    <Button
                      type="button"
                      variant={isMultiChapter ? 'secondary' : 'outline'}
                      size="sm"
                      aria-pressed={isMultiChapter}
                      disabled={busy || taskActive}
                      onClick={() => chapterCountInput.setCommittedValue(Math.max(2, chapterCount))}
                    >
                      多章规划
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {isMultiChapter ? '每章按大纲逐段下发；请在下方确认大纲覆盖全部章节。' : '推荐先围绕一条情节方向精写一章；需要连续推进时再切换为多章规划。'}
                  </p>
                </div>
              )}
              {mode === 'continue' && isMultiChapter && (
                <div className="grid gap-1.5">
                  <Label htmlFor="ai-writing-chapter-count">续写章节数</Label>
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
                </div>
              )}
            </div>
          </section>
          {mode === 'continue' && (
            <section className="ai-writing-baseline" aria-labelledby="ai-writing-baseline-title">
              <div className="ai-writing-section-heading">
                <div>
                  <h3 id="ai-writing-baseline-title">续写基线</h3>
                  <p>这些上下文会决定本次续写的尺度、人物边界和承接方向。</p>
                </div>
                {selectedNovelTitle && <span className="ai-writing-baseline__novel">{selectedNovelTitle}</span>}
              </div>
              {chapterOptions.length > 1 && (
                <div className="ai-writing-continuation-start grid gap-1.5">
                  <Label id="ai-writing-after-chapter-label">续写起点</Label>
                  <CustomSelect
                    options={chapterOptions}
                    value={afterChapterId}
                    onChange={setAfterChapterId}
                    placeholder="从最新章节续写（默认）"
                    searchable
                    searchPlaceholder="搜索章节…"
                    dropdownSide="bottom"
                    aria-labelledby="ai-writing-after-chapter-label"
                  />
                </div>
              )}
              {chapterOptions.length <= 1 && (
                <p className="ai-writing-continuation-start__status">{novelId ? '续写起点：将从最新已发布章节继续。' : '选择小说后，可在这里确认续写起点。'}</p>
              )}
              {continuationContentScale}
              {continuationAnalysis}
            </section>
          )}
          <div className="ai-writing-notes grid gap-4 border-t pt-5">
            {/* 创作要求是这一页权重最高的输入：它逐章下发，直接决定写出什么。
                此前它只是「一个标签 + 一个 textarea」，与下方的侧重点输入框视觉同级，
                用户分不清哪个才是给模型的要求；空着会怎样也没有任何提示。
                现把它立为带标题行与状态提示的主区。 */}
            {/* 创作要求与候选改为左右两栏：候选是「填进要求」的选项，
                点完必须能立刻看到左侧正文的变化；上下排布时两者相隔一屏，
                用户点完要滚回去核对填了什么。同屏后这个动作才闭环。

                左列创作要求因此收窄到约半幅：原来整幅宽 1248px 时一行可容
                上百个全角字，远超舒适阅读宽度，分栏后自然落到可读区间。 */}
            <div className={`ai-writing-brief-layout${suggestions.length === 0 ? ' is-aside-empty' : ''}`}>
              <div className="ai-writing-brief-layout__main">
                <section className="ai-writing-brief">
                  <div className="ai-writing-brief__head">
                    <Label htmlFor="ai-writing-instruction">创作要求</Label>
                    <span className="ai-writing-brief__count">
                      {instruction.replace(/\s/g, '').length > 0 ? `${instruction.replace(/\s/g, '').length} 字` : '未填写'}
                    </span>
                  </div>
                  <Textarea
                    id="ai-writing-instruction"
                    className="field-sizing-fixed min-h-[8rem] shadow-none text-sm"
                    value={instruction}
                    onChange={(event) => setInstruction(event.target.value)}
                    aria-describedby="ai-writing-instruction-hint"
                    placeholder={'说清这一章发生什么、谁参与、推进哪条线。\n例如：苏越在朝堂以斗宗身份现身，当众治愈加刑天，逼云山表态。'}
                  />
                  <p id="ai-writing-instruction-hint" className="ai-writing-brief__hint">
                    {instruction.trim()
                      ? mode === 'continue' && chapterCount > 1
                        ? `本要求会原样下发给这 ${chapterCount} 章的每一章。多章建议只写整体方向与尺度，逐章内容交给下方大纲。`
                        : '本要求会随生成请求下发给模型；可先「推荐情节」挑一条，再按需改写。'
                      : '留空时模型自行发挥，情节走向随机——同一本书同一起点，两批结果可能完全不同。建议先「推荐情节」挑一条。'}
                  </p>
                </section>
                {/* 「推荐侧重点」不是创作要求的一部分，而是「推荐情节」的输入参数。
                    它此前只有 aria-label、没有可见标签，用户看到上下两个输入框会以为
                    这是第二处创作要求；现补可见标签，坐实「这是给按钮用的参数」。 */}
                <div className="ai-writing-assist">
                  <span className="ai-writing-assist__label" aria-hidden="true">
                    侧重点
                  </span>
                  <Input
                    aria-label="推荐侧重点（可选）"
                    value={focus}
                    onChange={(event) => setFocus(event.target.value)}
                    placeholder="可留空，例如：感情升温的日常互动"
                  />
                  <Button type="button" variant="outline" size="sm" disabled={busy || suggestBusy || !novelId} onClick={() => void loadSuggestions()}>
                    {suggestBusy ? (
                      '推荐中…'
                    ) : (
                      <>
                        <Sparkles className="size-3.5" aria-hidden="true" />
                        推荐情节
                      </>
                    )}
                  </Button>
                </div>
              </div>
              <div className="ai-writing-brief-layout__aside">
                {suggestions.length > 0 ? (
                  <div className="ai-writing-suggest-block">
                    <div className="ai-writing-suggest-block__head">
                      <p className="text-xs text-muted-foreground">
                        {suggestCollapsed ? `已取回 ${suggestions.length} 条方向，展开后点击即填入左侧创作要求` : '点一条填入左侧创作要求，填入后可继续修改'}
                      </p>
                      {/* 只切换显示，不丢弃数据：收起后仍可展开回来，不必重新请求 */}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        aria-expanded={!suggestCollapsed}
                        aria-controls="ai-writing-suggest-list"
                        onClick={() => setSuggestCollapsed((value) => !value)}
                      >
                        {suggestCollapsed ? '展开' : '收起'}
                      </Button>
                    </div>
                    {!suggestCollapsed && (
                      <div id="ai-writing-suggest-list" className="ai-writing-suggest">
                        {suggestions.map((item, index) => (
                          <button
                            key={`${index}-${item.direction.slice(0, 12)}`}
                            type="button"
                            className="ai-writing-suggest__item"
                            // 让读屏知道当前框里的内容是否就是这一条
                            aria-pressed={instruction === item.direction}
                            onClick={() => {
                              // 整段覆盖，先留下原文以便撤销；同一条重复点不覆盖撤销记录
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
                        ))}
                      </div>
                    )}
                    {/* 填入是整段覆盖，且用户可能已经手写过内容——给一次后悔的机会。
                        只在「当前要求确实还是那条候选」时显示，避免撤销按钮指向过期状态。 */}
                    {!suggestCollapsed && suggestionFill && instruction === suggestionFill.applied && (
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
                ) : (
                  /* 尚未取候选时的占位。此前是一整块虚线空态，与左列等高后右下方
                     会空出一大片（实测约 400px），既浪费空间又把视线拖走。
                     改为一条与「侧重点」行等高的内联提示：既能说明候选从哪来，
                     又不占据左列正文的高度，右列多余的空白随之收起。 */
                  <p className="ai-writing-suggest-placeholder">
                    <Sparkles className="size-3.5" aria-hidden="true" />
                    <span>点左侧「推荐情节」，这里会列出可直接填入的续写方向（取自最新章节，需已发布章节）。</span>
                  </p>
                )}
              </div>
            </div>
            {/* 成人内容与大纲是两件不同的事：一个是本次任务的写作尺度，一个是内容结构
                输入。此前两者同处一个 grid、只靠 border-top 分隔，展开后的确认项又紧贴
                大纲标签，读起来像同一组设置。现按本页其它段的写法独立成段。

                段内沿用本面板族既有的「开关行」范式（对照 AiParamsPanel 的
                「回来接着读功能」、AiSettingsCard 的「阅读器前情提要」）：文字在左、
                Switch 在右、整行可点，而不是为 R18 另造一套视觉。 */}
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
                  <Badge className={adultContentMode === 'explicit' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}>
                    {adultContentMode === 'explicit' ? '已启用' : '未启用'}
                  </Badge>
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
                      <CustomSelect
                        options={[
                          { value: 'default', label: '严格（默认，适用于绝大多数作品）' },
                          { value: 'fictional_nonconsent', label: '虚构题材分级（原作主线即含强迫/下药等情节时使用）' },
                        ]}
                        value={consentRuleTier}
                        onChange={(value) => setConsentRuleTier(value as 'default' | 'fictional_nonconsent')}
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
            <div className="grid gap-1.5 border-t pt-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label htmlFor="ai-writing-outline">{mode === 'new' ? '大纲（生成章节时使用）' : isMultiChapter ? '多章续写大纲' : '本章大纲（可选）'}</Label>
                {mode === 'continue' && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    // outlineBusy 必须进禁用条件：否则生成期间可重复点击，重复发起同一批大纲请求
                    disabled={busy || taskActive || outlineBusy || !novelId}
                    onClick={() => void generateOutlineForContinuation()}
                  >
                    {outlineBusy ? '生成中…' : isMultiChapter ? '按情节推荐生成大纲（多章）' : '按情节推荐生成大纲（单章）'}
                  </Button>
                )}
              </div>
              <Textarea
                id="ai-writing-outline"
                className="field-sizing-fixed min-h-[140px] shadow-none text-sm"
                value={outline}
                onChange={(event) => setOutline(event.target.value)}
                placeholder={
                  mode === 'new'
                    ? '先生成大纲，或直接粘贴已有大纲'
                    : isMultiChapter
                      ? '每章一行、以「第N章」开头，例如：\n第1章 重返皇城\n苏越带夭夜入城面见加刑天。\n第2章 婚夜\n两人在寝宫独处，约定共进退。'
                      : '可留空。单章建议优先写清本次情节；需要更细致安排时，可在此补一段本章提纲。'
                }
              />
              {mode === 'continue' && isMultiChapter && outline.trim() && (
                /* 大纲章数与续写章数必须对得上才有意义，此前只报「识别到 N 段」，
                   用户得自己心算够不够；现直接给出对比结论与差值。 */
                <div className={`ai-writing-outline-status${countOutlineChapters(outline) >= chapterCount ? ' is-ok' : ' is-short'}`}>
                  <span className="ai-writing-outline-status__figure">
                    {countOutlineChapters(outline)}
                    <span aria-hidden="true"> / </span>
                    {chapterCount}
                  </span>
                  <span className="ai-writing-outline-status__text">
                    {countOutlineChapters(outline) >= chapterCount
                      ? `已识别 ${countOutlineChapters(outline)} 个章节段落，够这 ${chapterCount} 章逐章下发，同一段内容不会在每章重复。`
                      : `已识别 ${countOutlineChapters(outline)} 个章节段落，不足 ${chapterCount} 章：多出的续写章会按创作要求生成，可能与已写内容重复。建议补足大纲或调小续写章数。`}
                  </span>
                </div>
              )}
            </div>
          </div>
          {/* 执行区刻意排在「小说分析」之前：任务是每次都要跑的，三张画像是提取一次、
              长期复用的资产（实测占 913px，是页面最高的区块）。原先把执行区放在最底部，
              每次执行都得先滚过基本不变的分析文本 —— 续写模式下主按钮距顶部 2023px，
              需滚 1123px 才出现，且中间还夹着两个「重新提取」按钮。
              移到画像之前后，按钮落在约 190px 处，滚动任意位置都完整可见。
              任务状态卡一并上移：它是「刚刚那次执行」的回执，属于本区语义。 */}
          <div className="ai-writing-actions grid gap-3 border-t pt-5">
            <div className="ai-writing-section-heading ai-writing-section-heading--actions">
              <div>
                <h3>{mode === 'continue' ? '生成续写' : '生成内容'}</h3>
                <p>{mode === 'continue' ? '确认本次会携带的上下文，再将结果保存为可审阅草稿。' : '生成结果会先保存为草稿，编辑确认后再发布。'}</p>
              </div>
            </div>
            {isContinuationMode && (
              <p className="ai-writing-launch-summary" aria-live="polite">
                {novelId ? (
                  <>
                    将续写《{selectedNovelTitle || '当前小说'}》{afterChapterId ? '指定章节之后' : '最新已发布章节之后'} ·{' '}
                    {isMultiChapter ? `${chapterCount} 章规划` : '单章精写'} · {adultContentMode === 'explicit' ? 'R18 已启用' : '常规内容'}
                    {activeProfileLabels.length > 0 ? ` · 已注入：${activeProfileLabels.join('、')}` : ' · 尚未提取小说分析'}
                  </>
                ) : (
                  '先选择小说；续写基线会随所选作品加载。'
                )}
              </p>
            )}
            {mode === 'continue' && pendingDrafts > 0 && !taskActive && (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                <span>该小说有 {pendingDrafts} 章未发布的续写草稿。续写上下文只取已发布章节，建议先发布草稿再继续，避免剧情断档。</span>
                {props.onViewBatch && (
                  <Button variant="outline" size="sm" className="ml-auto" onClick={() => props.onViewBatch?.()}>
                    查看草稿
                  </Button>
                )}
              </div>
            )}
            {task && (
              <div className="rounded-md border bg-muted/40 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`size-1.5 shrink-0 rounded-full ${taskDotClass(task.status)}`} aria-hidden />
                  <span className="font-medium">
                    {taskKindLabel(task.kind)} · {taskStatusLabel(task.status)}
                  </span>
                  {task.kind === 'continue' && (
                    <span className="text-muted-foreground">
                      {task.current} / {task.total} 章
                    </span>
                  )}
                  {taskActive && (
                    <Button variant="outline" size="sm" className="ml-auto" onClick={() => void cancelTask()}>
                      取消任务
                    </Button>
                  )}
                  {!taskActive && task.current > 0 && props.onViewBatch && (
                    <Button variant="outline" size="sm" className="ml-auto" onClick={() => props.onViewBatch?.(task.batchId || undefined)}>
                      {task.batchId ? `查看本批草稿（${task.current} 章）` : '查看草稿'}
                    </Button>
                  )}
                </div>
                <p className="mt-1 text-muted-foreground">{task.step || '等待处理'}</p>
                {task.error && <p className="mt-1 text-destructive">{task.error}</p>}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {mode === 'new' ? (
                <>
                  <Button variant="secondary" disabled={busy || taskActive} onClick={() => void generateOutline()}>
                    {taskActive && task?.kind === 'write_outline' ? '生成中…' : '生成大纲'}
                  </Button>
                  <Button disabled={busy || taskActive} onClick={() => void generateChapter()}>
                    {taskActive && task?.kind === 'write_chapter' ? '生成中…' : '生成章节'}
                  </Button>
                </>
              ) : (
                <Button disabled={busy || taskActive} onClick={() => void continueNovel()}>
                  {taskActive && task?.kind === 'continue' ? '生成中…' : '生成续写'}
                </Button>
              )}
            </div>
          </div>
          {mode === 'new' && (
            <div className="grid gap-4 border-t pt-5">
              <div>
                <p className="text-sm font-medium">小说分析</p>
                <p className="text-xs text-muted-foreground">提取后自动注入续写：风格画像定文风，关系画像定人设边界，情节状态防断档。</p>
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
        </CardContent>
      </Card>
    </div>
  )
}
