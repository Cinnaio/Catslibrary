/** AI 封面生成工作台：选小说 → 生成封面（落候选，不覆盖）→ 预览候选 → 采纳/弃用/上传替换。 */
import { ErrorState } from '@/components/admin/AsyncStates'
import AdminContentRatingBadge from '@/components/admin/AdminContentRatingBadge'
import { AdminDialogContent } from '@/components/admin/AdminDialog'
import AdminFormField from '@/components/admin/AdminFormField'
import { useEffect, useRef, useState } from 'react'
import { aiApi, newOperationId, novelsApi, url, type AiCoverCandidate, type AiTaskInfo } from '@/lib/api'
import { useToast, useConfirm } from '@/components/feedback'
import { AdminPanelHeading } from '@/components/admin/AdminWorkspace'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import CustomSelect from '@/components/admin/CustomSelect'
import CoverHistory from './CoverHistory'
import CoverStyleGallery from './CoverStyleGallery'
import { taskStatusLabel } from './labels'
import { BookOpen, CircleAlert, Loader2, Sparkles, Trash2, Upload, Wand2 } from 'lucide-react'

// 后台封面任务的进度轮询间隔（与 AiWritingPanel 对齐）
const TASK_POLL_INTERVAL = 3000
const COVER_TASK_KINDS = new Set(['cover'])
const DEFAULT_COVER_PROMPT_MAX_CHARS = 2000
const MIN_COVER_PROMPT_MAX_CHARS = 100
const HARD_MAX_COVER_PROMPT_CHARS = 10000
type CoverNovel = Awaited<ReturnType<typeof novelsApi.list>>['novels'][number]

const CONTENT_RATING_LABELS = {
  general: '一般',
  restricted: '限制级',
  unknown: '未标注',
} as const

const GENRE_LABELS: Record<string, string> = {
  xianxia: '仙侠',
  urban: '都市',
  ancient: '古代',
  romance: '言情',
  mystery: '悬疑',
  scifi: '科幻',
  fantasy: '奇幻',
  historical: '历史',
  horror: '惊悚',
  light: '轻小说',
}

const FACT_LABELS: Record<string, string> = {
  person: '人物',
  setting: '地点',
  object: '物件',
  event: '事件',
  relationship: '关系',
  mood: '情绪',
  premise: '故事前提',
}

const ADULT_RATING_LABEL = /(?:^|[\s,，;；|/])(?:r18|18\+|18禁|成人向|成人内容)(?=$|[\s,，;；|/])/iu
const BRACKETED_ADULT_RATING_LABEL = /[\[【(（]\s*(?:r18|18\+|18禁|成人向|成人内容)\s*[\]】)）]/iu

function hasAdultRatingCategory(categories: readonly string[]): boolean {
  return categories.some((category) => ADULT_RATING_LABEL.test(category) || BRACKETED_ADULT_RATING_LABEL.test(category))
}

function novelStatusLabel(status: string): string {
  if (status === 'completed') return '已完结'
  if (status === 'ongoing') return '连载中'
  return status || '状态未知'
}

function candidateTime(createdAt: number): string {
  if (!createdAt) return '时间未知'
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(createdAt))
}

function normalizeCoverPromptLimit(value: unknown): number {
  const n = Math.trunc(Number(value))
  return Number.isFinite(n) ? Math.min(HARD_MAX_COVER_PROMPT_CHARS, Math.max(MIN_COVER_PROMPT_MAX_CHARS, n)) : DEFAULT_COVER_PROMPT_MAX_CHARS
}

function limitCoverPrompt(value: string, maxChars: number): string {
  return Array.from(value).slice(0, maxChars).join('')
}

function coverPromptCharCount(value: string): number {
  return Array.from(value).length
}

/** 平台版式选项：只影响平台调性、尺寸和文字安全区，不决定主视觉画风。 */
const PLATFORM_OPTIONS = [
  { value: 'default', label: '通用（竖版 2:3）' },
  { value: 'fanqie', label: '番茄小说' },
  { value: 'qidian', label: '起点' },
  { value: 'jinjiang', label: '晋江' },
  { value: 'zhihu', label: '知乎盐言' },
  { value: 'qimao', label: '七猫' },
  { value: 'ciweimao', label: '刺猬猫' },
]

const STYLE_OPTIONS = [
  { value: 'auto', label: '自动推荐', sub: '结合题材和变体，自动挑选匹配的视觉方向' },
  { value: 'doodle_journal', label: '萌系涂鸦手账', sub: '奶黄格纹、贴纸涂鸦与圆润描边字，书名居中' },
  { value: 'dreamy_cloud', label: '梦幻云染', sub: '蓝粉紫云团与透明晕染，蓝色手写书名和轻盈留白' },
  { value: 'warm_apricot', label: '暖橘花染', sub: '桃橙水彩与花瓣肌理，橙金书法标题' },
  { value: 'ancient_blossom', label: '古言花间插画', sub: '精致人物、浅粉花枝与青玉点缀，墨色竖排题字' },
  { value: 'pink_collage', label: '粉色情绪拼贴', sub: '满版粉色纸片与透明叠层，深玫瑰色错落大字' },
  { value: 'floral_handwriting', label: '花笺甜系手写', sub: '浅粉花笺、花瓣肌理与俏皮莓粉手写字' },
  { value: 'soft_watercolor', label: '清透水彩', sub: '浅桃、奶油、薄荷或雾蓝的透明水彩与轻盈留白' },
  { value: 'moonlit_dream', label: '月色梦境', sub: '蓝紫月色、云雾和远景剪影，柔光低对比' },
  { value: 'ancient_guochao', label: '古风国色', sub: '朱砂、青玉、墨色与克制金色的国风画册质感' },
  { value: 'romance_illustration', label: '人物言情插画', sub: '精致商业言情插画，突出人物关系与细节' },
  { value: 'dark_cinematic', label: '暗夜电影感', sub: '深紫、藏蓝与黑色高反差，局部轮廓光与情绪拉扯' },
  { value: 'pastel_romance', label: '粉彩轻甜', sub: '暖白、浅杏与淡紫的柔和粉彩，轻甜但不喧闹' },
  { value: 'botanical_literary', label: '草木文学', sub: '鼠尾草、橄榄绿和旧纸色的安静草木纹理' },
  { value: 'minimal_typographic', label: '极简水彩题字', sub: '白底与局部淡彩，细长题字和克制作者署名' },
  { value: 'cinematic', label: '电影概念设计', sub: '明确焦点、景深层次和电影海报完成度' },
  { value: 'illustration', label: '编辑插画', sub: '强调叙事、笔触和轮廓的编辑插画' },
  { value: 'ink', label: '东方水墨', sub: '水墨纸张肌理、克制细节和自然留白' },
  { value: 'minimal', label: '极简海报', sub: '单一视觉隐喻、纪律感几何和大面积留白' },
  { value: 'noir', label: '黑色电影', sub: '硬朗方向光、深阴影和颗粒感' },
  { value: 'graphic', label: '现代平面设计', sub: '大胆色块、清晰层级和印刷肌理' },
]

