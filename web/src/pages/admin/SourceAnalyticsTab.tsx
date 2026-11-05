import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { CirclePlus, LockKeyhole, RefreshCw, Settings2 } from 'lucide-react'
import { toast } from 'sonner'
import { FOLLOWUP_LABELS, SOURCE_LABELS, type SourceCategory, type SourceAnalyticsBook, type SourceAnalyticsResponse } from '@shared/source-analytics'
import { adminApi, url, authHeaders } from '@/lib/api'
import { coverUrl as novelCoverUrl } from '@/lib/cover-url'
import { formatDateTime } from '@/lib/format'
import type { AdminStatusTone } from '@/lib/admin-status'
import { getAdminTableRowStaggerDelay } from '@/lib/admin-table-motion'
import AdminPage from '@/components/admin/AdminPage'
import { AdminDataPanel, type AdminColumn } from '@/components/admin/AdminDataPanel'
import { AdminToolbar } from '@/components/admin/AdminToolbar'
import { SearchField } from '@/components/shared/SearchField'
import FormField from '@/components/shared/FormField'
import AdminStatusBadge from '@/components/admin/AdminStatusBadge'
import AdminSelectionBar from '@/components/admin/AdminSelectionBar'
import EmptyState from "@/components/shared/EmptyState"
import { ErrorState, InlineError, LoadingState } from "@/components/shared/AsyncStates"
import SearchSelect from "@/components/shared/SearchSelect"
import Pagination from "@/components/shared/Pagination"
import NovelFollowupDialog from '@/components/admin/NovelFollowupDialog'
import BatchNovelFollowupDialog from '@/components/admin/BatchNovelFollowupDialog'
import { DialogBody, DialogFrame } from "@/components/shared/DialogFrame"
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import SourceDistribution, { type SourceBookFilter } from './SourceDistribution'
import '@/styles/admin/pages/source-analytics.css'
import styles from './source-analytics.module.css'

const MergeDialog = lazy(() => import('./ChaptersTab'))
const siteLabel = (site: string) => (site === '__none__' ? '无有效来源' : site)
const n = (value: number) => value.toLocaleString('zh-CN')

const results: Record<string, string> = {
  idle: '尚未检查',
  running: '检查中',
  updated: '有新章',
  no_change: '暂无新章',
  failed: '检查失败',
  partial: '部分失败',
  pending: '待补章节',
  protected: '章节受保护',
  cancelled: '已取消',
}

const columns: readonly AdminColumn[] = [
  { key: 'select', width: '3rem' },
  { key: 'book', label: '作品', primary: true },
  { key: 'source', label: '主要来源', width: '14%' },
  { key: 'followup', label: '检查结果', width: '15%' },
  { key: 'check', label: '检查时间', width: '16%' },
  { key: 'pending', label: '待入库', width: '12%' },
  { key: 'actions', label: '操作', width: '7.5rem', actions: true },
]

function resultTone(result: string): AdminStatusTone {
  if (result === 'failed') return 'danger'
  if (['partial', 'pending', 'protected'].includes(result)) return 'warning'
  if (result === 'running') return 'info'
  if (result === 'updated') return 'success'
  return 'neutral'
}

function compactDateTime(timestamp: number, snapshotAt: number): string {
  const date = new Date(timestamp)
  const reference = new Date(snapshotAt)
  const sameYear = date.getFullYear() === reference.getFullYear()
  const sameDay = sameYear && date.getMonth() === reference.getMonth() && date.getDate() === reference.getDate()
  const time = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  const options: Intl.DateTimeFormatOptions = { month: '2-digit', day: '2-digit' }
  if (!sameYear) options.year = 'numeric'
  return sameDay ? `今天 ${time}` : `${date.toLocaleDateString('zh-CN', options)} ${time}`
}

function CheckTime({ timestamp, snapshotAt }: { timestamp: number; snapshotAt: number }) {
  return <time dateTime={new Date(timestamp).toISOString()} title={formatDateTime(timestamp)}>{compactDateTime(timestamp, snapshotAt)}</time>
}

