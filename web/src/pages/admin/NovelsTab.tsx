import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowDown, ArrowUp, BookOpen, ChevronsUpDown, CirclePlus, FileUp, GitMerge, Palette, Pencil, RefreshCw, Trash2 } from 'lucide-react'
import type { Novel } from '@shared/types'
import { novelsApi, url, authHeaders } from '../../lib/api'
import { coverUrl as novelCoverUrl } from '@/lib/cover-url'
import { timeAgo } from '../../lib/format'
import { useConfirm, useToast } from '../../components/feedback'
import CustomSelect from '../../components/admin/CustomSelect'
import Pagination from '../../components/admin/Pagination'
import { ADMIN_DEFAULT_PAGE_SIZE, ADMIN_PAGE_SIZE_OPTIONS } from '@/lib/admin-pagination'
import { getAdminTableRowStaggerDelay } from '@/lib/admin-table-motion'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Table, TableBody, TableCell, TableHead, TableCaption, TableHeader, TableRow } from '@/components/ui/table'
import AdminPage from '@/components/admin/AdminPage'
import AdminRowActions from '@/components/admin/AdminRowActions'
import AdminSelectionBar from '@/components/admin/AdminSelectionBar'
import AdminContentRatingBadge from '@/components/admin/AdminContentRatingBadge'
import AdminStatusBadge from '@/components/admin/AdminStatusBadge'
import { ErrorState } from '@/components/admin/AsyncStates'
import { AdminDataPanel, AdminCellText, AdminSearch, AdminToolbar, type AdminColumn } from '@/components/admin/AdminWorkspace'
import BatchNovelFollowupDialog from '@/components/admin/BatchNovelFollowupDialog'
import NovelFollowupDialog from '@/components/admin/NovelFollowupDialog'
import NovelUpdateTag from '@/components/admin/NovelUpdateTag'
import BookImportDialog from '@/components/admin/BookImportDialog'
import SupplementarySourcesDialog from '@/components/admin/SupplementarySourcesDialog'
import BookImportHistoryDialog from '@/components/admin/BookImportHistoryDialog'
import NovelEditorDialog from '@/components/admin/NovelEditorDialog'
import NovelDeleteDialog from '@/components/admin/NovelDeleteDialog'

const ChapterMergeDialog = lazy(() => import('./ChaptersTab'))

const NOVEL_COLUMNS: readonly AdminColumn[] = [
  { key: 'check', width: '4.5%' },
  { key: 'title', label: '作品', width: '22%', primary: true },
  { key: 'author', label: '作者', width: '12%' },
  { key: 'categories', label: '分类', width: '15%' },
  { key: 'status', label: '状态', width: '8.5%' },
  { key: 'rating', label: '分级', width: '8.5%' },
  { key: 'chapters', label: '章节', width: '11%' },
  { key: 'updated', label: '更新', width: '7.5%' },
  { key: 'actions', actions: true, width: '11%' },
]

const RATING_FILTER_OPTIONS = [
  { value: '', label: '全部分级' },
  { value: 'unknown', label: '未标注' },
  { value: 'general', label: '一般作品' },
  { value: 'restricted', label: '限制级' },
]

const STATUS_FILTER_OPTIONS = [
  { value: '', label: '全部连载状态' },
  { value: 'ongoing', label: '连载中' },
  { value: 'completed', label: '已完结' },
]

const STATUS_LABELS: Record<string, string> = {
  ongoing: '连载中',
  completed: '已完结',
}

async function scrapeUpdate(novelId: string): Promise<Record<string, unknown>> {
  const res = await fetch(url('/scrape'), {
    method: 'POST',
    credentials: 'include',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ action: 'update', novelId }),
  })
  return res.json().catch(() => ({})) as Promise<Record<string, unknown>>
}

function NovelSortButton({
  field,
  active,
  order,
  onSort,
  children,
}: {
  field: string
  active: boolean
  order: string
  onSort: (field: string) => void
  children: string
}) {
  const Caret = active ? (order === 'asc' ? ArrowUp : ArrowDown) : ChevronsUpDown
  return (
    <button type="button" className="admin-sort-button" data-active={active} onClick={() => onSort(field)}>
      <span>{children}</span>
      <Caret className="admin-sort-caret" aria-hidden="true" />
    </button>
  )
}

