/** AI 封面生成工作台：选小说 → 生成封面（落候选，不覆盖）→ 预览候选 → 采纳/弃用/上传替换。 */
import { useEffect, useRef, useState } from 'react'
import { aiApi, novelsApi, url, type AiCoverCandidate, type AiTaskInfo } from '@/lib/api'
import { useToast } from '@/components/feedback'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import CustomSelect from '@/components/admin/CustomSelect'

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

export default function AiCoverPanel() {
  const { toast } = useToast()
  const [novels, setNovels] = useState<Array<{ id: string; title: string; updatedAt?: number }>>([])
  const [novelId, setNovelId] = useState('')
  const [busy, setBusy] = useState(false)
  /** 当前封面生成任务；null 表示未启动过 */
  const [task, setTask] = useState<AiTaskInfo | null>(null)
  /** 预览图缓存破坏戳：生成完成后 +1 触发重新拉取（/api/cover/:id 公开无鉴权，img 直接拉） */
  const [coverVersion, setCoverVersion] = useState(0)
  /** 安全归一化开关：默认开，把限制级内容抽象为唯美画面，规避上游图像安全策略 */
  const [safe, setSafe] = useState(true)
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
      const res = await aiApi.generateCover(novelId, { safe, prompt, renderTitle, platform })
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
      const result = await aiApi.generateCoverPrompt(novelId, { safe, renderTitle, platform })
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
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">AI 封面生成</CardTitle>
          <p className="text-sm text-muted-foreground">
            根据小说标题、分类与简介生成封面，结果先存为「候选」不覆盖当前封面；在下方预览效果，满意后点击采纳，不满意可弃用或重新生成。
          </p>
        </CardHeader>
        <CardContent className="grid gap-4">
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

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>平台风格</Label>
              <CustomSelect options={PLATFORM_OPTIONS} value={platform} onChange={setPlatform} placeholder="选择平台风格" dropdownSide="bottom" />
              <p className="text-xs text-muted-foreground">按目标平台调性微调封面视觉；通用为竖版 2:3。</p>
            </div>
            <label className="flex items-start gap-2 rounded-md border bg-muted/30 p-3 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-4 rounded border-input"
                checked={renderTitle}
                disabled={busy || taskActive}
                onChange={(e) => setRenderTitle(e.target.checked)}
              />
              <span>
                <span className="font-medium text-foreground">渲染封面文字</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  在封面上直接渲染书名+作者名（按题材套用字体风格），默认开启。需图像模型支持中文渲染（如 gpt-image-2），渲染不佳时可关闭。
                </span>
              </span>
            </label>
          </div>

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
                {generatingPrompt ? '生成中…' : '自动生成描述词'}
              </Button>
            </div>
            <textarea
              id="cover-prompt"
              className="min-h-[112px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              value={prompt}
              maxLength={2000}
              disabled={busy || taskActive || generatingPrompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="留空将根据小说标题、分类和简介自动生成；也可以直接填写英文描述词。"
            />
            <p className="text-xs text-muted-foreground">自动生成后可继续编辑。安全模式开启时，服务端会在最终描述词中补充安全约束。</p>
          </div>

          <div className="flex flex-wrap items-end justify-between gap-3 rounded-md border bg-muted/30 p-3">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-4 rounded border-input"
                checked={safe}
                disabled={busy || taskActive}
                onChange={(e) => setSafe(e.target.checked)}
              />
              <span>
                <span className="font-medium text-foreground">安全归一化</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  默认开启。把限制级/暴力内容抽象为唯美氛围画面，规避上游图像服务的内容安全策略；需要忠实呈现剧情画面时可关闭。
                </span>
              </span>
            </label>
            <Button disabled={busy || taskActive || !novelId} onClick={() => void generate()}>
              {taskActive ? '生成中…' : '生成封面'}
            </Button>
          </div>

          {!imageConfigured && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
              AI 图像服务未配置（AI_IMAGE_BASE_URL / AI_IMAGE_API_KEY）。请到「配置」标签页设置图像供应商后再生成。
            </div>
          )}

          {task && (
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">封面</Badge>
                <Badge variant={task.status === 'failed' ? 'destructive' : 'outline'}>{taskStatusLabel(task.status)}</Badge>
                {taskActive && (
                  <Button variant="outline" size="sm" className="ml-auto" onClick={() => void cancelTask()}>
                    取消任务
                  </Button>
                )}
              </div>
              <p className="mt-1 text-muted-foreground">{task.step || '等待处理'}</p>
              {task.error && <p className="mt-1 text-destructive">{task.error}</p>}
            </div>
          )}

          {novelId && (
            <div className="grid gap-4">
              {/* 当前封面 + 上传替换 */}
              <div className="grid gap-2">
                <div className="flex items-center justify-between gap-2">
                  <Label>当前封面</Label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    className="hidden"
                    onChange={(e) => void handleUploadFile(e)}
                  />
                  <Button variant="outline" size="sm" disabled={candidateBusy === 'upload'} onClick={() => fileInputRef.current?.click()}>
                    {candidateBusy === 'upload' ? '上传中…' : '上传替换封面'}
                  </Button>
                </div>
                <div className="flex items-start gap-4">
                  <img
                    key={coverVersion}
                    src={previewSrc}
                    alt={selected?.title || '封面预览'}
                    className="h-40 w-28 rounded-md border border-border object-cover shadow-sm"
                    onError={(e) => {
                      e.currentTarget.style.visibility = 'hidden'
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    上传的图片会立即替换为当前封面，读者端经 /api/cover/:id 生效；AI 生成的新封面不会自动替换，需在下方的候选中点「采纳」。
                  </p>
                </div>
              </div>

              {/* AI 候选封面 */}
              <div className="grid gap-2">
                <Label>AI 候选封面（未采纳）</Label>
                {candidates.length === 0 ? (
                  <p className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
                    暂无候选。生成成功后这里会出现新封面，确认效果后可「采纳」为当前封面，不满意可「弃用」或重新生成。
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-4">
                    {candidates.map((candidate) => (
                      <div key={candidate.id} className="grid gap-1.5">
                        <img src={candidate.dataUrl} alt="AI 封面候选" className="h-40 w-28 rounded-md border border-border object-cover shadow-sm" />
                        <div className="flex gap-2">
                          <Button size="sm" disabled={!!candidateBusy} onClick={() => void adopt(candidate)}>
                            采纳
                          </Button>
                          <Button size="sm" variant="outline" disabled={!!candidateBusy} onClick={() => void discard(candidate)}>
                            弃用
                          </Button>
                        </div>
                        {candidate.prompt && <p className="max-w-28 text-xs leading-tight text-muted-foreground line-clamp-2">{candidate.prompt}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
