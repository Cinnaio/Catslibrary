/**
 * 爬虫抓取 tab —— 抓取中心 / 发现小说 / 书源管理 三个子视图。
 * 由 Novel-KV js/admin-scrape.js + js/admin-discover.js + admin.html #tab-scrape 平移。
 * 说明：旧版「本地（浏览器代理）抓取」模式未移植 —— 仅保留服务器端（云端）抓取，
 * 即 scrapeApi.start 走自托管 Node API。所有抓取任务都通过任务卡片轮询。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, ChevronLeft, ChevronRight, CircleMinus, RefreshCw, RotateCcw, Search, X } from 'lucide-react'
import { authHeaders, novelsApi, scrapeApi, url } from '../../lib/api'
import { formatDateTime } from '../../lib/format'
import { formatEta, formatJobSpeed, isJobRunning, isJobTerminal, jobStatusLabel } from '../../lib/admin'
import { useConfirm, useToast } from '../../components/feedback'
import CustomSelect from '../../components/admin/CustomSelect'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'

// ---------- helpers ----------

/** scrapeApi 未覆盖的 /scrape 动作（test/discover/list-sources/import-legado 等）走此 POST。 */
async function scrapePost(body: Record<string, unknown>): Promise<any> {
  const res = await fetch(url('/scrape'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error || `HTTP ${res.status}`)
  return data
}

/** 逗号/顿号分隔分类字符串 → 去重数组（大小写不敏感）。 */
function parseCategories(input: string): string[] {
  if (!input) return []
  const seen = new Set<string>()
  return input
    .split(/[,，、]/)
    .map((s) => s.trim())
    .filter((s) => {
      if (!s || seen.has(s.toLowerCase())) return false
      seen.add(s.toLowerCase())
      return true
    })
}

/** 日志时间戳可能是数值或 ISO 字符串。 */
function fmtLogTime(ts: number | string | undefined): string {
  if (ts == null) return ''
  const t = Number(ts)
  if (Number.isFinite(t) && t > 0) return formatDateTime(t)
  return String(ts)
}

/** PO18 封面兜底：从 /book/<id> 推导。 */
function po18CoverFallback(sourceUrl: string): string {
  const m = (sourceUrl || '').match(/\/book\/(\d+)/)
  if (!m) return ''
  const id = parseInt(m[1] || '', 10)
  return `https://img.po18x.vip/image/${Math.floor(id / 1000)}/${m[1]}/${m[1]}s.jpg`
}

// ---------- types ----------

interface DetectedMeta {
  novel?: {
    title?: string
    author?: string
    description?: string
    coverUrl?: string
    categories?: string[]
    category?: string
    status?: string
    sourceUrl?: string
  }
  selectors?: { chapterList?: string; chapterTitle?: string; chapterContent?: string; nextPage?: string }
  encoding?: string
  chapterListUrl?: string
  chapterCount?: number
  site?: { name?: string }
  error?: string
}

interface CheckItem {
  label: string
  ok: boolean
  detail?: string
}

type ConfigRow = [string, string]

interface JobStatusData {
  id?: string
  status?: string
  step?: string
  current?: number
  total?: number
  progress?: number
  chapterCount?: number
  startedAt?: number
  updatedAt?: number
  successCount?: number
  failedCount?: number
  skippedCount?: number
  speed?: number
  etaSeconds?: number
  failedItems?: Array<{ chapterTitle?: string; chapterUrl?: string; error?: string }>
  summary?: Record<string, number>
  recentLogs?: Array<{ level?: string; message?: string; detail?: string; createdAt?: number | string }>
  novelTitle?: string
  novelId?: string
}

interface JobCard {
  jobId: string
  novelTitle: string
  status: string
  step: string
  current: number
  total: number
  progress: number
  successCount: number
  failedCount: number
  skippedCount: number
  speed: number
  etaSeconds: number
  failedItems: Array<{ chapterTitle?: string; chapterUrl?: string; error?: string }>
  recentLogs: Array<{ level: string; message: string; detail?: string; createdAt?: number | string }>
  logOpen: boolean
}

interface DiscoverNovel {
  bookId?: string
  title: string
  author?: string
  coverUrl?: string
  url: string
  existing?: boolean
  description?: string
  chapterCount?: number
  status?: string
}

interface BatchEntry {
  type: 'novel' | 'ok' | 'skip' | 'err' | 'info'
  text: string
}

interface BatchState {
  title: string
  entries: BatchEntry[]
  total: number
  success: number
  fail: number
  done: boolean
}

interface DiscoverDetail {
  item: DiscoverNovel
  loading: boolean
  error: string
  meta: DetectedMeta | null
  chapters: Array<{ text: string; href: string }> | null
  chapterCount: number
  scraping: boolean
}

interface SourceRow {
  host: string
  name: string
  encoding?: string
  support?: string
  confidence?: number | string
  enabled?: boolean
  chapterList?: string
  chapterContent?: string
  warnings?: string[]
}

const PO18_SITES = [
  { label: '日点击榜', value: 'https://wap.po18x.vip/top/dayvisit_1/' },
  { label: '周点击榜', value: 'https://wap.po18x.vip/top/weekvisit_1/' },
  { label: '月点击榜', value: 'https://wap.po18x.vip/top/monthvisit_1/' },
  { label: '总点击榜', value: 'https://wap.po18x.vip/top/allvisit_1/' },
  { label: '日推荐榜', value: 'https://wap.po18x.vip/top/dayvote_1/' },
  { label: '周推荐榜', value: 'https://wap.po18x.vip/top/weekvote_1/' },
  { label: '月推荐榜', value: 'https://wap.po18x.vip/top/monthvote_1/' },
  { label: '总推荐榜', value: 'https://wap.po18x.vip/top/allvote_1/' },
  { label: '总收藏榜', value: 'https://wap.po18x.vip/top/goodnum_1/' },
  { label: '字数排行', value: 'https://wap.po18x.vip/top/size_1/' },
  { label: '最新入库', value: 'https://wap.po18x.vip/top/postdate_1/' },
  { label: '最近更新', value: 'https://wap.po18x.vip/top/lastupdate_1/' },
]

const FALLBACK_COVER = 'https://wap.po18x.vip/17mb/style/noimg.jpg'

function supportBadge(support: string | undefined) {
  const label = support === 'full' ? '可用' : support === 'partial' ? '需核验' : '不支持'
  const cls =
    support === 'full'
      ? 'bg-success/10 text-success'
      : support === 'partial'
        ? 'bg-warning/10 text-warning'
        : 'bg-secondary text-muted-foreground'
  return <Badge className={cls}>{label}</Badge>
}

function coverOnError(e: React.SyntheticEvent<HTMLImageElement>) {
  const img = e.currentTarget
  if (img.src !== FALLBACK_COVER) {
    img.src = FALLBACK_COVER
    return
  }
  img.style.display = 'none'
  const p = img.parentElement
  if (p) p.classList.add('discover-card__cover--broken')
}

// ============================================================
// 抓取中心
// ============================================================

function CenterView() {
  const { toast } = useToast()
  const { confirm } = useConfirm()

  // Step 1 / 2
  const [sourceUrl, setSourceUrl] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeResult, setAnalyzeResult] = useState<{ ok: boolean | null; text: string }>({ ok: null, text: '' })
  const [showNovelPreview, setShowNovelPreview] = useState(false)
  const [preview, setPreview] = useState({ title: '', author: '', category: '', status: 'ongoing', description: '', coverUrl: '' })
  const [confirming, setConfirming] = useState(false)
  const [currentScrapeNovelId, setCurrentScrapeNovelId] = useState('')
  const currentScrapeNovelIdRef = useRef('')
  const [showScrapeConfig, setShowScrapeConfig] = useState(false)

  // Step 3 config
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [sitePreset, setSitePreset] = useState('custom')
  const [chapterListUrl, setChapterListUrl] = useState('')
  const [selectors, setSelectors] = useState({ chapterList: '', chapterTitle: '', chapterContent: '', nextPage: '' })
  const [activeEncoding, setActiveEncoding] = useState('')
  const [testResult, setTestResult] = useState<{ loading: boolean; empty?: boolean; error?: string; data: Record<string, any> | null }>({ loading: false, data: null })

  // Side cards
  const [preflight, setPreflight] = useState<CheckItem[]>([])
  const [configRows, setConfigRows] = useState<ConfigRow[]>([])

  // Job cards
  const [jobCards, setJobCards] = useState<JobCard[]>([])
  const activePolls = useRef(new Set<string>())

  // Config export/import
  const [configImportStatus, setConfigImportStatus] = useState('')
  const configFileRef = useRef<HTMLInputElement>(null)

  const effectiveCover = useMemo(() => {
    if (!preview.coverUrl || /noimg\.jpg/i.test(preview.coverUrl)) return ''
    return preview.coverUrl
  }, [preview.coverUrl])

  const addJobCard = useCallback((jobId: string, novelTitle: string) => {
    setJobCards((prev) => {
      if (prev.some((c) => c.jobId === jobId)) return prev
      return [
        {
          jobId,
          novelTitle,
          status: 'starting',
          step: '任务已启动（服务器模式）',
          current: 0,
          total: 0,
          progress: 0,
          successCount: 0,
          failedCount: 0,
          skippedCount: 0,
          speed: 0,
          etaSeconds: 0,
          failedItems: [],
          recentLogs: [],
          logOpen: false,
        },
        ...prev,
      ]
    })
    activePolls.current.add(jobId)
  }, [])

  const applyJobStatus = useCallback((jobId: string, data: JobStatusData) => {
    setJobCards((prev) =>
      prev.map((c) => {
        if (c.jobId !== jobId) return c
        const status = data.status || c.status
        const summary = data.summary || {}
        return {
          ...c,
          status,
          step: data.step ?? c.step,
          current: data.current ?? c.current,
          total: data.total ?? c.total,
          progress: data.progress ?? c.progress,
          successCount: data.successCount ?? summary.successCount ?? c.successCount,
          failedCount: data.failedCount ?? summary.failedCount ?? c.failedCount,
          skippedCount: data.skippedCount ?? summary.skippedCount ?? c.skippedCount,
          speed: data.speed ?? summary.speed ?? c.speed,
          etaSeconds: data.etaSeconds ?? summary.etaSeconds ?? c.etaSeconds,
          failedItems: Array.isArray(data.failedItems) ? data.failedItems : c.failedItems,
          recentLogs: Array.isArray(data.recentLogs)
            ? data.recentLogs.map((l) => ({ level: l.level || 'info', message: l.message || '', detail: l.detail, createdAt: l.createdAt }))
            : c.recentLogs,
        }
      }),
    )
  }, [])

  const removeJobCard = useCallback((jobId: string) => {
    activePolls.current.delete(jobId)
    setJobCards((prev) => prev.filter((c) => c.jobId !== jobId))
  }, [])

  const toggleLog = useCallback((jobId: string) => {
    setJobCards((prev) => prev.map((c) => (c.jobId === jobId ? { ...c, logOpen: !c.logOpen } : c)))
  }, [])

  // Resume running jobs on mount（与旧版 resumeScrapeJob 一致）
  useEffect(() => {
    let cancelled = false
    scrapeApi
      .jobs()
      .then((data) => {
        if (cancelled) return
        const jobs = (data as { jobs?: JobStatusData[] }).jobs || []
        jobs.forEach((j) => {
          if (!isJobRunning(j.status || '')) return
          const jobId = j.id || ''
          if (!jobId) return
          const novelTitle = j.novelTitle || j.novelId || ''
          addJobCard(jobId, novelTitle ? novelTitle.slice(0, 12) : jobId.slice(0, 12))
          applyJobStatus(jobId, j)
        })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [addJobCard, applyJobStatus])

  // 轮询所有运行中的任务（2s），终端状态停止轮询
  useEffect(() => {
    const timer = setInterval(() => {
      const ids = Array.from(activePolls.current)
      ids.forEach((jobId) => {
        scrapeApi
          .status(jobId)
          .then((data) => {
            const st = String((data as JobStatusData).status || '')
            applyJobStatus(jobId, data as JobStatusData)
            if (isJobTerminal(st)) activePolls.current.delete(jobId)
          })
          .catch(() => {
            /* 下个周期重试 */
          })
      })
    }, 2000)
    return () => clearInterval(timer)
  }, [applyJobStatus])

  // ---- Step 1: analyze ----
  async function analyzeUrl() {
    const s = sourceUrl.trim()
    if (!s) {
      toast('请先粘贴小说网址', 'error')
      return
    }
    setAnalyzing(true)
    setAnalyzeResult({ ok: null, text: '' })
    try {
      const data = (await scrapeApi.detectMeta(s)) as unknown as DetectedMeta & { chapterListUrl?: string; chapterCount?: number }
      const n = data.novel || {}
      setActiveEncoding(data.encoding || '')
      setAnalyzeResult({
        ok: true,
        text: `识别成功 — ${data.site?.name || '通用'} · ${data.chapterCount || 0} 章 · 编码: ${data.encoding || 'utf-8'}`,
      })
      const rawCategories: string[] = Array.isArray(n.categories) ? n.categories : n.category ? [n.category] : []
      setPreview({
        title: n.title || '',
        author: n.author || '',
        category: rawCategories.filter(Boolean).join(', '),
        status: n.status || 'ongoing',
        description: n.description || '',
        coverUrl: n.coverUrl && !/noimg\.jpg/i.test(n.coverUrl) ? n.coverUrl : po18CoverFallback(n.sourceUrl || s) || '',
      })
      setShowNovelPreview(true)
      setChapterListUrl(data.chapterListUrl || s)
      setSelectors({
        chapterList: data.selectors?.chapterList || '',
        chapterTitle: data.selectors?.chapterTitle || '',
        chapterContent: data.selectors?.chapterContent || '',
        nextPage: data.selectors?.nextPage || '',
      })
      setConfigRows([
        ['站点', data.site?.name || '通用站点'],
        ['编码', data.encoding || 'utf-8'],
        ['目录', data.chapterListUrl || s],
        ['列表', data.selectors?.chapterList || '未配置'],
        ['内容', data.selectors?.chapterContent || '未配置'],
      ])
      setPreflight([
        { label: '小说信息', ok: !!n.title },
        { label: '章节目录', ok: (data.chapterCount || 0) > 0, detail: (data.chapterCount || 0) + ' 章' },
        { label: '编码', ok: true, detail: data.encoding || 'utf-8' },
      ])
      toast('小说信息识别完成', 'success')
    } catch (err) {
      setAnalyzeResult({ ok: false, text: (err as Error).message })
      toast((err as Error).message, 'error')
    } finally {
      setAnalyzing(false)
    }
  }

  // ---- Step 2: confirm / create novel ----
  async function confirmNovel() {
    const title = preview.title.trim()
    const author = preview.author.trim()
    if (!title || !author) {
      toast('书名和作者不能为空', 'error')
      return
    }
    setConfirming(true)
    try {
      const res = await novelsApi.create({
        title,
        author,
        description: preview.description,
        coverUrl: preview.coverUrl || '',
        categories: parseCategories(preview.category),
        status: preview.status,
        sourceUrl: sourceUrl.trim(),
      })
      const novelId = (res as { novel?: { id: string } }).novel?.id || (res as { id?: string }).id || ''
      currentScrapeNovelIdRef.current = novelId
      setCurrentScrapeNovelId(novelId)
      toast('小说已创建！现在可以开始抓取章节', 'success')
      setShowScrapeConfig(true)
    } catch (err) {
      toast('创建失败: ' + (err as Error).message, 'error')
    } finally {
      setConfirming(false)
    }
  }

  function skipToScrape() {
    setShowScrapeConfig(true)
    toast('已跳过创建，请在高级配置中确认章节列表页 URL 与选择器', 'default')
  }

  // ---- Site preset ----
  function applySitePreset(key: string) {
    setSitePreset(key)
    if (key === 'custom') return
    const preset = { name: 'PO18', selectors: { chapterList: '.chapters li a', chapterTitle: '#chaptertitle', chapterContent: '#novelcontent', nextPage: '.page a' }, encoding: 'gbk' }
    setSelectors({ ...preset.selectors })
    setActiveEncoding(preset.encoding)
    setConfigRows([
      ['站点', preset.name],
      ['编码', preset.encoding],
      ['目录', chapterListUrl.trim() || '未填写'],
      ['列表', preset.selectors.chapterList],
      ['内容', preset.selectors.chapterContent],
    ])
    toast(`已应用 ${preset.name} 预设`, 'success')
  }

  // ---- Step 3: test selectors ----
  async function testSelectors() {
    const src = chapterListUrl.trim()
    const selList = selectors.chapterList.trim()
    if (!src || !selList) {
      toast('请填写章节列表页 URL 和选择器', 'error')
      return
    }
    setTestResult({ loading: true, data: null })
    try {
      const data = await scrapePost({
        action: 'test',
        sourceUrl: src,
        encoding: activeEncoding || null,
        selectors: { chapterList: selectors.chapterList, chapterTitle: selectors.chapterTitle, chapterContent: selectors.chapterContent },
      })
      if (data.links && data.links.length > 0) {
        const diagnostics = data.diagnostics || {}
        const sampleOk = Array.isArray(data.sampleChapters) ? data.sampleChapters.filter((s: any) => s.ok).length : 0
        setPreflight([
          { label: '章节链接', ok: true, detail: data.links.length + ' 个' },
          { label: '重复链接', ok: !diagnostics.duplicateCount, detail: (diagnostics.duplicateCount || 0) + ' 个' },
          { label: '空标题', ok: !diagnostics.emptyTitleCount, detail: (diagnostics.emptyTitleCount || 0) + ' 个' },
          { label: '样章内容', ok: sampleOk > 0, detail: sampleOk + '/' + (data.sampleChapters?.length || 0) + ' 可读' },
        ])
        setTestResult({ loading: false, data })
      } else {
        setTestResult({ loading: false, empty: true, data: null })
      }
    } catch (err) {
      setTestResult({ loading: false, error: (err as Error).message, data: null })
      toast('抓取服务不可用。请确认自托管 API 服务正在运行。', 'default')
    }
  }

  // ---- Step 3: start scrape ----
  async function startScrape() {
    const novelId = currentScrapeNovelIdRef.current
    if (!novelId) {
      toast('请先在第二步确认/创建小说后再开始抓取', 'error')
      return
    }
    const src = chapterListUrl.trim()
    const sel = {
      chapterList: selectors.chapterList.trim(),
      chapterTitle: selectors.chapterTitle.trim(),
      chapterContent: selectors.chapterContent.trim(),
      nextPage: selectors.nextPage.trim(),
    }
    if (!src || !sel.chapterList || !sel.chapterContent) {
      toast('请先执行智能分析并确认小说', 'error')
      return
    }
    const ok = await confirm({
      title: '开始抓取',
      message: '即将开始抓取小说，确认信息如下：',
      okText: '开始抓取',
      items: ['源站: ' + src, '章节列表: ' + (sel.chapterList || '—'), '章节内容: ' + (sel.chapterContent || '—'), '翻页: ' + (sel.nextPage || '无')],
    })
    if (!ok) return
    try {
      const res = await scrapeApi.start({ novelId, sourceUrl: src, encoding: activeEncoding || null, selectors: sel })
      if (res.jobId) {
        addJobCard(res.jobId, preview.title.trim() || '(未命名)')
        toast('抓取任务已启动！', 'success')
      } else {
        throw new Error((res as { error?: string }).error || '未知错误')
      }
    } catch (err) {
      toast('抓取失败: ' + (err as Error).message, 'error')
    }
  }

  // ---- Job card actions ----
  async function cancelJob(jobId: string) {
    const ok = await confirm({
      title: '终止任务',
      message: '确定终止该任务？正在运行的抓取流程会被中断。',
      okText: '终止',
      danger: true,
      items: [jobId],
    })
    if (!ok) return
    try {
      await scrapeApi.cancel(jobId)
      toast('任务已终止', 'default')
    } catch (err) {
      toast('终止失败: ' + (err as Error).message, 'error')
    }
  }

  async function retryJob(jobId: string) {
    toast('正在重试任务…', 'default')
    try {
      const data = await scrapePost({ action: 'retry', jobId })
      if (data.jobId) {
        toast('重试任务已启动', 'success')
        const old = jobCards.find((c) => c.jobId === jobId)
        addJobCard(data.jobId, (old?.novelTitle || jobId.slice(0, 12)) + ' (重试)')
      } else {
        throw new Error(data.error || '重试失败')
      }
    } catch (err) {
      toast('重试失败: ' + (err as Error).message, 'error')
    }
  }

  async function retryFailedJob(jobId: string) {
    toast('正在重试失败章节…', 'default')
    try {
      const data = (await scrapeApi.retryFailed(jobId)) as { jobId?: string; error?: string }
      if (data.jobId) {
        toast('失败章节重试已启动', 'success')
        const old = jobCards.find((c) => c.jobId === jobId)
        addJobCard(data.jobId, (old?.novelTitle || jobId.slice(0, 12)) + ' (失败章节重试)')
      } else {
        throw new Error(data.error || '重试失败章节失败')
      }
    } catch (err) {
      toast('重试失败章节失败: ' + (err as Error).message, 'error')
    }
  }

  // ---- Config export / import ----
  async function exportConfigs() {
    toast('正在导出爬虫配置…', 'default')
    try {
      const data = await scrapePost({ action: 'list-configs' })
      const configs = Array.isArray(data.configs) ? data.configs : []
      if (configs.length === 0) {
        toast('没有爬虫配置可导出', 'error')
        return
      }
      const blob = new Blob([JSON.stringify(configs, null, 2)], { type: 'application/json;charset=utf-8' })
      const objectUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = objectUrl
      a.download = `scrape_configs_${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(objectUrl)
      toast('已导出 ' + configs.length + ' 条配置', 'success')
    } catch (err) {
      toast('导出失败: ' + (err as Error).message, 'error')
    }
  }

  async function handleConfigFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const text = await file.text()
      const configs = JSON.parse(text)
      if (!Array.isArray(configs)) throw new Error('JSON 格式错误，应为数组')
      setConfigImportStatus('正在导入 ' + configs.length + ' 条配置…')
      const data = await scrapePost({ action: 'import-configs', configs })
      setConfigImportStatus('')
      toast('成功导入 ' + (data.imported || 0) + ' 条配置', 'success')
    } catch (err) {
      toast('导入失败: ' + (err as Error).message, 'error')
    }
  }

  function renderJobCard(job: JobCard) {
    const running = isJobRunning(job.status)
    const terminal = isJobTerminal(job.status)
    let statusCls = 'bg-info/10 text-info'
    let statusText = jobStatusLabel(job.status)
    if (job.status === 'completed') {
      statusCls = 'bg-success/10 text-success'
      statusText = '✓ ' + jobStatusLabel(job.status)
    } else if (job.status === 'partial') {
      statusCls = 'bg-warning/10 text-warning'
      statusText = '⚠ ' + jobStatusLabel(job.status)
    } else if (job.status === 'failed') {
      statusCls = 'bg-destructive/10 text-destructive'
      statusText = '✕ ' + jobStatusLabel(job.status)
    } else if (job.status === 'cancelled') {
      statusCls = 'bg-muted text-muted-foreground'
      statusText = '— ' + jobStatusLabel(job.status)
    }

    let pct = job.progress != null ? job.progress * 100 : 5
    if (job.total > 0 && job.current != null) pct = Math.min((job.current / job.total) * 95, 95)
    if (terminal) pct = 100
    const fillCls = job.status === 'failed' ? '[&_[data-slot=progress-indicator]]:bg-destructive' : job.status === 'cancelled' ? '[&_[data-slot=progress-indicator]]:bg-muted-foreground' : ''

    return (
      <div className="card scrape-step job-card" key={job.jobId} data-job-id={job.jobId}>
        <div className="job-card__head">
          <div className="job-card__title">
            {running ? <div className="spinner"></div> : <span style={{ width: 16, height: 16 }}></span>}
            <span className="text-sm job-card__name">{job.novelTitle}</span>
            <Badge className={statusCls}>{statusText}</Badge>
          </div>
          <div className="job-card__actions">
            {job.failedCount > 0 && (
              <Button variant="ghost" size="icon" className="btn-retry-failed-job" title="重试失败章节" onClick={() => void retryFailedJob(job.jobId)}>
                <RotateCcw className="size-4" />
              </Button>
            )}
            {!running && (job.status === 'failed' || job.status === 'cancelled' || job.status === 'partial') && (
              <Button variant="ghost" size="icon" className="btn-retry-job" title="整本重试" onClick={() => void retryJob(job.jobId)}>
                <RefreshCw className="size-4" />
              </Button>
            )}
            {terminal && (
              <Button variant="ghost" size="icon" className="btn-dismiss-job" title="清除" onClick={() => removeJobCard(job.jobId)}>
                <X className="size-4" />
              </Button>
            )}
            <Button variant="ghost" size="icon" className="btn-cancel-job" title="终止" onClick={() => void cancelJob(job.jobId)}>
              <CircleMinus className="size-4" />
            </Button>
          </div>
        </div>
        <Progress value={pct} className={fillCls} />
        <div className="scrape-job-metrics">
          <span>
            成功 <strong>{job.successCount}</strong>
          </span>
          <span>
            失败 <strong>{job.failedCount}</strong>
          </span>
          <span>
            跳过 <strong>{job.skippedCount}</strong>
          </span>
          <span>
            速度 <strong>{formatJobSpeed(job.speed)}</strong>
          </span>
          <span>
            ETA <strong>{formatEta(job.etaSeconds)}</strong>
          </span>
        </div>
        <div className="text-xs text-muted job-card__step">
          {job.step}
          {job.total > 0 ? ` (${job.current || 0}/${job.total})` : ''}
        </div>
        {job.failedItems.length > 0 && (
          <div className="scrape-job-failed-list">
            <div className="scrape-job-failed-list__title">失败章节</div>
            {job.failedItems.map((item, i) => (
              <div className="scrape-job-failed-item" key={i}>
                <span>{item.chapterTitle || item.chapterUrl || '未知章节'}</span>
                <em>{item.error || '抓取失败'}</em>
              </div>
            ))}
          </div>
        )}
        <div className="toggle-advanced job-card__log-toggle" onClick={() => toggleLog(job.jobId)}>
          <span>{job.logOpen ? '▾' : '▸'}</span> 日志
        </div>
        {job.logOpen && (
          <div className="scrape-job-log-list">
            {job.recentLogs.map((log, i) => (
              <div className={`scrape-job-log-item scrape-job-log-item--${log.level || 'info'}`} key={i}>
                <span>{fmtLogTime(log.createdAt)}</span>
                <strong>{log.message}</strong>
                {log.detail ? <em>{String(log.detail).slice(0, 160)}</em> : null}
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      <div className="admin-page-intro scrape-center-hero">
        <div>
          <p className="detail-kicker">SCRAPE CENTER</p>
          <h2 className="section-title">爬虫抓取中心</h2>
          <p className="text-secondary text-sm">识别源站、检测章节、追踪任务，并在失败时恢复抓取。</p>
        </div>
        <div className="scrape-center-hero__meta">
          <span>全量抓取</span>
          <span>增量更新</span>
          <span>失败重试</span>
        </div>
      </div>

      <div className="scrape-flow-grid">
        <div className="scrape-flow-grid__main">
          {/* Step 1 */}
          <div className="card scrape-step">
            <div className="step-label">第一步</div>
            <h3 className="step-title">智能分析小说</h3>
            <div className="step-body">
              <div className="input-row">
                <Input
                  type="url"
                  className="flex-1 admin-input--compact"
                  placeholder="https://wap.po18x.vip/book/10075/"
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                />
                <Button size="sm" onClick={() => void analyzeUrl()} disabled={analyzing}>
                  {analyzing ? '分析中…' : '智能分析'}
                </Button>
              </div>
              <div className="analyze-result">
                {analyzing ? (
                  <div className="flex items-center gap">
                    <div className="spinner"></div>
                    <span className="text-sm text-muted">正在获取页面信息，识别书名、作者…</span>
                  </div>
                ) : analyzeResult.ok === true ? (
                  <div className="success-text">{analyzeResult.text}</div>
                ) : analyzeResult.ok === false ? (
                  <div className="error-text">{analyzeResult.text}</div>
                ) : null}
              </div>
            </div>
          </div>

          {/* Step 2 */}
          {showNovelPreview && (
            <div className="card scrape-step">
              <div className="step-label">第二步</div>
              <h3 className="step-title">确认信息并抓取</h3>
              <div className="step-body">
                <div className="scrape-preview">
                  {effectiveCover ? (
                    <div className="scrape-preview__cover">
                      <img src={effectiveCover} alt="" referrerPolicy="no-referrer" onError={(e) => (e.currentTarget.style.display = 'none')} />
                    </div>
                  ) : null}
                  <div className="scrape-preview__form">
                    <div className="form-group">
                      <Label className="mb-1.5">书名</Label>
                      <Input value={preview.title} onChange={(e) => setPreview({ ...preview, title: e.target.value })} />
                    </div>
                    <div className="form-group">
                      <Label className="mb-1.5">作者</Label>
                      <Input value={preview.author} onChange={(e) => setPreview({ ...preview, author: e.target.value })} />
                    </div>
                    <div className="scrape-preview__grid">
                      <div className="form-group">
                        <Label className="mb-1.5">分类</Label>
                        <Input value={preview.category} placeholder="玄幻, 修真" onChange={(e) => setPreview({ ...preview, category: e.target.value })} />
                      </div>
                      <div className="form-group">
                        <Label className="mb-1.5">状态</Label>
                        <CustomSelect
                          compact
                          options={[
                            { value: 'ongoing', label: '连载中' },
                            { value: 'completed', label: '已完结' },
                          ]}
                          value={preview.status}
                          onChange={(v) => setPreview({ ...preview, status: v })}
                        />
                      </div>
                    </div>
                    <div className="form-group">
                      <Label className="mb-1.5">简介</Label>
                      <Textarea rows={3} value={preview.description} onChange={(e) => setPreview({ ...preview, description: e.target.value })} />
                    </div>
                    <div className="action-row admin-action-row">
                      <Button onClick={() => void confirmNovel()} disabled={confirming || !!currentScrapeNovelId}>
                        {confirming ? '创建中…' : '确认并创建小说'}
                      </Button>
                      <Button variant="secondary" onClick={skipToScrape} disabled={!!currentScrapeNovelId}>
                        跳过 (已有小说)
                      </Button>
                    </div>
                    {currentScrapeNovelId && <div className="success-text scrape-ready-note">小说已就绪，ID: {currentScrapeNovelId}</div>}
                  </div>
                </div>

                {showScrapeConfig && (
                  <div id="stepScrapeConfig">
                    <div className="action-row scrape-action-row">
                      <Button size="sm" onClick={() => void startScrape()}>
                        开始抓取
                      </Button>
                    </div>
                    <button className={`toggle-advanced${advancedOpen ? ' open' : ''}`} onClick={() => setAdvancedOpen(!advancedOpen)}>
                      高级配置
                    </button>
                    {advancedOpen && (
                      <div id="advancedConfig">
                        <div className="admin-toolbar__group">
                          <div className="preset-group">
                            <button className={`preset-btn${sitePreset === 'po18' ? ' preset-btn--active' : ''}`} onClick={() => applySitePreset('po18')}>
                              PO18
                            </button>
                            <button className={`preset-btn${sitePreset === 'custom' ? ' preset-btn--active' : ''}`} onClick={() => applySitePreset('custom')}>
                              自定义
                            </button>
                          </div>
                        </div>
                        <div className="form-row">
                          <Label className="mb-1.5">章节列表页 URL</Label>
                          <Input type="url" value={chapterListUrl} onChange={(e) => setChapterListUrl(e.target.value)} />
                        </div>
                        <div className="form-row">
                          <Label className="mb-1.5">编码</Label>
                          <Input value={activeEncoding} placeholder="utf-8 / gbk" onChange={(e) => setActiveEncoding(e.target.value)} />
                        </div>
                        <div className="action-row scrape-action-row">
                          <Button variant="secondary" size="sm" onClick={() => void testSelectors()}>
                            测试选择器
                          </Button>
                        </div>
                        <fieldset className="selector-fieldset">
                          <legend>选择器配置</legend>
                          <div className="selector-grid">
                            <div className="form-group">
                              <Label className="mb-1.5">章节列表</Label>
                              <Input placeholder=".chapter-list a" value={selectors.chapterList} onChange={(e) => setSelectors({ ...selectors, chapterList: e.target.value })} />
                            </div>
                            <div className="form-group">
                              <Label className="mb-1.5">章节标题</Label>
                              <Input placeholder="h1" value={selectors.chapterTitle} onChange={(e) => setSelectors({ ...selectors, chapterTitle: e.target.value })} />
                            </div>
                            <div className="form-group">
                              <Label className="mb-1.5">章节内容</Label>
                              <Input placeholder="#content" value={selectors.chapterContent} onChange={(e) => setSelectors({ ...selectors, chapterContent: e.target.value })} />
                            </div>
                            <div className="form-group">
                              <Label className="mb-1.5">下一页</Label>
                              <Input placeholder=".next a (可选)" value={selectors.nextPage} onChange={(e) => setSelectors({ ...selectors, nextPage: e.target.value })} />
                            </div>
                          </div>
                        </fieldset>
                      </div>
                    )}
                    <div className="scrape-result">
                      {testResult.loading ? (
                        <div className="flex items-center gap">
                          <div className="spinner"></div>
                          <span className="text-sm text-muted">正在测试选择器...</span>
                        </div>
                      ) : testResult.data && testResult.data.links && testResult.data.links.length > 0 ? (
                        <>
                          <Badge className="bg-success/10 text-success scrape-test-badge">测试成功 — 找到 {testResult.data.links.length} 个章节链接</Badge>
                          <div className="scrape-test-links">
                            {testResult.data.links.slice(0, 20).map((l: any, i: number) => (
                              <div key={i}>
                                • {l.text || l.href} → <span className="text-muted">{l.href}</span>
                              </div>
                            ))}
                            {testResult.data.links.length > 20 && <div className="text-muted">...还有 {testResult.data.links.length - 20} 个</div>}
                          </div>
                        </>
                      ) : testResult.empty ? (
                        <Badge variant="secondary" className="scrape-test-badge">未找到任何链接，请检查选择器</Badge>
                      ) : testResult.error ? (
                        <div className="text-sm error-text">测试失败: {testResult.error}</div>
                      ) : null}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <aside className="scrape-flow-grid__side">
          <div className="card admin-panel-card scrape-side-card">
            <h3 className="admin-card-title">抓取前检查</h3>
            <div className="scrape-checklist">
              {preflight.length === 0 ? (
                <div className="scrape-check-item scrape-check-item--muted">等待智能分析后生成检查项</div>
              ) : (
                preflight.map((item, i) => (
                  <div className={`scrape-check-item${item.ok ? '' : ' scrape-check-item--muted'}`} key={i}>
                    {item.ok ? '✓ ' : '• '}
                    {item.label}
                    {item.detail ? ` · ${item.detail}` : ''}
                  </div>
                ))
              )}
            </div>
          </div>
          <div className="card admin-panel-card scrape-side-card">
            <h3 className="admin-card-title">配置摘要</h3>
            <div className="scrape-config-summary text-sm text-muted">
              {configRows.length === 0 ? (
                '尚未选择源站配置'
              ) : (
                configRows.map((row, i) => (
                  <div className="scrape-config-row" key={i}>
                    <span>{row[0]}</span>
                    <strong>{row[1]}</strong>
                  </div>
                ))
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* Job cards */}
      <div id="scrapeJobList" className={jobCards.length === 0 ? 'hidden' : ''}>
        {jobCards.map((job) => renderJobCard(job))}
      </div>

      {/* Config management */}
      <div className="card admin-panel-card scrape-config-card">
        <h3 className="admin-card-title">爬虫配置</h3>
        <p className="text-sm text-muted admin-card-desc">导出/导入所有小说的爬虫配置，方便换设备时迁移。</p>
        <div className="action-row admin-action-row">
          <Button variant="secondary" size="sm" onClick={() => void exportConfigs()}>
            导出配置
          </Button>
          <Button variant="secondary" size="sm" onClick={() => configFileRef.current?.click()}>
            导入配置
          </Button>
          <input ref={configFileRef} type="file" accept=".json" hidden onChange={(e) => void handleConfigFileSelected(e)} />
          <span className="text-sm text-muted admin-inline-status">{configImportStatus}</span>
        </div>
      </div>
    </>
  )
}

// ============================================================
// 发现小说
// ============================================================

function DiscoverView() {
  const { toast } = useToast()
  const { confirm } = useConfirm()

  const [siteValue, setSiteValue] = useState('')
  const [discoverUrl, setDiscoverUrl] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [searchType, setSearchType] = useState('articlename')

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [novels, setNovels] = useState<DiscoverNovel[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())

  const [totalPages, setTotalPages] = useState(1)
  const [page, setPage] = useState(1)
  const [jump, setJump] = useState('1')
  const listUrlRef = useRef('')

  const [detail, setDetail] = useState<DiscoverDetail | null>(null)
  const [batch, setBatch] = useState<BatchState | null>(null)

  async function renderDiscoverResults(body: Record<string, unknown>, emptyMessage: string) {
    setLoading(true)
    setError('')
    setInfo('')
    setNovels([])
    setSelected(new Set())
    try {
      const data = await scrapePost(body)
      if (!data.novels || data.novels.length === 0) {
        setError((data as { error?: string }).error || emptyMessage)
        return
      }
      setNovels(data.novels)
      setInfo(`找到 ${data.total} 本（显示前${data.novels.length}本）· ${data.site || ''}`)
      if (body.action === 'discover') {
        setTotalPages(data.totalPages || 1)
        setPage(1)
        setJump('1')
      }
    } catch (err) {
      setError('请求失败: ' + (err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  async function fetchDiscoverList(urlValue?: string) {
    const u = (urlValue ?? discoverUrl).trim()
    if (!u) {
      toast('请输入榜单页面 URL', 'error')
      return
    }
    listUrlRef.current = u
    await renderDiscoverResults({ action: 'discover', listUrl: u }, '未在页面中找到小说')
  }

  async function fetchPo18Search() {
    const q = searchInput.trim()
    if (!q) {
      toast('请输入 PO18 搜索关键词', 'error')
      return
    }
    listUrlRef.current = ''
    setTotalPages(1)
    await renderDiscoverResults({ action: 'po18-search', query: q, searchType }, '未找到搜索结果')
  }

  function onSiteChange(value: string) {
    setSiteValue(value)
    setDiscoverUrl(value)
    void fetchDiscoverList(value)
  }

  async function goPage(p: number) {
    if (!listUrlRef.current) return
    const next = listUrlRef.current.replace(/_([0-9]+)\//, `_${p}/`)
    listUrlRef.current = next
    setDiscoverUrl(next)
    setPage(p)
    setJump(String(p))
    await renderDiscoverResults({ action: 'discover', listUrl: next }, '未在页面中找到小说')
  }

  function toggleSelect(i: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  // ---- detail modal ----
  async function openDetail(i: number) {
    const item = novels[i]
    if (!item) return
    setDetail({ item, loading: true, error: '', meta: null, chapters: null, chapterCount: 0, scraping: false })
    try {
      const data = (await scrapePost({ action: 'detect-meta', sourceUrl: item.url })) as DetectedMeta
      if (!data.novel) throw new Error(data.error || '获取失败')
      let chapters: Array<{ text: string; href: string }> | null = null
      let chapterCount = data.chapterCount || 0
      try {
        const chData = await scrapePost({
          action: 'test',
          sourceUrl: data.chapterListUrl || item.url,
          encoding: data.encoding || null,
          selectors: data.selectors || { chapterList: '.chapters li a', chapterTitle: '', chapterContent: '' },
        })
        if (chData.links && chData.links.length > 0) {
          chapters = chData.links
          chapterCount = chData.totalLinks || chData.links.length
        }
      } catch {
        /* 保留 detect-meta 的章节数 */
      }
      setDetail((d) => (d ? { ...d, loading: false, meta: data, chapters, chapterCount } : d))
    } catch (err) {
      setDetail((d) => (d ? { ...d, loading: false, error: (err as Error).message } : d))
    }
  }

  /** 创建小说（必要时）并启动抓取任务，返回 novelId。 */
  async function createAndScrape(item: DiscoverNovel, meta: DetectedMeta, chapterListUrl: string): Promise<string> {
    const n = meta.novel || {}
    const createRes = await novelsApi.create({
      title: n.title || item.title,
      author: n.author || '未知',
      description: n.description || '',
      coverUrl: n.coverUrl || item.coverUrl || '',
      categories: n.categories || [],
      status: n.status || 'ongoing',
      sourceUrl: n.sourceUrl || item.url,
    })
    const novelId = (createRes as { novel?: { id: string } }).novel?.id || (createRes as { id?: string }).id || ''
    if (!novelId) throw new Error('创建小说失败')
    const s = meta.selectors || {}
    if (s.chapterList) {
      const startRes = await scrapeApi.start({ novelId, sourceUrl: chapterListUrl || item.url, encoding: meta.encoding || null, selectors: s })
      if (!(startRes as { jobId?: string }).jobId) throw new Error((startRes as { error?: string }).error || '启动抓取失败')
    }
    return novelId
  }

  async function scrapeFromDetail() {
    if (!detail || !detail.meta) return
    setDetail({ ...detail, scraping: true })
    try {
      await createAndScrape(detail.item, detail.meta, detail.meta.chapterListUrl || detail.item.url)
      toast('小说已创建，抓取任务已启动！', 'success')
      setDetail(null)
    } catch (err) {
      toast('抓取失败: ' + (err as Error).message, 'error')
      setDetail((d) => (d ? { ...d, scraping: false } : d))
    }
  }

  // ---- batch scrape ----
  async function batchScrapeDiscovered() {
    const indices = Array.from(selected).sort((a, b) => a - b)
    if (indices.length === 0) {
      toast('请先选择小说', 'error')
      return
    }
    const ok = await confirm({
      title: '批量抓取发现小说',
      message: '确定抓取选中的 ' + indices.length + ' 本小说？将依次创建小说并启动抓取任务。',
      okText: '开始抓取',
      items: indices.map((i) => novels[i]?.title || '未知小说'),
    })
    if (!ok) return
    setBatch({ title: '批量抓取', entries: [], total: indices.length, success: 0, fail: 0, done: false })
    let success = 0
    let fail = 0
    const entries: BatchEntry[] = []
    for (const idx of indices) {
      const item = novels[idx]
      if (!item) continue
      entries.push({ type: 'novel', text: item.title })
      setBatch((b) => (b ? { ...b, entries: [...entries] } : b))
      try {
        if (item.existing) {
          entries.push({ type: 'skip', text: '已在书库中，跳过' })
        } else {
          const meta = (await scrapePost({ action: 'detect-meta', sourceUrl: item.url })) as DetectedMeta
          if (!meta.novel) throw new Error(meta.error || '检测失败')
          await createAndScrape(item, meta, meta.chapterListUrl || item.url)
          entries.push({ type: 'ok', text: '已创建并启动抓取' })
          success++
        }
      } catch (err) {
        entries.push({ type: 'err', text: (err as Error).message })
        fail++
      }
      setBatch((b) => (b ? { ...b, entries: [...entries], success, fail } : b))
    }
    setBatch((b) => (b ? { ...b, done: true, success, fail } : b))
    toast(`完成: ${success} 成功, ${fail} 失败`, fail > 0 ? 'error' : 'success')
    if (success > 0) {
      setNovels((prev) => prev.map((n, i) => (selected.has(i) ? { ...n, existing: true } : n)))
    }
    setSelected(new Set())
  }

  const detailCover = useMemo(() => {
    if (!detail) return ''
    let c = detail.meta?.novel?.coverUrl || ''
    if (!c) c = po18CoverFallback(detail.item.url)
    return c
  }, [detail])

  return (
    <>
      <div className="discover-toolbar">
        <div className="discover-toolbar__action discover-toolbar__action--search">
          <div className="discover-toolbar__field">
            <Search className="discover-toolbar__field-icon size-3.5" />
            <Input
              type="text"
              className="pl-9"
              placeholder="搜索 PO18 书名/作者…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void fetchPo18Search()
              }}
            />
          </div>
          <div className="discover-toolbar__toggle discover-toolbar__toggle--search-type" title="搜索类型">
            <button className={`preset-btn${searchType === 'articlename' ? ' preset-btn--active' : ''}`} onClick={() => setSearchType('articlename')}>
              书名
            </button>
            <button className={`preset-btn${searchType === 'author' ? ' preset-btn--active' : ''}`} onClick={() => setSearchType('author')}>
              作者
            </button>
          </div>
          <Button variant="secondary" size="sm" onClick={() => void fetchPo18Search()}>
            搜索 PO18
          </Button>
        </div>

        <div className="discover-toolbar__action discover-toolbar__action--list">
          <CustomSelect className="discover-site-select" options={PO18_SITES} value={siteValue} onChange={onSiteChange} placeholder="PO18 榜单" />
          <div className="discover-toolbar__field">
            <Search className="discover-toolbar__field-icon size-3.5" />
            <Input type="text" className="pl-9" placeholder="粘贴榜单页面 URL…" value={discoverUrl} onChange={(e) => setDiscoverUrl(e.target.value)} />
          </div>
          <Button size="sm" onClick={() => void fetchDiscoverList()}>
            <RefreshCw className="size-3.5" />
            获取榜单
          </Button>
        </div>
      </div>

      {loading && (
        <div className="discover-loading">
          <div className="spinner"></div>
          <span>正在获取榜单…</span>
        </div>
      )}
      {error && <div className="discover-error">{error}</div>}
      {info && <div className="discover-info">{info}</div>}

      {novels.length > 0 && (
        <div className="discover-grid">
          {novels.map((n, i) => {
            const exists = !!n.existing
            const firstChar = n.title ? n.title.charAt(0) : '书'
            return (
              <div className={`discover-card${exists ? ' discover-card--collected' : ''}`} key={`${n.url}-${i}`} onClick={() => void openDetail(i)}>
                <div className="discover-card__cover" data-letter={firstChar}>
                  <img src={n.coverUrl || FALLBACK_COVER} alt="" loading="lazy" referrerPolicy="no-referrer" onError={coverOnError} />
                  {exists && (
                    <span className="discover-card__seal" title="已收藏">
                      藏
                    </span>
                  )}
                </div>
                <div className="discover-card__body">
                  <div className="discover-card__title-row">
                    <div className="discover-card__title">{n.title}</div>
                    <input
                      type="checkbox"
                      className="discover-checkbox"
                      title="选择"
                      checked={selected.has(i)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggleSelect(i)}
                    />
                  </div>
                  <div className="discover-card__author">
                    {n.author || '未知作者'}
                    {n.chapterCount ? ` · ${n.chapterCount} 章` : ''}
                  </div>
                  <div className="discover-card__desc">{n.description || ''}</div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {selected.size > 0 && (
        <div className="discover-actions">
          <Button onClick={() => void batchScrapeDiscovered()}>
            <RefreshCw className="size-3.5" />
            抓取选中
          </Button>
          <span className="discover-actions__count">已选 {selected.size} 本</span>
        </div>
      )}

      {listUrlRef.current && totalPages > 1 && (
        <div className="discover-pagination">
          <button className="discover-pagination__btn" disabled={page <= 1} onClick={() => void goPage(page - 1)}>
            <ChevronLeft className="size-3.5" />
            上一页
          </button>
          <span className="discover-pagination__info">
            第 {page} / {totalPages} 页
          </span>
          <span className="discover-pagination__jump">
            跳转{' '}
            <input
              type="number"
              className="discover-pagination__input"
              min={1}
              max={totalPages}
              value={jump}
              onChange={(e) => {
                setJump(e.target.value)
                const n = Number.parseInt(e.target.value, 10)
                if (Number.isFinite(n) && n >= 1 && n <= totalPages) void goPage(n)
              }}
            />{' '}
            页
          </span>
          <button className="discover-pagination__btn" disabled={page >= totalPages} onClick={() => void goPage(page + 1)}>
            下一页
            <ChevronRight className="size-3.5" />
          </button>
        </div>
      )}

      {/* Detail modal */}
      {detail && (
        <Dialog open onOpenChange={(open) => !open && setDetail(null)}>
          <DialogContent className="admin-dialog sm:max-w-[680px] p-0 gap-0 flex flex-col overflow-hidden max-h-[86vh]" showCloseButton={false}>
            <div className="modal__header detail-modal__header discover-detail__header">
              <div className="editor-modal__mark discover-detail__mark" aria-hidden="true">
                探
              </div>
              <div>
                <div className="editor-modal__eyebrow">发现小说</div>
                <h3 className="modal__title editor-modal__title">{detail.item.title}</h3>
              </div>
              <Button variant="ghost" size="icon" className="editor-modal__close detail-modal__close" aria-label="关闭" onClick={() => setDetail(null)}>
                <X className="size-4" />
              </Button>
            </div>
            <div className="discover-detail__body min-h-0 flex-1">
              {detail.loading ? (
                <div className="discover-detail__loading">
                  <div className="spinner"></div>
                  <span>正在翻阅小说资料…</span>
                </div>
              ) : detail.error ? (
                <div className="discover-detail__error">获取详情失败：{detail.error}</div>
              ) : detail.meta ? (
                <>
                  <div className="discover-detail__hero">
                    {detailCover ? (
                      <div className="discover-detail__cover">
                        <img src={detailCover} alt="" referrerPolicy="no-referrer" onError={(e) => (e.currentTarget.style.display = 'none')} />
                      </div>
                    ) : (
                      <div className="discover-detail__cover discover-detail__cover--empty" data-letter={(detail.meta.novel?.title || detail.item.title || '书').slice(0, 1)}></div>
                    )}
                    <div className="discover-detail__meta">
                      <div className="discover-detail__eyebrow">发现页预览</div>
                      <div className="discover-detail__name">{detail.meta.novel?.title || detail.item.title}</div>
                      <div className="discover-detail__author">{detail.meta.novel?.author || '未知作者'}</div>
                      <div className="discover-detail__badges">
                        {(detail.meta.novel?.categories || []).length > 0 && (
                          <div className="discover-detail__tags">
                            {(detail.meta.novel?.categories || []).map((c) => (
                              <Badge variant="outline" key={c}>
                                {c}
                              </Badge>
                            ))}
                          </div>
                        )}
                        {detail.meta.novel?.status && (
                          <Badge className={detail.meta.novel.status === 'completed' ? 'bg-success/10 text-success' : 'bg-info/10 text-info'}>
                            {detail.meta.novel.status === 'completed' ? '已完结' : '连载中'}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  {detail.meta.novel?.description ? <div className="discover-detail__desc">{detail.meta.novel.description}</div> : null}
                  <div className="discover-detail__chapters">
                    {detail.chapters && detail.chapters.length > 0 ? (
                      <>
                        <div className="discover-detail__chapter-head">
                          <strong>章节目录</strong>
                          <span>共 {detail.chapterCount} 章</span>
                        </div>
                        <div className="discover-detail__chapter-list">
                          {detail.chapters.map((l, ci) => (
                            <div className="discover-detail__chapter-item" key={ci}>
                              <span className="discover-detail__chapter-index">{ci + 1}</span>
                              <span className="discover-detail__chapter-title">{l.text || l.href}</span>
                            </div>
                          ))}
                        </div>
                      </>
                    ) : (
                      <div className="discover-detail__chapter-empty">章节数：{detail.chapterCount}</div>
                    )}
                  </div>
                </>
              ) : null}
            </div>
            <div className="modal__footer editor-modal__footer discover-detail__footer">
              {detail.item.existing ? (
                <Badge className="bg-success/10 text-success discover-detail__footer-badge">已收藏</Badge>
              ) : (
                <Button size="sm" onClick={() => void scrapeFromDetail()} disabled={detail.scraping}>
                  {detail.scraping ? '正在抓取…' : '抓取该小说'}
                </Button>
              )}
              <Button variant="secondary" size="sm" onClick={() => setDetail(null)}>
                关闭
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Batch log modal */}
      {batch && (
        <Dialog open onOpenChange={(open) => !open && batch.done && setBatch(null)}>
          <DialogContent className="admin-dialog sm:max-w-[800px] p-0 gap-0 flex flex-col overflow-hidden max-h-[80vh]" showCloseButton={false}>
            <div className="modal__header operation-log__header">
              <h3 className="modal__title">{batch.title}</h3>
              <Button variant="ghost" size="icon" className="operation-log__close" aria-label="关闭" onClick={() => batch.done && setBatch(null)}>
                <X className="size-4" />
              </Button>
            </div>
            <div className="clean-log__body">
              <div className="clean-log__entries">
                {batch.entries.map((e, i) =>
                  e.type === 'novel' ? (
                    <div className="log-novel" key={i}>
                      <BookOpen className="size-4 shrink-0 opacity-50" />
                      {e.text}
                    </div>
                  ) : (
                    <div className={`log-${e.type}`} key={i}>
                      {e.text}
                    </div>
                  ),
                )}
              </div>
            </div>
            <div className="clean-log__footer">
              <div className="operation-log__stats">
                <span>
                  已处理 <strong>{batch.success}</strong>
                </span>
                <span>
                  跳过 <strong>0</strong>
                </span>
                <span>
                  失败 <strong>{batch.fail}</strong>
                </span>
                <span className="operation-log__total">
                  共 <strong>{batch.total}</strong>
                </span>
              </div>
              <Button variant="secondary" size="sm" onClick={() => setBatch(null)}>
                关闭
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}

// ============================================================
// 书源管理
// ============================================================

function SourcesView({ active }: { active: boolean }) {
  const { toast } = useToast()
  const { confirm } = useConfirm()

  const [sources, setSources] = useState<SourceRow[]>([])
  const [sourcesError, setSourcesError] = useState('')
  const [sourcesLoading, setSourcesLoading] = useState(false)
  const [total, setTotal] = useState(0)
  const [enabledCount, setEnabledCount] = useState(0)
  const [bySupport, setBySupport] = useState<Record<string, number>>({})

  const [supportFilter, setSupportFilter] = useState('')
  const [hostFilter, setHostFilter] = useState('')
  const hostFilterRef = useRef('')
  const hostDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [importUrl, setImportUrl] = useState('')
  const [importText, setImportText] = useState('')
  const [importStatus, setImportStatus] = useState('')
  const [importResult, setImportResult] = useState<{ ok: boolean; text: string; sub?: string } | null>(null)

  const [testState, setTestState] = useState<{ loading: boolean; data: Record<string, any> | null; error: string }>({ loading: false, data: null, error: '' })

  const loadScrapeSources = useCallback(async () => {
    setSourcesLoading(true)
    setSourcesError('')
    const body: Record<string, unknown> = { action: 'list-sources' }
    if (supportFilter === 'enabled') body.enabled = 1
    else if (supportFilter) body.support = supportFilter
    const host = hostFilterRef.current
    if (host) body.host = host
    try {
      const data = await scrapePost(body)
      setSources(Array.isArray(data.sources) ? data.sources : [])
      setTotal(data.total || 0)
      setEnabledCount(data.enabledCount || 0)
      setBySupport(data.bySupport || {})
    } catch (err) {
      setSourcesError((err as Error).message)
      setSources([])
    } finally {
      setSourcesLoading(false)
    }
  }, [supportFilter])

  // 视图可见时加载 + 过滤条件变化时重载
  useEffect(() => {
    if (active) void loadScrapeSources()
  }, [active, loadScrapeSources])

  useEffect(() => {
    return () => {
      if (hostDebounce.current) clearTimeout(hostDebounce.current)
    }
  }, [])

  function onHostFilterChange(value: string) {
    hostFilterRef.current = value.trim()
    setHostFilter(value)
    if (hostDebounce.current) clearTimeout(hostDebounce.current)
    hostDebounce.current = setTimeout(() => void loadScrapeSources(), 300)
  }

  async function toggleSource(s: SourceRow) {
    try {
      await scrapePost({ action: 'toggle-source', host: s.host, enabled: !s.enabled })
      await loadScrapeSources()
      toast(s.enabled ? `已停用 ${s.host}` : `已启用 ${s.host}`, 'success')
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  async function deleteSource(s: SourceRow) {
    const ok = await confirm({
      title: '删除书源',
      message: `确定删除书源「${s.host}」？删除后运行时不再按该 host 匹配。`,
      okText: '删除',
      danger: true,
    })
    if (!ok) return
    try {
      await scrapePost({ action: 'delete-source', host: s.host })
      await loadScrapeSources()
      toast(`已删除 ${s.host}`, 'success')
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  async function testSource(s: SourceRow) {
    setTestState({ loading: true, data: null, error: '' })
    try {
      const data = await scrapePost({ action: 'test-source', host: s.host })
      setTestState({ loading: false, data, error: '' })
    } catch (err) {
      setTestState({ loading: false, data: null, error: (err as Error).message })
    }
  }

  async function doImportLegado(payload: { url?: string; text?: string }) {
    setImportStatus('正在导入…')
    setImportResult(null)
    try {
      const data = await scrapePost({ action: 'import-legado', ...payload })
      const s = data.bySupport || {}
      setImportResult({
        ok: true,
        text: `导入完成 — 新增 ${data.imported}，更新 ${data.updated}，跳过 ${data.skipped}`,
        sub: `支持度: full ${s.full} · partial ${s.partial} · unsupported ${s.unsupported}${data.parseErrorCount ? ` · 解析失败 ${data.parseErrorCount}` : ''}`,
      })
      setImportStatus('')
      await loadScrapeSources()
      toast(`成功导入 ${data.imported} 条书源`, 'success')
    } catch (err) {
      setImportStatus('')
      setImportResult({ ok: false, text: (err as Error).message })
      toast((err as Error).message, 'error')
    }
  }

  function importFromUrl() {
    if (!importUrl.trim()) {
      toast('请填写书源池 URL', 'error')
      return
    }
    void doImportLegado({ url: importUrl.trim() })
  }

  function importFromText() {
    if (!importText.trim()) {
      toast('请粘贴书源 JSON', 'error')
      return
    }
    void doImportLegado({ text: importText.trim() })
  }

  const testSampleOk = Array.isArray(testState.data?.sampleChapters) ? testState.data.sampleChapters.filter((s: any) => s.ok).length : 0

  return (
    <>
      <div className="sources-hero">
        <div>
          <p className="detail-kicker">BOOK SOURCES</p>
          <h2 className="section-title">书源管理</h2>
          <p className="text-secondary text-sm">批量导入 Legado 社区书源池，智能分析小说时自动按 host 匹配书源选择器。仅消费书源规则数据，转换器为项目自研。</p>
        </div>
      </div>

      {/* Import card */}
      <div className="card admin-panel-card">
        <h3 className="admin-card-title">导入书源</h3>
        <div className="form-group">
          <Label className="mb-1.5">书源池 URL</Label>
          <div className="input-row">
            <Input type="url" className="flex-1" placeholder="https://raw.githubusercontent.com/aoaostar/legado/release/sources/xxx.json" value={importUrl} onChange={(e) => setImportUrl(e.target.value)} />
            <Button size="sm" onClick={importFromUrl}>
              拉取并导入
            </Button>
          </div>
        </div>
        <div className="form-group">
          <Label className="mb-1.5">或粘贴书源 JSON（单个或数组）</Label>
          <Textarea
            rows={4}
            placeholder='[{"bookSourceName":"xxx小说网","bookSourceUrl":"https://...","ruleToc":{...},"ruleContent":{...}}]'
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
          />
        </div>
        <div className="action-row admin-action-row">
          <Button variant="secondary" size="sm" onClick={importFromText}>
            粘贴导入
          </Button>
          <span className="text-sm text-muted admin-inline-status">{importStatus}</span>
        </div>
        {importResult && (
          <div className="source-import-result">
            {importResult.ok ? (
              <Badge className="bg-success/10 text-success scrape-test-badge">{importResult.text}</Badge>
            ) : (
              <div className="text-sm error-text">{importResult.text}</div>
            )}
            {importResult.sub && <div className="text-sm text-muted">{importResult.sub}</div>}
          </div>
        )}
      </div>

      {/* Stats + filter bar */}
      <div className="sources-toolbar">
        <div className="sources-toolbar__stats">
          <Badge variant="secondary">总数: {total}</Badge>
          <Badge variant="secondary">已启用: {enabledCount}</Badge>
          <Badge className="bg-success/10 text-success">可用: {bySupport.full || 0}</Badge>
          <Badge className="bg-warning/10 text-warning">需核验: {bySupport.partial || 0}</Badge>
          <Badge className="bg-secondary text-muted-foreground">不支持: {bySupport.unsupported || 0}</Badge>
        </div>
        <div className="sources-toolbar__filters">
          <div className="preset-group">
            {[
              { label: '全部', value: '' },
              { label: 'full', value: 'full' },
              { label: 'partial', value: 'partial' },
              { label: 'unsupported', value: 'unsupported' },
              { label: '已启用', value: 'enabled' },
            ].map((f) => (
              <button key={f.value} className={`preset-btn${supportFilter === f.value ? ' preset-btn--active' : ''}`} onClick={() => setSupportFilter(f.value)}>
                {f.label}
              </button>
            ))}
          </div>
          <Input type="text" className="admin-input--compact sources-toolbar__search" placeholder="按 host 过滤…" value={hostFilter} onChange={(e) => onHostFilterChange(e.target.value)} />
        </div>
      </div>

      {/* Table */}
      <div className="card admin-panel-card">
        <h3 className="admin-card-title">已导入书源</h3>
        <div className="table-wrapper">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>站点</TableHead>
                <TableHead>host</TableHead>
                <TableHead>编码</TableHead>
                <TableHead>支持度</TableHead>
                <TableHead>置信度</TableHead>
                <TableHead>章节列表选择器</TableHead>
                <TableHead>启用</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sourcesLoading ? (
                <TableRow>
                  <TableCell colSpan={8} className="table-empty">
                    加载中…
                  </TableCell>
                </TableRow>
              ) : sourcesError ? (
                <TableRow>
                  <TableCell colSpan={8} className="table-empty">
                    {sourcesError}
                  </TableCell>
                </TableRow>
              ) : sources.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="table-empty">
                    没有匹配的书源
                  </TableCell>
                </TableRow>
              ) : (
                sources.map((s) => (
                  <TableRow key={s.host}>
                    <TableCell>
                      <strong>{s.name}</strong>
                      {Array.isArray(s.warnings) && s.warnings.length > 0 && (
                        <div className="text-xs text-muted" title={s.warnings.join('\n')}>
                          {s.warnings.slice(0, 2).join('; ')}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-muted">{s.host}</TableCell>
                    <TableCell className="text-muted">{s.encoding}</TableCell>
                    <TableCell>{supportBadge(s.support)}</TableCell>
                    <TableCell className="text-muted">{s.confidence}</TableCell>
                    <TableCell className="text-muted source-selector-cell" title={s.chapterList}>
                      {s.chapterList || '—'}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" onClick={() => void toggleSource(s)}>
                        {s.enabled ? '停用' : '启用'}
                      </Button>
                    </TableCell>
                    <TableCell>
                      <Button variant="secondary" size="sm" onClick={() => void testSource(s)}>
                        测试
                      </Button>
                      <Button variant="destructive" size="sm" onClick={() => void deleteSource(s)}>
                        删除
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        <div className="admin-table-meta-row">
          <span className="text-xs text-muted">
            共 {total} 条书源，已启用 {enabledCount}
          </span>
          <Button variant="secondary" size="sm" onClick={() => void loadScrapeSources()}>
            刷新
          </Button>
        </div>
      </div>

      {/* Test result */}
      <div className="scrape-result">
        {testState.loading ? (
          <div className="flex items-center gap">
            <div className="spinner"></div>
            <span className="text-sm text-muted">正在测试书源…</span>
          </div>
        ) : testState.data && testState.data.links && testState.data.links.length > 0 ? (
          <>
            <Badge className="bg-success/10 text-success scrape-test-badge">测试成功 — 找到 {testState.data.links.length} 个章节链接 (编码 {testState.data.encoding})</Badge>
            <div className="scrape-test-links">
              {testState.data.links.slice(0, 20).map((l: any, i: number) => (
                <div key={i}>
                  • {l.text || l.href} → <span className="text-muted">{l.href}</span>
                </div>
              ))}
              {testState.data.links.length > 20 && <div className="text-muted">...还有 {testState.data.links.length - 20} 个</div>}
            </div>
            {testState.data.sampleChapters ? <div className="text-sm text-muted">样章可读: {testSampleOk}/{testState.data.sampleChapters.length}</div> : null}
          </>
        ) : testState.error ? (
          <div className="text-sm error-text">测试失败: {testState.error}</div>
        ) : null}
      </div>
    </>
  )
}

// ============================================================
// 主组件
// ============================================================

export default function ScrapeTab(_props: { highlightNovelId?: string; onHighlightConsumed?: () => void }) {
  const [view, setView] = useState<'center' | 'discover' | 'sources'>('center')

  return (
    <section className="tab-content">
      <div className="preset-group scrape-view-toggle">
        {(
          [
            { id: 'center', label: '抓取中心' },
            { id: 'discover', label: '发现小说' },
            { id: 'sources', label: '书源管理' },
          ] as const
        ).map((v) => (
          <button key={v.id} type="button" className={`preset-btn${view === v.id ? ' preset-btn--active' : ''}`} onClick={() => setView(v.id)}>
            {v.label}
          </button>
        ))}
      </div>

      <div className={view !== 'center' ? 'hidden' : ''}>
        <CenterView />
      </div>
      <div className={view !== 'discover' ? 'hidden' : ''}>
        <DiscoverView />
      </div>
      <div className={view !== 'sources' ? 'hidden' : ''}>
        <SourcesView active={view === 'sources'} />
      </div>
    </section>
  )
}
