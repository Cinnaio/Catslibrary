// ============================================================
// 发现小说 — DiscoverView
// ============================================================
import { useMemo, useRef, useState } from 'react'
import { BookOpen, RefreshCw, Search, X } from 'lucide-react'
import { novelsApi, scrapeApi } from '../../../lib/api'
import { useConfirm, useToast } from '../../../components/feedback'
import CustomSelect from '../../../components/admin/CustomSelect'
import Pagination from '@/components/admin/Pagination'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { BatchEntry, BatchState, DiscoverDetail, DiscoverNovel, DetectedMeta } from './types'
import { scrapePost, po18CoverFallback, coverOnError, PO18_SITES, FALLBACK_COVER } from './utils'

export default function DiscoverView() {
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
    setPage(1)
    setTotalPages(1)
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
    await renderDiscoverResults({ action: 'discover', listUrl: next }, '未在页面中找到小说')
  }

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev)
      novels.forEach((n, i) => (next.has(i) ? next.delete(i) : next.add(i)))
      return next
    })
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
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {/* 工具栏行 1 · 搜索 */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
          <div className="relative min-w-64 flex-1">
            <Search className="discover-toolbar__field-icon size-3.5" />
            <Input
              type="text"
              className="pl-9"
              data-admin-search
              placeholder="搜索 PO18 书名/作者…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void fetchPo18Search()
              }}
            />
          </div>
          <Tabs value={searchType} onValueChange={setSearchType} aria-label="搜索类型">
            <TabsList>
              <TabsTrigger value="articlename">书名</TabsTrigger>
              <TabsTrigger value="author">作者</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button variant="secondary" size="sm" onClick={() => void fetchPo18Search()}>
            搜索 PO18
          </Button>
        </div>

        {/* 工具栏行 2 · 榜单 */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
          <CustomSelect className="discover-site-select" options={PO18_SITES} value={siteValue} onChange={onSiteChange} placeholder="PO18 榜单" />
          <div className="relative min-w-64 flex-1">
            <Search className="discover-toolbar__field-icon size-3.5" />
            <Input type="text" className="pl-9" placeholder="粘贴榜单页面 URL…" value={discoverUrl} onChange={(e) => setDiscoverUrl(e.target.value)} />
          </div>
          <Button size="sm" onClick={() => void fetchDiscoverList()}>
            <RefreshCw className="size-3.5" />
            获取榜单
          </Button>
        </div>

        {/* 批量操作行 · 选中态出现 */}
        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/30 px-3 py-2" aria-live="polite">
            <span className="text-sm text-muted-foreground tabular-nums">已选 {selected.size} 本</span>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={toggleAll}>
                反选
              </Button>
              <Button size="sm" onClick={() => void batchScrapeDiscovered()}>
                <RefreshCw className="size-3.5" />
                抓取选中
              </Button>
            </div>
          </div>
        )}

        {/* 结果区 */}
        <div className="p-4 md:p-5">
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
                  <article
                    className={`discover-card${exists ? ' discover-card--collected' : ''}`}
                    key={`${n.url}-${i}`}
                    onClick={() => void openDetail(i)}
                  >
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
                        <button
                          type="button"
                          className="discover-card__title"
                          aria-label={`查看 ${n.title} 详情`}
                          onClick={(e) => {
                            e.stopPropagation()
                            void openDetail(i)
                          }}
                        >
                          {n.title}
                        </button>
                        <Checkbox
                          className="discover-checkbox"
                          aria-label={`选择 ${n.title}`}
                          checked={selected.has(i)}
                          onClick={(e) => e.stopPropagation()}
                          onCheckedChange={() => toggleSelect(i)}
                        />
                      </div>
                      <div className="discover-card__author">
                        {n.author || '未知作者'}
                        {n.chapterCount ? ` · ${n.chapterCount} 章` : ''}
                      </div>
                      <div className="discover-card__desc">{n.description || ''}</div>
                    </div>
                  </article>
                )
              })}
            </div>
          )}

          {listUrlRef.current && totalPages > 1 && (
            <Pagination page={page} totalPages={totalPages} onPage={(p) => void goPage(p)} className="mt-5" />
          )}
        </div>
      </div>

      {/* Detail modal */}
      {detail && (
        <Dialog open onOpenChange={(open) => !open && setDetail(null)}>
          <DialogContent className="admin-dialog sm:max-w-[680px] p-0 gap-0 flex flex-col overflow-hidden max-h-[86vh]" showCloseButton={false}>
            <div className="modal__header detail-modal__header discover-detail__header">
              <h3 className="modal__title editor-modal__title">{detail.item.title}</h3>
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
