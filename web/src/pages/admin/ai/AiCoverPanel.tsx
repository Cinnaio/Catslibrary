/** AI 封面生成工作台：选小说 → 生成封面（落候选，不覆盖）→ 预览候选 → 采纳/弃用/上传替换。 */
import { useEffect, useRef, useState } from 'react'
import { aiApi, novelsApi, url, type AiCoverCandidate, type AiTaskInfo } from '@/lib/api'
import { useToast } from '@/components/feedback'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import CustomSelect from '@/components/admin/CustomSelect'
import { BookOpen, CircleAlert, Loader2, Palette, Sparkles, Trash2, Upload, Wand2 } from 'lucide-react'

// 后台封面任务的进度轮询间隔（与 AiWritingPanel 对齐）
const TASK_POLL_INTERVAL = 3000
const COVER_TASK_KINDS = new Set(['cover'])

/** 平台风格选项：与后端 PLATFORM_STYLES / settings.coverPlatform 白名单对齐 */
const PLATFORM_OPTIONS = [
  { value: 'default', label: '通用（竖版 2:3）' },
  { value: 'fanqie', label: '番茄小说' },
  { value: 'qidian', label: '起点' },
  { value: 'jinjiang', label: '晋江' },
  { value: 'zhihu', label: '知乎盐言' },
  { value: 'qimao', label: '七猫' },
  { value: 'ciweimao', label: '刺猬猫' },
]

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

/** 任务状态指示点颜色：按状态语义映射到站点语义色。 */
function statusDotColor(status: string): string {
  if (status === 'queued') return 'bg-[var(--color-warning)]'
  if (status === 'running') return 'bg-[var(--accent)]'
  if (status === 'completed') return 'bg-[var(--color-success)]'
  if (status === 'failed') return 'bg-[var(--color-danger)]'
  return 'bg-[var(--text-muted)]'
}

/** 封面主视觉的 2:3 画框（当前封面 / 空态）。 */
function CoverCanvas({ src, title, hasNovel }: { src: string; title?: string; hasNovel: boolean }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    setFailed(false)
  }, [src])

  return (
    <div className="ai-cover-frame relative aspect-[2/3] w-full overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--admin-inset)] shadow-md ring-1 ring-inset ring-[var(--border-light)]">
      {failed || !src ? (
        <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
          <BookOpen className="size-6 text-[var(--accent)]/45" />
          <p className="text-xs leading-relaxed text-muted-foreground">{hasNovel ? '暂无封面图片' : '选择小说后预览封面'}</p>
        </div>
      ) : (
        <img src={src} alt={title || '封面预览'} onError={() => setFailed(true)} />
      )}
    </div>
  )
}

