// ============================================================
// 抓取中心 — CenterView
// 工作台：左向导（三步）+ 右任务队列（有任务时才出现）。
// ============================================================
import { useMemo, useRef, useState } from 'react'
import { novelsApi, scrapeApi } from '@/lib/api'
import { useConfirm, useToast } from '@/components/feedback'
import AdminTabHeader from '@/components/admin/AdminTabHeader'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import type { CheckItem, ConfigRow, DetectedMeta } from './types'
import { scrapePost, parseCategories, po18CoverFallback } from './utils'
import JobQueue from './center/JobQueue'
import StepAnalyze from './center/StepAnalyze'
import StepConfirm, { type NovelPreview } from './center/StepConfirm'
import StepConfig, { type Selectors, type TestResult } from './center/StepConfig'
import { useScrapeJobs } from './center/useScrapeJobs'

const PO18_PRESET = {
  name: 'PO18',
  encoding: 'gbk',
  selectors: { chapterList: '.chapters li a', chapterTitle: '#chaptertitle', chapterContent: '#novelcontent', nextPage: '.page a' },
}

const EMPTY_PREVIEW: NovelPreview = { title: '', author: '', category: '', status: 'ongoing', description: '', coverUrl: '' }
const EMPTY_SELECTORS: Selectors = { chapterList: '', chapterTitle: '', chapterContent: '', nextPage: '' }

