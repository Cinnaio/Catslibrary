/**
 * 小说管理 tab —— 小说列表 / 搜索 / 排序 / 分页 / 增删改 / 批量操作。
 * 由 Novel-KV js/admin-novels.js + admin.html #tab-novels 平移。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { newOperationId, novelsApi, url, authHeaders } from '../../lib/api'
import { timeAgo } from '../../lib/format'
import { useConfirm, useToast } from '../../components/feedback'
import CustomSelect from '../../components/admin/CustomSelect'
import Pagination from '../../components/admin/Pagination'
import type { Novel } from '@shared/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableCaption, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { ArrowDown, ArrowUp, BookOpen, ChevronsUpDown, Pencil, Trash2 } from 'lucide-react'
import AdminPage from '@/components/admin/AdminPage'
import { AdminDataPanel, AdminPanelHeading, AdminSearch, AdminToolbar, type AdminColumn } from '@/components/admin/AdminWorkspace'

const PAGE_SIZE = 20

/**
 * 表格列定义：桌面端据此固定列宽（表头与内容对齐），移动端据此折成卡片并
 * 显示字段名。顺序必须与 thead/tbody 的单元格顺序一致。
 *
 * 宽度全部用百分比：fixed 布局下百分比与 rem 混用时，定长列会先吃掉宽度，
 * 剩余空间再分给百分比列，窄容器里百分比列会被压到不可读（900px 实测标题列
 * 只剩 40px）。纯百分比合计 100%，任何宽度下都等比缩放。
 */
const NOVEL_COLUMNS: readonly AdminColumn[] = [
  { key: 'check', width: '3%' },
  { key: 'title', label: '标题', width: '21%', primary: true },
  { key: 'author', label: '作者', width: '14%' },
  { key: 'categories', label: '分类', width: '24%' },
  { key: 'status', label: '状态', width: '9%' },
  { key: 'chapters', label: '章节', width: '7%' },
  { key: 'updated', label: '更新', width: '11%' },
  { key: 'actions', actions: true, width: '11%' },
]

const STATUS_OPTIONS = [
  { value: 'ongoing', label: '连载中' },
  { value: 'completed', label: '已完结' },
]

interface NovelDraft {
  title: string
  author: string
  status: string
  description: string
  coverUrl: string
  categories: string
  sourceUrl: string
}

const EMPTY_DRAFT: NovelDraft = {
  title: '',
  author: '',
  status: 'ongoing',
  description: '',
  coverUrl: '',
  categories: '',
  sourceUrl: '',
}