export default function AiCoverPanel() {
  const { toast } = useToast()
  const [novels, setNovels] = useState<Array<{ id: string; title: string; updatedAt?: number }>>([])
  const [novelId, setNovelId] = useState('')
  const [busy, setBusy] = useState(false)
  /** 当前封面生成任务；null 表示未启动过 */
  const [task, setTask] = useState<AiTaskInfo | null>(null)
  /** 预览图缓存破坏戳：生成完成后 +1 触发重新拉取（/api/cover/:id 公开无鉴权，img 直接拉） */
  const [coverVersion, setCoverVersion] = useState(0)
  /** 渲染书名+作者名文字层：默认开（story-cover 认为这是封面必需信息；模型需支持中文渲染，如 gpt-image-2） */
  const [renderTitle, setRenderTitle] = useState(true)
  /** 平台风格调性：默认通用竖版 */
  const [platform, setPlatform] = useState('default')
  const [prompt, setPrompt] = useState('')
  const [generatingPrompt, setGeneratingPrompt] = useState(false)
  const [imageConfigured, setImageConfigured] = useState(false)
  /** 当前小说的 AI 封面候选（未采纳）；生成成功/采纳/弃用后刷新 */
  const [candidates, setCandidates] = useState<AiCoverCandidate[]>([])
  const [candidateBusy, setCandidateBusy] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  /** 候选请求序号：只让最后一次请求的结果生效，避免切书后过期响应覆盖新书候选 */
  const candidateSeq = useRef(0)
  /** 当前选中的小说（供后台任务完成时判断候选是否仍属于当前书） */
  const novelIdRef = useRef(novelId)
  useEffect(() => {
    novelIdRef.current = novelId
  }, [novelId])
  const taskActive = !!task && (task.status === 'queued' || task.status === 'running')

  /** 拉取当前小说的候选列表。 */
  async function loadCandidates(id: string) {
    if (!id) return
    const seq = ++candidateSeq.current
    try {
      const { items } = await aiApi.coverCandidates(id)
      if (seq === candidateSeq.current) setCandidates(items)
    } catch {
      if (seq === candidateSeq.current) setCandidates([])
    }
  }

  useEffect(() => {
    void novelsApi
      .list({ limit: 100, page: 1 })
      .then((data) => setNovels(data.novels.map((novel) => ({ id: novel.id, title: novel.title, updatedAt: novel.updatedAt }))))
      .catch((err) => toast((err as Error).message, 'error'))
    void aiApi
      .settings()
      .then((res) => {
        setImageConfigured(res.imageProvider.configured)
        // 用运营设置里的封面默认值初始化控件
        if (typeof res.settings?.coverRenderTitle === 'boolean') setRenderTitle(res.settings.coverRenderTitle)
        if (typeof res.settings?.coverPlatform === 'string' && res.settings.coverPlatform) setPlatform(res.settings.coverPlatform)
      })
      .catch(() => {})
  }, [toast])

  // 挂载时恢复正在运行的封面任务：切换 tab 回来后进度不丢
  useEffect(() => {
    let cancelled = false
    aiApi
      .tasks({ limit: 20 })
      .then((result) => {
        if (cancelled) return
        const running = result.items.find((item) => COVER_TASK_KINDS.has(item.kind) && (item.status === 'queued' || item.status === 'running'))
        if (running) {
          setTask((prev) => prev ?? running)
          setNovelId(running.novelId)
          void loadCandidates(running.novelId)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // 轮询后台封面任务：setTask 触发下一轮 effect，形成 3 秒间隔的轮询链，任务结束自然停止
  useEffect(() => {
    if (!task || (task.status !== 'queued' && task.status !== 'running')) return
    const timer = setTimeout(() => {
      if (document.hidden) {
        setTask((prev) => (prev ? { ...prev } : prev))
        return
      }
      aiApi
        .task(task.id)
        .then(({ task: next }) => {
          setTask(next)
          if (next.status === 'completed') {
            toast('封面已生成，请在下方预览候选并决定是否采纳', 'success')
            // 只在任务属于当前选中的小说时刷新候选，避免切书后被旧任务结果覆盖
            if (next.novelId === novelIdRef.current) void loadCandidates(next.novelId)
          } else if (next.status === 'failed') {
            toast(next.error || '封面生成失败', 'error')
          }
        })
        .catch(() => setTask((prev) => (prev ? { ...prev } : prev)))
    }, TASK_POLL_INTERVAL)
    return () => clearTimeout(timer)
  }, [task, toast])

  async function generate() {
    if (!novelId) return toast('请先选择小说', 'error')
    if (!imageConfigured) return toast('AI 图像服务未配置，请到「配置」标签页设置图像供应商', 'error')
    setBusy(true)
    try {
      const res = await aiApi.generateCover(novelId, { prompt, renderTitle, platform })
      const { task: created } = await aiApi.task(res.taskId)
      setTask(created)
      toast('封面生成已开始', 'success')
    } catch (err) {
      toast((err as Error).message || '启动生成失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function generatePrompt() {
    if (!novelId) return toast('请先选择小说', 'error')
    setGeneratingPrompt(true)
    try {
      const result = await aiApi.generateCoverPrompt(novelId, { renderTitle, platform })
      setPrompt(result.prompt)
      toast('已生成封面描述词，可继续编辑', 'success')
    } catch (err) {
      toast((err as Error).message || '生成描述词失败', 'error')
    } finally {
      setGeneratingPrompt(false)
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

  /** 采纳候选：覆盖为当前封面，刷新候选与当前预览。 */
  async function adopt(candidate: AiCoverCandidate) {
    if (!novelId) return
    setCandidateBusy(candidate.id)
    try {
      await aiApi.adoptCoverCandidate(candidate.id)
      await loadCandidates(novelId)
      setCoverVersion((v) => v + 1)
      toast('已采纳，当前封面已替换', 'success')
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setCandidateBusy('')
    }
  }

  /** 弃用候选：删除，当前封面不受影响。 */
  async function discard(candidate: AiCoverCandidate) {
    if (!novelId) return
    setCandidateBusy(candidate.id)
    try {
      await aiApi.discardCoverCandidate(candidate.id)
      await loadCandidates(novelId)
      toast('已弃用该候选封面', 'success')
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setCandidateBusy('')
    }
  }

  /** 上传本地图片替换当前封面。 */
  async function handleUploadFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !novelId) return
    setCandidateBusy('upload')
    try {
      await aiApi.uploadCover(novelId, file)
      setCoverVersion((v) => v + 1)
      toast('已上传并替换当前封面', 'success')
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setCandidateBusy('')
    }
  }

  const selected = novels.find((n) => n.id === novelId)
  // /api/cover/:id 公开无鉴权（与 NovelCard 同源），img 直接拉，带 coverVersion 破缓存
  const previewSrc = novelId ? url(`/cover/${encodeURIComponent(novelId)}?v=${coverVersion}&cover=2`) : ''

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">AI 封面生成</CardTitle>
        <p className="text-sm text-muted-foreground">根据小说标题、分类与简介生成封面 · 候选制，满意后采纳替换</p>
      </CardHeader>

      <CardContent className="grid gap-8 lg:grid-cols-2 lg:items-start">
        {/* 左列：生成配置 */}
        <div className="grid content-start gap-5">
          <div className="grid gap-1.5">
            <Label>目标小说</Label>
            <CustomSelect
              options={novels.map((novel) => ({ value: novel.id, label: novel.title }))}
              value={novelId}
              onChange={(value) => {
                setNovelId(value)
                setPrompt('')
                void loadCandidates(value)
              }}
              placeholder="选择小说"
              searchable
              searchPlaceholder="搜索小说名称…"
              dropdownSide="bottom"
            />
          </div>

          {/* 封面设定：平台风格 + 封面文字层 */}
          <div className="grid gap-3 rounded-lg border border-[var(--border)] bg-[var(--admin-inset)] p-3.5">
            <p className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-muted)]">
              <Palette className="size-3.5" />
              封面设定
            </p>
            <div className="grid gap-1.5">
              <Label>平台风格</Label>
              <CustomSelect options={PLATFORM_OPTIONS} value={platform} onChange={setPlatform} placeholder="选择平台风格" dropdownSide="bottom" />
              <p className="text-xs text-muted-foreground">按目标平台调性微调封面视觉；通用为竖版 2:3。</p>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-md border border-[var(--border)] bg-[var(--bg-card)] px-3.5 py-2.5">
              <div className="grid gap-0.5">
                <span className="text-sm font-medium text-foreground">渲染封面文字</span>
                <span className="text-xs leading-relaxed text-muted-foreground">在封面渲染书名+作者名（按题材套用字体），需模型支持中文渲染（如 gpt-image-2）。</span>
              </div>
              <Switch checked={renderTitle} disabled={busy || taskActive} onCheckedChange={setRenderTitle} />
            </div>
          </div>

          {!imageConfigured && (
            <div className="flex items-start gap-2.5 rounded-lg border border-[color-mix(in_srgb,var(--color-warning)_45%,transparent)] bg-[color-mix(in_srgb,var(--color-warning)_12%,transparent)] px-3.5 py-3 text-sm leading-relaxed text-[var(--color-warning)]">
              <CircleAlert className="mt-0.5 size-4 shrink-0" />
              <p>AI 图像服务未配置（AI_IMAGE_BASE_URL / AI_IMAGE_API_KEY）。请到「配置」标签页设置图像供应商后再生成。</p>
            </div>
          )}

          {/* 封面描述词 */}
          <div className="grid gap-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label htmlFor="cover-prompt">封面描述词</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy || taskActive || generatingPrompt || !novelId}
                onClick={() => void generatePrompt()}
              >
                {generatingPrompt ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    生成中…
                  </>
                ) : (
                  <>
                    <Wand2 className="size-3.5" />
                    自动生成描述词
                  </>
                )}
              </Button>
            </div>
            <textarea
              id="cover-prompt"
              className="min-h-[7.5rem] w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3.5 py-2.5 text-sm leading-relaxed ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              value={prompt}
              maxLength={2000}
              disabled={busy || taskActive || generatingPrompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="留空将根据小说标题、分类和简介自动生成；也可以直接填写英文描述词。"
            />
            <p className="text-xs text-muted-foreground">留空自动生成，可编辑后保存；最多 2000 字符。</p>
          </div>

          {/* 生成 CTA */}
          <Button size="lg" className="w-full gap-2" disabled={busy || taskActive || !novelId} onClick={() => void generate()}>
            {busy || taskActive ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                正在生成…
              </>
            ) : (
              <>
                <Sparkles className="size-4" />
                生成封面
              </>
            )}
          </Button>

          {/* 任务状态 */}
          {task && (
            <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--admin-inset)]">
              <div className="flex flex-wrap items-center gap-2.5 px-3.5 py-3 text-sm">
                <span className="relative flex size-2.5">
                  {taskActive && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--accent)] opacity-60" />}
                  <span className={`relative inline-flex size-2.5 rounded-full ${statusDotColor(task.status)}`} />
                </span>
                <span className="font-medium text-foreground">{taskStatusLabel(task.status)}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{task.step || '等待处理'}</span>
                {taskActive && (
                  <Button variant="outline" size="sm" onClick={() => void cancelTask()}>
                    取消任务
                  </Button>
                )}
              </div>
              {taskActive && <div className="ai-task-progress" />}
              {task.error && <p className="border-t border-[var(--border)] px-3.5 py-2 text-xs leading-relaxed text-destructive">{task.error}</p>}
            </div>
          )}
        </div>

        {/* 右列：画布与候选 */}
        <div className="grid content-start gap-6 lg:border-l lg:border-[var(--admin-line)] lg:pl-8">
          {/* 当前封面 */}
          <section className="grid gap-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-foreground">当前封面</h3>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={(e) => void handleUploadFile(e)}
              />
              <Button variant="outline" size="sm" disabled={candidateBusy === 'upload'} onClick={() => fileInputRef.current?.click()}>
                {candidateBusy === 'upload' ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    上传中…
                  </>
                ) : (
                  <>
                    <Upload className="size-3.5" />
                    上传替换
                  </>
                )}
              </Button>
            </div>

            <div className="grid justify-items-center gap-3">
              <div className="relative w-full max-w-[13.5rem]">
                <CoverCanvas src={previewSrc} title={selected?.title} hasNovel={!!novelId} />
                {selected && (
                  <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 max-w-full truncate whitespace-nowrap rounded-full border border-[var(--border)] bg-[var(--bg-card)] px-2.5 py-0.5 text-[0.7rem] text-[var(--text-muted)] shadow-sm">
                    {selected.title}
                  </span>
                )}
              </div>
              <p className="max-w-[13.5rem] text-center text-[0.72rem] leading-relaxed text-muted-foreground">
                上传的图片会立即替换为当前封面（读者端 /api/cover/:id 生效）；AI 生成的新封面先入候选，确认后「采纳」才会替换。
              </p>
            </div>
          </section>

          {/* AI 候选封面 */}
          <section className="grid gap-3">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">AI 候选封面</h3>
              {candidates.length > 0 && <Badge variant="secondary">{candidates.length}</Badge>}
            </div>

            {candidates.length === 0 ? (
              <div className="grid gap-2 rounded-lg border border-dashed border-[var(--border)] bg-[var(--admin-inset)] px-4 py-8 text-center">
                <BookOpen className="mx-auto size-5 text-[var(--accent)]/55" />
                <p className="text-xs leading-relaxed text-muted-foreground">
                  暂无候选。生成成功后这里会出现新封面，确认效果后可「采纳」为当前封面，不满意可「弃用」或重新生成。
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-4">
                {candidates.map((candidate, index) => (
                  <figure key={candidate.id} className="group grid gap-2">
                    <div className="ai-cover-frame relative aspect-[2/3] w-full overflow-hidden rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] shadow-sm transition-shadow duration-200 group-hover:shadow-md">
                      <img
                        src={candidate.dataUrl}
                        alt="AI 封面候选"
                        className="transition-transform duration-300 group-hover:scale-[1.03]"
                      />
                      <span className="absolute left-1.5 top-1.5 rounded-full bg-[var(--overlay-bg)] px-2 py-0.5 text-xs font-medium text-white/95 backdrop-blur-sm">
                        候选 {index + 1}
                      </span>
                    </div>
                    <figcaption className="grid gap-1.5">
                      <div className="flex gap-1.5">
                        <Button size="sm" className="flex-1 gap-1" disabled={!!candidateBusy} onClick={() => void adopt(candidate)}>
                          {candidateBusy === candidate.id ? (
                            <>
                              <Loader2 className="size-3.5 animate-spin" />
                              处理中
                            </>
                          ) : (
                            '采纳'
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!!candidateBusy}
                          onClick={() => void discard(candidate)}
                          aria-label="弃用该候选"
                          title="弃用"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                      {candidate.prompt && (
                        <p className="line-clamp-2 text-[0.7rem] leading-snug text-muted-foreground">{candidate.prompt}</p>
                      )}
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}
          </section>
        </div>
      </CardContent>
    </Card>
  )
}