export default function CenterView() {
  const { toast } = useToast()
  const { confirm } = useConfirm()

  // Step 1 —— 分析
  const [sourceUrl, setSourceUrl] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeResult, setAnalyzeResult] = useState<{ ok: boolean | null; text: string }>({ ok: null, text: '' })
  const [analyzeChecks, setAnalyzeChecks] = useState<CheckItem[]>([])

  // Step 2 —— 确认小说
  const [showNovelPreview, setShowNovelPreview] = useState(false)
  const [preview, setPreview] = useState<NovelPreview>(EMPTY_PREVIEW)
  const [confirming, setConfirming] = useState(false)
  const [currentScrapeNovelId, setCurrentScrapeNovelId] = useState('')

  // Step 3 —— 抓取配置
  const [showScrapeConfig, setShowScrapeConfig] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [sitePreset, setSitePreset] = useState('custom')
  const [chapterListUrl, setChapterListUrl] = useState('')
  const [selectors, setSelectors] = useState<Selectors>(EMPTY_SELECTORS)
  const [activeEncoding, setActiveEncoding] = useState('')
  const [testResult, setTestResult] = useState<TestResult>({ loading: false, data: null })
  const [testChecks, setTestChecks] = useState<CheckItem[]>([])
  const [configRows, setConfigRows] = useState<ConfigRow[]>([])

  // 任务队列
  const { jobs, track, dismiss, toggleLog, cancel, retry, retryFailed } = useScrapeJobs()

  // 爬虫配置导入导出
  const [configImportStatus, setConfigImportStatus] = useState('')
  const configFileRef = useRef<HTMLInputElement>(null)

  const effectiveCover = useMemo(() => {
    if (!preview.coverUrl || /noimg\.jpg/i.test(preview.coverUrl)) return ''
    return preview.coverUrl
  }, [preview.coverUrl])

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
      setAnalyzeChecks([
        { label: '小说信息', ok: !!n.title },
        { label: '章节目录', ok: (data.chapterCount || 0) > 0, detail: (data.chapterCount || 0) + ' 章' },
        { label: '编码', ok: true, detail: data.encoding || 'utf-8' },
      ])
      toast('小说信息识别完成', 'success')
    } catch (err) {
      setAnalyzeResult({ ok: false, text: (err as Error).message })
      setAnalyzeChecks([])
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

  // ---- 站点预设 ----
  function applySitePreset(key: string) {
    setSitePreset(key)
    if (key === 'custom') return
    setSelectors({ ...PO18_PRESET.selectors })
    setActiveEncoding(PO18_PRESET.encoding)
    setConfigRows([
      ['站点', PO18_PRESET.name],
      ['编码', PO18_PRESET.encoding],
      ['目录', chapterListUrl.trim() || '未填写'],
      ['列表', PO18_PRESET.selectors.chapterList],
      ['内容', PO18_PRESET.selectors.chapterContent],
    ])
    toast(`已应用 ${PO18_PRESET.name} 预设`, 'success')
  }

  // ---- Step 3: test selectors ----
  async function testSelectors() {
    const src = chapterListUrl.trim()
    if (!src || !selectors.chapterList.trim()) {
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
        setTestChecks([
          { label: '章节链接', ok: true, detail: data.links.length + ' 个' },
          { label: '重复链接', ok: !diagnostics.duplicateCount, detail: (diagnostics.duplicateCount || 0) + ' 个' },
          { label: '空标题', ok: !diagnostics.emptyTitleCount, detail: (diagnostics.emptyTitleCount || 0) + ' 个' },
          { label: '样章内容', ok: sampleOk > 0, detail: sampleOk + '/' + (data.sampleChapters?.length || 0) + ' 可读' },
        ])
        setTestResult({ loading: false, data })
      } else {
        setTestChecks([])
        setTestResult({ loading: false, empty: true, data: null })
      }
    } catch (err) {
      setTestChecks([])
      setTestResult({ loading: false, error: (err as Error).message, data: null })
      toast('抓取服务不可用。请确认自托管 API 服务正在运行。', 'default')
    }
  }

  // ---- Step 3: start scrape ----
  async function startScrape() {
    if (!currentScrapeNovelId) {
      toast('请先在第二步确认/创建小说后再开始抓取', 'error')
      return
    }
    const src = chapterListUrl.trim()
    const sel: Selectors = {
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
      const res = await scrapeApi.start({ novelId: currentScrapeNovelId, sourceUrl: src, encoding: activeEncoding || null, selectors: sel })
      if (!res.jobId) throw new Error((res as { error?: string }).error || '未知错误')
      track(res.jobId, preview.title.trim() || '(未命名)')
      toast('抓取任务已启动！', 'success')
    } catch (err) {
      toast('抓取失败: ' + (err as Error).message, 'error')
    }
  }

  // ---- 爬虫配置导入导出 ----
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
      setConfigImportStatus('')
      toast('导入失败: ' + (err as Error).message, 'error')
    }
  }

  const hasJobs = jobs.length > 0

  return (
    <>
      <AdminTabHeader
        title="抓取中心"
        description="识别源站、检测章节、追踪任务，并在失败时恢复抓取。"
      />

      <div className={`grid items-start gap-4 ${hasJobs ? 'lg:grid-cols-[minmax(0,1fr)_22rem]' : ''}`}>
        <div className="grid min-w-0 gap-4">
          <StepAnalyze
            sourceUrl={sourceUrl}
            onSourceUrlChange={setSourceUrl}
            analyzing={analyzing}
            result={analyzeResult}
            checks={analyzeChecks}
            onAnalyze={() => void analyzeUrl()}
          />

          {showNovelPreview && (
            <StepConfirm
              preview={preview}
              onPreviewChange={setPreview}
              coverUrl={effectiveCover}
              confirming={confirming}
              novelId={currentScrapeNovelId}
              onConfirm={() => void confirmNovel()}
              onSkip={skipToScrape}
            />
          )}

          {showScrapeConfig && (
            <StepConfig
              summary={configRows}
              advancedOpen={advancedOpen}
              onToggleAdvanced={() => setAdvancedOpen(!advancedOpen)}
              sitePreset={sitePreset}
              onSitePresetChange={applySitePreset}
              chapterListUrl={chapterListUrl}
              onChapterListUrlChange={setChapterListUrl}
              encoding={activeEncoding}
              onEncodingChange={setActiveEncoding}
              selectors={selectors}
              onSelectorsChange={setSelectors}
              testResult={testResult}
              testChecks={testChecks}
              onTest={() => void testSelectors()}
              onStart={() => void startScrape()}
            />
          )}
        </div>

        <JobQueue
          jobs={jobs}
          onCancel={(id) => void cancel(id)}
          onRetry={(id) => void retry(id)}
          onRetryFailed={(id) => void retryFailed(id)}
          onDismiss={dismiss}
          onToggleLog={toggleLog}
        />
      </div>

      {/* 爬虫配置迁移 */}
      <Card className="scrape-config-card">
        <CardHeader className="px-6 pt-6">
          <CardTitle className="text-base">爬虫配置</CardTitle>
          <CardDescription>导出/导入所有小说的爬虫配置，方便换设备时迁移。</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => void exportConfigs()}>
              导出配置
            </Button>
            <Button variant="secondary" size="sm" onClick={() => configFileRef.current?.click()}>
              导入配置
            </Button>
            <input ref={configFileRef} type="file" accept=".json" hidden onChange={(e) => void handleConfigFileSelected(e)} />
            <span className="text-sm text-muted-foreground" aria-live="polite">
              {configImportStatus}
            </span>
          </div>
        </CardContent>
      </Card>
    </>
  )
}