const COMPOSITION_OPTIONS = [
  { value: 'auto', label: '跟随风格推荐' },
  { value: 'title_center', label: '中央字章' },
  { value: 'title_vertical', label: '竖排题字' },
  { value: 'title_collage', label: '错落字章' },
  { value: 'portrait', label: '人物特写' },
  { value: 'duo', label: '双人物关系' },
  { value: 'environment', label: '环境叙事' },
  { value: 'symbolic', label: '关键物件' },
  { value: 'silhouette', label: '剪影留白' },
  { value: 'off_center', label: '非对称构图' },
]

const ROMANCE_SUBTYPE_LABELS: Record<string, string> = {
  sweet: '甜宠',
  contract: '合约/豪门',
  workplace: '职场关系',
  campus: '校园初恋',
  reunion: '久别重逢',
  healing: '治愈救赎',
  suspense: '悬疑言情',
  revenge: '虐恋复仇',
  historical: '古言爱情',
  general: '现代言情',
}

const ROMANCE_EMOTION_LABELS: Record<string, string> = {
  sweet: '甜蜜',
  tension: '暧昧拉扯',
  bittersweet: '酸涩遗憾',
  healing: '温柔治愈',
  dangerous: '危险克制',
  playful: '轻快俏皮',
}

const ROMANCE_CONCEPT_LABELS: Record<string, string> = {
  object: '关键物件',
  distance: '情绪距离',
  environment: '环境叙事',
  action: '决定性动作',
  threshold: '边界构图',
  split: '双时空对照',
  silhouette: '剪影留白',
  aftermath: '事件余波',
}

function romanceDirectionLabel(metadata?: AiCoverCandidate['metadata']): string {
  if (!metadata?.romanceSubtype && !metadata?.romanceEmotion && !metadata?.visualConcept) return ''
  return [
    metadata.romanceSubtype ? `主线：${ROMANCE_SUBTYPE_LABELS[metadata.romanceSubtype] || metadata.romanceSubtype}` : '',
    metadata.romanceEmotion ? `情绪：${ROMANCE_EMOTION_LABELS[metadata.romanceEmotion] || metadata.romanceEmotion}` : '',
    metadata.visualConcept ? `概念：${ROMANCE_CONCEPT_LABELS[metadata.visualConcept] || metadata.visualConcept}` : '',
  ]
    .filter(Boolean)
    .join(' · ')
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
function CoverCanvas({
  src,
  title,
  hasNovel,
  className = '',
  onPreview,
}: {
  src: string
  title?: string
  hasNovel: boolean
  className?: string
  onPreview?: () => void
}) {
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    setFailed(false)
  }, [src])

  const frameClassName = `ai-cover-frame relative aspect-[2/3] w-full overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--admin-inset)] ${className}`
  const content = (
    <>
      {failed || !src ? (
        <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
          <BookOpen className="size-6 text-[var(--accent)]/45" />
          <p className="text-xs leading-relaxed text-muted-foreground">{hasNovel ? '暂无封面图片' : '选择小说后预览封面'}</p>
        </div>
      ) : (
        <img src={src} alt={title || '封面预览'} loading="lazy" decoding="async" onError={() => setFailed(true)} />
      )}
    </>
  )

  return onPreview ? (
    <button
      type="button"
      className={`${frameClassName} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`}
      onClick={onPreview}
      aria-label={`查看大图：${title || '封面预览'}`}
    >
      {content}
    </button>
  ) : (
    <div className={frameClassName}>{content}</div>
  )
}

