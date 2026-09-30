/**
 * 章节管理 tab —— 选书下拉（全库索引）、章节 CRUD、批量删除、按源站映射融合章节名。
 * 由 Novel-KV js/admin-chapters.js 平移。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useToast, useConfirm } from '../../components/feedback'
import CustomSelect from '../../components/admin/CustomSelect'
import Pagination from '../../components/admin/Pagination'
import { ADMIN_DEFAULT_PAGE_SIZE, ADMIN_PAGE_SIZE_OPTIONS } from '@/lib/admin-pagination'
import { getAdminTableRowStaggerDelay } from '@/lib/admin-table-motion'
import { useDialogFocus, useDialogHotkeys } from '@/hooks/useDialogHotkeys'
import { adminApi, chaptersApi, newOperationId, scrapeApi, type SourceSyncPreview, type TitleSource, type TitleSourceSearchResponse } from '../../lib/api'
import { timeAgo } from '../../lib/format'
import type { ChapterMeta } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { Pencil, Trash2 } from 'lucide-react'
import AdminPage from '@/components/admin/AdminPage'
import AdminRowActions from '@/components/admin/AdminRowActions'
import AdminSelectionBar from '@/components/admin/AdminSelectionBar'
import { AdminDataPanel, AdminCellText, AdminSearch, AdminToolbar, type AdminColumn } from '@/components/admin/AdminWorkspace'

const CHAPTER_COLUMNS: readonly AdminColumn[] = [
  { key: 'check', width: '8%' },
  { key: 'order', label: '序号', width: '11%' },
  { key: 'title', label: '章节标题', width: '38%', primary: true },
  { key: 'wordCount', label: '字数', width: '13%' },
  { key: 'createdAt', label: '创建时间', width: '17%' },
  { key: 'actions', label: '操作', width: '13%', actions: true },
]

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
  const [pageSize, setPageSize] = useState(ADMIN_DEFAULT_PAGE_SIZE)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [modal, setModal] = useState<{ open: boolean; chapter: ChapterMeta | null; loading: boolean }>({ open: false, chapter: null, loading: false })
  // 提交中标志：与 Ctrl+Enter 快捷键共用，防止正文较长时重复提交。
  const [chapterSaving, setChapterSaving] = useState(false)
  const [draft, setDraft] = useState<ChapterDraft>({ order: 1, title: '', content: '' })
  const [renameModal, setRenameModal] = useState(false)
  const [sourceUrl, setSourceUrl] = useState('')
  const [sourcePreview, setSourcePreview] = useState<SourceSyncPreview | null>(null)
  const [sourceSearch, setSourceSearch] = useState<TitleSourceSearchResponse | null>(null)
  const [sourceSearchTitle, setSourceSearchTitle] = useState('')
  const [sourceSearchAuthor, setSourceSearchAuthor] = useState('')
  const [sourceSearching, setSourceSearching] = useState(false)
  const [sourceMetadataFields, setSourceMetadataFields] = useState<string[]>(['title', 'author', 'description', 'coverUrl', 'categories', 'status'])
  const [sourceMetadataMode, setSourceMetadataMode] = useState<'missing' | 'replace'>('missing')
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

  const novelSelectOptions = useMemo(
    () => novelOptions.map((n) => ({ value: n.id, label: n.title, sub: `${n.author || '未知作者'} · ${n.chapterCount}章` })),
    [novelOptions],
  )

  const novelById = useMemo(() => new Map(novelOptions.map((novel) => [novel.id, novel])), [novelOptions])

  const novelFilter = useCallback(
    (o: { value: string; label: string }, q: string) => {
      const item = novelById.get(o.value)
      return item ? item.title.toLowerCase().includes(q) || item.author.toLowerCase().includes(q) : o.label.toLowerCase().includes(q)
    },
    [novelById],
  )

  const selectedNovelInfo = useMemo(() => novelOptions.find((novel) => novel.id === selectedNovel) || null, [novelOptions, selectedNovel])

  const loadChapters = useCallback(
    async (novelId: string) => {
      try {
        const data = await chaptersApi.list(novelId)
        setChapters(data.chapters || [])
        setSelectedIds(new Set())
      } catch {
        setChapters([])
        toast('章节列表加载失败，请检查网络', 'error')
      }
    },
    [toast],
  )

  function pickNovel(id: string) {
    setSelectedNovel(id)
    setPage(1)
    setSearch('')
    if (id) void loadChapters(id)
  }

  // 服务端补搜：本地索引无命中时
  const handleNovelServerSearch = useCallback(
    async (q: string) => {
      try {
        const data = await adminApi.novelIndex({ q, limit: '50' })
        const list = ((data as { novels?: IndexNovel[] }).novels || []).filter((n) => !novelOptions.some((x) => x.id === n.id))
        if (list.length) setNovelOptions((prev) => [...prev, ...list])
      } catch {
        /* ignore */
      }
    },
    [novelOptions],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return chapters
    return chapters.filter((c) => c.title.toLowerCase().includes(q) || String(c.order).startsWith(q))
  }, [chapters, search])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)

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

  /**
   * 关闭章节编辑弹窗。
   * 三处调用点（保存成功、Esc/遮罩关闭、取消按钮）此前各写一遍 setModal，
   * 且都没有复位 chapterSaving——用户若在请求飞行中关掉弹窗，残留的
   * 提交态会让下次打开直接是禁用的「保存中…」。收成一个入口后，
   * 复位只可能漏一次。
   */
  function closeChapterModal() {
    setModal({ open: false, chapter: null, loading: false })
    setChapterSaving(false)
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
    if (chapterSaving) return
    if (!selectedNovel) {
      toast('请先选择小说', 'error')
      return
    }
    if (!draft.title.trim()) {
      toast('请选择小说并填写标题', 'error')
      return
    }
    setChapterSaving(true)
    try {
      if (modal.chapter) {
        await chaptersApi.update(modal.chapter.id, { novelId: selectedNovel, title: draft.title.trim(), content: draft.content, order: draft.order })
        toast('章节已更新', 'success')
      } else {
        await chaptersApi.create({ novelId: selectedNovel, title: draft.title.trim(), content: draft.content, order: draft.order })
        toast('章节已创建', 'success')
      }
      closeChapterModal()
      void loadChapters(selectedNovel)
    } catch (err) {
      toast((err as Error).message || '保存失败', 'error')
    } finally {
      setChapterSaving(false)
    }
  }

  // 章节弹窗键盘路径：Ctrl/Cmd + Enter 提交（正文换行仍走裸 Enter，不冲突）；
  // 正文加载中时关闭，避免把未取回的内容写回覆盖源文。
  useDialogHotkeys({ open: modal.open, onSubmit: saveChapter, submitting: chapterSaving, enabled: !modal.loading })
  useDialogFocus(modal.open, '.chapter-editor-dialog__fields [data-slot="input"]')

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
    const chapterIds = chapters
      .filter((c) => selectedIds.has(c.id))
      .map((c) => c.id)
      .filter(Boolean)
      .sort()
    if (!chapterIds.length) {
      toast('确认时目标章节已不在当前列表，请刷新后重试', 'error')
      return
    }
    const items = chapters.filter((c) => chapterIds.includes(c.id)).map((c) => `第${c.order}章 ${c.title}`)
    const ok = await confirm({
      title: '批量删除章节',
      message: `确定删除以下 ${selectedIds.size} 个章节？此操作不可撤销。`,
      okText: '确认删除',
      danger: true,
      items: items.slice(0, 50),
    })
    if (!ok) return
    try {
      await chaptersApi.batchDelete(selectedNovel, chapterIds, newOperationId('batch-delete-chapters'))
      toast(`成功删除 ${chapterIds.length} 个章节`, 'success')
      void loadChapters(selectedNovel)
    } catch (err) {
      toast((err as Error).message || '批量删除失败', 'error')
    }
  }

  async function openRenameModal() {
    setRenameModal(true)
    setSourcePreview(null)
    setSourceSearch(null)
    setSourceUrl('')
    setSourceSearchTitle(selectedNovelInfo?.title || '')
    setSourceSearchAuthor(selectedNovelInfo?.author || '')
    if (!selectedNovel) return
    try {
      const result = await scrapeApi.sourceBindings(selectedNovel)
      const primary = result.bindings.find((binding) => binding.isPrimary === true) || result.bindings[0]
      if (primary?.sourceUrl) setSourceUrl(String(primary.sourceUrl))
    } catch {
      /* 没有绑定源站时保持空输入，允许手动粘贴 */
    }
  }

  async function searchSourceSites() {
    const title = sourceSearchTitle.trim()
    const author = sourceSearchAuthor.trim()
    if (!title && !author) {
      toast('请填写书名或作者后再搜索', 'error')
      return
    }
    setSourceSearching(true)
    setSourceSearch(null)
    try {
      setSourceSearch(await scrapeApi.titleSourceSearch(title, author))
    } catch (err) {
      toast((err as Error).message || '源站搜索失败', 'error')
    } finally {
      setSourceSearching(false)
    }
  }

  async function previewSourceSync(selectedSourceUrl = sourceUrl) {
    if (!selectedNovel) {
      toast('请先选择小说', 'error')
      return
    }
    const url = selectedSourceUrl.trim()
    if (!url) {
      toast('请填写原作者源站 URL', 'error')
      return
    }
    setSourceUrl(url)
    setRenaming(true)
    try {
      const result = await scrapeApi.sourceSyncPreview({ novelId: selectedNovel, sourceUrl: url, onlyWeakTitles: true })
      setSourcePreview(result)
    } catch (err) {
      toast((err as Error).message || '源站读取失败', 'error')
    } finally {
      setRenaming(false)
    }
  }

  function sourceResults(site: string): TitleSource[] {
    return sourceSearch?.sources?.[site]?.results || []
  }

  async function applyRename() {
    if (!sourcePreview) {
      toast('请先读取源站', 'error')
      return
    }
    const confirmedChangeIds = sourcePreview.changes
      .filter((change) => change.eligible)
      .map((change) => change.localChapterId)
      .filter(Boolean)
      .sort()
    const ok = await confirm({
      title: '确认应用源站同步？',
      message: `将更新确认快照中的 ${confirmedChangeIds.length} 个章节标题${sourceMetadataMode === 'replace' ? '，并覆盖已选小说信息' : ''}。`,
      items: [
        `目标快照：${confirmedChangeIds.length} 个章节`,
        sourceMetadataMode === 'replace' ? '小说信息将按已勾选字段覆盖' : '小说信息只补全空字段',
        '未标记为可自动更新的标题不会被改动',
      ],
      okText: '确认更新',
      cancelText: '取消',
      danger: sourceMetadataMode === 'replace',
    })
    if (!ok) return
    setRenaming(true)
    try {
      const result = await scrapeApi.sourceSyncApply({
        runId: sourcePreview.runId,
        applyMetadata: sourceMetadataFields.length > 0,
        metadataFields: sourceMetadataFields,
        metadataMode: sourceMetadataMode,
        confirmedChangeIds,
        operationId: newOperationId('source-sync-apply'),
      })
      const parts = [`已更新 ${result.updated} 个章节名`]
      if (result.metadataUpdated.length) parts.push(`补充 ${result.metadataUpdated.length} 项小说信息`)
      toast(parts.join('，'), 'success')
      setRenameModal(false)
      setSourcePreview(null)
      void loadChapters(selectedNovel)
    } catch (err) {
      toast((err as Error).message || '同步应用失败', 'error')
    } finally {
      setRenaming(false)
    }
  }

  const pageAllSelected = pageRows.length > 0 && pageRows.every((c) => selectedIds.has(c.id))
  const pageSomeSelected = pageRows.some((c) => selectedIds.has(c.id))

  return (
    <AdminPage
      className="admin-redesign-page admin-redesign-page--chapters"
      title="章节管理"
      description="按作品维护目录与正文，搜索和批量操作只作用于当前作品。"
      meta={
        selectedNovel ? (search ? `匹配 ${filtered.length} / 共 ${chapters.length} 章` : `共 ${chapters.length} 章`) : `${novelOptions.length || '—'} 部作品`
      }
      actions={
        <>
          <CustomSelect
            className="chapter-novel-select"
            searchable
            searchPlaceholder="搜索书名 / 拼音…"
            placeholder="请选择小说"
            options={novelSelectOptions}
            value={selectedNovel}
            onChange={pickNovel}
            filter={novelFilter}
            onServerSearch={handleNovelServerSearch}
          />
          <Button onClick={() => void openChapterModal(null)} disabled={!selectedNovel}>
            <span aria-hidden="true">＋</span>
            添加章节
          </Button>
        </>
      }
    >
      {selectedNovel && (
        <AdminToolbar layout="inline" className="chapter-toolbar" ariaLive="polite">
          <div className="chapter-toolbar__search">
            <AdminSearch
              id="chapter-search"
              label="搜索章节"
              type="text"
              placeholder="搜索章节标题…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="chapter-toolbar__actions">
            {selectedIds.size === 0 && (
              <Button variant="secondary" size="sm" onClick={() => void openRenameModal()}>
                融合章节名
              </Button>
            )}
          </div>
        </AdminToolbar>
      )}
      {selectedNovel && selectedIds.size > 0 && (
        <AdminSelectionBar count={selectedIds.size} label={`已选 ${selectedIds.size} 章`} onClear={() => setSelectedIds(new Set())}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              setSelectedIds((prev) => {
                const pageIds = pageRows.map((c) => c.id)
                const next = new Set(prev)
                pageIds.forEach((id) => (next.has(id) ? next.delete(id) : next.add(id)))
                return next
              })
            }
          >
            反选本页
          </Button>
          <Button variant="destructive" size="sm" onClick={() => void batchDelete()}>
            批量删除 ({selectedIds.size})
          </Button>
        </AdminSelectionBar>
      )}
      <AdminDataPanel className="chapter-directory-panel" ariaLabel="章节目录数据" columns={CHAPTER_COLUMNS}>
        <Table>
          <TableCaption className="sr-only">章节目录列表，包含序号、章节标题、字数、创建时间和操作</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">
                <Checkbox
                  aria-label="选择当前页全部章节"
                  disabled={!selectedNovel || pageRows.length === 0}
                  checked={pageAllSelected ? true : pageSomeSelected ? 'indeterminate' : false}
                  onCheckedChange={toggleAll}
                />
              </TableHead>
              <TableHead scope="col">序号</TableHead>
              <TableHead scope="col">章节标题</TableHead>
              <TableHead scope="col">字数</TableHead>
              <TableHead scope="col">创建时间</TableHead>
              <TableHead scope="col">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody key={pageSize}>
            {!selectedNovel ? (
              <TableRow>
                <TableCell colSpan={CHAPTER_COLUMNS.length} className="table-empty">
                  先选择一本小说以查看章节目录。
                </TableCell>
              </TableRow>
            ) : pageRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={CHAPTER_COLUMNS.length} className="table-empty">
                  {search ? '没有匹配的章节，换一个标题或序号试试。' : '当前小说还没有章节，可以选择“添加章节”创建第一章。'}
                </TableCell>
              </TableRow>
            ) : (
              pageRows.map((c, index) => (
                <TableRow key={c.id} style={{ animationDelay: `${getAdminTableRowStaggerDelay(index, pageRows.length)}ms` }}>
                  <TableCell data-check="">
                    <Checkbox aria-label={`选择章节：第${c.order}章 ${c.title}`} checked={selectedIds.has(c.id)} onCheckedChange={() => toggleSelect(c.id)} />
                  </TableCell>
                  <TableCell data-label="序号">{c.order || <span className="admin-empty-value">—</span>}</TableCell>
                  <TableCell data-primary="" data-label="章节标题">
                    <AdminCellText strong>{c.title || '—'}</AdminCellText>
                  </TableCell>
                  <TableCell data-label="字数">{c.wordCount ? c.wordCount.toLocaleString('zh-CN') : <span className="admin-empty-value">—</span>}</TableCell>
                  <TableCell data-label="创建时间" className="text-sm text-muted-foreground">
                    {timeAgo(c.createdAt)}
                  </TableCell>
                  <TableCell data-actions="">
                    <AdminRowActions
                      label={`第${c.order}章`}
                      items={[
                        // 编辑是高频主操作，常驻；删除不可逆且低频，收进菜单。
                        { label: '删除章节', icon: Trash2, onSelect: () => void deleteChapter(c), danger: true },
                      ]}
                    >
                      <Button
                        variant="ghost"
                        size="icon"
                        className="admin-icon-button"
                        aria-label={`编辑：第${c.order}章 ${c.title}`}
                        title="编辑"
                        onClick={() => void openChapterModal(c)}
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

      {selectedNovel && pageRows.length > 0 && (
        <Pagination
          variant="detached"
          className="chapters-pagination"
          page={currentPage}
          totalPages={totalPages}
          onPage={setPage}
          summary={
            <>
              共 {filtered.length} 章，显示 {filtered.length === 0 ? 0 : (currentPage - 1) * pageSize + 1}-{Math.min(currentPage * pageSize, filtered.length)}
            </>
          }
          pageSize={{
            value: pageSize,
            // 本地切片分页：改页大小后回第 1 页，避免落在越界区间。
            onChange: (size) => {
              setPageSize(size)
              setPage(1)
            },
            options: ADMIN_PAGE_SIZE_OPTIONS,
          }}
        />
      )}

      <Dialog
        open={modal.open}
        onOpenChange={(open) => {
          if (!open) closeChapterModal()
        }}
      >
        <DialogContent className="admin-dialog chapter-editor-dialog sm:max-w-[620px]">
          <DialogHeader>
            <DialogTitle>{modal.chapter ? '编辑章节' : '添加章节'}</DialogTitle>
            <DialogDescription>
              {modal.chapter ? '修改章节标题或正文，保存后会保留原有顺序与阅读进度。' : '填写新章节内容，保存后会追加到当前小说。'}
            </DialogDescription>
          </DialogHeader>
          <div className="admin-dialog__body chapter-editor-dialog__body flex flex-col gap-3 overflow-y-auto max-h-[70vh]">
            <div className="chapter-dialog-context">
              <span>当前小说</span>
              <strong>{selectedNovelInfo?.title || '未选择小说'}</strong>
            </div>
            <div className="chapter-editor-dialog__fields">
              <div className="chapter-dialog-field">
                <Label>序号</Label>
                <Input type="number" min={1} value={draft.order} onChange={(e) => setDraft({ ...draft, order: Number.parseInt(e.target.value, 10) || 1 })} />
              </div>
              <div className="chapter-dialog-field">
                <Label>章节标题</Label>
                <Input value={draft.title} placeholder="章节标题" onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
              </div>
            </div>
            <section className="chapter-dialog-section">
              <div className="chapter-dialog-section__heading">
                <Label>正文</Label>
                <span>支持直接粘贴排版后的内容</span>
              </div>
              {modal.loading ? (
                <div className="loading-center">
                  <div className="spinner"></div>
                </div>
              ) : (
                <Textarea
                  rows={14}
                  className="chapter-editor-dialog__textarea min-h-[300px]"
                  value={draft.content}
                  placeholder="章节正文…"
                  onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                />
              )}
            </section>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={closeChapterModal} disabled={chapterSaving}>
              取消
            </Button>
            <Button disabled={modal.loading || chapterSaving} onClick={() => void saveChapter()}>
              {chapterSaving ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={renameModal}
        onOpenChange={(open) => {
          if (!open) {
            setRenameModal(false)
            setSourcePreview(null)
            setSourceSearch(null)
          }
        }}
      >
        <DialogContent className="admin-dialog chapter-merge-dialog">
          <DialogHeader>
            <DialogTitle className="editor-modal__title">融合章节名</DialogTitle>
            <DialogDescription>补全弱标题的来源与变化会在这里先确认，正文、顺序和阅读进度不会改变。</DialogDescription>
          </DialogHeader>
          <div className="admin-dialog__body chapter-merge-dialog__body">
            <div className="chapter-merge-dialog__info">
              <div className="chapter-merge-dialog__info-grid">
                <div>
                  <span>当前小说</span>
                  <strong>{selectedNovelInfo?.title || '未选择小说'}</strong>
                </div>
                <div>
                  <span>作者</span>
                  <strong>{selectedNovelInfo?.author || '未知作者'}</strong>
                </div>
                <div>
                  <span>章节</span>
                  <strong>{selectedNovelInfo?.chapterCount || chapters.length} 章</strong>
                </div>
              </div>
              <div className="chapter-merge-dialog__badge">仅更新弱标题</div>
            </div>
            <section className="chapter-merge-dialog__source">
              <div className="chapter-dialog-section__heading">
                <Label>从原作者源站读取</Label>
                <span className="text-muted-foreground">建议优先使用</span>
              </div>
              <div className="chapter-merge-dialog__source-grid grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.72fr)_auto]">
                <Input aria-label="搜索书名" placeholder="书名" value={sourceSearchTitle} onChange={(e) => setSourceSearchTitle(e.target.value)} />
                <Input aria-label="搜索作者" placeholder="作者（可选）" value={sourceSearchAuthor} onChange={(e) => setSourceSearchAuthor(e.target.value)} />
                <Button variant="secondary" disabled={renaming || sourceSearching} onClick={() => void searchSourceSites()}>
                  {sourceSearching ? '搜索中…' : '搜索两处源站'}
                </Button>
              </div>
              {sourceSearch && (
                <div className="chapter-merge-dialog__search-results mt-3 space-y-3">
                  {(['jjwxc', 'po18tw'] as const).map((site) => {
                    const bucket = sourceSearch.sources?.[site]
                    const results = sourceResults(site)
                    const label = site === 'jjwxc' ? '晋江' : 'PO18.tw'
                    return (
                      <div key={site}>
                        <div className="admin-dialog-section-label mb-1 flex items-center justify-between gap-2">
                          <span>{label}</span>
                          <span className="admin-dialog-hint">{results.length ? `${results.length} 个结果` : bucket?.ok ? '没有匹配结果' : '搜索不可用'}</span>
                        </div>
                        {bucket?.error && <p className="mb-2 text-xs text-amber-600">{bucket.error}</p>}
                        {results.length > 0 && (
                          <div className="grid gap-2">
                            {results.map((candidate) => (
                              <button
                                type="button"
                                key={`${candidate.site}-${candidate.bookId || candidate.url}`}
                                className="group rounded-md border border-border bg-background p-2.5 text-left transition-colors hover:border-primary/60 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                onClick={() => void previewSourceSync(candidate.url)}
                                disabled={renaming}
                              >
                                <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
                                  <span>{candidate.title || '未识别书名'}</span>
                                  {candidate.status && (
                                    <span className="text-xs font-normal text-muted-foreground">{candidate.status === 'completed' ? '完结' : '连载'}</span>
                                  )}
                                </span>
                                <span className="mt-1 block truncate text-xs text-muted-foreground">
                                  {candidate.author || '作者未识别'} · {candidate.url}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
              <div className="chapter-merge-dialog__url-field chapter-dialog-field">
                <Label>原作者源站 URL</Label>
                <div className="chapter-merge-dialog__url-row flex gap-2">
                  <Input
                    value={sourceUrl}
                    placeholder="https://www.jjwxc.net/onebook.php?novelid=… 或 https://www.po18.tw/…"
                    onChange={(e) => {
                      setSourceUrl(e.target.value)
                      setSourcePreview(null)
                    }}
                  />
                  <Button variant="secondary" disabled={renaming || !sourceUrl.trim()} onClick={() => void previewSourceSync()}>
                    {renaming ? '读取中…' : '读取源站'}
                  </Button>
                </div>
              </div>
            </section>
            {sourcePreview && (
              <section className="chapter-merge-dialog__preview">
                <div className="chapter-merge-dialog__preview-summary">
                  <div className="flex flex-wrap gap-x-4 gap-y-1 font-medium">
                    <span>{sourcePreview.site === 'jjwxc' ? '晋江' : sourcePreview.site === 'po18tw' ? 'PO18.tw' : sourcePreview.site}</span>
                    <span>源站 {sourcePreview.sourceChapterCount} 章</span>
                    <span>本地 {sourcePreview.localChapterCount} 节</span>
                    {sourcePreview.splitLocalChapterCount > 0 && <span>拆分节 {sourcePreview.splitLocalChapterCount}</span>}
                  </div>
                  <p>
                    已匹配 {sourcePreview.matchedSourceCount} 章；未匹配源站 {sourcePreview.unmatchedSource.length} 章，本地 {sourcePreview.unmatchedLocal.length} 节。
                  </p>
                  {sourcePreview.warnings.map((warning) => (
                    <p className="chapter-merge-dialog__warning" key={warning}>
                      {warning}
                    </p>
                  ))}
                </div>
                <div className="chapter-merge-dialog__preview-section">
                  <Label className="mb-2 block">同步小说信息</Label>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    {(
                      [
                        ['title', '标题', sourcePreview.metadata.title],
                        ['author', '作者', sourcePreview.metadata.author],
                        ['description', '简介', sourcePreview.metadata.description],
                        ['coverUrl', '封面', sourcePreview.metadata.coverUrl],
                        ['categories', '分类', sourcePreview.metadata.categories.join('、')],
                        ['status', '状态', sourcePreview.metadata.status],
                      ] as Array<[string, string, string]>
                    ).map(([field, label, value]) => (
                      <label className="flex min-w-0 items-center gap-2" key={field}>
                        <Checkbox
                          checked={sourceMetadataFields.includes(field)}
                          disabled={!value}
                          onCheckedChange={(checked) =>
                            setSourceMetadataFields((prev) => (checked ? [...new Set([...prev, field])] : prev.filter((item) => item !== field)))
                          }
                        />
                        <span className="min-w-0 break-words">
                          {label}：{value || '未识别'}
                        </span>
                      </label>
                    ))}
                  </div>
                  <label className="mt-3 flex items-center gap-2 text-sm">
                    <Checkbox checked={sourceMetadataMode === 'replace'} onCheckedChange={(checked) => setSourceMetadataMode(checked ? 'replace' : 'missing')} />
                    <span>覆盖已有小说信息（默认只补全空字段）</span>
                  </label>
                </div>
                {sourcePreview.mappings.some((mapping) => mapping.relation === 'split') && (
                  <div className="chapter-merge-dialog__preview-section">
                    <p className="mb-2 font-medium">拆分章节映射</p>
                    {sourcePreview.mappings
                      .filter((mapping) => mapping.relation === 'split')
                      .slice(0, 30)
                      .map((mapping) => (
                        <div className="mb-1" key={mapping.sourceChapterKey}>
                          源站第 {mapping.sourceOrder} 章「{mapping.sourceTitle}」→ 本地 {mapping.localChapterIds.length} 节
                        </div>
                      ))}
                  </div>
                )}
                <div className="chapter-merge-dialog__preview-section chapter-merge-dialog__preview-changes">
                  <p className="text-sm text-muted-foreground">
                    将更新 {sourcePreview.changes.filter((change) => change.eligible).length} 个章节名；另有{' '}
                    {sourcePreview.changes.filter((change) => !change.eligible).length} 个需要人工确认：
                  </p>
                  <div className="import-chapter-preview__list">
                    {sourcePreview.changes.slice(0, 80).map((change) => (
                      <div className="import-chapter-preview__item" key={change.localChapterId}>
                        <span className="text-muted-foreground">{change.localOrder}.</span>
                        <span className="old-title">{change.oldTitle}</span>
                        <span className="arrow">→</span>
                        <span className="new-title">{change.newTitle}</span>
                        {change.partCount > 1 && (
                          <span className="text-xs text-muted-foreground">
                            拆分 {change.partIndex}/{change.partCount}
                          </span>
                        )}
                        {!change.eligible && <span className="text-xs text-amber-600">需确认</span>}
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            )}
          </div>
          <DialogFooter className="chapter-merge-dialog__footer">
            <span className="chapter-merge-dialog__footer-note">
              {sourcePreview ? `已读取 ${sourcePreview.changes.length} 个标题变化` : '只会更新弱标题'}
            </span>
            <Button variant="secondary" onClick={() => setRenameModal(false)}>
              取消
            </Button>
            {sourcePreview && (
              <Button disabled={renaming} onClick={() => void applyRename()}>
                {renaming ? '更新中…' : '确认更新'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminPage>
  )
}
