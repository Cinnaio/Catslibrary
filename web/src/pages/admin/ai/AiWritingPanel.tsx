/** AI 创作工作台：新写 / 续写，生成结果先保存为草稿。 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { aiApi, chaptersApi, novelsApi, type AiTaskInfo } from '@/lib/api'
import { useToast, useConfirm } from '@/components/feedback'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import CustomSelect from '@/components/admin/CustomSelect'

// 后台创作任务的进度轮询间隔
const TASK_POLL_INTERVAL = 3000
// 后台化的创作任务类型
const WRITING_TASK_KINDS = new Set(['continue', 'write_outline', 'write_chapter'])
// 超过该章数的批量续写需要二次确认（成本意识）
const CONFIRM_CHAPTER_COUNT = 5

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
  const paragraphs = text.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean)
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

/** 画像提取模块的统一骨架：标题 + 提取状态徽标 + 操作区（可选取样章数），内容面板或空态提示。 */
function ProfileSection(props: {
  label: string
  extracted: boolean
  busy: boolean
  disabled: boolean
  actionText: string
  onAction: () => void
  emptyHint: string
  sample?: { value: number; min: number; max: number; onChange: (value: number) => void }
  content?: ReactNode
  footnote?: ReactNode
}) {
  const sample = props.sample
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 sm:justify-between">
        <div className="flex shrink-0 items-center gap-2.5">
          <Label>{props.label}</Label>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground">
            <span className={`size-1.5 rounded-full ${props.extracted ? 'bg-[var(--color-success)]' : 'bg-muted-foreground/40'}`} />
            {props.extracted ? '已提取' : '未提取'}
          </span>
        </div>
        <div className="flex basis-full items-center justify-between border-t border-border/70 pt-2.5 sm:ml-auto sm:basis-auto sm:border-t-0 sm:pt-0">
          {sample && (
            <div className="flex shrink-0 items-center gap-2">
              <span className="whitespace-nowrap text-xs text-muted-foreground">取样</span>
              <Input
                type="number"
                min={sample.min}
                max={sample.max}
                className="h-10 w-13 px-1 text-center sm:h-8 sm:w-[4.5rem]"
                value={sample.value}
                onChange={(event) => sample.onChange(Number(event.target.value))}
              />
              <span className="whitespace-nowrap text-xs text-muted-foreground">章</span>
            </div>
          )}
          <Button className="min-h-10 shrink-0 whitespace-nowrap px-3 sm:min-h-0" variant="outline" size="sm" disabled={props.disabled} onClick={props.onAction}>
            {props.actionText}
          </Button>
        </div>
      </div>
      {props.content ? (
        <div className="rounded-lg border bg-muted/30 px-4 py-3.5 sm:rounded-md sm:px-3.5 sm:py-3">{props.content}</div>
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
  const [mode, setMode] = useState<'new' | 'continue'>('new')
  const [novels, setNovels] = useState<Array<{ id: string; title: string }>>([])
  const [novelId, setNovelId] = useState('')
  const [title, setTitle] = useState('')
  const [chapterTitle, setChapterTitle] = useState('')
  const [instruction, setInstruction] = useState('')
  const [outline, setOutline] = useState('')
  const [targetWords, setTargetWords] = useState(2000)
  const [chapterCount, setChapterCount] = useState(1)
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
  const [styleBusy, setStyleBusy] = useState(false)
  /** 选中小说的情节状态（已提取则展示，续写时自动注入 user 消息） */
  const [plotState, setPlotState] = useState('')
  const [plotChaptersThrough, setPlotChaptersThrough] = useState(0)
  const [plotChapterCount, setPlotChapterCount] = useState(0)
  const [plotBusy, setPlotBusy] = useState(false)
  const [plotSample, setPlotSample] = useState(8)
  /** 选中小说的关系画像（已提取则展示，续写时自动注入 system prompt） */
  const [relationshipProfile, setRelationshipProfile] = useState('')
  const [relationshipBusy, setRelationshipBusy] = useState(false)
  const [relationshipSample, setRelationshipSample] = useState(10)
  // 初始读取与手动重新提取可能并发；只让每类画像最新一轮请求更新页面。
  const styleRequestVersion = useRef(0)
  const plotRequestVersion = useRef(0)
  const relationshipRequestVersion = useRef(0)
  const taskActive = !!task && (task.status === 'queued' || task.status === 'running')

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

  // 选中小说后加载章节列表（倒序），用于选择续写起点
  useEffect(() => {
    setAfterChapterId('')
    // 切书（包括清空选择）立即作废上一部小说的所有在途画像请求。
    const styleVersion = ++styleRequestVersion.current
    const plotVersion = ++plotRequestVersion.current
    const relationshipVersion = ++relationshipRequestVersion.current
    if (!novelId) {
      setChapterOptions([])
      setStyleProfile('')
      setPlotState('')
      setPlotChaptersThrough(0)
      setPlotChapterCount(0)
      setRelationshipProfile('')
      return
    }
    let cancelled = false
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
    // 读已存的风格画像：有则展示，没有则空（续写时后端会兜底，不阻断）
    aiApi.writing
      .getStyleProfile(novelId)
      .then((res) => {
        if (!cancelled && styleVersion === styleRequestVersion.current) setStyleProfile(res.profile || '')
      })
      .catch(() => {})
    // 读已存的情节状态与已发布章节数：后者大于前者说明状态落后于最新章节（过期提醒）
    aiApi.writing
      .getPlotState(novelId)
      .then((res) => {
        if (!cancelled && plotVersion === plotRequestVersion.current) {
          setPlotState(res.state || '')
          setPlotChaptersThrough(res.chaptersThrough || 0)
          setPlotChapterCount(res.chapterCount || 0)
        }
      })
      .catch(() => {})
    // 读已存的关系画像：有则展示，没有则空（续写时后端会兜底，不阻断）
    aiApi.writing
      .getRelationshipProfile(novelId)
      .then((res) => {
        if (!cancelled && relationshipVersion === relationshipRequestVersion.current) setRelationshipProfile(res.profile || '')
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [novelId])

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
    await startTask(() => aiApi.writing.outline({ novelId, title, instruction, targetWords, chapterCount }), '大纲生成已开始，完成后到“已生成内容”查看')
  }

  async function generateChapter() {
    if (!novelId || !chapterTitle.trim()) return toast('请选择小说并填写章节标题', 'error')
    await startTask(
      () => aiApi.writing.chapter({ novelId, title, outline, instruction, targetWords, chapterCount }),
      '章节生成已开始，完成后到“已生成内容”查看',
    )
  }

  async function continueNovel() {
    if (!novelId) return toast('请选择小说', 'error')
    // 批量续写是连续 N 次模型调用，超过阈值先确认，避免误触烧钱
    if (chapterCount > CONFIRM_CHAPTER_COUNT) {
      const ok = await confirm({
        title: `批量续写 ${chapterCount} 章？`,
        message: `将按顺序连续调用 AI ${chapterCount} 次（每章一次），生成期间可随时取消，已生成章节会保留为草稿。`,
        okText: '开始续写',
        cancelText: '取消',
      })
      if (!ok) return
    }
    await startTask(
      () => aiApi.writing.continue({ novelId, title: chapterTitle, instruction, targetWords, chapterCount, ...(afterChapterId ? { afterChapterId } : {}) }),
      '续写任务已开始，完成后草稿在“已生成内容”',
    )
  }

  async function refreshStyleProfile() {
    if (!novelId) return toast('请选择小说', 'error')
    const version = ++styleRequestVersion.current
    setStyleBusy(true)
    try {
      const res = await aiApi.writing.refreshStyleProfile(novelId)
      if (version === styleRequestVersion.current) setStyleProfile(res.profile)
      toast('风格画像已更新，后续续写将自动套用', 'success')
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setStyleBusy(false)
    }
  }

  async function refreshPlotState() {
    if (!novelId) return toast('请选择小说', 'error')
    const version = ++plotRequestVersion.current
    setPlotBusy(true)
    try {
      const res = await aiApi.writing.refreshPlotState(novelId, plotSample)
      if (version === plotRequestVersion.current) {
        setPlotState(res.state)
        setPlotChaptersThrough(res.chaptersThrough)
      }
      // 章节数本地已加载过，直接用；接口返回的 chaptersThrough 已是最新取样数
      toast('情节状态已更新，后续续写将自动套用', 'success')
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
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setRelationshipBusy(false)
    }
  }

  async function cancelTask() {
    if (!task) return
    try {
      await aiApi.cancelTask(task.id)
      const { task: next } = await aiApi.task(task.id)
      setTask(next)
      toast('任务已取消', 'success')
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div>
            <CardTitle className="text-base">AI 创作工作台</CardTitle>
            <p className="text-sm text-muted-foreground">生成结果先保存为草稿，编辑确认后再发布为正式章节。</p>
          </div>
        </CardHeader>
        <CardContent className="grid gap-5">
          <Tabs value={mode} onValueChange={(value) => setMode(value as 'new' | 'continue')}>
            <TabsList>
              <TabsTrigger value="new">新写</TabsTrigger>
              <TabsTrigger value="continue">续写</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="ai-form-grid grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>目标小说</Label>
              <CustomSelect
                options={novels.map((novel) => ({ value: novel.id, label: novel.title }))}
                value={novelId}
                onChange={setNovelId}
                placeholder="选择小说"
                searchable
                searchPlaceholder="搜索小说名称…"
                dropdownSide="bottom"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>{mode === 'new' ? '作品标题' : '章节标题（可选）'}</Label>
              <Input
                value={mode === 'new' ? title : chapterTitle}
                onChange={(event) => (mode === 'new' ? setTitle(event.target.value) : setChapterTitle(event.target.value))}
                placeholder={mode === 'new' ? '例如：雾城来信' : '例如：第十二章 暴雨前夜'}
              />
            </div>
          </div>
          {mode === 'new' && (
            <div className="grid gap-1.5">
              <Label>章节标题</Label>
              <Input value={chapterTitle} onChange={(event) => setChapterTitle(event.target.value)} placeholder="例如：第一章 雾中来客" />
            </div>
          )}
          <div className="ai-form-grid grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="grid gap-1.5">
              <Label>{mode === 'continue' ? '每章目标字数' : '目标字数'}</Label>
              <Input
                type="number"
                min={300}
                max={30000}
                step={100}
                value={targetWords}
                onChange={(event) => setTargetWords(Number(event.target.value) || 300)}
              />
            </div>
            {mode === 'continue' && (
              <div className="grid gap-1.5">
                <Label>续写章节数</Label>
                <Input
                  type="number"
                  min={1}
                  max={20}
                  value={chapterCount}
                  onChange={(event) => setChapterCount(Math.max(1, Math.min(20, Number(event.target.value) || 1)))}
                />
              </div>
            )}
            {mode === 'continue' && chapterOptions.length > 1 && (
              <div className="grid gap-1.5">
                <Label>续写起点</Label>
                <CustomSelect
                  options={chapterOptions}
                  value={afterChapterId}
                  onChange={setAfterChapterId}
                  placeholder="从最新章节续写（默认）"
                  searchable
                  searchPlaceholder="搜索章节…"
                  dropdownSide="bottom"
                />
              </div>
            )}
          </div>
          <div className="grid gap-4 border-t pt-5">
            <div className="grid gap-1.5">
              <Label>创作要求</Label>
              <textarea data-slot="textarea"
                className="min-h-[100px] w-full border border-input bg-background px-3 py-2 text-sm"
                value={instruction}
                onChange={(event) => setInstruction(event.target.value)}
                placeholder="人物、风格、冲突、节奏或本次剧情目标"
              />
            </div>
            {mode === 'new' && (
              <div className="grid gap-1.5">
                <Label>大纲（生成章节时使用）</Label>
                <textarea data-slot="textarea"
                  className="min-h-[140px] w-full border border-input bg-background px-3 py-2 text-sm"
                  value={outline}
                  onChange={(event) => setOutline(event.target.value)}
                  placeholder="先生成大纲，或直接粘贴已有大纲"
                />
              </div>
            )}
          </div>
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
              content={styleProfile ? <ProfileText text={styleProfile} /> : undefined}
            />
            {mode === 'continue' && (
              <ProfileSection
                label="关系画像"
                extracted={!!relationshipProfile}
                busy={relationshipBusy}
                disabled={busy || relationshipBusy || taskActive || !novelId}
                actionText={relationshipBusy ? '提取中…' : relationshipProfile ? '重新提取' : '提取关系画像'}
                onAction={() => void refreshRelationshipProfile()}
                emptyHint="提取后把角色关系动态、权力结构、心理边界、互动尺度塞进续写，防止主从写成平等恋人、把奖赏手段当真心、从属试探写成主导。关系底色较稳定，建议取较长窗口看清演变。"
                sample={{ value: relationshipSample, min: 1, max: 30, onChange: (value) => setRelationshipSample(Math.max(1, Math.min(30, value || 10))) }}
                content={relationshipProfile ? <ProfileText text={relationshipProfile} /> : undefined}
              />
            )}
            {mode === 'continue' && (
              <ProfileSection
                label="情节状态"
                extracted={!!plotState}
                busy={plotBusy}
                disabled={busy || plotBusy || taskActive || !novelId}
                actionText={plotBusy ? '提取中…' : plotState ? '重新提取' : '提取情节状态'}
                onAction={() => void refreshPlotState()}
                emptyHint="多章续写时上下文会截断丢前文，提取后把角色处境、伏笔、待解决冲突塞进续写，人设不漂移、伏笔不遗忘。建议续写前更新一次。"
                sample={{ value: plotSample, min: 1, max: 30, onChange: (value) => setPlotSample(Math.max(1, Math.min(30, value || 8))) }}
                content={plotState ? <ProfileText text={plotState} /> : undefined}
                footnote={
                  plotState ? (
                    <p className="text-xs leading-5 text-muted-foreground">
                      基于最近 {plotChaptersThrough} 章提取{plotChapterCount > 0 ? `（本书共 ${plotChapterCount} 章）` : ''}。情节状态反映「当前」进展，只取最近几章即可，无需等于全书章节数；若上次提取后又发布了新章节，建议重新提取。
                    </p>
                  ) : undefined
                }
              />
            )}
          </div>
          <div className="grid gap-3 border-t pt-5">
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
        </CardContent>
      </Card>
    </div>
  )
}
