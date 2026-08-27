/**
 * 章节管理 tab —— 选书下拉（全库索引）、章节 CRUD、批量删除、按序融合章节名。
 * 由 Novel-KV js/admin-chapters.js 平移。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useToast, useConfirm } from '../../components/feedback'
import CustomSelect from '../../components/admin/CustomSelect'
import Pagination from '../../components/admin/Pagination'
import { adminApi, chaptersApi, scrapeApi, type SourceSyncPreview, type TitleSource, type TitleSourceSearchResponse } from '../../lib/api'
import { timeAgo } from '../../lib/format'
import type { ChapterMeta } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
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
  const navigate = useNavigate()

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

  const novelFilter = useCallback(
    (o: { value: string; label: string }, q: string) => {
      const item = novelOptions.find((n) => n.id === o.value)
      return item ? item.title.toLowerCase().includes(q) || item.author.toLowerCase().includes(q) : o.label.toLowerCase().includes(q)
    },
    [novelOptions],
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

  const chapterStats = useMemo(() => {
    const ordered = chapters.filter((chapter) => Number.isFinite(chapter.order) && chapter.order > 0).length
    const totalWords = chapters.reduce((sum, chapter) => sum + (Number.isFinite(chapter.wordCount) ? chapter.wordCount : 0), 0)
    const latestCreatedAt = chapters.reduce((latest, chapter) => Math.max(latest, Number(chapter.createdAt) || 0), 0)
    return {
      ordered,
      orderPercent: chapters.length ? Math.round((ordered / chapters.length) * 100) : 0,
      totalWords,
      latestCreatedAt,
    }
  }, [chapters])

  const formattedWordCount = chapterStats.totalWords >= 10000
    ? `${(chapterStats.totalWords / 10000).toFixed(1)}万`
    : chapterStats.totalWords.toLocaleString('zh-CN')

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
    const titles = renameTitles
      .split('\n')
      .map((t) => t.trim())
      .filter(Boolean)
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

  async function openRenameModal() {
    setRenameModal(true)
    setRenamePreview(null)
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
    setRenamePreview(null)
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
    if (!renamePreview?.length && !sourcePreview) {
      toast('请先预览', 'error')
      return
    }
    if (sourcePreview) {
      setRenaming(true)
      try {
        const result = await scrapeApi.sourceSyncApply({
          runId: sourcePreview.runId,
          applyMetadata: sourceMetadataFields.length > 0,
          metadataFields: sourceMetadataFields,
          metadataMode: sourceMetadataMode,
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
      return
    }
    const titles = renameTitles
      .split('\n')
      .map((t) => t.trim())
      .filter(Boolean)
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
    <AdminPage
      className="admin-redesign-page admin-redesign-page--chapters"
      title="章节管理"
      description="按作品维护目录与正文，搜索和批量操作只作用于当前作品。"
      meta={selectedNovel ? (search ? `匹配 ${filtered.length} / 共 ${chapters.length} 章` : `共 ${chapters.length} 章`) : `${novelOptions.length || '—'} 部作品`}
      actions={
        <Button onClick={() => void openChapterModal(null)} disabled={!selectedNovel}>
          <span aria-hidden="true">＋</span>
          添加章节
        </Button>
      }
    >
      <section className="chapter-context-panel" aria-labelledby="chapter-context-title">
        <div className="chapter-context-copy">
          <span className="chapter-section-kicker">当前工作对象</span>
          <h3 id="chapter-context-title">先选一本小说，再处理章节</h3>
          <p>切换作品会同步章节目录、字数与更新时间；搜索和批量操作只作用于当前作品。</p>
        </div>
        <div className="chapter-context-form">
          <div className="chapter-context-form__field">
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
          <Button
            variant="secondary"
            disabled={!selectedNovel}
            onClick={() => selectedNovel && navigate(`/novel/${encodeURIComponent(selectedNovel)}`)}
          >
            打开详情
          </Button>
        </div>
      </section>

      <section className="chapter-metric-strip" aria-label="章节统计">
        <div className="chapter-metric">
          <span>当前章节</span>
          <strong>{selectedNovel ? chapters.length : '—'}</strong>
        </div>
        <div className="chapter-metric">
          <span>已排序</span>
          <strong>{selectedNovel ? chapterStats.ordered : '—'} {selectedNovel && chapters.length > 0 && <em>{chapterStats.orderPercent}%</em>}</strong>
        </div>
        <div className="chapter-metric">
          <span>总字数</span>
          <strong>{selectedNovel ? formattedWordCount : '—'} {selectedNovel && chapterStats.totalWords > 0 && chapterStats.totalWords < 10000 && <em>字</em>}</strong>
        </div>
        <div className="chapter-metric">
          <span>最近更新</span>
          <strong>{selectedNovel && chapterStats.latestCreatedAt ? timeAgo(chapterStats.latestCreatedAt) : '—'}</strong>
        </div>
      </section>

      <div className="chapter-layout">
        <section className="admin-data-panel chapter-directory-panel overflow-hidden rounded-xl border border-border bg-card" aria-labelledby="chapter-directory-title">
          <div className="chapter-directory-panel__head">
            <div>
              <h3 id="chapter-directory-title">章节目录</h3>
              <p>{selectedNovel ? `共 ${chapters.length} 章 · 最近更新于 ${chapterStats.latestCreatedAt ? timeAgo(chapterStats.latestCreatedAt) : '—'}` : '选择小说后加载章节目录'}</p>
            </div>
            <span className={`chapter-directory-status ${selectedNovel ? 'is-ready' : ''}`}>
              <span aria-hidden="true">●</span>
              {selectedNovel ? '目录正常' : '等待选择'}
            </span>
          </div>
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
                    反选
                  </Button>
                  <Button variant="destructive" size="sm" onClick={() => void batchDelete()}>
                    批量删除 ({selectedIds.size})
                  </Button>
                </>
              ) : (
                <Button variant="secondary" size="sm" onClick={() => void openRenameModal()} disabled={!selectedNovel}>
                  融合章节名
                </Button>
              )}
            </div>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <Checkbox checked={pageAllSelected ? true : pageSomeSelected ? 'indeterminate' : false} onCheckedChange={toggleAll} />
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
          <Pagination page={currentPage} totalPages={totalPages} className="chapter-directory-pagination" onPage={setPage} />
        </section>

        <aside className="chapter-work-note" aria-labelledby="chapter-work-note-title">
          <span className="chapter-section-kicker">工作提示</span>
          <h3 id="chapter-work-note-title">让目录保持可读</h3>
          <p>融合源站章节名只影响标题，不会改动正文来源、章节顺序或阅读进度。</p>
          <dl className="chapter-work-note__rows">
            <div><dt>当前章节</dt><dd>{selectedNovel ? chapters.length : '—'}</dd></div>
            <div><dt>已选章节</dt><dd>{selectedIds.size}</dd></div>
            <div><dt>当前页</dt><dd>{selectedNovel ? `${currentPage} / ${totalPages}` : '—'}</dd></div>
          </dl>
          <Button variant="secondary" disabled={!selectedNovel} onClick={() => void openRenameModal()}>
            融合章节名
          </Button>
        </aside>
      </div>

      <Dialog
        open={modal.open}
        onOpenChange={(open) => {
          if (!open) setModal({ open: false, chapter: null, loading: false })
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
            <Button variant="secondary" onClick={() => setModal({ open: false, chapter: null, loading: false })}>
              取消
            </Button>
            <Button disabled={modal.loading} onClick={() => void saveChapter()}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={renameModal}
        onOpenChange={(open) => {
          if (!open) {
            setRenameModal(false)
            setRenamePreview(null)
            setSourcePreview(null)
            setSourceSearch(null)
          }
        }}
      >
        <DialogContent className="admin-dialog chapter-merge-dialog sm:max-w-[760px]">
          <DialogHeader>
            <DialogTitle>融合章节名</DialogTitle>
            <DialogDescription>补全弱标题的来源与变化会在这里先确认，正文、顺序和阅读进度不会改变。</DialogDescription>
          </DialogHeader>
          <div className="admin-dialog__body chapter-merge-dialog__body flex flex-col gap-3 overflow-y-auto max-h-[70vh]">
            <div className="chapter-dialog-context chapter-merge-dialog__context">
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
              <span className="chapter-merge-dialog__status">仅更新弱标题</span>
            </div>
            <section className="chapter-merge-dialog__source">
              <div className="chapter-dialog-section__heading">
                <Label>从原作者源站读取</Label>
                <span>建议优先使用</span>
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
                        <div className="mb-1 flex items-center justify-between gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          <span>{label}</span>
                          <span>{results.length ? `${results.length} 个结果` : bucket?.ok ? '没有匹配结果' : '搜索不可用'}</span>
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
            </section>
            <div className="chapter-merge-dialog__url-field chapter-dialog-field">
              <Label>原作者源站 URL</Label>
              <div className="chapter-merge-dialog__url-row flex gap-2">
              <Input
                value={sourceUrl}
                placeholder="https://www.jjwxc.net/onebook.php?novelid=… 或 https://www.po18.tw/…"
                onChange={(e) => {
                  setSourceUrl(e.target.value)
                  setSourcePreview(null)
                  setRenamePreview(null)
                }}
              />
              <Button variant="secondary" disabled={renaming || !sourceUrl.trim()} onClick={() => void previewSourceSync()}>
                {renaming ? '读取中…' : '读取源站'}
              </Button>
              </div>
            </div>
            {sourcePreview && (
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
                <div className="flex flex-wrap gap-x-4 gap-y-1 font-medium">
                  <span>{sourcePreview.site === 'jjwxc' ? '晋江' : sourcePreview.site === 'po18tw' ? 'PO18.tw' : sourcePreview.site}</span>
                  <span>源站 {sourcePreview.sourceChapterCount} 章</span>
                  <span>本地 {sourcePreview.localChapterCount} 节</span>
                  {sourcePreview.splitLocalChapterCount > 0 && <span>拆分节 {sourcePreview.splitLocalChapterCount}</span>}
                </div>
                <p className="mt-1 text-muted-foreground">
                  已匹配 {sourcePreview.matchedSourceCount} 章；未匹配源站 {sourcePreview.unmatchedSource.length} 章，本地 {sourcePreview.unmatchedLocal.length}{' '}
                  节。
                </p>
                {sourcePreview.warnings.map((warning) => (
                  <p className="mt-1 text-amber-600" key={warning}>
                    {warning}
                  </p>
                ))}
              </div>
            )}
            {sourcePreview && (
              <div className="rounded-lg border border-border p-3">
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
                    <label className="flex items-center gap-2" key={field}>
                      <Checkbox
                        checked={sourceMetadataFields.includes(field)}
                        disabled={!value}
                        onCheckedChange={(checked) =>
                          setSourceMetadataFields((prev) => (checked ? [...new Set([...prev, field])] : prev.filter((item) => item !== field)))
                        }
                      />
                      <span>
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
            )}
            {sourcePreview && sourcePreview.mappings.some((mapping) => mapping.relation === 'split') && (
              <div className="rounded-lg border border-border p-3 text-sm">
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
            <div className="chapter-merge-dialog__divider">或者使用手动标题</div>
            <section className="chapter-merge-dialog__manual chapter-dialog-section">
              <div className="chapter-dialog-section__heading">
                <Label>手动章节标题</Label>
                <span>每行一个</span>
              </div>
              <Textarea
                rows={4}
                className="chapter-merge-dialog__textarea min-h-[96px]"
                placeholder={'第一章 起点\n第二章 转折\n第三章 真相…'}
                value={renameTitles}
                onChange={(e) => {
                  setRenameTitles(e.target.value)
                  setRenamePreview(null)
                  setSourcePreview(null)
                }}
              />
              <p className="chapter-merge-dialog__hint">填写后可预览将要更新的弱标题。</p>
            </section>
            {sourcePreview && (
              <div className="rename-preview">
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
            )}
            {renamePreview && !sourcePreview && (
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
          <DialogFooter className="chapter-merge-dialog__footer">
            <span className="chapter-merge-dialog__footer-note">
              {sourcePreview ? `已读取 ${sourcePreview.changes.length} 个标题变化` : renamePreview ? `已生成 ${renamePreview.length} 个变化` : '只会更新弱标题'}
            </span>
            <Button variant="secondary" onClick={() => setRenameModal(false)}>
              取消
            </Button>
            {sourcePreview || renamePreview ? (
              <Button disabled={renaming || (!sourcePreview && renamePreview?.length === 0)} onClick={() => void applyRename()}>
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
