import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { LockKeyhole, RefreshCw, Settings2 } from 'lucide-react'
import { toast } from 'sonner'
import { FOLLOWUP_LABELS, SOURCE_LABELS, type FollowupCategory, type SourceAnalyticsBook, type SourceAnalyticsResponse } from '@shared/source-analytics'
import { adminApi, url, authHeaders } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { getAdminTableRowStaggerDelay } from '@/lib/admin-table-motion'
import AdminPage from '@/components/admin/AdminPage'
import { AdminDataPanel, AdminPanelHeading, AdminToolbar, AdminSearch, type AdminColumn } from '@/components/admin/AdminWorkspace'
import AdminStatusBadge from '@/components/admin/AdminStatusBadge'
import AdminSelectionBar from '@/components/admin/AdminSelectionBar'
import AdminEmptyState from '@/components/admin/AdminEmptyState'
import { ErrorState, InlineError, LoadingState } from '@/components/admin/AsyncStates'
import CustomSelect from '@/components/admin/CustomSelect'
import Pagination from '@/components/admin/Pagination'
import NovelFollowupDialog from '@/components/admin/NovelFollowupDialog'
import BatchNovelFollowupDialog from '@/components/admin/BatchNovelFollowupDialog'
import { AdminDialogBody, AdminDialogContent } from '@/components/admin/AdminDialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import '@/styles/admin/pages/source-analytics.css'

