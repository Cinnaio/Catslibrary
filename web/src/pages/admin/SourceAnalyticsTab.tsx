import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'
import { FOLLOWUP_LABELS, SOURCE_LABELS, type FollowupCategory, type SourceAnalyticsBook, type SourceAnalyticsResponse } from '@shared/source-analytics'
import { adminApi } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import AdminPage from '@/components/admin/AdminPage'
import { AdminDataPanel, AdminPanelHeading, AdminToolbar, AdminSearch, type AdminColumn } from '@/components/admin/AdminWorkspace'
import AdminStatusBadge from '@/components/admin/AdminStatusBadge'
import AdminEmptyState from '@/components/admin/AdminEmptyState'
import { ErrorState, InlineError, LoadingState } from '@/components/admin/AsyncStates'
import CustomSelect from '@/components/admin/CustomSelect'
import Pagination from '@/components/admin/Pagination'
import NovelFollowupDialog from '@/components/admin/NovelFollowupDialog'
import { AdminDialogBody, AdminDialogContent } from '@/components/admin/AdminDialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
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
  { key: 'book', label: '作品', width: '24%', primary: true },
  { key: 'source', label: '主要来源', width: '19%' },
  { key: 'followup', label: '追更状态', width: '18%' },
  { key: 'check', label: '最近检查 / 下次安排', width: '26%' },
  { key: 'pending', label: '待入库', width: '13%' },
]
function BookDetails({ book, snapshotAt, onClose, onUpdated }: { book: SourceAnalyticsBook; snapshotAt: number; onClose: () => void; onUpdated: () => Promise<void> }) {
  const [followup, setFollowup] = useState(false),
    [merge, setMerge] = useState(false)
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
          <dl className="task-workspace-details">
            <dt>作者 / 状态</dt>
            <dd>
              {book.author || '未知作者'} · {book.status === 'ongoing' ? '连载中' : '已完结'}
            </dd>
            <dt>来源配置</dt>
            <dd>{SOURCE_LABELS[book.sourceCategory]}</dd>
            <dt>自动追更</dt>
            <dd>
              {FOLLOWUP_LABELS[book.followupCategory]} · 每 {book.intervalHours} 小时
            </dd>
            <dt>最近结果</dt>
            <dd>
              {results[book.result] || book.result}；{book.message || '尚未记录检查说明'}
            </dd>
            <dt>章节缺口</dt>
            <dd>{book.pending == null ? '尚未核对源站目录' : `待入库 ${n(book.pending)} 章 · 其中受保护 ${n(book.protected || 0)} 章`}</dd>
            <dt>连续失败</dt>
            <dd>{book.failures == null ? '未统计' : `${book.failures} 次`}</dd>
          </dl>
          <section className="source-book-sources" aria-label="来源记录">
            <h3 className="admin-dialog-section-label">来源记录</h3>
            {book.sources.length ? (
              <ul>
                {book.sources.map((source) => (
                  <li key={source.url}>
                    <span>
                      {source.kind}
                      {source.url === book.sourceUrl ? ' · 主要来源' : ''}
                    </span>
                    <a href={source.url} target="_blank" rel="noreferrer">
                      {source.url}
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="admin-dialog-hint">未找到有效的 HTTP/HTTPS 来源。</p>
            )}
          </section>
          <div className="source-book-actions">
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
          <p className="admin-dialog-hint">统计读取于 {formatDateTime(snapshotAt)}。配置完整不代表源站当前可访问；进入追更详情可读取最新结果。</p>
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
  const [data, setData] = useState<SourceAnalyticsResponse | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true)
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
  const [input, setInput] = useState(''),
    [loadedKey, setLoadedKey] = useState(''),
    [selected, setSelected] = useState<SourceAnalyticsBook | null>(null)
  const revision = useRef(0),
    listRef = useRef<HTMLDivElement>(null)
  const key = useMemo(() => JSON.stringify(filters), [filters])
  const load = useCallback(async () => {
    const seq = ++revision.current
    setLoading(true)
    setError('')
    try {
      const next = await adminApi.sourceAnalytics(filters)
      if (seq === revision.current) {
        setData(next)
        setSelected(current => current ? next.books.find(book => book.id === current.id) || current : null)
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
    setFilters((f) => ({ ...f, site, followup: category || '', source: source || '', status: '', result: '', search: '', page: '1' }))
    listRef.current?.scrollIntoView({ block: 'start', behavior: 'auto' })
  }
  const matches = loadedKey === key
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
          <div className="source-analytics-scope">
            <CustomSelect
              aria-label="来源统计口径"
              value={filters.view}
              onChange={(value) => setFilters((f) => ({ ...f, view: value, site: '', page: '1' }))}
              options={[
                { value: 'primary', label: '主要来源 · 每本书计一次' },
                { value: 'all', label: '全部来源 · 按站点去重' },
              ]}
            />
            <span>统计于 {formatDateTime(data.snapshotAt)}</span>
          </div>
          <div className="source-analytics-charts" aria-busy={loading}>
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
                        {siteLabel(group.site)}
                        <span>{n(group.total)} 本</span>
                      </button>
                      <div
                        className="source-chart-track"
                        style={{ width: `${Math.max(8, (group.total / Math.max(...data.groups.map((g) => g.total), 1)) * 100)}%` }}
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
                  onClick={() => {
                    setInput('')
                    setFilters((f) => ({ ...f, followup: 'attention', source: '', site: '', status: '', result: '', search: '', page: '1' }))
                    listRef.current?.scrollIntoView({ block: 'start' })
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
                        {siteLabel(group.site)}
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
          <div ref={listRef} className="source-analytics-list">
            <AdminPanelHeading
              title="小说明细"
              status={<span className="source-analytics-meta">{matches ? `匹配 ${n(data.filteredTotal)} 本` : '正在更新筛选结果'}</span>}
            />
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
                  setFilters((f) => ({ ...f, site: '', source: '', followup: '', status: '', result: '', search: '', page: '1' }))
                }}
              >
                清除筛选
              </Button>
            </AdminToolbar>
            <AdminDataPanel ariaLabel="小说明细" columns={columns} density="comfortable">
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
                      {columns.map((column) => (
                        <TableHead key={column.key}>{column.label}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!data.books.length ? (
                      <TableRow>
                        <TableCell colSpan={5}>
                          <AdminEmptyState message="当前筛选没有匹配的小说" />
                        </TableCell>
                      </TableRow>
                    ) : (
                      data.books.map((book) => (
                        <TableRow key={book.id}>
                          <TableCell data-label="作品" data-primary>
                            <button className="source-book-name" onClick={() => setSelected(book)}>
                              {book.title}
                            </button>
                            <p className="source-analytics-meta">
                              {book.author || '未知作者'} · {book.status === 'ongoing' ? '连载中' : '已完结'} · {n(book.chapterCount)} 章
                            </p>
                          </TableCell>
                          <TableCell data-label="主要来源">
                            <span>{siteLabel(book.site)}</span>
                            <p className="source-analytics-meta">
                              {SOURCE_LABELS[book.sourceCategory]}
                              {book.sources.length > 1 ? ` · ${book.sources.length} 条来源` : ''}
                            </p>
                          </TableCell>
                          <TableCell data-label="追更状态">
                            <AdminStatusBadge tone={book.followupCategory === 'enabled' ? 'success' : 'neutral'}>
                              {FOLLOWUP_LABELS[book.followupCategory]}
                            </AdminStatusBadge>
                            <p className="source-analytics-meta">
                              {book.attention ? '需要处理 · ' : ''}
                              {results[book.result] || book.result}
                            </p>
                          </TableCell>
                          <TableCell data-label="检查与安排">
                            <p>{book.checkedAt ? formatDateTime(book.checkedAt) : '尚未检查'}</p>
                            <p className="source-analytics-meta">
                              {book.followupCategory !== 'enabled'
                                ? '未安排自动检查'
                                : book.active
                                  ? '正在执行'
                                  : !book.nextCheckAt || book.nextCheckAt <= data.snapshotAt
                                    ? '等待调度'
                                    : `下次 ${formatDateTime(book.nextCheckAt)}`}
                            </p>
                          </TableCell>
                          <TableCell data-label="待入库">
                            {book.pending == null ? '未核对' : `${n(book.pending)} 章`}
                            {!!book.protected && <p className="source-analytics-meta">受保护 {n(book.protected)} 章</p>}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              )}
              <Pagination
                page={data.page}
                totalPages={data.totalPages}
                busy={loading || !matches}
                onPage={(page) => setFilters((f) => ({ ...f, page: String(page) }))}
                summary={
                  matches
                    ? `共 ${n(data.filteredTotal)} 本，显示 ${data.books.length ? (data.page - 1) * data.limit + 1 : 0}–${(data.page - 1) * data.limit + data.books.length}`
                    : '筛选结果更新中'
                }
                pageSize={{ value: Number(filters.limit), onChange: (size) => setFilters((f) => ({ ...f, limit: String(size), page: '1' })) }}
              />
            </AdminDataPanel>
          </div>
        </>
      )}
      {selected && data && (
        <BookDetails
          key={selected.id}
          book={selected}
          snapshotAt={data.snapshotAt}
          onUpdated={load}
          onClose={() => {
            setSelected(null)
            void load()
          }}
        />
      )}
    </AdminPage>
  )
}
