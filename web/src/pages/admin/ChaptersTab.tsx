/**
 * 章节管理 tab —— 选书下拉（全库索引）、章节 CRUD、批量删除、按序融合章节名。
 * 由 Novel-KV js/admin-chapters.js 平移。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useToast, useConfirm } from '../../components/feedback'
import CustomSelect from '../../components/admin/CustomSelect'
import Pagination from '../../components/admin/Pagination'
import { adminApi, chaptersApi } from '../../lib/api'
import { timeAgo } from '../../lib/format'
import type { ChapterMeta } from '@shared/types'
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
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { Pencil, Trash2 } from 'lucide-react'
import AdminPage from '@/components/admin/AdminPage'

const PAGE_SIZE = 50

interface IndexNovel {
  id: string
  title: string
  author: string
  chapterCount: number
}

interface ChapterDraft {
  order: number
  title: string
  content: string
}

export default function ChaptersTab(_props: { highlightNovelId?: string; onHighlightConsumed?: () => void }) {
  const { toast } = useToast()
  const { confirm } = useConfirm()

  const [novelOptions, setNovelOptions] = useState<IndexNovel[]>([])
  const [selectedNovel, setSelectedNovel] = useState('')
  const [chapters, setChapters] = useState<ChapterMeta[]>([])
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [modal, setModal] = useState<{ open: boolean; chapter: ChapterMeta | null; loading: boolean }>({ open: false, chapter: null, loading: false })
  const [draft, setDraft] = useState<ChapterDraft>({ order: 1, title: '', content: '' })
  const [renameModal, setRenameModal] = useState(false)
  const [renameTitles, setRenameTitles] = useState('')
  const [renamePreview, setRenamePreview] = useState<Array<{ order: number; oldTitle: string; newTitle: string }> | null>(null)
  const [renaming, setRenaming] = useState(false)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 小说下拉：全库紧凑索引 + 服务端补搜
  useEffect(() => {
    let alive = true
    adminApi
      .novelIndex({ limit: '2000' })
      .then((data) => {
        if (!alive) return
        const list = (data as { novels?: IndexNovel[] }).novels || []
        setNovelOptions(list)
      })
      .catch(() => {
        /* 索引失败：下拉留空，走服务端补搜 */
      })
    return () => {
      alive = false
    }
  }, [])

  const novelFilter = useCallback(
    (o: { value: string; label: string }, q: string) => {
      const item = novelOptions.find((n) => n.id === o.value)
      return item ? item.title.toLowerCase().includes(q) || item.author.toLowerCase().includes(q) : o.label.toLowerCase().includes(q)
    },
    [novelOptions],
  )

  const loadChapters = useCallback(async (novelId: string) => {
    try {
      const data = await chaptersApi.list(novelId)
      setChapters(data.chapters || [])
      setSelectedIds(new Set())
    } catch {
      setChapters([])
      toast('章节列表加载失败，请检查网络', 'error')
    }
  }, [toast])

  function pickNovel(id: string) {
    setSelectedNovel(id)
    setPage(1)
    setSearch('')
    if (id) void loadChapters(id)
  }

  // 服务端补搜：本地索引无命中时
  const handleNovelServerSearch = useCallback(async (q: string) => {
    try {
      const data = await adminApi.novelIndex({ q, limit: '50' })
      const list = ((data as { novels?: IndexNovel[] }).novels || []).filter((n) => !novelOptions.some((x) => x.id === n.id))
      if (list.length) setNovelOptions((prev) => [...prev, ...list])
    } catch {
      /* ignore */
    }
  }, [novelOptions])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return chapters
    return chapters.filter((c) => c.title.toLowerCase().includes(q) || String(c.order).startsWith(q))
  }, [chapters, search])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  // 搜索防抖
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => setPage(1), 250)
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current)
    }
  }, [search])

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    const pageIds = pageRows.map((c) => c.id)
    const allSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id))
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (allSelected) pageIds.forEach((id) => next.delete(id))
      else pageIds.forEach((id) => next.add(id))
      return next
    })
  }

  async function openChapterModal(chapter: ChapterMeta | null) {
    setModal({ open: true, chapter, loading: false })
    if (chapter) {
      setDraft({ order: chapter.order, title: chapter.title, content: '' })
      setModal({ open: true, chapter, loading: true })
      try {
        const data = await chaptersApi.get(chapter.id)
        const full = (data as { chapter?: { content?: string } }).chapter || (data as { content?: string })
        setDraft({ order: chapter.order, title: chapter.title, content: full.content || '' })
      } catch {
        /* 保持标题/序号编辑 */
      } finally {
        setModal((m) => (m.open ? { ...m, loading: false } : m))
      }
    } else {
      setDraft({ order: chapters.length + 1, title: '', content: '' })
    }
  }

  async function saveChapter() {
    if (!selectedNovel) {
      toast('请先选择小说', 'error')
      return
    }
    if (!draft.title.trim()) {
      toast('请选择小说并填写标题', 'error')
      return
    }
    try {
      if (modal.chapter) {
        await chaptersApi.update(modal.chapter.id, { novelId: selectedNovel, title: draft.title.trim(), content: draft.content, order: draft.order })
        toast('章节已更新', 'success')
      } else {
        await chaptersApi.create({ novelId: selectedNovel, title: draft.title.trim(), content: draft.content, order: draft.order })
        toast('章节已创建', 'success')
      }
      setModal({ open: false, chapter: null, loading: false })
      void loadChapters(selectedNovel)
    } catch (err) {
      toast((err as Error).message || '保存失败', 'error')
    }
  }

  async function deleteChapter(chapter: ChapterMeta) {
    const ok = await confirm({
      title: '删除章节',
      message: '确定删除该章节？此操作不可恢复。',
      okText: '删除',
      danger: true,
      items: [chapter.title ? `第${chapter.order}章 ${chapter.title}` : chapter.id.slice(0, 8)],
    })
    if (!ok) return
    try {
      await chaptersApi.remove(chapter.id)
      toast('章节已删除', 'success')
      void loadChapters(selectedNovel)
    } catch (err) {
      toast((err as Error).message || '删除失败', 'error')
    }
  }

  async function batchDelete() {
    if (selectedIds.size === 0) {
      toast('请先勾选要删除的章节', 'error')
      return
    }
    const items = chapters.filter((c) => selectedIds.has(c.id)).map((c) => `第${c.order}章 ${c.title}`)
    const ok = await confirm({
      title: '批量删除章节',
      message: `确定删除以下 ${selectedIds.size} 个章节？此操作不可撤销。`,
      okText: '确认删除',
      danger: true,
      items: items.slice(0, 50),
    })
    if (!ok) return
    try {
      await chaptersApi.batchDelete(selectedNovel, [...selectedIds])
      toast(`成功删除 ${selectedIds.size} 个章节`, 'success')
      void loadChapters(selectedNovel)
    } catch (err) {
      toast((err as Error).message || '批量删除失败', 'error')
    }
  }

  async function previewRename() {
    if (!selectedNovel) {
      toast('请先选择小说', 'error')
      return
    }
    const titles = renameTitles.split('\n').map((t) => t.trim()).filter(Boolean)
    if (!titles.length) {
      toast('请粘贴章节标题（每行一个）', 'error')
      return
    }
    setRenaming(true)
    try {
      const data = await chaptersApi.renameByOrder({ novelId: selectedNovel, titles, onlyWeakTitles: true, dryRun: true })
      const res = data as unknown as { changes?: Array<{ order: number; oldTitle: string; newTitle: string }> }
      setRenamePreview(res.changes || [])
    } catch (err) {
      toast((err as Error).message || '预览失败', 'error')
    } finally {
      setRenaming(false)
    }
  }

  async function applyRename() {
    if (!renamePreview?.length) {
      toast('请先预览', 'error')
      return
    }
    const titles = renameTitles.split('\n').map((t) => t.trim()).filter(Boolean)
    setRenaming(true)
    try {
      const data = await chaptersApi.renameByOrder({ novelId: selectedNovel, titles, onlyWeakTitles: true, dryRun: false })
      const res = data as unknown as { updated?: number }
      toast(`已更新 ${res.updated || 0} 个章节名`, 'success')
      setRenameModal(false)
      setRenamePreview(null)
      void loadChapters(selectedNovel)
    } catch (err) {
      toast((err as Error).message || '更新失败', 'error')
    } finally {
      setRenaming(false)
    }
  }

  const pageAllSelected = pageRows.length > 0 && pageRows.every((c) => selectedIds.has(c.id))
  const pageSomeSelected = pageRows.some((c) => selectedIds.has(c.id))

  return (
    <AdminPage title="章节管理" meta={
          selectedNovel || selectedIds.size > 0
            ? <>{selectedNovel ? (search ? `匹配 ${filtered.length} / 共 ${chapters.length} 章` : `共 ${chapters.length} 章`) : ''}{selectedIds.size > 0 ? ` · 已选 ${selectedIds.size}` : ''}</>
            : undefined
        }
      >

      <div className="form-row chapter-novel-row">
        <Label>选择小说</Label>
        <CustomSelect
          className="chapter-novel-select"
          searchable
          searchPlaceholder="搜索书名 / 拼音…"
          placeholder="请选择小说"
          options={novelOptions.map((n) => ({
            value: n.id,
            label: n.title,
            sub: `${n.author || '未知作者'} · ${n.chapterCount}章`,
          }))}
          value={selectedNovel}
          onChange={pickNovel}
          filter={(o, q) => novelFilter(o, q)}
          onServerSearch={handleNovelServerSearch}
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="chapter-toolbar" aria-live="polite">
          <Input
            type="text"
            className="chapter-toolbar__search admin-input--compact"
            data-admin-search
            placeholder="搜索章节标题…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="chapter-toolbar__actions">
            {selectedIds.size > 0 ? (
              <>
                <span className="chapter-toolbar__count text-sm text-muted-foreground tabular-nums">已选 {selectedIds.size} 章</span>
                <Button variant="secondary" size="sm" onClick={() => setSelectedIds((prev) => {
                  const pageIds = pageRows.map((c) => c.id)
                  const next = new Set(prev)
                  pageIds.forEach((id) => (next.has(id) ? next.delete(id) : next.add(id)))
                  return next
                })}>
                  反选
                </Button>
                <Button variant="destructive" size="sm" onClick={() => void batchDelete()}>
                  批量删除 ({selectedIds.size})
                </Button>
              </>
            ) : (
              <>
                <Button variant="secondary" size="sm" onClick={() => setRenameModal(true)} disabled={!selectedNovel}>
                  融合章节名
                </Button>
                <Button size="sm" onClick={() => void openChapterModal(null)}>
                  添加章节
                </Button>
              </>
            )}
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <Checkbox
                  checked={pageAllSelected ? true : pageSomeSelected ? 'indeterminate' : false}
                  onCheckedChange={toggleAll}
                />
              </TableHead>
              <TableHead>序号</TableHead>
              <TableHead>章节标题</TableHead>
              <TableHead>字数</TableHead>
              <TableHead>创建时间</TableHead>
              <TableHead>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!selectedNovel ? (
              <TableRow>
                <TableCell colSpan={6} className="table-empty">
                  请先选择小说
                </TableCell>
              </TableRow>
            ) : pageRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="table-empty">
                  {search ? '没有匹配的章节' : '暂无章节'}
                </TableCell>
              </TableRow>
            ) : (
              pageRows.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <Checkbox checked={selectedIds.has(c.id)} onCheckedChange={() => toggleSelect(c.id)} />
                  </TableCell>
                  <TableCell>{c.order || '—'}</TableCell>
                  <TableCell>{c.title}</TableCell>
                  <TableCell>{c.wordCount || '—'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{timeAgo(c.createdAt)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" title="编辑" onClick={() => void openChapterModal(c)}>
                        <Pencil className="size-4" />
                      </Button>
                      <Button variant="ghost" size="icon" title="删除" onClick={() => void deleteChapter(c)}>
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

      <Pagination page={currentPage} totalPages={totalPages} onPage={setPage} />

      <Dialog open={modal.open} onOpenChange={(open) => { if (!open) setModal({ open: false, chapter: null, loading: false }) }}>
        <DialogContent className="admin-dialog sm:max-w-[540px]">
          <DialogHeader>
            <DialogTitle>{modal.chapter ? '编辑章节' : '添加章节'}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 overflow-y-auto max-h-[70vh]">
            <Label>序号</Label>
            <Input
              type="number"
              min={1}
              value={draft.order}
              onChange={(e) => setDraft({ ...draft, order: Number.parseInt(e.target.value, 10) || 1 })}
            />
            <Label>章节标题</Label>
            <Input value={draft.title} placeholder="章节标题" onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            <Label>正文</Label>
            {modal.loading ? (
              <div className="loading-center">
                <div className="spinner"></div>
              </div>
            ) : (
              <Textarea rows={14} className="min-h-[300px]" value={draft.content} placeholder="章节正文…" onChange={(e) => setDraft({ ...draft, content: e.target.value })} />
            )}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setModal({ open: false, chapter: null, loading: false })}>
              取消
            </Button>
            <Button disabled={modal.loading} onClick={() => void saveChapter()}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={renameModal} onOpenChange={(open) => { if (!open) { setRenameModal(false); setRenamePreview(null) } }}>
        <DialogContent className="admin-dialog sm:max-w-[540px]">
          <DialogHeader>
            <DialogTitle>融合章节名</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 overflow-y-auto max-h-[70vh]">
            <p className="text-sm text-muted-foreground">将源站章节标题（每行一个）按顺序替换本地弱标题（如「第1章」「正文」等占位标题）。</p>
            <Label>源站章节标题</Label>
            <Textarea
              rows={8}
              className="min-h-[120px]"
              placeholder={'第一章 起点\n第二章 转折\n第三章 真相…'}
              value={renameTitles}
              onChange={(e) => {
                setRenameTitles(e.target.value)
                setRenamePreview(null)
              }}
            />
            {renamePreview && (
              <div className="rename-preview">
                {renamePreview.length === 0 ? (
                  <p className="text-sm text-muted-foreground">没有可更新的弱标题。</p>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground">将更新 {renamePreview.length} 个章节名：</p>
                    <div className="import-chapter-preview__list">
                      {renamePreview.slice(0, 80).map((r) => (
                        <div className="import-chapter-preview__item" key={r.order}>
                          <span className="text-muted-foreground">{r.order}.</span>
                          <span className="old-title">{r.oldTitle}</span>
                          <span className="arrow">→</span>
                          <span className="new-title">{r.newTitle}</span>
                        </div>
                      ))}
                      {renamePreview.length > 80 && <p className="text-sm text-muted-foreground">另有 {renamePreview.length - 80} 章未显示…</p>}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setRenameModal(false)}>
              取消
            </Button>
            {renamePreview ? (
              <Button disabled={renaming || renamePreview.length === 0} onClick={() => void applyRename()}>
                {renaming ? '更新中…' : '确认更新'}
              </Button>
            ) : (
              <Button variant="secondary" disabled={renaming} onClick={() => void previewRename()}>
                {renaming ? '预览中…' : '预览'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminPage>
  )
}