/** 归一化分类输入：支持中英文逗号/顿号，去重（忽略大小写）。 */
function parseCategories(input: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  String(input || '')
    .split(/[,，、]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((s) => {
      const key = s.toLowerCase()
      if (!seen.has(key)) {
        seen.add(key)
        out.push(s)
      }
    })
  return out
}

function getNewCount(n: Novel): number {
  return Math.max(0, (n.remoteChapterCount || 0) - (n.chapterCount || 0))
}

/** 增量更新：scrapeApi 未暴露原始 update action，用本地 fetch 包装。 */
async function scrapeUpdate(novelId: string): Promise<Record<string, unknown>> {
  const res = await fetch(url('/scrape'), {
    method: 'POST',
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
  // 用图标而非 ↑↓↕ 字符：字符箭头在 12px 下渲染模糊且宽度不一，
  // 切换排序时会造成表头文字左右抖动。
  const Caret = active ? (order === 'asc' ? ArrowUp : ArrowDown) : ChevronsUpDown
  return (
    <button type="button" className="admin-sort-button" data-active={active} onClick={() => onSort(field)}>
      {/* 文字包一层 span：裸文本节点不参与 flex gap，会导致图标紧贴文字 */}
      <span>{children}</span>
      <Caret className="admin-sort-caret" aria-hidden="true" />
    </button>
  )
}

export default function NovelsTab({ highlightNovelId, onHighlightConsumed }: { highlightNovelId?: string; onHighlightConsumed?: () => void }) {
  const { toast } = useToast()
  const { confirm } = useConfirm()

  // --- List state ---
  const [novels, setNovels] = useState<Novel[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [sortField, setSortField] = useState('updated_at')
  const [sortOrder, setSortOrder] = useState('desc')
  const [searchInput, setSearchInput] = useState('')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // --- Edit modal state ---
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Novel | null>(null)
  const [draft, setDraft] = useState<NovelDraft>(EMPTY_DRAFT)

  // --- Highlight (jump from detail page "管理") ---
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const consumeRef = useRef(onHighlightConsumed)
  useEffect(() => {
    consumeRef.current = onHighlightConsumed
  }, [onHighlightConsumed])

  // 忽略过期响应（快速切换搜索/排序/翻页时）
  const seqRef = useRef(0)

  // 搜索防抖 250ms → 重置到第 1 页
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(searchInput.trim())
      setPage(1)
    }, 250)
    return () => clearTimeout(t)
  }, [searchInput])

  const load = useCallback(async () => {
    const seq = ++seqRef.current
    setLoading(true)
    setLoadError('')
    try {
      const params: Record<string, string | number> = { page, limit: PAGE_SIZE, sort: sortField, order: sortOrder }
      if (query) params.search = query
      const data = await novelsApi.list(params)
      if (seq !== seqRef.current) return
      const rows = Array.isArray(data.novels) ? data.novels : []
      const tp = data.totalPages || 1
      setNovels(rows)
      setTotalPages(tp)
      setTotal(data.total || 0)
      // 结果收缩导致越界 → 钳回末页重试
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
  }, [page, sortField, sortOrder, query, toast])

  useEffect(() => {
    void load()
  }, [load])

  // 详情页「管理」跳转：按标题搜索使其落在第 1 页
  useEffect(() => {
    if (!highlightNovelId || highlightId === highlightNovelId) return
    setHighlightId(highlightNovelId)
    novelsApi
      .get(highlightNovelId)
      .then((res) => {
        const novel = res && res.novel
        if (novel && novel.title) {
          setSearchInput(novel.title)
          setQuery(novel.title)
          setPage(1)
        }
      })
      .catch(() => {
        /* 目标不存在 → 走下方 fallback 消耗 */
      })
  }, [highlightNovelId, highlightId])

  // 高亮行出现后短暂停留再消耗；目标不在当前页时兜底消耗，避免状态卡死
  useEffect(() => {
    if (!highlightId) return
    if (novels.some((n) => n.id === highlightId)) {
      const t = setTimeout(() => {
        consumeRef.current?.()
        setHighlightId(null)
      }, 1500)
      return () => clearTimeout(t)
    }
    if (!loading && query) {
      const t = setTimeout(() => {
        consumeRef.current?.()
        setHighlightId(null)
      }, 300)
      return () => clearTimeout(t)
    }
  }, [novels, loading, query, highlightId])

  // 高亮行滚动到可视区
  useEffect(() => {
    if (highlightId) {
      document.querySelector('.novel-row--highlight')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [highlightId, novels])

  // --- Sort ---
  function toggleSort(field: string) {
    if (field === sortField) {
      setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortOrder(field === 'title' || field === 'author' ? 'asc' : 'desc')
    }
    setPage(1)
  }

  function sortAria(field: string): 'ascending' | 'descending' | 'none' {
    if (sortField !== field) return 'none'
    return sortOrder === 'asc' ? 'ascending' : 'descending'
  }

  // --- Selection ---
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
      novels.forEach((n) => {
        if (checked) next.add(n.id)
        else next.delete(n.id)
      })
      return next
    })
  }

  function invertSelection() {
    setSelected((prev) => {
      const next = new Set(prev)
      novels.forEach((n) => {
        if (next.has(n.id)) next.delete(n.id)
        else next.add(n.id)
      })
      return next
    })
  }

  function titleFor(id: string): string {
    const n = novels.find((x) => x.id === id)
    return n ? n.title : id.slice(0, 8)
  }

  // --- Modal ---
  function openModal(novel: Novel | null) {
    setEditing(novel)
    setDraft(
      novel
        ? {
            title: novel.title || '',
            author: novel.author || '',
            status: novel.status || 'ongoing',
            description: novel.description || '',
            coverUrl: novel.coverUrl || '',
            categories: (novel.categories || []).join(', '),
            sourceUrl: novel.sourceUrl || '',
          }
        : EMPTY_DRAFT,
    )
    setModalOpen(true)
  }

  function closeModal() {
    setModalOpen(false)
    setEditing(null)
  }

  async function handleSave() {
    const title = draft.title.trim()
    const author = draft.author.trim()
    const sourceUrl = draft.sourceUrl.trim()
    if (!title || !author) {
      toast('标题和作者为必填项', 'error')
      return
    }
    const dup = novels.find((n) => n.id !== (editing ? editing.id : null) && (n.title === title || (sourceUrl && n.sourceUrl === sourceUrl)))
    if (dup) {
      const ok = await confirm({
        title: '发现重复小说',
        message: '已存在同名小说，仍要继续保存吗？',
        okText: '继续保存',
        danger: false,
        items: [dup.title],
      })
      if (!ok) return
    }
    const data = {
      title,
      author,
      description: draft.description.trim(),
      coverUrl: draft.coverUrl.trim(),
      categories: parseCategories(draft.categories),
      status: draft.status,
      sourceUrl,
    }
    try {
      if (editing) {
        await novelsApi.update(editing.id, data)
        toast('小说已更新', 'success')
      } else {
        await novelsApi.create(data)
        toast('小说已创建', 'success')
      }
      closeModal()
      void load()
    } catch (err) {
      toast('保存失败: ' + ((err as Error).message || '请检查网络和认证令牌'), 'error')
    }
  }

  // --- Delete ---
  async function handleDelete(novel: Novel) {
    const ok = await confirm({
      title: '删除小说',
      message: '确定删除该小说及其所有章节？此操作不可恢复。',
      okText: '删除',
      danger: true,
      items: [`${novel.title || novel.id} — ${novel.chapterCount || 0} 章`],
    })
    if (!ok) return
    try {
      await novelsApi.remove(novel.id)
      setSelected((prev) => {
        const next = new Set(prev)
        next.delete(novel.id)
        return next
      })
      toast('小说已删除', 'success')
    } catch (err) {
      toast('删除失败: ' + ((err as Error).message || '请检查网络和认证令牌'), 'error')
    }
    void load()
  }

  async function handleBatchDelete() {
    const ids = Array.from(selected).filter(Boolean).sort()
    if (ids.length === 0) {
      toast('请先选择小说', 'error')
      return
    }
    const ok = await confirm({
      title: '批量删除小说',
      message: `确定删除以下 ${ids.length} 本小说及其所有章节？此操作不可恢复。`,
      okText: '确认删除',
      danger: true,
      items: ids.map((id) => {
        const n = novels.find((x) => x.id === id)
        return (n ? n.title : id.slice(0, 8)) + (n ? ` — ${n.chapterCount || 0} 章` : '')
      }),
    })
    if (!ok) return
    try {
      const data = await novelsApi.batchDelete(ids, newOperationId('batch-delete-novels'))
      toast(`已删除 ${(data as { deleted?: number }).deleted || ids.length} 本小说`, 'success')
    } catch (err) {
      toast('批量删除失败: ' + ((err as Error).message || '请检查网络和认证令牌'), 'error')
    }
    setSelected((prev) => {
      const next = new Set(prev)
      ids.forEach((id) => next.delete(id))
      return next
    })
    void load()
  }

  // --- Batch update (incremental scrape) ---
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

  const countLabel = query ? `匹配 ${total} 本 · 第${page}/${totalPages}页` : `共 ${total} 本 · 第${page}/${totalPages}页`

  const emptyMessage = query ? `没有匹配「${query}」的小说` : '暂无小说，点击「+ 添加小说」开始'

  return (
    <AdminPage
      className="admin-redesign-page--novels"
      title="小说管理"
      meta={countLabel}
      description="维护书库作品、分类与连载状态，批量更新只作用于当前列表。"
      actions={
        <>
          <AdminSearch
            id="novel-search"
            label="搜索小说"
            type="search"
            data-admin-search
            placeholder="搜索标题、作者或简介"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <Button onClick={() => openModal(null)}>
            <span aria-hidden="true">＋</span>
            添加小说
          </Button>
        </>
      }
    >
      <AdminDataPanel ariaLabel="作品目录" columns={NOVEL_COLUMNS}>
        <AdminPanelHeading title="作品目录" description={query ? `匹配「${query}」的作品` : '按标题、作者、章节数和更新时间管理书库'} />
        {selected.size > 0 && (
          <AdminToolbar layout="inline">
            <div className="admin-toolbar__batch" aria-live="polite">
              <span className="admin-toolbar__batch-count">已选 {selected.size} 本</span>
              <div className="admin-toolbar__batch-actions">
                <Button variant="secondary" size="sm" onClick={() => void handleBatchUpdate()}>
                  批量更新
                </Button>
                <Button variant="secondary" size="sm" onClick={invertSelection}>
                  反选
                </Button>
                <Button variant="destructive" size="sm" onClick={() => void handleBatchDelete()}>
                  批量删除
                </Button>
              </div>
            </div>
          </AdminToolbar>
        )}
        <Table>
          <TableCaption className="sr-only">小说目录列表，可按标题、作者、章节数和更新时间排序</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">
                <Checkbox aria-label="选择当前页全部小说" checked={allChecked} onCheckedChange={handleSelectAll} />
              </TableHead>
              <TableHead scope="col" aria-sort={sortAria('title')}>
                <NovelSortButton field="title" active={sortField === 'title'} order={sortOrder} onSort={toggleSort}>
                  标题
                </NovelSortButton>
              </TableHead>
              <TableHead scope="col" aria-sort={sortAria('author')}>
                <NovelSortButton field="author" active={sortField === 'author'} order={sortOrder} onSort={toggleSort}>
                  作者
                </NovelSortButton>
              </TableHead>
              <TableHead scope="col">分类</TableHead>
              <TableHead scope="col">状态</TableHead>
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
              <TableHead scope="col">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={8} className="table-empty">
                  加载中…
                </TableCell>
              </TableRow>
            ) : novels.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="table-empty">
                  {loadError ? `加载失败：${loadError}` : emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              novels.map((n) => (
                <TableRow key={n.id} className={n.id === highlightId ? 'novel-row--highlight' : undefined}>
                  <TableCell data-check="">
                    <Checkbox aria-label={`选择小说：${n.title}`} checked={selected.has(n.id)} onCheckedChange={() => toggleRow(n.id)} />
                  </TableCell>
                  <TableCell data-primary="" data-label="标题">
                    <strong>{n.title}</strong>
                  </TableCell>
                  <TableCell data-label="作者">{n.author}</TableCell>
                  <TableCell data-label="分类">
                    {n.categories && n.categories.length > 0 ? (
                      // 全部标签都渲染，由 CSS 按视口截断显示数量（见
                      // .admin-cell-tags__overflow）。这样桌面与移动可显示不同
                      // 数量，且完整列表对读屏软件仍可见。
                      <span className="admin-cell-tags" title={n.categories.join('、')}>
                        {n.categories.map((c) => (
                          <Badge variant="outline" key={c} className="admin-cell-tags__tag">
                            {c}
                          </Badge>
                        ))}
                        {n.categories.length > 3 && (
                          <span className="admin-cell-tags__overflow" aria-hidden="true">
                            +{n.categories.length - 3}
                          </span>
                        )}
                      </span>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell data-label="状态">
                    <Badge className={n.status === 'completed' ? 'bg-success/10 text-success' : 'bg-info/10 text-info'}>
                      {n.status === 'completed' ? '已完结' : '连载中'}
                    </Badge>
                  </TableCell>
                  <TableCell data-label="章节">
                    {n.chapterCount || 0}
                    {getNewCount(n) > 0 && (
                      <span
                        className="badge-update"
                        title={`源站 ${n.remoteChapterCount || 0} 章 / 本地 ${n.chapterCount || 0} 章${n.updateCheckedAt ? `，检查于 ${timeAgo(n.updateCheckedAt)}` : ''}`}
                      >
                        +{getNewCount(n)}
                      </span>
                    )}
                  </TableCell>
                  <TableCell data-label="更新" className="text-sm text-muted">
                    {timeAgo(n.updatedAt)}
                  </TableCell>
                  <TableCell data-actions="">
                    <div className="admin-cell-actions">
                      <Button asChild variant="ghost" size="icon" className="admin-icon-button" aria-label={`阅读：${n.title}`} title="阅读">
                        <Link to={`/novel/${encodeURIComponent(n.id)}`}>
                          <BookOpen className="size-4" />
                        </Link>
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
                      <Button
                        variant="ghost"
                        size="icon"
                        className="admin-icon-button admin-icon-button--danger"
                        aria-label={`删除：${n.title}`}
                        title="删除"
                        onClick={() => void handleDelete(n)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </AdminDataPanel>

      <Pagination page={page} totalPages={totalPages} onPage={setPage} />

      <Dialog
        open={modalOpen}
        onOpenChange={(open) => {
          if (!open) closeModal()
        }}
      >
        <DialogContent className="admin-dialog novel-editor-dialog sm:max-w-[540px]">
          <DialogHeader>
            <DialogTitle className="editor-modal__title">{editing ? '编辑小说' : '添加小说'}</DialogTitle>
          </DialogHeader>
          <div className="admin-dialog__body">
            <div className="novel-editor__grid">
              <div className="form-group novel-editor__field novel-editor__field--wide">
                <Label htmlFor="novel-title">标题</Label>
                <Input
                  id="novel-title"
                  type="text"
                  placeholder="小说标题"
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                />
              </div>
              <div className="form-group novel-editor__field">
                <Label htmlFor="novel-author">作者</Label>
                <Input
                  id="novel-author"
                  type="text"
                  placeholder="作者名"
                  value={draft.author}
                  onChange={(e) => setDraft({ ...draft, author: e.target.value })}
                />
              </div>
              <div className="form-group novel-editor__field">
                <Label id="novel-status-label">状态</Label>
                <CustomSelect
                  aria-labelledby="novel-status-label"
                  options={STATUS_OPTIONS}
                  value={draft.status}
                  onChange={(v) => setDraft({ ...draft, status: v })}
                />
              </div>
              <div className="form-group novel-editor__field novel-editor__field--wide">
                <Label htmlFor="novel-description">简介</Label>
                <Textarea
                  id="novel-description"
                  rows={5}
                  className="min-h-[150px]"
                  placeholder="小说简介…"
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                />
              </div>
              <div className="form-group novel-editor__field novel-editor__field--wide">
                <Label htmlFor="novel-cover-url">来源封面 URL</Label>
                <Input
                  id="novel-cover-url"
                  type="url"
                  placeholder="https://..."
                  value={draft.coverUrl}
                  onChange={(e) => setDraft({ ...draft, coverUrl: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">外部来源封面地址；AI 生成或本地上传的当前封面保存在封面库中，此处会保持为空</p>
              </div>
              <div className="form-group novel-editor__field">
                <Label htmlFor="novel-categories">分类</Label>
                <Input
                  id="novel-categories"
                  type="text"
                  placeholder="玄幻, 修真, 仙侠"
                  value={draft.categories}
                  onChange={(e) => setDraft({ ...draft, categories: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">多个分类用逗号分隔</p>
              </div>
              <div className="form-group novel-editor__field">
                <Label htmlFor="novel-source-url">源网址</Label>
                <Input
                  id="novel-source-url"
                  type="url"
                  placeholder="https://..."
                  value={draft.sourceUrl}
                  onChange={(e) => setDraft({ ...draft, sourceUrl: e.target.value })}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={closeModal}>
              取消
            </Button>
            <Button onClick={() => void handleSave()}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminPage>
  )
}