async function triggerNovelUpdate(novelId: string): Promise<Record<string, unknown>> {
  const res = await fetch(url('/scrape'), {
    method: 'POST',
    credentials: 'include',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ action: 'update', novelId }),
  })
  const result = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok || result.error) throw new Error(String(result.error || '更新检查请求失败'))
  return result
}

function BookDetails({
  book,
  snapshotAt,
  onClose,
  onUpdated,
}: {
  book: SourceAnalyticsBook
  snapshotAt: number
  onClose: () => void
  onUpdated: () => Promise<void>
}) {
  const [followup, setFollowup] = useState(false)
  const [merge, setMerge] = useState(false)
  const [returnFocus] = useState(() => document.activeElement as HTMLElement | null)

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogFrame
        className="source-book-dialog"
        onCloseAutoFocus={(event) => {
          if (returnFocus?.isConnected) {
            event.preventDefault()
            returnFocus.focus()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>书源与追更详情</DialogTitle>
          <DialogDescription>{book.title}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="source-book-details-grid">
            <div className="source-book-details-item">
              <span className="source-book-details-label">作者 / 状态</span>
              <span className="source-book-details-value">
                {book.author || '未知作者'} · {book.status === 'ongoing' ? '连载中' : '已完结'}
              </span>
            </div>
            <div className="source-book-details-item">
              <span className="source-book-details-label">来源配置</span>
              <span className="source-book-details-value">{SOURCE_LABELS[book.sourceCategory]}</span>
            </div>
            <div className="source-book-details-item">
              <span className="source-book-details-label">自动追更</span>
              <span className="source-book-details-value">
                {FOLLOWUP_LABELS[book.followupCategory]} · 每 {book.intervalHours} 小时
              </span>
            </div>
            <div className="source-book-details-item">
              <span className="source-book-details-label">最近结果</span>
              <span className="source-book-details-value">
                {results[book.result] || book.result}；{book.message || '尚未记录检查说明'}
              </span>
            </div>
            <div className="source-book-details-item">
              <span className="source-book-details-label">章节缺口</span>
              <span className="source-book-details-value">
                {book.pending == null ? '尚未核对源站目录' : `待入库 ${n(book.pending)} 章 · 其中受保护 ${n(book.protected || 0)} 章`}
              </span>
            </div>
            <div className="source-book-details-item">
              <span className="source-book-details-label">连续失败</span>
              <span className="source-book-details-value">{book.failures == null ? '未统计' : `${book.failures} 次`}</span>
            </div>
          </div>

          <section className="source-book-sources" aria-label="来源记录" style={{ marginTop: '1.25rem' }}>
            <h3 className="dialog-frame-section-label">来源记录</h3>
            {book.sources.length ? (
              <div className="source-book-sources-list">
                {book.sources.map((source) => (
                  <div className="source-book-source-card" key={source.url}>
                    <div className="source-book-source-header">
                      <span className="source-book-source-kind">{source.kind}</span>
                      {source.url === book.sourceUrl && <span className="source-book-primary-pill">主要来源</span>}
                    </div>
                    <a className="source-book-source-url" href={source.url} target="_blank" rel="noreferrer">
                      {source.url}
                    </a>
                  </div>
                ))}
              </div>
            ) : (
              <p className="dialog-frame-hint">未找到有效的 HTTP/HTTPS 来源。</p>
            )}
          </section>

          <div className="source-book-actions-bar">
            <Button variant="secondary" onClick={() => setFollowup(true)}>
              追更详情与设置
            </Button>
            <Button variant="secondary" onClick={() => setMerge(true)}>
              融合章节名
            </Button>
            <Button variant="outline" asChild>
              <Link to={`/admin/scrape?view=center${book.sourceUrl ? `&source=${encodeURIComponent(book.sourceUrl)}` : ''}`}>进入抓取中心补充配置</Link>
            </Button>
            <Button variant="ghost" asChild>
              <Link to={`/admin/novels?novelId=${encodeURIComponent(book.id)}`}>管理小说</Link>
            </Button>
          </div>
          <p className="dialog-frame-hint" style={{ marginTop: '0.75rem' }}>
            统计读取于 {formatDateTime(snapshotAt)}。配置完整不代表源站当前可访问；进入追更详情可读取最新结果。
          </p>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            关闭
          </Button>
        </DialogFooter>
      </DialogFrame>
      {followup && <NovelFollowupDialog variant="event" novel={book} onClose={() => setFollowup(false)} />}
      {merge && (
        <Suspense fallback={<span role="status">正在打开融合弹窗…</span>}>
          <MergeDialog mergeNovel={book} onMergeClose={() => setMerge(false)} onMergeApplied={onUpdated} />
        </Suspense>
      )}
    </Dialog>
  )
}

export default function SourceAnalyticsTab(_props: { highlightNovelId?: string; onHighlightConsumed?: () => void }) {
  const [data, setData] = useState<SourceAnalyticsResponse | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'list' | 'distribution'>('list')
  const listTabRef = useRef<HTMLButtonElement>(null)
  const [filters, setFilters] = useState({
    view: 'primary',
    site: '',
    source: '',
    followup: '',
    status: '',
    result: '',
    sort: 'checked',
    search: '',
    page: '1',
    limit: '15',
  })
  const [input, setInput] = useState('')
  const [loadedKey, setLoadedKey] = useState('')
  const [selectedBook, setSelectedBook] = useState<SourceAnalyticsBook | null>(null)
  const [quickFollowupNovel, setQuickFollowupNovel] = useState<{ id: string; title: string } | null>(null)
  const [batchFollowupNovels, setBatchFollowupNovels] = useState<Array<{ id: string; title: string }> | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [batchBusy, setBatchBusy] = useState(false)
  const moreFilterCount = [filters.source, filters.followup, filters.status].filter(Boolean).length

  const hasActiveFilters = Boolean(
    input.trim() ||
    filters.search ||
    filters.site ||
    filters.source ||
    filters.followup ||
    filters.status ||
    filters.result ||
    filters.sort !== 'checked'
  )

  const revision = useRef(0)
  const key = useMemo(() => JSON.stringify(filters), [filters])

  useEffect(() => {
    setSelectedIds(new Set())
  }, [key])

  const load = useCallback(async () => {
    const seq = ++revision.current
    setLoading(true)
    setError('')
    try {
      const next = await adminApi.sourceAnalytics(filters)
      if (seq === revision.current) {
        setData(next)
        setSelectedBook((current) => (current ? next.books.find((b) => b.id === current.id) || current : null))
        setLoadedKey(key)
      }
    } catch (err) {
      if (seq === revision.current) setError((err as Error).message || '读取统计失败')
    } finally {
      if (seq === revision.current) setLoading(false)
    }
  }, [filters, key])

  useEffect(() => {
    void load()
    return () => {
      revision.current++
    }
  }, [load])

  useEffect(() => {
    if (input.trim() === filters.search) return
    const timer = setTimeout(() => setFilters((f) => ({ ...f, search: input.trim(), page: '1' })), 300)
    return () => clearTimeout(timer)
  }, [input, filters.search])

  function setFilter(name: keyof typeof filters, value: string) {
    setFilters((f) => ({ ...f, [name]: value, page: '1' }))
  }

  function selectSourceBooks(site: string, category?: SourceBookFilter, source?: SourceCategory) {
    setInput('')
    setFilters((f) => ({
      ...f,
      site,
      followup: category || '',
      source: source || '',
      status: '',
      result: '',
      search: '',
      page: '1',
    }))
    setActiveTab('list')
    listTabRef.current?.focus()
  }

  const matches = loadedKey === key

  // 批量选择与操作
  const toggleSelectAll = (checked: boolean) => {
    if (checked && data?.books) {
      setSelectedIds(new Set(data.books.map((b) => b.id)))
    } else {
      setSelectedIds(new Set())
    }
  }

  const toggleSelectOne = (id: string, checked: boolean) => {
    const next = new Set(selectedIds)
    if (checked) next.add(id)
    else next.delete(id)
    setSelectedIds(next)
  }

  const selectedNovelsList = useMemo(() => {
    if (!data?.books) return []
    return data.books.filter((b) => selectedIds.has(b.id)).map((b) => ({ id: b.id, title: b.title }))
  }, [data?.books, selectedIds])

  const handleBatchUpdate = async () => {
    const list = selectedNovelsList.map((book) => book.id)
    if (!list.length || batchBusy || !matches) return
    setBatchBusy(true)
    try {
      const results = await Promise.allSettled(list.map((id) => triggerNovelUpdate(id)))
      const failedIds = new Set(list.filter((_, index) => results[index]?.status === 'rejected'))
      const accepted = list.length - failedIds.size
      if (!failedIds.size) toast.success(`已受理 ${accepted} 本小说的更新检查请求`)
      else if (accepted) toast.error(`已受理 ${accepted} 本，${failedIds.size} 本请求失败，可重试失败作品`)
      else toast.error(`${failedIds.size} 本更新检查请求失败，请重试`)
      setSelectedIds((current) => new Set([...current].filter((id) => failedIds.has(id))))
      await load()
    } catch {
      toast.error('批量更新请求失败')
    } finally {
      setBatchBusy(false)
    }
  }

  return (
    <AdminPage
      className={cn('admin-redesign-page--source-analytics', styles.page)}
      title="书源与追更"
      description="了解书源分布、追更覆盖情况，并找到需要处理的作品。"
      actions={
        <Button variant="secondary" size="sm" disabled={loading} onClick={() => void load()}>
          <RefreshCw className={`size-3.5${loading ? ' animate-spin' : ''}`} />
          刷新统计
        </Button>
      }
    >
      {!data ? (
        error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : (
          <LoadingState label="正在读取书源与追更统计" />
        )
      ) : (
        <>
          {error && <InlineError message={`读取失败：${error}。统计保留上次快照，未更新的筛选明细暂不显示。`} onRetry={() => void load()} />}

          {/* 横向滑动胶囊切换组件：分离「小说明细」与「书源与追更透视」 */}
          <Tabs value={activeTab} onValueChange={(val) => setActiveTab(val as 'list' | 'distribution')} className={styles.tabs}>
            <div className={styles.navigation}>
              <TabsList aria-label="工作视图">
                <TabsTrigger value="list" ref={listTabRef}>
                  小说明细
                  <span className={styles.tabCount}>{matches ? n(data.filteredTotal) : '…'}</span>
                </TabsTrigger>
                <TabsTrigger value="distribution">书源与追更透视</TabsTrigger>
              </TabsList>
            </div>

            {/* 视图一：去容器化小说明细 (Uncontainerized List) */}
            <TabsContent value="list" forceMount className={cn(styles.list, activeTab !== 'list' && 'hidden')}>
              {/* 单层控制流：筛选工具栏直接平铺 */}
              <AdminToolbar layout="inline" className={styles.toolbar}>
                <SearchField
                  id="source-analytics-search"
                  label="搜索小说"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder="搜索书名或作者"
                />
                <div className={styles.filters}>
                  <SearchSelect
                    compact
                    chip
                    filterChip
                    leadingIcon={<CirclePlus className="size-[var(--select-filter-chip-icon-size)]" />}
                    aria-label="源站筛选"
                    value={filters.site}
                    onChange={(v) => setFilter('site', v)}
                    searchable
                    options={[{ value: '', label: '全部源站' }, ...data.groups.map((g) => ({ value: g.site, label: siteLabel(g.site) }))]}
                  />
                  <SearchSelect
                    compact
                    chip
                    filterChip
                    leadingIcon={<CirclePlus className="size-[var(--select-filter-chip-icon-size)]" />}
                    aria-label="检查结果筛选"
                    value={filters.result}
                    onChange={(v) => setFilter('result', v)}
                    options={[{ value: '', label: '全部检查结果' }, ...Object.entries(results).map(([value, label]) => ({ value, label }))]}
                  />
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant={moreFilterCount ? 'secondary' : 'ghost'} size="sm" aria-label={`更多筛选${moreFilterCount ? `，已选 ${moreFilterCount} 项` : ''}`}>
                        <Settings2 aria-hidden="true" />
                        更多筛选{moreFilterCount > 0 && <span className={styles.filterCount}>{moreFilterCount}</span>}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className={styles.moreFilters} aria-label="更多筛选">
                      <div className={styles.filterHeader}>
                        <p className={styles.filterHeading}>更多筛选</p>
                        <Button variant="ghost" size="sm" aria-label="重置更多筛选" disabled={!moreFilterCount} onClick={() => setFilters((f) => ({ ...f, source: '', followup: '', status: '', page: '1' }))}>
                          重置
                        </Button>
                      </div>
                      <FormField label="来源配置">
                        <SearchSelect
                          compact
                          className={styles.filterSelect}
                          matchTriggerWidth
                          aria-label="来源配置筛选"
                          value={filters.source}
                          onChange={(v) => setFilter('source', v)}
                          options={[{ value: '', label: '全部来源配置' }, ...Object.entries(SOURCE_LABELS).map(([value, label]) => ({ value, label }))]}
                        />
                      </FormField>
                      <FormField label="追更状态">
                        <SearchSelect
                          compact
                          className={styles.filterSelect}
                          matchTriggerWidth
                          aria-label="追更状态筛选"
                          value={filters.followup}
                          onChange={(v) => setFilter('followup', v)}
                          options={[
                            { value: '', label: '全部追更状态' },
                            ...Object.entries(FOLLOWUP_LABELS).map(([value, label]) => ({ value, label })),
                            { value: 'attention', label: '仅看检查异常' },
                          ]}
                        />
                      </FormField>
                      <FormField label="连载状态">
                        <SearchSelect
                          compact
                          className={styles.filterSelect}
                          matchTriggerWidth
                          aria-label="连载状态筛选"
                          value={filters.status}
                          onChange={(v) => setFilter('status', v)}
                          options={[
                            { value: '', label: '全部连载状态' },
                            { value: 'ongoing', label: '连载中' },
                            { value: 'completed', label: '已完结' },
                          ]}
                        />
                      </FormField>
                    </PopoverContent>
                  </Popover>
                </div>
                {hasActiveFilters && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setInput('')
                      setFilters((f) => ({
                        ...f,
                        site: '',
                        source: '',
                        followup: '',
                        status: '',
                        result: '',
                        search: '',
                        sort: 'checked',
                        page: '1',
                      }))
                    }}
                  >
                    清除筛选
                  </Button>
                )}
                <div className={styles.sort}>
                  <SearchSelect
                    compact
                    chip
                    aria-label="明细排序"
                    value={filters.sort}
                    onChange={(v) => setFilter('sort', v)}
                    options={[
                      { value: 'checked', label: '最近检查优先' },
                      { value: 'next', label: '下次检查最早' },
                      { value: 'pending', label: '章节缺口最多' },
                      { value: 'updated', label: '最近更新优先' },
                      { value: 'title', label: '按书名排序' },
                    ]}
                  />
                </div>
              </AdminToolbar>

              {/* 批量操作浮动胶囊岛 */}
              <AdminSelectionBar
                count={selectedIds.size}
                label={`已选择 ${selectedIds.size} 部作品`}
                onClear={() => setSelectedIds(new Set())}
                clearPlacement="actions"
              >
                <Button variant="secondary" size="sm" disabled={batchBusy} onClick={() => void handleBatchUpdate()}>
                  检查更新
                </Button>
                <Button variant="secondary" size="sm" disabled={batchBusy} onClick={() => setBatchFollowupNovels(selectedNovelsList)}>
                  批量追更设置
                </Button>
              </AdminSelectionBar>

              {/* 纸白作业台：复用共享库列表套件 */}
              <AdminDataPanel ariaLabel="小说明细" columns={columns} density="comfortable" className={styles.tablePanel}>
                {!matches ? (
                  error ? (
                    <EmptyState message="筛选结果尚未读取成功" />
                  ) : (
                    <LoadingState label="正在更新小说明细" />
                  )
                ) : (
                  <Table className={cn('admin-data-table admin-data-table--animated', !matches && 'admin-data-table--transitioning')}>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12 pl-4">
                          <Checkbox
                            aria-label="全选当前页作品"
                            checked={data.books.length > 0 && data.books.every((b) => selectedIds.has(b.id))}
                            onCheckedChange={(checked) => toggleSelectAll(checked === true)}
                          />
                        </TableHead>
                        <TableHead>作品</TableHead>
                        <TableHead>主要来源</TableHead>
                        <TableHead>检查结果</TableHead>
                        <TableHead>检查时间</TableHead>
                        <TableHead>待入库</TableHead>
                        <TableHead className="text-right pr-6">操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {!data.books.length ? (
                        <TableRow>
                          <TableCell colSpan={7}>
                            <EmptyState message="当前筛选没有匹配的小说" />
                          </TableCell>
                        </TableRow>
                      ) : (
                        data.books.map((book, idx) => (
                          <TableRow
                            key={book.id}
                            style={{
                              animationDelay: `${getAdminTableRowStaggerDelay(idx, data.books.length)}ms`,
                            }}
                          >
                            <TableCell data-check="" className="pl-4">
                              <Checkbox
                                aria-label={`选择作品 ${book.title}`}
                                checked={selectedIds.has(book.id)}
                                onCheckedChange={(checked) => toggleSelectOne(book.id, checked === true)}
                              />
                            </TableCell>
                            <TableCell data-primary="" data-label="作品" className="font-medium novel-title-cell">
                              <div className="novel-book-entity">
                                <div className="novel-book-cover">
                                  {novelCoverUrl(book) ? (
                                    <img src={novelCoverUrl(book)} alt={book.title} className="novel-book-cover__img" loading="lazy" />
                                  ) : (
                                    <div className="novel-book-cover__placeholder">
                                      <span>{book.title.charAt(0)}</span>
                                    </div>
                                  )}
                                  <span className="novel-book-cover__spine" aria-hidden="true" />
                                </div>
                                <div className="novel-book-info">
                                  <button className={cn('novel-book-title text-left', styles.bookTitle)} title={book.title} onClick={() => setSelectedBook(book)}>
                                    {book.title}
                                  </button>
                                  <span className="novel-book-sub">
                                    {book.author || '未知作者'} · {book.status === 'ongoing' ? '连载中' : '已完结'} · {n(book.chapterCount)} 章
                                  </span>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell data-label="主要来源">
                              <div className="flex flex-col gap-0.5 min-w-0">
                                <span className="font-medium text-sm text-foreground truncate">{siteLabel(book.site)}</span>
                                <span className="text-xs text-muted-foreground truncate">
                                  {SOURCE_LABELS[book.sourceCategory]}
                                  {book.sources.length > 1 ? ` · ${book.sources.length} 条来源` : ''}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell data-label="检查结果">
                              <div className="flex flex-col gap-1 items-start">
                                <AdminStatusBadge tone={resultTone(book.result)}>
                                  {results[book.result] || book.result || '尚未检查'}
                                </AdminStatusBadge>
                                <span className="text-xs text-muted-foreground">
                                  {book.followupCategory === 'enabled' ? '自动追更已开启' : FOLLOWUP_LABELS[book.followupCategory]}
                                </span>
                                {book.attention && <span className={styles.attention}>{book.sourceCategory !== 'configured' ? '需补全抓取配置' : '需要处理'}</span>}
                              </div>
                            </TableCell>
                            <TableCell data-label="检查时间">
                              <div className="flex flex-col gap-0.5">
                                <span className="text-sm font-medium tabular-nums">{book.checkedAt ? <CheckTime timestamp={book.checkedAt} snapshotAt={data.snapshotAt} /> : '尚未检查'}</span>
                                <span className="text-xs text-muted-foreground">
                                  {book.active
                                    ? '正在执行'
                                    : book.followupCategory !== 'enabled'
                                      ? '未安排自动检查'
                                      : !book.nextCheckAt || book.nextCheckAt <= data.snapshotAt
                                        ? '等待调度'
                                        : <>下次 <CheckTime timestamp={book.nextCheckAt} snapshotAt={data.snapshotAt} /></>}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell data-label="待入库">
                              <div className="flex flex-col items-start gap-1 justify-center">
                                <span className="text-sm font-semibold tabular-nums text-foreground">
                                  {book.pending == null ? '未核对' : `${n(book.pending)} 章`}
                                </span>
                                {!!book.protected && (
                                  <span className="source-protected-badge" title={`该作品有 ${n(book.protected)} 章受保护内容`}>
                                    <LockKeyhole aria-hidden="true" />
                                    受保护 {n(book.protected)} 章
                                  </span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell data-actions="" data-label="操作" className="text-right pr-6">
                              <div className="admin-cell-actions justify-end">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  aria-label={`《${book.title}》追更设置`}
                                  onClick={() => setQuickFollowupNovel({ id: book.id, title: book.title })}
                                >
                                  追更设置
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                )}
              </AdminDataPanel>

              {/* 独立悬浮底部分页：平铺于表格之外 */}
              <Pagination
                variant="detached"
                page={data.page}
                totalPages={data.totalPages}
                busy={loading || !matches}
                onPage={(page) => setFilters((f) => ({ ...f, page: String(page) }))}
                summary={
                  matches
                    ? `共 ${n(data.filteredTotal)} 本，显示 ${data.books.length ? (data.page - 1) * data.limit + 1 : 0}–${(data.page - 1) * data.limit + data.books.length}`
                    : '筛选结果更新中'
                }
                pageSize={{
                  value: Number(filters.limit),
                  onChange: (size) => setFilters((f) => ({ ...f, limit: String(size), page: '1' })),
                }}
              />
            </TabsContent>

            <TabsContent value="distribution" forceMount className={activeTab !== 'distribution' ? 'hidden' : undefined}>
              <SourceDistribution
                data={data}
                view={filters.view}
                loading={loading}
                onViewChange={(view) => setFilters((f) => ({ ...f, view, site: '', page: '1' }))}
                onSelectBooks={selectSourceBooks}
              />
            </TabsContent>
          </Tabs>
        </>
      )}

      {/* 作品详情弹窗 */}
      {selectedBook && data && (
        <BookDetails
          key={selectedBook.id}
          book={selectedBook}
          snapshotAt={data.snapshotAt}
          onUpdated={load}
          onClose={() => {
            setSelectedBook(null)
            void load()
          }}
        />
      )}

      {/* 单本追更弹窗 */}
      {quickFollowupNovel && (
        <NovelFollowupDialog
          key={quickFollowupNovel.id}
          novel={quickFollowupNovel}
          onClose={() => {
            setQuickFollowupNovel(null)
            void load()
          }}
        />
      )}

      {/* 批量追更弹窗 */}
      {batchFollowupNovels && (
        <BatchNovelFollowupDialog
          novels={batchFollowupNovels}
          onClose={() => {
            setBatchFollowupNovels(null)
            setSelectedIds(new Set())
            void load()
          }}
        />
      )}
    </AdminPage>
  )
}
