/**
 * 小说管理 tab —— 小说列表 / 搜索 / 排序 / 分页 / 增删改 / 批量操作。
 * 由 Novel-KV js/admin-novels.js + admin.html #tab-novels 平移。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { novelsApi, url, authHeaders } from '../../lib/api'
import { timeAgo } from '../../lib/format'
import { useConfirm, useToast } from '../../components/feedback'
import CustomSelect from '../../components/admin/CustomSelect'
import Pagination from '../../components/admin/Pagination'
import type { Novel } from '@shared/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableCaption,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { BookOpen, Pencil, Trash2 } from 'lucide-react'
import AdminPage from '@/components/admin/AdminPage'

const PAGE_SIZE = 20

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

  function SortButton({ field, children }: { field: string; children: string }) {
    const active = sortField === field
    return (
      <button
        type="button"
        className="admin-sort-button"
        data-active={active}
        onClick={() => toggleSort(field)}
      >
        {children}
        <span className="admin-sort-caret" aria-hidden="true">{active ? (sortOrder === 'asc' ? '↑' : '↓') : '↕'}</span>
      </button>
    )
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
    const ids = Array.from(selected)
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
      const data = await novelsApi.batchDelete(ids)
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
    <AdminPage kicker="CONTENT CATALOG" title="小说管理" meta={countLabel} actions={
          <div className="novel-toolbar">
            <div className="novel-toolbar__primary">
              <Label htmlFor="novel-search" className="sr-only">搜索小说</Label>
              <Input
                id="novel-search"
                className="novel-toolbar__search"
                type="search"
                data-admin-search
                placeholder="搜索标题、作者或简介"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
              <Button size="sm" onClick={() => openModal(null)}>
                添加小说
              </Button>
            </div>
            {selected.size > 0 && (
              <div className="novel-toolbar__batch" aria-live="polite">
                <span className="novel-toolbar__batch-count">已选 {selected.size} 本</span>
                <div className="batch-actions-group">
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
            )}
          </div>
        }
      >

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <Table>
          <TableCaption className="sr-only">小说目录列表，可按标题、作者、章节数和更新时间排序</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col" className="admin-table__check">
                <Checkbox aria-label="选择当前页全部小说" checked={allChecked} onCheckedChange={handleSelectAll} />
              </TableHead>
              <TableHead scope="col" aria-sort={sortAria('title')}>
                <SortButton field="title">标题</SortButton>
              </TableHead>
              <TableHead scope="col" aria-sort={sortAria('author')}>
                <SortButton field="author">作者</SortButton>
              </TableHead>
              <TableHead scope="col">分类</TableHead>
              <TableHead scope="col">状态</TableHead>
              <TableHead scope="col" aria-sort={sortAria('chapter_count')}>
                <SortButton field="chapter_count">章节</SortButton>
              </TableHead>
              <TableHead scope="col" aria-sort={sortAria('updated_at')}>
                <SortButton field="updated_at">更新</SortButton>
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
                  <TableCell>
                    <Checkbox
                      className="novel-checkbox"
                      aria-label={`选择小说：${n.title}`}
                      checked={selected.has(n.id)}
                      onCheckedChange={() => toggleRow(n.id)}
                    />
                  </TableCell>
                  <TableCell>
                    <strong>{n.title}</strong>
                  </TableCell>
                  <TableCell>{n.author}</TableCell>
                  <TableCell className="admin-category-cell">
                    {n.categories && n.categories.length > 0 ? n.categories.map((c) => <Badge variant="outline" className="mr-1" key={c}>{c}</Badge>) : '—'}
                  </TableCell>
                  <TableCell>
                    <Badge className={n.status === 'completed' ? 'bg-success/10 text-success' : 'bg-info/10 text-info'}>
                      {n.status === 'completed' ? '已完结' : '连载中'}
                    </Badge>
                  </TableCell>
                  <TableCell>
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
                  <TableCell className="text-sm text-muted">{timeAgo(n.updatedAt)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button asChild variant="ghost" size="icon" aria-label={`阅读：${n.title}`} title="阅读">
                        <Link to={`/novel/${encodeURIComponent(n.id)}`}>
                          <BookOpen className="size-4" />
                        </Link>
                      </Button>
                      <Button variant="ghost" size="icon" aria-label={`编辑：${n.title}`} title="编辑" onClick={() => openModal(n)}>
                        <Pencil className="size-4" />
                      </Button>
                      <Button variant="ghost" size="icon" aria-label={`删除：${n.title}`} title="删除" onClick={() => void handleDelete(n)}>
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Pagination page={page} totalPages={totalPages} onPage={setPage} />

      <Dialog open={modalOpen} onOpenChange={(open) => { if (!open) closeModal() }}>
        <DialogContent className="admin-dialog sm:max-w-[540px]">
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
                <CustomSelect aria-labelledby="novel-status-label" options={STATUS_OPTIONS} value={draft.status} onChange={(v) => setDraft({ ...draft, status: v })} />
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
                <Label htmlFor="novel-cover-url">封面 URL</Label>
                <Input
                  id="novel-cover-url"
                  type="url"
                  placeholder="https://..."
                  value={draft.coverUrl}
                  onChange={(e) => setDraft({ ...draft, coverUrl: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">保存时由服务器在后台缓存封面图</p>
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
            <Button onClick={() => void handleSave()}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminPage>
  )
}
