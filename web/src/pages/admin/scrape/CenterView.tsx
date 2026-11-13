import { useSession } from '@/context/SessionContext'
import '@/styles/input-fields.css'
// ============================================================
// 抓取中心 — 统一入口、发现、校验与任务追踪
// ============================================================
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { ArrowLeft, SearchX } from 'lucide-react'
import { novelsApi, scrapeApi, type ScrapeSourceCapability } from '@/lib/api'
import { useConfirm, useToast } from '@/components/feedback'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import JobQueue from './center/JobQueue'
import styles from './workbench.module.css'
import type { CheckItem, DetectedMeta, DiscoverNovel, BatchEntry, BatchState } from './types'
import { scrapePost, parseCategories } from './utils'
import SourceAccountPanel from './SourceAccountPanel'
import DiscoveryPanel from './center/DiscoveryPanel'
import ScrapeIntake, { type IntakeMode } from './center/ScrapeIntake'
import ScrapeSetupPanel, { type SetupPreview } from './center/ScrapeSetupPanel'
import type { Selectors, TestResult } from './center/StepConfig'
import { useScrapeJobs } from './center/useScrapeJobs'

// contentRating 必须与 SetupPreview 同批初始化：漏掉这一格不会报错，
// 但 onPreviewChange({ ...preview, contentRating }) 会因为键不存在而静默丢字段。
const EMPTY_PREVIEW: SetupPreview = { title: '', author: '', category: '', status: 'ongoing', contentRating: 'unknown', description: '', coverUrl: '' }
const EMPTY_SELECTORS: Selectors = { chapterList: '', chapterTitle: '', chapterContent: '', nextPage: '' }

interface ActiveCandidate {
  item: DiscoverNovel
  loading: boolean
  error: string
  meta: DetectedMeta | null
}