export default function AiCoverPanel({
  initialNovelId,
  onNovelChange,
}: {
  initialNovelId?: string
  onNovelChange?: (novelId: string) => void
} = {}) {
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const [novels, setNovels] = useState<CoverNovel[]>([])
  const [novelsLoading, setNovelsLoading] = useState(true)
  const [novelsLoadError, setNovelsLoadError] = useState('')
  const [focusedCandidateId, setFocusedCandidateId] = useState('')
  const [novelId, setNovelId] = useState(initialNovelId || '')
  const [busy, setBusy] = useState(false)
  /** 当前封面生成任务；null 表示未启动过 */
  const [task, setTask] = useState<AiTaskInfo | null>(null)
  /** 预览图缓存破坏戳：生成完成后 +1 触发重新拉取（/api/cover/:id 公开无鉴权，img 直接拉） */
  const [coverVersion, setCoverVersion] = useState(0)
  /** 渲染书名+作者名文字层：默认开（story-cover 认为这是封面必需信息；模型需支持中文渲染，如 gpt-image-2） */
  const [renderTitle, setRenderTitle] = useState(true)
  /** 平台风格调性：默认通用竖版 */
  const [platform, setPlatform] = useState('default')
  /** 主视觉画风：自动按题材和 variationId 选择，或由管理员固定。 */
  const [stylePreset, setStylePreset] = useState('auto')
  /** 构图方向：自动轮换或显式指定。 */
  const [composition, setComposition] = useState('auto')
  /** 生成结果的变体标识；相同值用于复现，换值用于生成新方向。 */
  const [variationId, setVariationId] = useState('')
  const [promptMetadata, setPromptMetadata] = useState<AiCoverCandidate['metadata']>()
  const [prompt, setPrompt] = useState('')
  const [promptMode, setPromptMode] = useState<'auto' | 'exact'>('auto')
  /** AI 描述词生成时冻结的配置；选择器变更后不能假装旧 prompt 已同步。 */
  const [promptSourceSignature, setPromptSourceSignature] = useState('')
  const [coverPromptMaxChars, setCoverPromptMaxChars] = useState(DEFAULT_COVER_PROMPT_MAX_CHARS)
  const [generatingPrompt, setGeneratingPrompt] = useState(false)
  const [imageConfigured, setImageConfigured] = useState(false)
  /** 当前小说的 AI 封面候选（未采纳）；生成成功/采纳/弃用后刷新 */
  const [candidates, setCandidates] = useState<AiCoverCandidate[]>([])
  const [candidatesLoading, setCandidatesLoading] = useState(false)
  const [candidateError, setCandidateError] = useState('')
  const [candidateBusy, setCandidateBusy] = useState('')
  const [previewImage, setPreviewImage] = useState<{ src: string; title: string } | null>(null)

  /**
   * 当前封面版本号（图片哈希 + 元数据摘要），由 CoverHistory 读取后回传。
   * 采纳候选、上传替换、恢复历史都带上它做乐观并发：后端不一致就 409，
   * 避免把别人刚换上的封面覆盖掉。
   */
  const [currentCoverVersion, setCurrentCoverVersion] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  /** 候选请求序号：只让最后一次请求的结果生效，避免切书后过期响应覆盖新书候选 */
  const candidateSeq = useRef(0)
  /** 当前选中的小说（供后台任务完成时判断候选是否仍属于当前书） */
  const novelIdRef = useRef(novelId)
  useEffect(() => {
    novelIdRef.current = novelId
  }, [novelId])
  const taskActive = !!task && (task.status === 'queued' || task.status === 'running')
  const configSignature = `${novelId}|${renderTitle ? '1' : '0'}|${platform}|${stylePreset}|${composition}|${variationId}`
  const promptConfigMismatch = !!promptSourceSignature && promptSourceSignature !== configSignature
  const usesExactPrompt = promptMode === 'exact' && !!prompt.trim() && !promptSourceSignature

  /** 拉取当前小说的候选列表。 */
  async function loadCandidates(id: string) {
    const seq = ++candidateSeq.current
    setCandidateError('')
    if (!id) {
      setCandidates([])
      setCandidatesLoading(false)
      return
    }
    setCandidatesLoading(true)
    try {
      const { items } = await aiApi.coverCandidates(id)
      if (seq === candidateSeq.current && id === novelIdRef.current) setCandidates(items)
    } catch {
      if (seq === candidateSeq.current && id === novelIdRef.current) {
        setCandidates([])
        setCandidateError('候选列表加载失败，请重试。')
      }
    } finally {
      if (seq === candidateSeq.current) setCandidatesLoading(false)
    }
  }

  useEffect(() => {
    const id = novelIdRef.current
    if (id) void loadCandidates(id)
  }, [])

  function clearNovelContext() {
    setPrompt('')
    setPromptMode('auto')
    setPromptSourceSignature('')
    setVariationId('')
    setPromptMetadata(undefined)
    setCurrentCoverVersion('')
    setCandidates([])
    setCandidateError('')
    setPreviewImage(null)
  }

  function selectNovel(value: string) {
    novelIdRef.current = value
    setNovelId(value)
    clearNovelContext()
    onNovelChange?.(value)
    void loadCandidates(value)
  }

  useEffect(() => {
    const nextId = initialNovelId || ''
    if (novelIdRef.current === nextId) return
    novelIdRef.current = nextId
    setNovelId(nextId)
    clearNovelContext()
    void loadCandidates(nextId)
  }, [initialNovelId])

  useEffect(() => {
    // 目标小说下拉要覆盖全库：后端 /novels 的 limit 封顶 100，需翻页拉全，避免下拉里小说不全
    let cancelled = false
    const PAGE_SIZE = 100
    void (async () => {
      const all: CoverNovel[] = []
      try {
        const first = await novelsApi.list({ limit: PAGE_SIZE, page: 1 })
        all.push(...first.novels)
        for (let page = 2; page <= first.totalPages && !cancelled; page++) {
          const data = await novelsApi.list({ limit: PAGE_SIZE, page })
          all.push(...data.novels)
        }
        if (!cancelled) setNovels(all)
      } catch (err) {
        if (!cancelled) {
          setNovelsLoadError((err as Error).message || '书库加载失败。')
          toast((err as Error).message, 'error')
        }
      } finally {
        if (!cancelled) setNovelsLoading(false)
      }
    })()
    void aiApi
      .settings()
      .then((res) => {
        setImageConfigured(res.imageProvider.configured)
        // 用运营设置里的封面默认值初始化控件
        if (typeof res.settings?.coverRenderTitle === 'boolean') setRenderTitle(res.settings.coverRenderTitle)
        if (typeof res.settings?.coverPlatform === 'string' && res.settings.coverPlatform) setPlatform(res.settings.coverPlatform)
        const promptLimit = normalizeCoverPromptLimit(res.settings?.coverPromptMaxChars)
        setCoverPromptMaxChars(promptLimit)
        setPrompt((value) => limitCoverPrompt(value, promptLimit))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
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
          if (!novelIdRef.current) {
            novelIdRef.current = running.novelId
            setNovelId(running.novelId)
          }
          if (running.novelId === novelIdRef.current) void loadCandidates(running.novelId)
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
    const nextPrompt = prompt.trim()
    if (promptConfigMismatch) return toast('封面设定已变化，请先按新设定更新描述词，或确认使用现有描述词', 'error')
    if (coverPromptCharCount(nextPrompt) > coverPromptMaxChars) {
      return toast(`封面描述词不能超过 ${coverPromptMaxChars} 个字符`, 'error')
    }
    setBusy(true)
    try {
      const mode = nextPrompt ? 'exact' : 'auto'
      const res = await aiApi.generateCover(novelId, {
        prompt: nextPrompt,
        promptMode: mode,
        renderTitle,
        platform,
        stylePreset,
        composition,
        variationId,
        ...(!usesExactPrompt && promptMetadata ? { promptMetadata } : {}),
        operationId: newOperationId('ai-cover-generate'),
      })
      const { task: created } = await aiApi.task(res.taskId)
      setTask(created)
      toast('封面生成已开始', 'success')
    } catch (err) {
      toast((err as Error).message || '启动生成失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function generatePrompt(forceNewVariation = false) {
    if (!novelId) return toast('请先选择小说', 'error')
    setGeneratingPrompt(true)
    try {
      const requestedVariationId = forceNewVariation ? crypto.randomUUID() : variationId
      const result = await aiApi.generateCoverPrompt(novelId, {
        renderTitle,
        platform,
        stylePreset,
        composition,
        variationId: requestedVariationId,
        operationId: newOperationId('ai-cover-prompt'),
      })
      setPrompt(limitCoverPrompt(result.prompt, coverPromptMaxChars))
      setVariationId(result.metadata?.variationId || requestedVariationId)
      setPromptMetadata(result.metadata)
      setPromptMode('exact')
      setPromptSourceSignature(
        `${novelId}|${renderTitle ? '1' : '0'}|${platform}|${stylePreset}|${composition}|${result.metadata?.variationId || requestedVariationId}`,
      )
      toast('已生成封面描述词，可继续编辑', 'success')
    } catch (err) {
      toast((err as Error).message || '生成描述词失败', 'error')
    } finally {
      setGeneratingPrompt(false)
    }
  }

  async function cancelTask() {
    if (!task) return
    const ok = await confirm({
      title: '终止封面生成任务？',
      message: '已产生的任务记录和用量记录会保留，未完成的生成不会继续执行。',
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

  /** 采纳候选：覆盖为当前封面，刷新候选与当前预览。 */
  async function adopt(candidate: AiCoverCandidate) {
    if (!novelId) return
    const ok = await confirm({
      title: '覆盖当前封面？',
      message: '采纳后会用这个候选封面替换当前封面，读者端会立即看到新封面。',
      items: [`操作目标：${candidate.id}`],
      okText: '确认覆盖',
      cancelText: '取消',
      danger: true,
    })
    if (!ok) return
    setCandidateBusy(candidate.id)
    try {
      // 带当前封面版本号：期间若有人换过封面，后端会 409 而不是静默覆盖
      await aiApi.adoptCoverCandidate(candidate.id, newOperationId('ai-cover-adopt'), currentCoverVersion)
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
    const ok = await confirm({
      title: '覆盖当前封面？',
      message: `确定用「${file.name}」替换当前封面？读者端会立即看到新封面。`,
      items: ['原封面不会自动保留为候选', '图片会直接写入当前封面'],
      okText: '确认上传并覆盖',
      cancelText: '取消',
      danger: true,
    })
    if (!ok) return
    setCandidateBusy('upload')
    try {
      await aiApi.uploadCover(novelId, file, newOperationId('ai-cover-upload'), currentCoverVersion)
      setCoverVersion((v) => v + 1)
      toast('已上传并替换当前封面', 'success')
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setCandidateBusy('')
    }
  }

  const focusedCandidate = candidates.find((candidate) => candidate.id === focusedCandidateId) || candidates[0]
  const selected = novels.find((n) => n.id === novelId)
  // /api/cover/:id 公开无鉴权（与 NovelCard 同源），img 直接拉，带 coverVersion 破缓存
  const previewSrc = novelId ? url(`/cover/${encodeURIComponent(novelId)}?v=${coverVersion}&cover=2`) : ''
  const recentNovels = novels.slice(0, 5)
  const hasCurrentGeneratedPrompt = !!prompt.trim() && !!promptSourceSignature && !promptConfigMismatch
  const canGenerateCover = !!novelId && !busy && !taskActive && !generatingPrompt && !promptConfigMismatch && (usesExactPrompt || hasCurrentGeneratedPrompt)
  const taskNovel = task ? novels.find((novel) => novel.id === task.novelId) : undefined
  const showAdultMetadataNote = !!selected && (selected.contentRating === 'restricted' || hasAdultRatingCategory(selected.categories))

  return (
    <Card className="admin-panel-card ai-cover-card">
      <CardContent className="grid gap-6">
        {!selected ? (
          <div className="ai-cover-workspace grid items-start gap-8">
            <section className="ai-cover-controls grid gap-5">
              <AdminPanelHeading title="封面工作台" />{' '}
              <AdminFormField label="目标小说" labelId="cover-start-novel-label">
                <CustomSelect
                  options={novels.map((novel) => ({ value: novel.id, label: novel.title }))}
                  value={novelId}
                  onChange={selectNovel}
                  placeholder={novelsLoading ? '正在加载书库…' : '搜索并选择小说'}
                  searchable
                  searchPlaceholder="搜索书名…"
                  disabled={novelsLoading || busy || generatingPrompt || taskActive || !!candidateBusy}
                  dropdownSide="bottom"
                  aria-labelledby="cover-start-novel-label"
                />
              </AdminFormField>
              <p className="text-xs text-muted-foreground">选择作品后设置视觉方向和描述词。</p>{' '}
              {!novelsLoading && recentNovels.length > 0 && (
                <div className="grid gap-2">
                  <h4 className="text-sm font-semibold text-foreground">最近更新</h4>
                  <div className="divide-y divide-[var(--admin-line)] rounded-lg border border-[var(--admin-border)] bg-[var(--admin-panel)]">
                    {recentNovels.map((novel) => (
                      <button
                        key={novel.id}
                        type="button"
                        className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-[var(--admin-panel-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                        onClick={() => selectNovel(novel.id)}
                        disabled={busy || generatingPrompt || taskActive || !!candidateBusy}
                      >
                        <div className="relative size-12 shrink-0 overflow-hidden rounded-md bg-[var(--admin-inset)]">
                          {novel.coverUrl ? (
                            <img src={novel.coverUrl} alt="" className="absolute inset-0 size-full object-cover" loading="lazy" />
                          ) : (
                            <BookOpen className="absolute inset-0 m-auto size-4 text-[var(--accent)]/50" aria-hidden="true" />
                          )}
                        </div>
                        <span className="grid min-w-0 flex-1 gap-0.5">
                          <span className="truncate text-sm font-medium text-foreground">{novel.title || '未命名小说'}</span>
                          <span className="truncate text-xs text-muted-foreground">
                            {novel.author || '作者未填写'}
                            {novel.categories.length ? ` · ${novel.categories.slice(0, 3).join('、')}` : ''}
                          </span>
                        </span>
                        <span className="shrink-0 text-xs text-[var(--accent)]">选择</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {!novelsLoading && novels.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {novelsLoadError ? '书库加载失败，请刷新页面后重试。' : '书库里还没有小说，请先到小说管理添加作品。'}
                </p>
              )}
            </section>
            <div className="ai-cover-results grid gap-5">
              <section>
                <AdminPanelHeading title="封面候选" />
                <div className="ai-cover-empty">
                  <p>选择作品后查看封面候选</p>
                  <p>生成结果先保存为候选，采纳后再替换当前封面。</p>
                </div>
              </section>
            </div>
          </div>
        ) : (
          <>
            <div className="ai-cover-workspace grid items-start gap-8">
              <div className="ai-cover-controls grid min-w-0 content-start gap-5">
                <AdminPanelHeading title="封面工作台" />{' '}
                <AdminFormField label="目标小说" labelId="cover-change-novel-label">
                  <CustomSelect
                    options={novels.map((novel) => ({ value: novel.id, label: novel.title }))}
                    value={novelId}
                    onChange={selectNovel}
                    placeholder="搜索并选择小说"
                    searchable
                    searchPlaceholder="搜索书名…"
                    disabled={busy || generatingPrompt || taskActive || !!candidateBusy}
                    dropdownSide="bottom"
                    aria-labelledby="cover-change-novel-label"
                  />
                </AdminFormField>
                <details className="ai-cover-book-disclosure">
                  <summary>作品资料与内容分级</summary>{' '}
                  <section className="ai-cover-book-details grid gap-4" aria-labelledby="cover-book-title">
                    <CoverCanvas src={previewSrc} title={`${selected.title} 当前封面`} hasNovel className="max-w-24 rounded-md" />
                    <div className="grid min-w-0 content-start gap-3">
                      <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-start">
                        <div className="grid min-w-0 gap-1">
                          <h3 id="cover-book-title" className="break-words text-lg font-semibold text-foreground">
                            {selected.title || '未命名小说'}
                          </h3>
                          <p className="text-sm text-muted-foreground">
                            {selected.author ? `作者：${selected.author}` : '作者未填写'} · {selected.chapterCount || 0} 章
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <AdminContentRatingBadge rating={selected.contentRating}>
                          {CONTENT_RATING_LABELS[selected.contentRating || 'unknown']}
                        </AdminContentRatingBadge>
                        <Badge variant="outline">{novelStatusLabel(selected.status)}</Badge>
                        {selected.categories.map((category) => (
                          <Badge key={category} variant="secondary">
                            {category}
                          </Badge>
                        ))}
                      </div>

                      <div className="grid gap-1.5 text-sm leading-relaxed">
                        <p className="text-foreground/90">{selected.description?.trim() || '这本小说还没有简介，自动推荐会更多依赖书名和分类。'}</p>
                        {selected.description?.trim() && selected.description.length > 320 && (
                          <details className="text-xs text-muted-foreground">
                            <summary className="w-fit cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                              展开完整简介
                            </summary>
                            <p className="mt-2 whitespace-pre-wrap leading-relaxed">{selected.description}</p>
                          </details>
                        )}
                      </div>

                      {showAdultMetadataNote && (
                        <p className="flex items-start gap-2 rounded-md bg-[var(--admin-panel-muted)] px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                          <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-[var(--color-warning)]" aria-hidden="true" />
                          限制级分级和作品标签会原样保留。自动封面分析把独立的 R18 / 成人向标签作为元数据，不转成露骨画面指令；封面场景仍保持非露骨。
                        </p>
                      )}
                    </div>
                  </section>
                </details>
                <section className="grid gap-3" aria-labelledby="cover-design-title">
                  <div className="grid gap-1">
                    <Button
                      type="button"
                      className="ai-cover-extract"
                      variant="ghost"
                      size="sm"
                      disabled={busy || taskActive || generatingPrompt}
                      onClick={() => void generatePrompt()}
                    >
                      {generatingPrompt ? '提取中…' : '从作品提取'}
                    </Button>
                    <h3 id="cover-design-title" className="text-sm font-semibold text-foreground">
                      视觉方向
                    </h3>
                    <p className="text-xs leading-relaxed text-muted-foreground">结合作品内容设定画面，再生成封面候选。</p>
                  </div>

                  <CoverStyleGallery value={stylePreset} onChange={setStylePreset} disabled={busy || generatingPrompt || taskActive || usesExactPrompt} />
                  {!renderTitle &&
                    ['doodle_journal', 'dreamy_cloud', 'warm_apricot', 'minimal_typographic', 'pink_collage', 'floral_handwriting'].includes(stylePreset) && (
                      <p className="text-xs leading-relaxed text-muted-foreground">当前仅生成背景；开启「渲染书名与作者」后可生成示意中的题字效果。</p>
                    )}

                  <div className="grid gap-3 sm:grid-cols-2">
                    <AdminFormField label="主视觉风格" labelId="cover-style-label">
                      <CustomSelect
                        options={STYLE_OPTIONS}
                        value={stylePreset}
                        onChange={setStylePreset}
                        disabled={busy || generatingPrompt || taskActive || usesExactPrompt}
                        placeholder="选择主视觉风格"
                        dropdownSide="bottom"
                        aria-labelledby="cover-style-label"
                      />
                    </AdminFormField>
                    <AdminFormField label="构图方向" labelId="cover-composition-label">
                      <CustomSelect
                        options={COMPOSITION_OPTIONS}
                        value={composition}
                        onChange={setComposition}
                        disabled={busy || generatingPrompt || taskActive || usesExactPrompt}
                        placeholder="选择构图方向"
                        dropdownSide="bottom"
                        aria-labelledby="cover-composition-label"
                      />
                    </AdminFormField>
                  </div>

                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {STYLE_OPTIONS.find((option) => option.value === stylePreset)?.sub || '自动结合题材推荐画风。'}{' '}
                    {composition === 'auto'
                      ? '构图按所选风格推荐，换变体可调整适配的布局。'
                      : `构图：${COMPOSITION_OPTIONS.find((option) => option.value === composition)?.label || composition}。`}
                  </p>
                </section>
                <details className="ai-cover-understanding">
                  <summary>AI 对作品的理解与方向提取</summary>
                  <section className="grid gap-3" aria-labelledby="cover-understanding-title" aria-live="polite">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="grid gap-0.5">
                        <h3 id="cover-understanding-title" className="text-sm font-semibold text-foreground">
                          AI 对本书的理解
                        </h3>
                        <p className="text-xs text-muted-foreground">根据当前小说简介与分类提炼，仅用于本次封面。</p>
                      </div>
                      {!usesExactPrompt && promptMetadata && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={busy || taskActive || generatingPrompt}
                          onClick={() => void generatePrompt(true)}
                        >
                          <Wand2 className="size-3.5" />
                          换一个画面方向
                        </Button>
                      )}
                    </div>

                    {usesExactPrompt ? (
                      <p className="text-sm leading-relaxed text-muted-foreground">当前使用完整描述词，画面由你填写的内容决定，风格与构图选项不会额外注入。</p>
                    ) : promptMetadata?.storyBrief ? (
                      <div className="grid gap-3 text-sm leading-relaxed">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="secondary">
                            {GENRE_LABELS[promptMetadata.genre || promptMetadata.storyBrief.genre] || promptMetadata.genre || promptMetadata.storyBrief.genre}
                          </Badge>
                          {promptMetadata.contentMode === 'non_explicit' && <Badge variant="outline">非露骨封面</Badge>}
                        </div>
                        {promptMetadata.storyBrief.premise && <p className="text-foreground">{promptMetadata.storyBrief.premise}</p>}
                        {promptMetadata.storyBrief.mood.length > 0 && (
                          <p>
                            <span className="font-medium text-foreground">情绪：</span>
                            {promptMetadata.storyBrief.mood.join('、')}
                          </p>
                        )}
                        {promptMetadata.storyBrief.facts.length > 0 && (
                          <p>
                            <span className="font-medium text-foreground">依据：</span>
                            {promptMetadata.storyBrief.facts
                              .slice(0, 4)
                              .map((fact) => `${FACT_LABELS[fact.kind] || '信息'}：${fact.value}`)
                              .join(' · ')}
                          </p>
                        )}
                        {promptMetadata.visualSummary && !promptConfigMismatch && (
                          <p>
                            <span className="font-medium text-foreground">画面提议：</span>
                            {promptMetadata.visualSummary}
                          </p>
                        )}
                        {promptMetadata.storyBrief.unknowns.length > 0 && (
                          <p className="text-muted-foreground">
                            <span className="font-medium text-foreground">资料未说明：</span>
                            {promptMetadata.storyBrief.unknowns.join('、')}
                          </p>
                        )}
                        {(promptConfigMismatch || promptMetadata.degraded || promptMetadata.storyBrief.degraded) && (
                          <p className="flex items-start gap-2 text-xs text-[var(--color-warning)]">
                            <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                            {promptConfigMismatch
                              ? '风格或构图已变化；当前方向预览仍对应上一组设置，请按新设置重新生成。'
                              : '本次方向使用了降级信息，建议核对画面描述后再生成。'}
                          </p>
                        )}
                      </div>
                    ) : promptMetadata ? (
                      <div className="grid gap-2 text-sm leading-relaxed">
                        <p>{GENRE_LABELS[promptMetadata.genre || ''] || promptMetadata.genre || '已生成视觉方向'}</p>
                        {romanceDirectionLabel(promptMetadata) && <p>{romanceDirectionLabel(promptMetadata)}</p>}
                        {promptMetadata.storySetting && <p>故事场景：{promptMetadata.storySetting}</p>}
                        {promptMetadata.visualAnchor && <p>画面重点：{promptMetadata.visualAnchor}</p>}
                        <p className="text-xs text-muted-foreground">当前服务返回的是旧版方向摘要；你仍可在高级设置中核对完整描述词。</p>
                      </div>
                    ) : (
                      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
                          生成后会显示识别的题材、故事依据、情绪和画面提议。书籍的 R18 分类只作为分级标签，不会自动变成露骨画面要求。
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busy || taskActive || generatingPrompt}
                          onClick={() => void generatePrompt()}
                        >
                          {generatingPrompt ? <Loader2 className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />}
                          {generatingPrompt ? '正在分析…' : '生成方向预览'}
                        </Button>
                      </div>
                    )}
                  </section>
                </details>
                {!imageConfigured && (
                  <div className="flex items-start gap-2.5 rounded-lg border border-[color-mix(in_srgb,var(--color-warning)_45%,transparent)] bg-[color-mix(in_srgb,var(--color-warning)_12%,transparent)] px-3.5 py-3 text-sm leading-relaxed text-[var(--color-warning)]">
                    <CircleAlert className="mt-0.5 size-4 shrink-0" />
                    <p>AI 图像服务未配置。请到「AI 配置」设置图像供应商后再生成。</p>
                  </div>
                )}
                <div className="ai-cover-prompt-fields grid gap-4">
                  <div className="grid gap-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Label htmlFor="cover-prompt">封面描述词</Label>
                      <span
                        className={
                          coverPromptCharCount(prompt) >= coverPromptMaxChars
                            ? 'text-xs font-medium text-[var(--color-warning)]'
                            : 'text-xs text-muted-foreground'
                        }
                      >
                        {coverPromptCharCount(prompt)}/{coverPromptMaxChars}
                      </span>
                    </div>
                    <textarea
                      id="cover-prompt"
                      aria-describedby="cover-prompt-hint"
                      className="min-h-[8rem] w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3.5 py-2.5 text-sm leading-relaxed ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      value={prompt}
                      maxLength={coverPromptMaxChars}
                      disabled={busy || taskActive || generatingPrompt}
                      onChange={(event) => {
                        const nextPrompt = limitCoverPrompt(event.target.value, coverPromptMaxChars)
                        setPrompt(nextPrompt)
                        if (nextPrompt.trim()) {
                          setPromptMode('exact')
                          setPromptSourceSignature('')
                        } else {
                          setPromptMode('auto')
                          setPromptSourceSignature('')
                          setPromptMetadata(undefined)
                        }
                      }}
                      placeholder="先生成方向预览；你也可以在这里直接填写完整描述词。"
                    />
                    <p id="cover-prompt-hint" className="text-xs leading-relaxed text-muted-foreground">
                      手动填写后将按完整描述词生成，平台、风格和构图选项不额外注入。
                    </p>

                    {promptConfigMismatch && (
                      <div className="grid gap-2 rounded-md border border-[color-mix(in_srgb,var(--color-warning)_45%,transparent)] bg-[color-mix(in_srgb,var(--color-warning)_10%,transparent)] p-3 text-xs leading-relaxed text-[var(--color-warning)]">
                        <p>风格或构图已变化，完整描述词仍来自上一版设置。</p>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setPromptMode('exact')
                              setPromptSourceSignature('')
                            }}
                          >
                            保留当前描述词
                          </Button>
                          <Button type="button" size="sm" variant="ghost" disabled={generatingPrompt || taskActive} onClick={() => void generatePrompt()}>
                            按新设置更新方向
                          </Button>
                        </div>
                      </div>
                    )}

                    {!promptConfigMismatch && usesExactPrompt && (
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-[var(--admin-panel-muted)] px-3 py-2 text-xs text-muted-foreground">
                        <span>当前由完整描述词控制画面。</span>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setPrompt('')
                            setPromptMode('auto')
                            setPromptSourceSignature('')
                            setPromptMetadata(undefined)
                          }}
                        >
                          返回配置生成
                        </Button>
                      </div>
                    )}
                  </div>
                  <AdminFormField label="目标平台版式" labelId="cover-platform-label">
                    <CustomSelect
                      options={PLATFORM_OPTIONS}
                      value={platform}
                      onChange={setPlatform}
                      disabled={busy || generatingPrompt || taskActive || usesExactPrompt}
                      placeholder="通用竖版 2:3"
                      dropdownSide="bottom"
                      aria-labelledby="cover-platform-label"
                    />
                    <p className="text-xs leading-relaxed text-muted-foreground">调整平台版式与文字安全区，不决定主视觉画风。</p>
                  </AdminFormField>
                </div>
                <div className="flex items-center justify-between gap-3 ai-cover-render-toggle">
                  <div className="grid gap-0.5">
                    <span className="text-sm font-medium text-foreground">渲染书名与作者</span>
                    <span className="text-xs leading-relaxed text-muted-foreground">需要模型支持中文文字渲染。</span>
                  </div>
                  <Switch
                    checked={renderTitle}
                    disabled={busy || generatingPrompt || taskActive || usesExactPrompt}
                    onCheckedChange={setRenderTitle}
                    aria-label="生成封面时渲染书名和作者"
                  />
                </div>
                {/* 描述词仍在生成时禁止提交，确保任务使用屏幕上已确认的方向。 */}
                <Button size="lg" className="w-full gap-2" disabled={!canGenerateCover} onClick={() => void generate()}>
                  {busy || taskActive ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      封面生成中…
                    </>
                  ) : (
                    <>
                      <Sparkles className="size-4" />
                      {candidates.length ? '保留方向，重新生成候选' : '按本次方向生成封面'}
                    </>
                  )}
                </Button>
                {task && (
                  <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--admin-inset)]">
                    <div className="flex flex-wrap items-center gap-2.5 px-3.5 py-3 text-sm">
                      <span className="relative flex size-2.5">
                        {taskActive && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--accent)] opacity-60" />}
                        <span className={`relative inline-flex size-2.5 rounded-full ${statusDotColor(task.status)}`} />
                      </span>
                      <span className="font-medium text-foreground">{taskStatusLabel(task.status)}</span>
                      {taskNovel && task.novelId !== novelId && <span className="text-xs text-muted-foreground">任务作品：{taskNovel.title}</span>}
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

              <div className="ai-cover-results grid min-w-0 content-start gap-6">
                <section className="grid gap-3" aria-labelledby="cover-comparison-title">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="grid gap-0.5">
                      <h3 id="cover-comparison-title" className="text-sm font-semibold text-foreground">
                        封面候选
                      </h3>
                      <p className="text-xs text-muted-foreground">选择候选查看描述与大图，采纳后用于读者端。</p>
                    </div>
                  </div>

                  <p className="text-xs leading-relaxed text-muted-foreground">AI 图片先保存为候选；采纳后才替换读者端封面。历史记录可恢复之前的版本。</p>

                  {candidatesLoading ? (
                    <p className="ai-cover-empty">正在读取候选…</p>
                  ) : candidateError ? (
                    <ErrorState message={`封面候选加载失败：${candidateError}`} onRetry={() => void loadCandidates(novelId)} />
                  ) : !focusedCandidate ? (
                    <div className="ai-cover-empty">
                      <p>还没有待比较的候选</p>
                      <p>生成封面后会显示在这里，采纳后才替换线上封面。</p>
                    </div>
                  ) : (
                    <>
                      <div className="ai-cover-gallery" aria-label="封面候选选择">
                        {candidates.map((candidate, index) => (
                          <button
                            key={candidate.id}
                            type="button"
                            className="ai-cover-tile"
                            aria-pressed={focusedCandidate.id === candidate.id}
                            onClick={() => setFocusedCandidateId(candidate.id)}
                          >
                            <CoverCanvas src={candidate.dataUrl} title={`${selected.title} 候选 ${index + 1}`} hasNovel className="rounded-lg" />
                            <span>候选 {index + 1}</span>
                          </button>
                        ))}
                      </div>
                      <figure className="ai-cover-selected">
                        <CoverCanvas
                          src={focusedCandidate.dataUrl}
                          title={`${selected.title} 选中候选`}
                          hasNovel
                          className="rounded-lg"
                          onPreview={() => setPreviewImage({ src: focusedCandidate.dataUrl, title: `${selected.title} · 候选封面` })}
                        />
                        <figcaption className="grid gap-2">
                          <span className="text-xs text-muted-foreground">{candidateTime(focusedCandidate.createdAt)}</span>
                          {focusedCandidate.metadata && (focusedCandidate.metadata.stylePreset || focusedCandidate.metadata.composition) ? (
                            <div className="grid gap-0.5 text-xs text-muted-foreground">
                              <p>
                                {STYLE_OPTIONS.find((option) => option.value === focusedCandidate.metadata?.stylePreset)?.label ||
                                  focusedCandidate.metadata.stylePreset}{' '}
                                ·{' '}
                                {COMPOSITION_OPTIONS.find((option) => option.value === focusedCandidate.metadata?.composition)?.label ||
                                  focusedCandidate.metadata.composition}
                              </p>
                              {focusedCandidate.metadata.promptMode === 'exact' && <p>本次方向已写入完整描述词</p>}
                              {romanceDirectionLabel(focusedCandidate.metadata) && <p>{romanceDirectionLabel(focusedCandidate.metadata)}</p>}
                            </div>
                          ) : focusedCandidate.metadata?.promptMode === 'exact' ? (
                            <p className="text-xs text-muted-foreground">完整描述词</p>
                          ) : null}
                          {focusedCandidate.metadata?.contentMode === 'non_explicit' && <p className="text-xs text-muted-foreground">封面画面保持非露骨</p>}
                          {focusedCandidate.metadata?.visualSummary && (
                            <p className="line-clamp-3 text-xs leading-relaxed text-foreground/90">{focusedCandidate.metadata.visualSummary}</p>
                          )}
                          <div className="flex gap-1.5">
                            <Button size="sm" className="flex-1" disabled={!!candidateBusy} onClick={() => void adopt(focusedCandidate)}>
                              {candidateBusy === focusedCandidate.id ? (
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
                              onClick={() => void discard(focusedCandidate)}
                              aria-label={`弃用候选 ${candidates.indexOf(focusedCandidate) + 1}`}
                              title="弃用"
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                          {focusedCandidate.prompt && (
                            <details className="text-xs text-muted-foreground">
                              <summary className="w-fit cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                查看完整描述词
                              </summary>
                              <p className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap break-words leading-relaxed">{focusedCandidate.prompt}</p>
                            </details>
                          )}
                        </figcaption>{' '}
                      </figure>
                    </>
                  )}
                </section>

                <section className="ai-cover-current">
                  <div className="flex items-center justify-between gap-3">
                    <h3>当前封面与历史</h3>{' '}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      className="hidden"
                      onChange={(event) => void handleUploadFile(event)}
                    />
                    <Button variant="outline" size="sm" disabled={candidateBusy === 'upload' || !novelId} onClick={() => fileInputRef.current?.click()}>
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
                  <div className="ai-cover-current-book">
                    <CoverCanvas
                      src={previewSrc}
                      title={`${selected.title} 当前封面`}
                      hasNovel
                      className="rounded-lg"
                      onPreview={previewSrc ? () => setPreviewImage({ src: previewSrc, title: `${selected.title} · 当前封面` }) : undefined}
                    />
                    <div>
                      <strong>{selected.title}</strong>
                      <p>当前线上封面</p>
                      <p>采纳候选或上传图片后替换，历史版本可以恢复。</p>
                    </div>
                  </div>{' '}
                  <CoverHistory
                    novelId={novelId}
                    coverVersion={coverVersion}
                    onRestored={() => setCoverVersion((version) => version + 1)}
                    onCurrentVersion={setCurrentCoverVersion}
                  />
                </section>
              </div>
            </div>
          </>
        )}
      </CardContent>

      <Dialog open={!!previewImage} onOpenChange={(open) => !open && setPreviewImage(null)}>
        <AdminDialogContent variant="preview">
          <DialogHeader>
            <DialogTitle>{previewImage?.title || '封面预览'}</DialogTitle>
          </DialogHeader>
          {previewImage && <img src={previewImage.src} alt={previewImage.title} className="mx-auto max-h-[78vh] max-w-full object-contain" />}
        </AdminDialogContent>
      </Dialog>
    </Card>
  )
}