const MergeDialog = lazy(() => import('./ChaptersTab'))
const followupKeys = Object.keys(FOLLOWUP_LABELS) as FollowupCategory[]
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
  { key: 'select', width: '4.5%' },
  { key: 'book', label: '作品', width: '22%', primary: true },
  { key: 'source', label: '主要来源', width: '18%' },
  { key: 'followup', label: '追更状态', width: '17%' },
  { key: 'check', label: '最近检查 / 下次安排', width: '22%' },
  { key: 'pending', label: '待入库', width: '10%' },
  { key: 'actions', label: '操作', width: '6.5%', actions: true },
]

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
      <AdminDialogContent
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
        <AdminDialogBody>
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
            <h3 className="admin-dialog-section-label">来源记录</h3>
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
              <p className="admin-dialog-hint">未找到有效的 HTTP/HTTPS 来源。</p>
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
          <p className="admin-dialog-hint" style={{ marginTop: '0.75rem' }}>
            统计读取于 {formatDateTime(snapshotAt)}。配置完整不代表源站当前可访问；进入追更详情可读取最新结果。
          </p>
        </AdminDialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            关闭
          </Button>
        </DialogFooter>
      </AdminDialogContent>
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

  function chartFilter(site: string, category?: FollowupCategory, source?: string) {
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
      className="admin-redesign-page--source-analytics"
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
          <Tabs value={activeTab} onValueChange={(val) => setActiveTab(val as 'list' | 'distribution')} className="source-analytics-tabs admin-capsule-tabs">
            <div className="source-analytics-workspace-nav">
              <TabsList aria-label="工作视图">
                <TabsTrigger value="list">
                  小说明细
                  <span className="source-analytics-tab-count">{matches ? n(data.filteredTotal) : '…'}</span>
                </TabsTrigger>
                <TabsTrigger value="distribution">书源与追更透视</TabsTrigger>
              </TabsList>
            </div>

            {/* 视图一：去容器化小说明细 (Uncontainerized List) */}
            <TabsContent value="list" forceMount className={cn('source-analytics-list-view', activeTab !== 'list' && 'hidden')}>
              {/* 单层控制流：筛选工具栏直接平铺 */}
              <AdminToolbar layout="inline" className="source-analytics-filters" ariaLive="polite">
                <AdminSearch
                  id="source-analytics-search"
                  label="搜索小说"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder="搜索书名或作者"
                />
                <div className="admin-filter-chips">
                  <CustomSelect
                    compact
                    chip
                    filterChip
                    aria-label="源站筛选"
                    value={filters.site}
                    onChange={(v) => setFilter('site', v)}
                    searchable
                    options={[{ value: '', label: '全部源站' }, ...data.groups.map((g) => ({ value: g.site, label: siteLabel(g.site) }))]}
                  />
                  <CustomSelect
                    compact
                    chip
                    filterChip
                    aria-label="来源配置筛选"
                    value={filters.source}
                    onChange={(v) => setFilter('source', v)}
                    options={[{ value: '', label: '全部来源配置' }, ...Object.entries(SOURCE_LABELS).map(([value, label]) => ({ value, label }))]}
                  />
                  <CustomSelect
                    compact
                    chip
                    filterChip
                    aria-label="追更状态筛选"
                    value={filters.followup}
                    onChange={(v) => setFilter('followup', v)}
                    options={[
                      { value: '', label: '全部追更状态' },
                      ...Object.entries(FOLLOWUP_LABELS).map(([value, label]) => ({ value, label })),
                      { value: 'attention', label: '仅看检查异常' },
                    ]}
                  />
                  <CustomSelect
                    compact
                    chip
                    filterChip
                    aria-label="连载状态筛选"
                    value={filters.status}
                    onChange={(v) => setFilter('status', v)}
                    options={[
                      { value: '', label: '全部连载状态' },
                      { value: 'ongoing', label: '连载中' },
                      { value: 'completed', label: '已完结' },
                    ]}
                  />
                  <CustomSelect
                    compact
                    chip
                    filterChip
                    aria-label="检查结果筛选"
                    value={filters.result}
                    onChange={(v) => setFilter('result', v)}
                    options={[{ value: '', label: '全部检查结果' }, ...Object.entries(results).map(([value, label]) => ({ value, label }))]}
                  />
                  <CustomSelect
                    compact
                    chip
                    filterChip
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
                      page: '1',
                    }))
                  }}
                >
                  清除筛选
                </Button>
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
              <AdminDataPanel ariaLabel="小说明细" columns={columns} density="comfortable" className="source-analytics-table-panel">
                {!matches ? (
                  error ? (
                    <AdminEmptyState message="筛选结果尚未读取成功" />
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
                        <TableHead>追更状态</TableHead>
                        <TableHead>最近检查 / 下次安排</TableHead>
                        <TableHead>待入库</TableHead>
                        <TableHead className="text-right pr-6">操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {!data.books.length ? (
                        <TableRow>
                          <TableCell colSpan={7}>
                            <AdminEmptyState message="当前筛选没有匹配的小说" />
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
                                  {book.coverUrl && !/noimg\.jpg/i.test(book.coverUrl) ? (
                                    <img src={book.coverUrl} alt={book.title} className="novel-book-cover__img" loading="lazy" />
                                  ) : (
                                    <div className="novel-book-cover__placeholder">
                                      <span>{book.title.charAt(0)}</span>
                                    </div>
                                  )}
                                  <span className="novel-book-cover__spine" aria-hidden="true" />
                                </div>
                                <div className="novel-book-info">
                                  <button className="novel-book-title text-left" onClick={() => setSelectedBook(book)}>
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
                            <TableCell data-label="追更状态">
                              <div className="flex flex-col gap-1 items-start">
                                <AdminStatusBadge tone={book.followupCategory === 'enabled' ? 'success' : 'neutral'}>
                                  {FOLLOWUP_LABELS[book.followupCategory]}
                                </AdminStatusBadge>
                                <span className="text-xs text-muted-foreground">
                                  {book.attention ? '需要处理 · ' : ''}
                                  {results[book.result] || book.result}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell data-label="最近检查 / 下次安排">
                              <div className="flex flex-col gap-0.5">
                                <span className="text-sm font-medium tabular-nums">{book.checkedAt ? formatDateTime(book.checkedAt) : '尚未检查'}</span>
                                <span className="text-xs text-muted-foreground">
                                  {book.followupCategory !== 'enabled'
                                    ? '未安排自动检查'
                                    : book.active
                                      ? '正在执行'
                                      : !book.nextCheckAt || book.nextCheckAt <= data.snapshotAt
                                        ? '等待调度'
                                        : `下次 ${formatDateTime(book.nextCheckAt)}`}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell data-label="待入库">
                              <div className="flex flex-col gap-0.5">
                                <span className="text-sm font-semibold tabular-nums">{book.pending == null ? '未核对' : `${n(book.pending)} 章`}</span>
                                {!!book.protected && (
                                  <span className="novel-update-protection">
                                    <LockKeyhole aria-hidden="true" />
                                    受保护 {n(book.protected)} 章
                                  </span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell data-actions="" data-label="操作" className="text-right pr-6">
                              <div className="admin-cell-actions justify-end">
                                <button
                                  type="button"
                                  className="admin-icon-button"
                                  title="调整追更设置"
                                  aria-label={`调整《${book.title}》追更设置`}
                                  onClick={() => setQuickFollowupNovel({ id: book.id, title: book.title })}
                                >
                                  <Settings2 className="size-4" />
                                </button>
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

            {/* 视图二：书源分布与追更覆盖透视卡片 */}
            <TabsContent value="distribution" forceMount className={cn('flex flex-col gap-4', activeTab !== 'distribution' && 'hidden')}>
              {/* 大盘口径与快照指示栏 */}
              <div className="source-analytics-scope-bar">
                <CustomSelect
                  aria-label="来源统计口径"
                  compact
                  chip
                  value={filters.view}
                  onChange={(value) => setFilters((f) => ({ ...f, view: value, site: '', page: '1' }))}
                  options={[
                    { value: 'primary', label: '主要来源 · 每本书计一次' },
                    { value: 'all', label: '全部来源 · 按站点去重' },
                  ]}
                />
                <span className="source-analytics-snapshot-tag">统计于 {formatDateTime(data.snapshotAt)}</span>
              </div>

              {/* 双子数据透视卡片 */}
              <div className="source-analytics-charts" aria-busy={loading}>
                {/* 书源分布 */}
                <AdminDataPanel ariaLabel="书源分布">
                  <AdminPanelHeading
                    title="书源分布"
                    status={
                      <span className="source-analytics-meta">
                        {n(data.withSource)} / {n(data.total)} 本有来源
                      </span>
                    }
                  />
                  <div className="source-chart-legend">
                    {Object.entries(SOURCE_LABELS).map(([category, label]) => (
                      <button key={category} type="button" onClick={() => chartFilter('', undefined, category)}>
                        <i className={`source-chart-color source-color-${category}`} />
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="source-chart-rows">
                    {!data.groups.length ? (
                      <AdminEmptyState message="书库还是空的" />
                    ) : (
                      data.groups.map((group) => (
                        <div className="source-chart-row" key={group.site}>
                          <button className="source-chart-site" onClick={() => chartFilter(group.site)}>
                            <span>{siteLabel(group.site)}</span>
                            <span>{n(group.total)} 本</span>
                          </button>
                          <div
                            className="source-chart-track"
                            style={{
                              width: `${Math.max(8, (group.total / Math.max(...data.groups.map((g) => g.total), 1)) * 100)}%`,
                            }}
                          >
                            {(['configured', 'link', 'none'] as const)
                              .filter((category) => group[category])
                              .map((category) => (
                                <button
                                  key={category}
                                  className={`source-color-${category}`}
                                  style={{ flexGrow: group[category] }}
                                  title={`${SOURCE_LABELS[category]} ${group[category]} 本`}
                                  aria-label={`${siteLabel(group.site)}：${SOURCE_LABELS[category]} ${group[category]} 本`}
                                  onClick={() => chartFilter(group.site, undefined, category)}
                                />
                              ))}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  <p className="source-chart-note">
                    {data.view === 'primary'
                      ? '优先采用抓取配置中的来源，其次采用作品来源和主要绑定来源。'
                      : '包含抓取、作品及绑定来源；同一本书在不同站点分别计入，站点数量之和可能超过书籍总数。配置状态属于作品，不表示该绑定来源可用于抓取。'}
                  </p>
                </AdminDataPanel>

                {/* 追更覆盖 */}
                <AdminDataPanel ariaLabel="追更覆盖">
                  <AdminPanelHeading title="追更覆盖" status={<span className="source-analytics-meta">{n(data.followups.enabled)} 本已开启</span>} />
                  <div className="source-chart-legend">
                    {followupKeys.map((category) => (
                      <button key={category} type="button" onClick={() => chartFilter('', category)}>
                        <i className={`source-chart-color followup-color-${category}`} />
                        {FOLLOWUP_LABELS[category]} {n(data.followups[category])}
                      </button>
                    ))}
                    <button
                      className="source-chart-legend-attention"
                      onClick={() => {
                        setInput('')
                        setFilters((f) => ({
                          ...f,
                          followup: 'attention',
                          source: '',
                          site: '',
                          status: '',
                          result: '',
                          search: '',
                          page: '1',
                        }))
                        setActiveTab('list')
                      }}
                    >
                      检查异常 {n(data.attention)}
                    </button>
                  </div>
                  <div className="source-chart-rows">
                    {!data.groups.length ? (
                      <AdminEmptyState message="暂无追更统计" />
                    ) : (
                      data.groups.map((group) => (
                        <div className="source-chart-row" key={group.site}>
                          <button className="source-chart-site" onClick={() => chartFilter(group.site)}>
                            <span>{siteLabel(group.site)}</span>
                            <span>{n(group.total)} 本</span>
                          </button>
                          <div className="source-chart-track">
                            {followupKeys
                              .filter((category) => group.followups[category])
                              .map((category) => (
                                <button
                                  key={category}
                                  className={`followup-color-${category}`}
                                  style={{ flexGrow: group.followups[category] }}
                                  title={`${FOLLOWUP_LABELS[category]} ${group.followups[category]} 本`}
                                  aria-label={`${siteLabel(group.site)}：${FOLLOWUP_LABELS[category]} ${group.followups[category]} 本`}
                                  onClick={() => chartFilter(group.site, category)}
                                />
                              ))}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  <p className="source-chart-note">
                    异常是已开启作品中的额外状态，包含失败、待补、受保护章节和配置缺失；运行中任务不重复计入。点击色块或图例筛选明细。
                  </p>
                </AdminDataPanel>
              </div>
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