export default function CenterView() {
  const { user: sessionUser } = useSession()
  const sessionUserRole = sessionUser?.role
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const setupRef = useRef<HTMLDivElement>(null)
  const intakeRef = useRef<HTMLDivElement>(null)
  const { jobs, track, cancel, retry, retryFailed, dismiss, toggleLog, restoring, restoreError } = useScrapeJobs()

  // 统一入口
  const [intakeMode, setIntakeMode] = useState<IntakeMode>('link')
  const [sourceUrl, setSourceUrl] = useState(() => new URLSearchParams(window.location.search).get('source') || '')
  const [searchInput, setSearchInput] = useState('')
  const [searchType, setSearchType] = useState('articlename')
  const [searchSourceId, setSearchSourceId] = useState('')
  const [capabilities, setCapabilities] = useState<{ userId: string; sources: ScrapeSourceCapability[]; error?: string } | null>(null)
  const userId = sessionUser?.id
  const currentCapabilities = capabilities?.userId === userId ? capabilities : null
  const sources = currentCapabilities?.sources ?? []
  const searchSources = sources.filter(source => source.search)
  const searchSource = searchSources.find(source => source.id === searchSourceId) ?? searchSources[0]
  const rankings = sources.flatMap(source => source.rankings.map(ranking => ({ ...ranking, sourceName: source.name })))

  const [capabilityAttempt, retryCapabilities] = useState(0)
  useEffect(() => {
    if (!userId) return
    let current = true
    void scrapeApi.sourceCapabilities().then(({ sources }) => {
      if (current) setCapabilities({ userId, sources })
    }).catch((error: Error) => {
      if (current) setCapabilities({ userId, sources: [], error: error.message || '无法读取书源能力' })
    })
    return () => { current = false }
  }, [userId, capabilityAttempt])
  const [siteValue, setSiteValue] = useState('')
  const [discoverUrl, setDiscoverUrl] = useState('')
  const [intakeLoading, setIntakeLoading] = useState(false)

  // 发现结果
  const [novels, setNovels] = useState<DiscoverNovel[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [discoveryError, setDiscoveryError] = useState('')
  const [discoveryInfo, setDiscoveryInfo] = useState('')
  const [discoveryLoading, setDiscoveryLoading] = useState(false)
  const [totalPages, setTotalPages] = useState(1)
  const [page, setPage] = useState(1)
  const listUrlRef = useRef('')
  /** 榜单发现请求的基准参数，翻页时复用，避免丢失 kind/type。 */
  const rankingRef = useRef<{ rankingKind?: string; rankingType?: string }>({})

  // 当前待处理作品与抓取配置
  const [activeCandidate, setActiveCandidate] = useState<ActiveCandidate | null>(null)
  const [preview, setPreview] = useState<SetupPreview>(EMPTY_PREVIEW)
  const [confirming, setConfirming] = useState(false)
  const [starting, setStarting] = useState(false)
  const [started, setStarted] = useState(false)
  const [currentScrapeNovelId, setCurrentScrapeNovelId] = useState('')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [chapterListUrl, setChapterListUrl] = useState('')
  const [selectors, setSelectors] = useState<Selectors>(EMPTY_SELECTORS)
  const [activeEncoding, setActiveEncoding] = useState('')
  const [testResult, setTestResult] = useState<TestResult>({ loading: false, data: null })
  const [testChecks, setTestChecks] = useState<CheckItem[]>([])

  // 批量处理
  const [batch, setBatch] = useState<BatchState | null>(null)

  // 爬虫配置迁移
  const [configImportStatus, setConfigImportStatus] = useState('')
  const configFileRef = useRef<HTMLInputElement>(null)

  const effectiveCover = useMemo(() => {
    if (!preview.coverUrl || /noimg\.jpg/i.test(preview.coverUrl)) return ''
    return preview.coverUrl
  }, [preview.coverUrl])

  function resetSetup() {
    setStarted(false)
    setActiveCandidate(null)
    setPreview(EMPTY_PREVIEW)
    setCurrentScrapeNovelId('')
    setAdvancedOpen(false)
    setChapterListUrl('')
    setSelectors(EMPTY_SELECTORS)
    setActiveEncoding('')
    setTestResult({ loading: false, data: null })
    setTestChecks([])
    window.setTimeout(() => intakeRef.current?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true }), 0)
  }

  function hydrateFromMeta(item: DiscoverNovel, data: DetectedMeta) {
    const novel = data.novel || {}
    const rawCategories: string[] = Array.isArray(novel.categories) ? novel.categories : novel.category ? [novel.category] : []
    const fallbackUrl = novel.sourceUrl || item.url
    const coverUrl = novel.coverUrl && !/noimg\.jpg/i.test(novel.coverUrl) ? novel.coverUrl : item.coverUrl || ''
    const nextSelectors: Selectors = {
      chapterList: data.selectors?.chapterList || '',
      chapterTitle: data.selectors?.chapterTitle || '',
      chapterContent: data.selectors?.chapterContent || '',
      nextPage: data.selectors?.nextPage || '',
    }

    setPreview({
      title: novel.title || item.title || '',
      author: novel.author || item.author || '',
      category: rawCategories.filter(Boolean).join(', '),
      status: novel.status || item.status || 'ongoing',
      // 候选阶段源站元数据没有分级，一律留待人工在「确认作品」处判定。
      contentRating: 'unknown',
      description: novel.description || item.description || '',
      coverUrl,
    })
    setSourceUrl(fallbackUrl)
    setChapterListUrl(data.chapterListUrl || fallbackUrl)
    setSelectors(nextSelectors)
    setActiveEncoding(data.encoding || '')
    setTestResult({ loading: false, data: null })
    setTestChecks([
      { label: '小说信息', ok: !!(novel.title || item.title) },
      {
        label: '章节目录',
        ok: (data.chapterCount || 0) > 0,
        detail: data.chapterCount ? `${data.chapterCount}${data.hasMoreChapters ? '+' : ''} 章` : '待测试',
      },
      { label: '编码', ok: true, detail: data.encoding || 'utf-8' },
    ])
  }

  async function loadCandidate(item: DiscoverNovel) {
    setSourceUrl(item.url)
    setCurrentScrapeNovelId('')
    setStarted(false)
    setActiveCandidate({ item, loading: true, error: '', meta: null })
    try {
      const data = (await scrapePost({ action: 'detect-meta', sourceUrl: item.url })) as DetectedMeta
      if (!data.novel) throw new Error(data.error || '源站没有返回小说信息')
      hydrateFromMeta(item, data)
      setActiveCandidate({ item, loading: false, error: '', meta: data })
      window.setTimeout(() => setupRef.current?.scrollIntoView({ behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' }), 0)
      toast('作品信息已载入，请确认后继续', 'success')
    } catch (err) {
      setActiveCandidate({ item, loading: false, error: (err as Error).message, meta: null })
    }
  }

  async function analyzeUrl() {
    const value = sourceUrl.trim()
    if (!value) {
      toast('请先粘贴小说源站链接', 'error')
      return
    }
    if (intakeLoading) return
    setStarted(false)
    setCurrentScrapeNovelId('')
    setIntakeLoading(true)
    setDiscoveryError('')
    setActiveCandidate({ item: { title: '正在分析…', author: '', url: value }, loading: true, error: '', meta: null })
    try {
      const data = (await scrapeApi.detectMeta(value)) as unknown as DetectedMeta & { chapterListUrl?: string; chapterCount?: number }
      if (!data.novel) throw new Error(data.error || '源站没有返回小说信息')
      const item: DiscoverNovel = {
        title: data.novel.title || '待确认作品',
        author: data.novel.author || '',
        coverUrl: data.novel.coverUrl,
        url: value,
        description: data.novel.description || '',
        chapterCount: data.chapterCount,
        status: data.novel.status,
      }
      hydrateFromMeta(item, data)
      setActiveCandidate({ item, loading: false, error: '', meta: data })
      toast('链接分析完成，请确认作品信息', 'success')
    } catch (err) {
      setActiveCandidate({ item: { title: '分析失败', author: '', url: value }, loading: false, error: (err as Error).message, meta: null })
      toast((err as Error).message, 'error')
    } finally {
      setIntakeLoading(false)
    }
  }

  async function renderDiscoverResults(body: Record<string, unknown>, emptyMessage: string) {
    setDiscoveryLoading(true)
    setDiscoveryError('')
    setDiscoveryInfo('')
    setNovels([])
    setSelected(new Set())
    try {
      const data = await scrapePost(body)
      const result = Array.isArray(data.novels) ? (data.novels as DiscoverNovel[]) : []
      if (result.length === 0) {
        if (data.error) setDiscoveryError(data.error)
        else setDiscoveryInfo(emptyMessage)
        return
      }
      setNovels(result)
      setDiscoveryInfo(`找到 ${data.total || result.length} 本 · ${data.site || '源站结果'}`)
      if (body.action === 'discover') setTotalPages(data.totalPages || 1)
    } catch (err) {
      setDiscoveryError('请求失败：' + (err as Error).message)
    } finally {
      setDiscoveryLoading(false)
    }
  }

  async function fetchDiscoverList() {
    const value = discoverUrl.trim()
    if (!value) {
      toast('请选择榜单或输入榜单 URL', 'error')
      return
    }
    // 下拉选中的预设携带 kind/type；地址被手改过就当自定义 URL，只按地址发现。
    const preset = rankings.find(ranking => ranking.id === siteValue)
    const usePreset = !!preset && preset.listUrl === value
    const listUrl = usePreset ? preset.listUrl : value
    const ranking = usePreset ? { rankingKind: preset.rankingKind, rankingType: preset.rankingType } : {}
    rankingRef.current = ranking
    listUrlRef.current = listUrl
    setPage(1)
    setTotalPages(1)
    await renderDiscoverResults({ action: 'discover', listUrl, ...ranking }, '未在页面中找到小说')
  }

  async function fetchSourceSearch() {
    const value = searchInput.trim()
    if (!value) {
      toast('请输入搜索关键词', 'error')
      return
    }
    listUrlRef.current = ''
    rankingRef.current = {}
    setTotalPages(1)
    if (!searchSource) return
    await renderDiscoverResults({ action: 'source-search', sourceId: searchSource.id, query: value, searchType }, '未找到搜索结果')
  }

  function submitIntake() {
    if (intakeMode === 'link' || (intakeMode === 'search' && !searchSource)) void analyzeUrl()
    else if (intakeMode === 'search') void fetchSourceSearch()
    else void fetchDiscoverList()
  }

  async function goPage(nextPage: number) {
    if (!listUrlRef.current) return
    const nextUrl = listUrlRef.current.replace(/_[0-9]+\/$/, `_${nextPage}/`)
    listUrlRef.current = nextUrl
    setDiscoverUrl(nextUrl)
    setPage(nextPage)
    await renderDiscoverResults({ action: 'discover', listUrl: nextUrl, ...rankingRef.current }, '未在页面中找到小说')
  }

  function toggleAll() {
    setSelected((previous) => {
      const selectable = novels.map((novel, index) => (!novel.existing ? index : -1)).filter((index) => index >= 0)
      const allSelected = selectable.length > 0 && selectable.every((index) => previous.has(index))
      return allSelected ? new Set() : new Set(selectable)
    })
  }

  function toggleSelect(index: number) {
    if (novels[index]?.existing) return
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  function clearSelectorTest() {
    setTestResult({ loading: false, data: null })
    setTestChecks([])
  }

  async function confirmNovel() {
    if (confirming || currentScrapeNovelId) return
    const title = preview.title.trim()
    const author = preview.author.trim()
    if (!title || !author) {
      toast('书名和作者不能为空', 'error')
      return
    }
    setConfirming(true)
    try {
      const result = await novelsApi.create({
        title,
        author,
        description: preview.description,
        coverUrl: preview.coverUrl || '',
        categories: parseCategories(preview.category),
        status: preview.status,
        contentRating: preview.contentRating,
        sourceUrl: sourceUrl.trim(),
      })
      const novelId = (result as { novel?: { id: string } }).novel?.id || (result as { id?: string }).id || ''
      if (!novelId) throw new Error('保存小说失败：没有返回小说 ID')
      setCurrentScrapeNovelId(novelId)
      toast('书籍已保存，现在可以测试章节并启动任务', 'success')
    } catch (err) {
      toast('保存失败：' + (err as Error).message, 'error')
    } finally {
      setConfirming(false)
    }
  }

  async function testSelectors() {
    const src = chapterListUrl.trim()
    if (!src || !selectors.chapterList.trim()) {
      toast('请填写章节列表页 URL 和章节链接选择器', 'error')
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
        const sampleOk = Array.isArray(data.sampleChapters) ? data.sampleChapters.filter((sample: any) => sample.ok).length : 0
        setTestChecks([
          { label: '章节链接', ok: true, detail: `${data.links.length} 个` },
          { label: '重复链接', ok: !diagnostics.duplicateCount, detail: `${diagnostics.duplicateCount || 0} 个` },
          { label: '空标题', ok: !diagnostics.emptyTitleCount, detail: `${diagnostics.emptyTitleCount || 0} 个` },
          { label: '样章正文', ok: sampleOk > 0, detail: `${sampleOk}/${data.sampleChapters?.length || 0} 可读` },
        ])
        setTestResult({ loading: false, data })
      } else {
        setTestChecks([])
        setTestResult({ loading: false, empty: true, data: null })
      }
    } catch (err) {
      setTestChecks([])
      setTestResult({ loading: false, error: (err as Error).message, data: null })
      toast('抓取服务不可用，请确认自托管 API 服务正在运行', 'error')
    }
  }

  async function startScrape() {
    if (!currentScrapeNovelId) {
      toast('请先保存书籍信息', 'error')
      return
    }
    const src = chapterListUrl.trim()
    const currentSelectors: Selectors = {
      chapterList: selectors.chapterList.trim(),
      chapterTitle: selectors.chapterTitle.trim(),
      chapterContent: selectors.chapterContent.trim(),
      nextPage: selectors.nextPage.trim(),
    }
    if (!src || !currentSelectors.chapterList || !currentSelectors.chapterContent) {
      toast('请先填写章节列表页 URL、章节链接和章节正文选择器', 'error')
      return
    }
    if (starting || started) return
    setStarting(true)
    try {
      const ok = await confirm({
        title: '启动抓取任务',
        message: '确认后会创建一个后台任务，页面可以继续处理其他作品。',
        okText: '启动任务',
        items: [
          `作品：${preview.title || '未命名'}`,
          `章节来源：${src}`,
          `章节链接：${currentSelectors.chapterList}`,
          `章节正文：${currentSelectors.chapterContent}`,
        ],
      })
      if (!ok) return
      const result = await scrapeApi.start({ novelId: currentScrapeNovelId, sourceUrl: src, encoding: activeEncoding || null, selectors: currentSelectors })
      if (!result.jobId) throw new Error((result as { error?: string }).error || '没有返回任务 ID')
      track(result.jobId, preview.title || '抓取任务')
      setStarted(true)
      toast('抓取任务已启动，可在下方查看进度', 'success')
    } catch (err) {
      toast('启动失败：' + (err as Error).message, 'error')
    } finally {
      setStarting(false)
    }
  }

  async function createAndScrape(item: DiscoverNovel, meta: DetectedMeta): Promise<string> {
    const novel = meta.novel || {}
    const createResult = await novelsApi.create({
      title: novel.title || item.title,
      author: novel.author || item.author || '未知',
      description: novel.description || item.description || '',
      coverUrl: novel.coverUrl || item.coverUrl || '',
      categories: novel.categories || [],
      status: novel.status || item.status || 'ongoing',
      sourceUrl: novel.sourceUrl || item.url,
    })
    const novelId = (createResult as { novel?: { id: string } }).novel?.id || (createResult as { id?: string }).id || ''
    if (!novelId) throw new Error('创建小说失败')
    const currentSelectors = meta.selectors || {}
    if (!currentSelectors.chapterList || !currentSelectors.chapterContent) throw new Error('源站未识别出完整章节选择器，无法启动批量任务')
    const startResult = await scrapeApi.start({
      novelId,
      sourceUrl: meta.chapterListUrl || item.url,
      encoding: meta.encoding || null,
      selectors: currentSelectors,
    })
    if (!startResult.jobId) throw new Error((startResult as { error?: string }).error || '启动抓取失败')
    track(startResult.jobId, novel.title || item.title)
    return novelId
  }

  async function batchScrapeDiscovered() {
    const indices = Array.from(selected)
      .filter((index) => !novels[index]?.existing)
      .sort((a, b) => a - b)
    if (indices.length === 0) {
      toast('请先选择至少一本未收录作品', 'error')
      return
    }
    const ok = await confirm({
      title: '批量启动抓取',
      message: `将依次分析、创建并启动 ${indices.length} 本作品。`,
      okText: '开始处理',
      items: indices.map((index) => novels[index]?.title || '未命名作品'),
    })
    if (!ok) return

    setBatch({ title: '批量抓取', entries: [], total: indices.length, success: 0, fail: 0, done: false })
    let success = 0
    let fail = 0
    const successfulIndices = new Set<number>()
    const entries: BatchEntry[] = []
    for (const index of indices) {
      const item = novels[index]
      if (!item) continue
      entries.push({ type: 'novel', text: item.title })
      setBatch((state) => (state ? { ...state, entries: [...entries] } : state))
      try {
        const meta = (await scrapePost({ action: 'detect-meta', sourceUrl: item.url })) as DetectedMeta
        if (!meta.novel) throw new Error(meta.error || '检测失败')
        await createAndScrape(item, meta)
        entries.push({ type: 'ok', text: '已创建并启动任务' })
        successfulIndices.add(index)
        success++
      } catch (err) {
        entries.push({ type: 'err', text: (err as Error).message })
        fail++
      }
      setBatch((state) => (state ? { ...state, entries: [...entries], success, fail } : state))
    }
    setBatch((state) => (state ? { ...state, done: true, success, fail } : state))
    setNovels((current) => current.map((item, index) => (successfulIndices.has(index) ? { ...item, existing: true } : item)))
    setSelected(new Set())
    toast(`批量处理完成：${success} 成功，${fail} 失败`, fail > 0 ? 'error' : 'success')
  }

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
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = `scrape_configs_${new Date().toISOString().slice(0, 10)}.json`
      link.click()
      URL.revokeObjectURL(objectUrl)
      toast(`已导出 ${configs.length} 条配置`, 'success')
    } catch (err) {
      toast('导出失败：' + (err as Error).message, 'error')
    }
  }

  async function handleConfigFileSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const text = await file.text()
      const configs = JSON.parse(text)
      if (!Array.isArray(configs)) throw new Error('JSON 格式错误，应为数组')
      setConfigImportStatus(`正在导入 ${configs.length} 条配置…`)
      const data = await scrapePost({ action: 'import-configs', configs })
      setConfigImportStatus('')
      toast(`成功导入 ${data.imported || 0} 条配置`, 'success')
    } catch (err) {
      setConfigImportStatus('')
      toast('导入失败：' + (err as Error).message, 'error')
    }
  }

  const setupState = activeCandidate?.loading ? 'loading' : activeCandidate?.error ? 'error' : activeCandidate?.meta ? 'ready' : 'none'

  useEffect(() => {
    if (setupState === 'ready' || setupState === 'error') setupRef.current?.focus({ preventScroll: true })
  }, [setupState])

  return (
    <div className={styles.center}>
      {currentCapabilities?.error && <div className={styles.controls}>
        <p className={styles.hint} role="status">{currentCapabilities.error}</p>
        <Button variant="ghost" onClick={() => retryCapabilities(attempt => attempt + 1)}>重新读取书源</Button>
      </div>}
      {sessionUserRole === 'super_admin' && sources.filter(source => source.account).map(source => (
        <SourceAccountPanel key={`${userId}:${source.id}`} sourceId={source.id} sourceName={source.name} />
      ))}
      <section className={styles.panel} aria-labelledby="scrape-workbench-title">
        <div className={styles.heading}>
          <h2 id="scrape-workbench-title" className={styles.title}>导入作品</h2>
          <ol className={styles.steps} aria-label="抓取步骤">
            <li aria-current={!activeCandidate ? 'step' : undefined}>选择来源</li>
            <li aria-current={activeCandidate && !currentScrapeNovelId ? 'step' : undefined}>核对作品</li>
            <li aria-current={currentScrapeNovelId ? 'step' : undefined}>{started ? '任务已启动' : '启动抓取'}</li>
          </ol>
        </div>
        {!activeCandidate && <div ref={intakeRef}>
            <ScrapeIntake
              mode={intakeMode === 'search' && !searchSource ? 'link' : intakeMode}
              searchSources={searchSources}
              searchSourceId={searchSource?.id || ''}
              onSearchSourceChange={setSearchSourceId}
              rankingOptions={rankings.map(ranking => ({ value: ranking.id, label: ranking.label, sub: ranking.sourceName }))}
              onModeChange={setIntakeMode}
              sourceUrl={sourceUrl}
              onSourceUrlChange={setSourceUrl}
              searchInput={searchInput}
              onSearchInputChange={setSearchInput}
              searchType={searchType}
              onSearchTypeChange={setSearchType}
              siteValue={siteValue}
              onSiteChange={(value) => {
                setSiteValue(value)
                setDiscoverUrl(rankings.find(ranking => ranking.id === value)?.listUrl || value)
              }}
              discoverUrl={discoverUrl}
              onDiscoverUrlChange={setDiscoverUrl}
              loading={intakeLoading || discoveryLoading}
              disabled={Boolean(batch && !batch.done)}
              onSubmit={submitIntake}
            />

            <div className={styles.results} aria-busy={discoveryLoading}>
              <DiscoveryPanel
                novels={novels}
                selected={selected}
                loading={discoveryLoading}
                error={discoveryError}
                info={discoveryInfo}
                page={page}
                totalPages={totalPages}
                batch={batch}
                onToggleAll={toggleAll}
                onToggleSelect={toggleSelect}
                onClearSelect={() => setSelected(new Set())}
                onInspect={(index) => {
                  const item = novels[index]
                  if (item) void loadCandidate(item)
                }}
                onBatchScrape={() => void batchScrapeDiscovered()}
                onPage={(nextPage) => void goPage(nextPage)}
                onClearBatch={() => setBatch(null)}
                onRetry={submitIntake}
              />
            </div>
        </div>}
        {activeCandidate && (
          <div ref={setupRef} tabIndex={-1} role="region" aria-label="当前作品核对" className={styles.currentStep}>
            {setupState === 'loading' && (
              <div className={styles.state} role="status">
                <Spinner aria-hidden="true" />
                <strong>正在分析源站</strong>
                <p className={styles.hint}>读取作品信息、章节目录和页面结构…</p>
              </div>
            )}
            {setupState === 'error' && (
              <div className={styles.state} role="alert">
                <SearchX className="size-5" aria-hidden="true" />
                <strong>暂时无法分析这部作品</strong>
                <p className={`${styles.hint} ${styles.danger}`}>{activeCandidate.error}</p>
                <div className={styles.controls}>
                  <Button variant="outline" onClick={() => void loadCandidate(activeCandidate.item)}>重新分析</Button>
                  <Button variant="ghost" onClick={resetSetup}><ArrowLeft aria-hidden="true" />返回导入</Button>
                </div>
              </div>
            )}
            {setupState === 'ready' && activeCandidate.meta && (
              <ScrapeSetupPanel
                item={activeCandidate.item}
                preview={preview}
                onPreviewChange={setPreview}
                coverUrl={effectiveCover}
                novelId={currentScrapeNovelId}
                confirming={confirming}
                starting={starting}
                started={started}
                advancedOpen={advancedOpen}
                onToggleAdvanced={() => setAdvancedOpen((open) => !open)}
                chapterCount={activeCandidate.meta.chapterCount || 0}
                hasMoreChapters={Boolean(activeCandidate.meta.hasMoreChapters)}
                protectedChapterCount={activeCandidate.meta.protectedChapterCount || 0}
                chapterListUrl={chapterListUrl}
                onChapterListUrlChange={(value) => { setChapterListUrl(value); clearSelectorTest() }}
                encoding={activeEncoding}
                onEncodingChange={(value) => { setActiveEncoding(value); clearSelectorTest() }}
                selectors={selectors}
                onSelectorsChange={(value) => { setSelectors(value); clearSelectorTest() }}
                testResult={testResult}
                testChecks={testChecks}
                onTest={() => void testSelectors()}
                onConfirm={() => void confirmNovel()}
                onStart={() => void startScrape()}
                onReset={resetSetup}
              />
            )}
          </div>
        )}
      </section>
      <JobQueue
        jobs={jobs}
        restoring={restoring}
        restoreError={restoreError}
        onCancel={(jobId) => void cancel(jobId)}
        onRetry={(jobId) => void retry(jobId)}
        onRetryFailed={(jobId) => void retryFailed(jobId)}
        onDismiss={dismiss}
        onToggleLog={toggleLog}
        onExportConfigs={() => void exportConfigs()}
        onImportConfigs={() => configFileRef.current?.click()}
        configImportStatus={configImportStatus}
      />
      <input ref={configFileRef} type="file" accept=".json" hidden onChange={(event) => void handleConfigFileSelected(event)} />
    </div>
  )
}
