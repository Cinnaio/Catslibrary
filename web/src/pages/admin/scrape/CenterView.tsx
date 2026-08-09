// ============================================================
// 抓取中心 — CenterView
// ============================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CircleMinus, RefreshCw, RotateCcw, X } from 'lucide-react'
import { novelsApi, scrapeApi } from '../../../lib/api'
import { formatEta, formatJobSpeed, isJobRunning, isJobTerminal, jobStatusLabel } from '../../../lib/admin'
import { useConfirm, useToast } from '../../../components/feedback'
import CustomSelect from '../../../components/admin/CustomSelect'
import AdminTabHeader from '@/components/admin/AdminTabHeader'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { CheckItem, ConfigRow, JobCard, JobStatusData } from './types'
import { scrapePost, parseCategories, po18CoverFallback, fmtLogTime } from './utils'

export default function CenterView() {
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
      const data = (await scrapeApi.detectMeta(s)) as unknown as import('./types').DetectedMeta & { chapterListUrl?: string; chapterCount?: number }
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
      <Card className="scrape-step job-card" key={job.jobId} data-job-id={job.jobId}>
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
      </Card>
    )
  }

  return (
    <>
      <AdminTabHeader
        kicker="SCRAPE CENTER"
        title="爬虫抓取中心"
        description="识别源站、检测章节、追踪任务，并在失败时恢复抓取。"
        variant="hero"
        meta={
          <div className="scrape-center-hero__meta">
            <span>全量抓取</span>
            <span>增量更新</span>
            <span>失败重试</span>
          </div>
        }
      />

      <div className="scrape-flow-grid">
        <div className="scrape-flow-grid__main">
          {/* Step 1 */}
          <Card className="scrape-step">
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
          </Card>

          {/* Step 2 */}
          {showNovelPreview && (
            <Card className="scrape-step">
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
                          <Tabs value={sitePreset} onValueChange={(v) => applySitePreset(v)}>
                            <TabsList>
                              <TabsTrigger value="po18">PO18</TabsTrigger>
                              <TabsTrigger value="custom">自定义</TabsTrigger>
                            </TabsList>
                          </Tabs>
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
            </Card>
          )}
        </div>

        <aside className="scrape-flow-grid__side">
          <Card className="scrape-side-card">
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
          </Card>
          <Card className="scrape-side-card">
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
          </Card>
        </aside>
      </div>

      {/* Job cards */}
      <div id="scrapeJobList" className={jobCards.length === 0 ? 'hidden' : ''}>
        {jobCards.map((job) => renderJobCard(job))}
      </div>

      {/* Config management */}
      <Card className="scrape-config-card">
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
      </Card>
    </>
  )
}