export default function NovelsTab({
  highlightNovelId,
  onHighlightConsumed,
}: {
  highlightNovelId?: string
  onHighlightConsumed?: () => void
}) {
  const [batchFollowupNovels, setBatchFollowupNovels] = useState<Array<{ id: string; title: string }> | null>(null)
  const novelTitleCache = useRef(new Map<string, string>())
  const [mergeNovel, setMergeNovel] = useState<Novel | null>(null)
  const [followupNovel, setFollowupNovel] = useState<Novel | null>(null)
  const navigate = useNavigate()
  const { toast } = useToast()
  const { confirm } = useConfirm()

  // 列表状态
  const [novels, setNovels] = useState<Novel[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(ADMIN_DEFAULT_PAGE_SIZE)
  const [totalPages, setTotalPages] = useState(1)
  const [sortField, setSortField] = useState('updated_at')
  const [sortOrder, setSortOrder] = useState('desc')
  const [searchInput, setSearchInput] = useState('')
  const [query, setQuery] = useState('')
  const [ratingFilter, setRatingFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [visibilityFilter, setVisibilityFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // 弹窗状态
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Novel | null>(null)
  const [bookImportOpen, setBookImportOpen] = useState(false)
  const [supplementaryOpen, setSupplementaryOpen] = useState(false)
  const [importHistoryOpen, setImportHistoryOpen] = useState(false)
  const [deletingNovels, setDeletingNovels] = useState<Novel[] | null>(null)

  // 定位高亮
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const [locateId, setLocateId] = useState<string | null>(null)
  const highlightRowRef = useRef<HTMLTableRowElement>(null)
  const consumeRef = useRef(onHighlightConsumed)
  useEffect(() => {
    consumeRef.current = onHighlightConsumed
  }, [onHighlightConsumed])

  const seqRef = useRef(0)

  // 搜索防抖
  useEffect(() => {
    if (searchInput.trim() === query) return
    const t = setTimeout(() => {
      setQuery(searchInput.trim())
      setPage(1)
    }, 250)
    return () => clearTimeout(t)
  }, [searchInput, query])

  const load = useCallback(async () => {
    const seq = ++seqRef.current
    setLoading(true)
    setLoadError('')
    try {
      const params: Record<string, string | number> = { page, limit: pageSize, sort: sortField, order: sortOrder }
      if (query) params.search = query
      if (ratingFilter) params.contentRating = ratingFilter
      if (statusFilter) params.status = statusFilter
      if (visibilityFilter) params.visibility = visibilityFilter
      if (locateId) params.locateNovelId = locateId
      const data = await novelsApi.list(params)
      if (seq !== seqRef.current) return
      const rows = Array.isArray(data.novels) ? data.novels : []
      const tp = data.totalPages || 1
      rows.forEach((novel) => novelTitleCache.current.set(novel.id, novel.title))
      setNovels(rows)
      setTotalPages(tp)
      setTotal(data.total || 0)
      if (locateId) {
        setLocateId(null)
        if (rows.some((novel) => novel.id === locateId)) {
          setPage(data.page || 1)
          setHighlightId(locateId)
        } else {
          consumeRef.current?.()
          toast('未找到目标小说，可能已被删除或不可访问', 'error')
        }
        return
      }
      if (page > tp && tp >= 1 && rows.length === 0) {
        setPage(tp)
        return
      }
    } catch (err) {
      if (seq !== seqRef.current) return
      const msg = (err as Error).message || '请检查网络'
      setLoadError(msg)
      toast('小说列表加载失败：' + msg, 'error')
    } finally {
      if (seq === seqRef.current) setLoading(false)
    }
  }, [page, pageSize, sortField, sortOrder, query, ratingFilter, statusFilter, visibilityFilter, toast, locateId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!highlightNovelId) return
    seqRef.current++
    setHighlightId(null)
    setSearchInput('')
    setQuery('')
    setRatingFilter('')
    setStatusFilter('')
    setLocateId(highlightNovelId)
  }, [highlightNovelId])

  useEffect(() => {
    if (!highlightId || loading) return
    const targetVisible = novels.some((n) => n.id === highlightId)
    if (targetVisible) {
      highlightRowRef.current?.scrollIntoView({
        behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'center',
      })
    }
    const t = setTimeout(
      () => {
        consumeRef.current?.()
        setHighlightId(null)
      },
      targetVisible ? 1800 : 0,
    )
    return () => clearTimeout(t)
  }, [novels, loading, highlightId])

  function toggleSort(field: string) {
    if (field === sortField) {
      setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortOrder(['title', 'author', 'categories', 'status', 'content_rating'].includes(field) ? 'asc' : 'desc')
    }
    setPage(1)
  }

  function sortAria(field: string): 'ascending' | 'descending' | 'none' {
    if (sortField !== field) return 'none'
    return sortOrder === 'asc' ? 'ascending' : 'descending'
  }

  const allChecked = novels.length > 0 && novels.every((n) => selected.has(n.id))

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleSelectAll(checked: boolean | 'indeterminate') {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) {
        novels.forEach((n) => next.add(n.id))
      } else {
        novels.forEach((n) => next.delete(n.id))
      }
      return next
    })
  }

  function invertSelection() {
    setSelected((prev) => {
      const next = new Set<string>()
      novels.forEach((n) => {
        if (!prev.has(n.id)) next.add(n.id)
      })
      return next
    })
  }

  function titleFor(id: string): string {
    const fromCache = novelTitleCache.current.get(id)
    if (fromCache) return fromCache
    const found = novels.find((n) => n.id === id)
    return found ? found.title : id.slice(0, 8)
  }

  function openModal(novel: Novel | null) {
    setEditing(novel)
    setModalOpen(true)
  }

  async function handleBatchUpdate() {
    const ids = Array.from(selected)
    if (ids.length === 0) {
      toast('请先选择小说', 'error')
      return
    }
    const ok = await confirm({
      title: '批量更新',
      message: `将依次检查以下 ${ids.length} 本小说是否有新章节：`,
      okText: '开始更新',
      danger: false,
      items: ids.map((id) => titleFor(id)),
    })
    if (!ok) return

    toast(`开始批量更新 ${ids.length} 本小说…`)
    let success = 0
    let fail = 0
    for (const id of ids) {
      const label = titleFor(id)
      try {
        const data = await scrapeUpdate(id)
        if (data && (data as { jobId?: string }).jobId) {
          success++
          toast(`✓ ${label} — 更新任务已启动`, 'success')
        } else {
          fail++
          toast(`✕ ${label} — ${(data as { error?: string }).error || '启动失败'}`, 'error')
        }
      } catch (err) {
        fail++
        toast(`✕ ${label} — ${(err as Error).message}`, 'error')
      }
      await new Promise((r) => setTimeout(r, 400))
    }
    toast(`批量更新完成：${success} 个成功, ${fail} 个失败`, fail === 0 ? 'success' : 'error')
    void load()
  }

  function handleBatchDeletePrompt() {
    const ids = Array.from(selected)
    if (ids.length === 0) {
      toast('请先选择小说', 'error')
      return
    }
    const toDelete = novels.filter((n) => selected.has(n.id))
    if (!toDelete.length) {
      toDelete.push(...ids.map((id) => ({ id, title: titleFor(id) } as Novel)))
    }
    setDeletingNovels(toDelete)
  }

  const emptyMessage = query ? `没有匹配「${query}」的小说` : '暂无小说，点击「+ 添加小说」开始'

  return (
    <AdminPage
      className="admin-redesign-page--novels"
      title="小说管理"
      description="维护书库作品、分类与连载状态，勾选作品后可批量更新或设置追更。"
      actions={
        <>
          <Button onClick={() => setBookImportOpen(true)}>
            <FileUp aria-hidden="true" />
            导入书籍
          </Button>
          <Button variant="secondary" onClick={() => setImportHistoryOpen(true)}>
            导入历史
          </Button>
          <Button variant="secondary" onClick={() => setSupplementaryOpen(true)}>附加更新源</Button>
          <Button variant="secondary" onClick={() => openModal(null)}>
            <span aria-hidden="true">＋</span>
            添加小说
          </Button>
        </>
      }
    >
      {/* Claude 风格全要素胶囊筛选轨道 */}
      <AdminToolbar layout="inline" className="novels-filter-rail">
        <AdminSearch
          id="novel-search"
          label="搜索小说"
          type="search"
          data-admin-search
          placeholder="搜索作品标题、作者名或简介…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <div className="novels-filter-chips">
          <CustomSelect compact chip filterChip leadingIcon={<CirclePlus className="size-[var(--admin-filter-chip-icon-size)]" />}
            aria-label="按可见范围筛选小说" value={visibilityFilter}
            options={[{ value: '', label: '全部可见范围' }, { value: 'public', label: '公开' }, { value: 'admin', label: '仅管理员' }, { value: 'selected', label: '指定用户' }]}
            onChange={(value) => { setVisibilityFilter(value); setPage(1) }} />
          <CustomSelect
            compact
            chip
            filterChip
            leadingIcon={<CirclePlus className="size-[var(--admin-filter-chip-icon-size)]" />}
            aria-label="按连载状态筛选小说"
            options={STATUS_FILTER_OPTIONS}
            value={statusFilter}
            onChange={(v) => {
              setStatusFilter(v)
              setPage(1)
            }}
          />
          <CustomSelect
            compact
            chip
            filterChip
            leadingIcon={<CirclePlus className="size-[var(--admin-filter-chip-icon-size)]" />}
            aria-label="按分级筛选小说"
            options={RATING_FILTER_OPTIONS}
            value={ratingFilter}
            onChange={(v) => {
              setRatingFilter(v)
              setPage(1)
            }}
          />
        </div>
      </AdminToolbar>

      {/* 浮动岛屿批量操作条 */}
      <AdminSelectionBar
        count={selected.size}
        label={`已选择 ${selected.size} 部作品`}
        onClear={() => setSelected(new Set())}
        clearPlacement="actions"
      >
        <Button variant="secondary" size="sm" onClick={() => void handleBatchUpdate()}>
          批量检查更新
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setBatchFollowupNovels(Array.from(selected, (id) => ({ id, title: titleFor(id) })))}
        >
          批量追更设置
        </Button>
        <Button variant="secondary" size="sm" onClick={invertSelection}>
          反选
        </Button>
        <Button variant="destructive" size="sm" onClick={handleBatchDeletePrompt}>
          删除所选
        </Button>
      </AdminSelectionBar>

      {/* 采用 comfortable 舒适行距的数据面板 */}
      <AdminDataPanel
        className="novels-data-panel"
        ariaLabel="作品目录数据"
        columns={NOVEL_COLUMNS}
        density="comfortable"
      >
        <Table>
          <TableCaption className="sr-only">小说目录列表，可按标题、作者、分类、状态、分级、章节数和更新时间排序</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col" data-check="">
                <Checkbox aria-label="选择当前页全部小说" checked={allChecked} onCheckedChange={handleSelectAll} />
              </TableHead>
              <TableHead scope="col" aria-sort={sortAria('title')}>
                <NovelSortButton field="title" active={sortField === 'title'} order={sortOrder} onSort={toggleSort}>
                  作品
                </NovelSortButton>
              </TableHead>
              <TableHead scope="col" aria-sort={sortAria('author')}>
                <NovelSortButton field="author" active={sortField === 'author'} order={sortOrder} onSort={toggleSort}>
                  作者
                </NovelSortButton>
              </TableHead>
              <TableHead scope="col" aria-sort={sortAria('categories')}>
                <NovelSortButton field="categories" active={sortField === 'categories'} order={sortOrder} onSort={toggleSort}>
                  分类
                </NovelSortButton>
              </TableHead>
              <TableHead scope="col" aria-sort={sortAria('status')}>
                <NovelSortButton field="status" active={sortField === 'status'} order={sortOrder} onSort={toggleSort}>
                  状态
                </NovelSortButton>
              </TableHead>
              <TableHead scope="col" aria-sort={sortAria('content_rating')}>
                <NovelSortButton field="content_rating" active={sortField === 'content_rating'} order={sortOrder} onSort={toggleSort}>
                  分级
                </NovelSortButton>
              </TableHead>
              <TableHead scope="col" aria-sort={sortAria('chapter_count')}>
                <NovelSortButton field="chapter_count" active={sortField === 'chapter_count'} order={sortOrder} onSort={toggleSort}>
                  章节
                </NovelSortButton>
              </TableHead>
              <TableHead scope="col" aria-sort={sortAria('updated_at')}>
                <NovelSortButton field="updated_at" active={sortField === 'updated_at'} order={sortOrder} onSort={toggleSort}>
                  更新
                </NovelSortButton>
              </TableHead>
              <TableHead scope="col" className="text-right pr-6">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && novels.length === 0 ? (
              <TableRow>
                <TableCell colSpan={NOVEL_COLUMNS.length} className="text-center py-12 text-muted-foreground">
                  <div className="flex flex-col items-center gap-2">
                    <RefreshCw className="size-5 animate-spin text-accent" />
                    <span>正在加载书库作品…</span>
                  </div>
                </TableCell>
              </TableRow>
            ) : loadError && novels.length === 0 ? (
              <TableRow>
                <TableCell colSpan={NOVEL_COLUMNS.length} className="text-center py-8">
                  <ErrorState message={`加载失败：${loadError}`} onRetry={() => void load()} />
                </TableCell>
              </TableRow>
            ) : novels.length === 0 ? (
              <TableRow>
                <TableCell colSpan={NOVEL_COLUMNS.length} className="text-center py-12 text-muted-foreground">
                  {emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              novels.map((n, idx) => (
                <TableRow
                  key={n.id}
                  ref={n.id === highlightId ? highlightRowRef : undefined}
                  className={n.id === highlightId ? 'novel-row--highlight' : undefined}
                  style={{
                    animationDelay: `${getAdminTableRowStaggerDelay(idx, novels.length)}ms`,
                  }}
                >
                  <TableCell data-check="">
                    <Checkbox
                      aria-label={`选择小说：${n.title}`}
                      checked={selected.has(n.id)}
                      onCheckedChange={() => toggleRow(n.id)}
                    />
                  </TableCell>
                  <TableCell data-primary="" className="font-medium novel-title-cell">
                    {/* 微型立体书影实体 + 书名 */}
                    <div className="novel-book-entity">
                      <div className="novel-book-cover">
                        {novelCoverUrl(n) ? (
                          <img src={novelCoverUrl(n)} alt={n.title} className="novel-book-cover__img" loading="lazy" />
                        ) : (
                          <div className="novel-book-cover__placeholder">
                            <span>{n.title.charAt(0)}</span>
                          </div>
                        )}
                        <span className="novel-book-cover__spine" aria-hidden="true" />
                      </div>
                      <div className="novel-book-info">
                        <span className="novel-book-title">{n.title}</span>
                        {n.visibility && n.visibility !== 'public' && <span className="novel-book-sub">私密 · {n.visibility === 'admin' ? '仅管理员' : '指定用户'}</span>}
                        {n.sourceUrl && (
                          <span className="novel-book-sub">
                            {(() => {
                              try {
                                return new URL(n.sourceUrl).hostname.replace('www.', '')
                              } catch {
                                return ''
                              }
                            })()}
                          </span>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell data-col="author">
                    <AdminCellText>{n.author || '未知作者'}</AdminCellText>
                  </TableCell>
                  <TableCell data-col="categories">
                    <div className="flex flex-wrap gap-1">
                      {(n.categories || []).length === 0 ? (
                        <span className="text-xs text-muted-foreground">未分类</span>
                      ) : (
                        <>
                          {n.categories!.slice(0, 2).map((c) => (
                            <Badge key={c} variant="outline" className="text-xs rounded-full px-2 py-0.5">
                              {c}
                            </Badge>
                          ))}
                          {n.categories!.length > 2 && (
                            <Badge variant="outline" className="text-xs rounded-full px-1.5 py-0.5 text-muted-foreground">
                              +{n.categories!.length - 2}
                            </Badge>
                          )}
                        </>
                      )}
                    </div>
                  </TableCell>
                  <TableCell data-col="status">
                    <AdminStatusBadge tone={n.status === 'completed' ? 'neutral' : 'info'}>
                      {STATUS_LABELS[n.status || 'ongoing'] || n.status}
                    </AdminStatusBadge>
                  </TableCell>
                  <TableCell data-col="rating">
                    <AdminContentRatingBadge rating={n.contentRating} />
                  </TableCell>
                  <TableCell data-col="chapters">
                    {/* 桌面纵向两行（章节数 / 更新标签）；手机上转为同一读数行的胶囊组。 */}
                    <div className="novel-chapter-summary flex flex-col gap-0.5">
                      <span className="tabular-nums font-semibold">{n.chapterCount || 0} 章</span>
                      <NovelUpdateTag novel={n} />
                    </div>
                  </TableCell>
                  <TableCell data-col="updated">
                    <span className="text-xs text-muted-foreground" title={n.updatedAt ? new Date(n.updatedAt).toLocaleString() : ''}>
                      {timeAgo(n.updatedAt)}
                    </span>
                  </TableCell>
                  <TableCell data-actions="">
                    <AdminRowActions
                      label={n.title}
                      items={[
                        {
                          label: '章节列表',
                          icon: BookOpen,
                          onSelect: () => navigate(`/admin/chapters?novelId=${encodeURIComponent(n.id)}`),
                        },
                        {
                          label: '融合章节名',
                          icon: GitMerge,
                          onSelect: () => setMergeNovel(n),
                        },
                        {
                          label: '生成 AI 封面',
                          icon: Palette,
                          onSelect: () => navigate(`/admin/ai?sub=cover&novel=${encodeURIComponent(n.id)}`),
                        },
                        {
                          label: '删除小说',
                          icon: Trash2,
                          danger: true,
                          onSelect: () => setDeletingNovels([n]),
                        },
                      ]}
                    >
                      <Button
                        variant="ghost"
                        size="icon"
                        className="admin-icon-button"
                        aria-label={`更新与来源：${n.title}`}
                        title="更新与来源"
                        onClick={() => setFollowupNovel(n)}
                      >
                        <RefreshCw className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="admin-icon-button"
                        aria-label={`编辑：${n.title}`}
                        title="编辑"
                        onClick={() => openModal(n)}
                      >
                        <Pencil className="size-4" />
                      </Button>
                    </AdminRowActions>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </AdminDataPanel>

      {/* 弹窗集合 */}
      {batchFollowupNovels && <BatchNovelFollowupDialog novels={batchFollowupNovels} onClose={() => setBatchFollowupNovels(null)} />}
      {mergeNovel && (
        <Suspense fallback={<p role="status">正在打开融合章节名…</p>}>
          <ChapterMergeDialog
            key={mergeNovel.id}
            mergeNovel={{ id: mergeNovel.id, title: mergeNovel.title, author: mergeNovel.author || '', chapterCount: mergeNovel.chapterCount || 0 }}
            onMergeClose={() => setMergeNovel(null)}
            onMergeApplied={load}
          />
        </Suspense>
      )}
      {followupNovel && <NovelFollowupDialog key={followupNovel.id} novel={followupNovel} onCompleted={() => void load()} onClose={() => setFollowupNovel(null)} />}

      <Pagination
        variant="detached"
        className="novels-pagination"
        page={page}
        totalPages={totalPages}
        onPage={setPage}
        busy={loading}
        summary={
          <>
            共 {total} 本，显示 {total === 0 ? 0 : (page - 1) * pageSize + 1}-{Math.min(page * pageSize, total)}
          </>
        }
        pageSize={{
          value: pageSize,
          onChange: (size) => {
            setPageSize(size)
            setPage(1)
          },
          options: ADMIN_PAGE_SIZE_OPTIONS,
        }}
      />

      <BookImportDialog key={bookImportOpen ? 'open' : 'closed'} open={bookImportOpen} onOpenChange={setBookImportOpen} onCompleted={() => void load()} />
      {supplementaryOpen && <SupplementarySourcesDialog onClose={() => setSupplementaryOpen(false)} onCompleted={() => void load()} />}
      <BookImportHistoryDialog open={importHistoryOpen} onOpenChange={setImportHistoryOpen} onCompleted={() => void load()} />

      {/* 独立的编辑弹窗与删除确认弹窗 */}
      <NovelEditorDialog
        open={modalOpen}
        editing={editing}
        existingNovels={novels}
        onClose={() => setModalOpen(false)}
        onSaved={() => void load()}
      />

      {deletingNovels && (
        <NovelDeleteDialog
          open={Boolean(deletingNovels)}
          novels={deletingNovels}
          onClose={() => setDeletingNovels(null)}
          onDeleted={(deletedIds) => {
            setSelected((prev) => {
              const next = new Set(prev)
              deletedIds.forEach((id) => next.delete(id))
              return next
            })
            void load()
          }}
        />
      )}
    </AdminPage>
  )
}
