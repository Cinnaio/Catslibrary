import AiStreamPreview from '@/components/shared/AiStreamPreview'
import type { AiTextProgress } from '@shared/ai-text-progress'
import DraftReview from './DraftReview'
import WritingQualityNotice from './WritingQualityNotice'
import type { WritingQualityReport } from '@shared/ai-writing-quality'
import PublishedMemoryUpdate from './PublishedMemoryUpdate'
/** 已生成内容管理：列出 AI 产物，支持按类型筛选、批量删除、草稿发布。 */
import { ReadingDialog, ReadingDialogDisclosure, ReadingDialogEditor, ReadingDialogText, ReadingDialogToolbar } from '@/components/shared/ReadingDialog'
import FormField from "@/components/shared/FormField"
import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ChevronDown, CirclePlus, CornerDownRight, RefreshCw, Sparkles, Trash2 } from 'lucide-react'
import { aiApi, newOperationId } from '@/lib/api'
import { useToast, useConfirm } from '@/components/feedback'
import { ErrorState, InlineError, LoadingState } from "@/components/shared/AsyncStates"
import Pagination from "@/components/shared/Pagination"
import { ADMIN_DEFAULT_PAGE_SIZE, ADMIN_PAGE_SIZE_OPTIONS } from '@/lib/admin-pagination'
import AiPanelEmptyState from './AiPanelEmptyState'
import DraftRewrite from './DraftRewrite'
import { useAiConfigured } from './useAiConfigured'
import { AdminDataPanel, type AdminColumn } from '@/components/admin/AdminDataPanel'
import { SearchField } from '@/components/shared/SearchField'
import { AdminToolbar } from '@/components/admin/AdminToolbar'
import AdminSelectionBar from '@/components/admin/AdminSelectionBar'
import SearchSelect from "@/components/shared/SearchSelect"
import { cn } from '@/lib/utils'
import { getAdminTableRowStaggerDelay } from '@/lib/admin-table-motion'
import AdminStatusBadge from '@/components/admin/AdminStatusBadge'
import AdminModelTime from '@/components/admin/AdminModelTime'
import AdminRowActions from '@/components/admin/AdminRowActions'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog } from '@/components/ui/dialog'
import { kindLabel } from './labels'
import { useDebouncedValue } from '@/hooks/useDebounce'
import styles from './AiGenerationDialog.module.css'

interface AiGenerationListItem {
  id: string
  kind: string
  model: string
  novelId: string
  chapterId: string
  novelTitle: string
  chapterTitle: string
  result: string
  prompt: string
  status: string
  createdAt: number
  batchId: string
  batchIndex: number
  batchCount: number
  /** 续写时从 AI 输出解析出的章节标题，用于发布自动填充 */
  draftTitle: string
  plotDirection?: string
  /** 正文 SHA-256 版本；选段改写的前置校验字段 */
  contentRevision: string
  quality?: WritingQualityReport
  groupItems?: AiGenerationListItem[]
}

/** 可编辑的草稿类型：与后端 PUT /writing/drafts/:id 的白名单一致。 */
const EDITABLE_KINDS = new Set(['write_chapter', 'continue', 'write_outline'])

/** 可改写选段的类型：与后端 POST /writing/drafts/:id/rewrite 的白名单一致。
 *  大纲不作为散文改写，故不在其列。 */
const REWRITABLE_KINDS = new Set(['write_chapter', 'continue'])

/** 与样稿一致的五列目录；选择框并入关联内容，模型和时间共用一列。 */
const AI_GENERATION_COLUMNS: readonly AdminColumn[] = [
  { key: 'related', label: '关联内容', width: '29%', primary: true },
  { key: 'kind', label: '类型与状态', width: '14%' },
  { key: 'preview', label: '内容预览', width: '24%' },
  { key: 'modelTime', label: '模型与时间', width: '17%' },
  { key: 'actions', actions: true, width: '16%' },
]

const generationStatusLabel = (status: string) => ({ draft: '待审草稿', published: '已发布', rejected: '已拒绝' })[status] || status
const generationWordCount = (text: string) => Array.from(text.replace(/<[^>]*>/g, '')).length
const qualityCount = (item: AiGenerationListItem) => item.groupItems
  ? item.groupItems.filter(chapter => chapter.status === 'draft' && chapter.quality?.warnings.length).length
  : item.status === 'draft' && item.quality?.warnings.length ? 1 : 0

export default function AiGenerationsPanel(props: {
  scope: 'all' | 'reader' | 'writing'
  status?: 'all' | 'published' | 'draft' | 'rejected'
  search?: string
  focusBatchId?: string
  novelId?: string
  /** 任务结束后刷新列表，保留正在审阅或编辑的草稿。 */
  refreshToken?: string
}) {
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const configured = useAiConfigured()
  const [items, setItems] = useState<AiGenerationListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [total, setTotal] = useState(0)
  const [limit, setLimit] = useState(ADMIN_DEFAULT_PAGE_SIZE)
  const [offset, setOffset] = useState(0)
  const [filterKind, setFilterKind] = useState<'all' | 'summary' | 'catchup' | 'write_outline' | 'write_chapter' | 'continue'>('all')
  const [localSearch, setSearch] = useState('')
  const search = props.search ?? localSearch
  const query = useDebouncedValue(search.trim(), 350)
  const [filterStatus, setFilterStatus] = useState(props.status || 'published')
  const requestVersion = useRef(0)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [viewing, setViewing] = useState<AiGenerationListItem | null>(null)
  const [viewingBatch, setViewingBatch] = useState<AiGenerationListItem | null>(null)
  const readingDialogRef = useRef<HTMLDivElement>(null)
  const [publishTitle, setPublishTitle] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [titleCandidates, setTitleCandidates] = useState<string[]>([])
  const [generatingTitles, setGeneratingTitles] = useState(false)
  const [titleProgress, setTitleProgress] = useState<AiTextProgress | null>(null)
  const titleRequest = useRef(0)
  useEffect(() => {
    titleRequest.current++
    setTitleProgress(null)
    setTitleCandidates([])
    setGeneratingTitles(false)
    return () => { titleRequest.current++ }
  }, [viewing?.id, viewing?.contentRevision, props.novelId])
  const [expandedBatchId, setExpandedBatchId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [batchDeleting, setBatchDeleting] = useState(false)
  /** null 表示阅读模式；字符串表示编辑中的草稿正文 */
  const [editingText, setEditingText] = useState<string | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)
  const [publishingBatchId, setPublishingBatchId] = useState<string | null>(null)
  const [memoryUpdate, setMemoryUpdate] = useState<{ novelId: string; novelTitle: string; autoStart: boolean; key: number } | null>(null)

  function showMemoryUpdate(item: AiGenerationListItem, autoStart = true) {
    setMemoryUpdate({ novelId: item.novelId, novelTitle: item.novelTitle, autoStart, key: Date.now() })
  }

  function openGeneration(item: AiGenerationListItem, batch: AiGenerationListItem | null = null) {
    // 集合先进入目录，只有明确选择章节后才进入单章审阅与发布。
    setViewing(item.groupItems ? null : item)
    setViewingBatch(item.groupItems ? item : batch)
    setPublishTitle(item.groupItems ? '' : item.draftTitle || item.chapterTitle || '')
    setTitleCandidates([])
    setEditingText(null)
  }

  function updateViewing(id: string, update: Partial<AiGenerationListItem>) {
    setViewing(current => current?.id === id ? { ...current, ...update } : current)
    setViewingBatch(current => current ? {
      ...current,
      groupItems: current.groupItems?.map(chapter => chapter.id === id ? { ...chapter, ...update } : chapter),
    } : current)
  }

  useEffect(() => {
    // 同一弹窗切换目录和正文时，从顶部阅读，并把键盘焦点移到标题。
    if (!viewing?.id && !viewingBatch?.id) return
    const dialog = readingDialogRef.current
    const body = dialog?.querySelector<HTMLElement>('[role="region"]')
    if (body) body.scrollTop = 0
    dialog?.querySelector<HTMLElement>('[data-slot="dialog-title"]')?.focus()
  }, [viewing?.id, viewingBatch?.id])

  // 从任务面板 / 创作页跳转过来时，自动展开对应批次并滚动到可见位置
  useEffect(() => {
    if (!props.focusBatchId) return
    setExpandedBatchId(props.focusBatchId)
    const timer = setTimeout(() => {
      document.querySelector(`[data-focus-batch="${props.focusBatchId}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }, 120)
    return () => clearTimeout(timer)
  }, [props.focusBatchId])

  const load = useCallback(async () => {
    const version = ++requestVersion.current
    setLoading(true)
    try {
      const res = await aiApi.generations({
        groupBatches: true,
        novelId: props.novelId || undefined,
        kind: filterKind === 'all' ? undefined : filterKind,
        scope: props.scope,
        status: props.status === 'all' ? filterStatus : props.status,
        q: query || undefined,
        limit,
        offset,
      })
      if (version !== requestVersion.current) return
      if (props.novelId && res.novelId !== props.novelId) throw new Error('当前服务端尚不支持按作品查看草稿，请更新 API 后重试。')
      if (offset > 0 && offset >= res.total) {
        setTotal(res.total)
        setOffset(Math.max(0, Math.ceil(res.total / limit) - 1) * limit)
        return
      }
      const allowedKinds =
        props.scope === 'writing'
          ? new Set(['continue', 'write_outline', 'write_chapter'])
          : props.scope === 'reader'
            ? new Set(['summary', 'catchup'])
            : new Set(['summary', 'catchup', 'continue', 'write_outline', 'write_chapter'])
      const filtered = res.items.filter((item) => allowedKinds.has(item.kind))
      const groups = new Map<string, AiGenerationListItem[]>()
      for (const item of filtered) {
        const key = item.kind === 'continue' && item.batchId ? item.batchId : item.id
        const group = groups.get(key) || []
        group.push(item)
        groups.set(key, group)
      }
      setItems(
        Array.from(groups.entries()).map(([key, group]) => {
          if (!group[0] || !group[0].batchId || group.length === 1) return group[0]!
          const first = group[0]
          const plotDirection = group.find((chapter) => chapter.plotDirection?.trim())?.plotDirection
          return {
            ...first,
            id: key,
            plotDirection,
            result: plotDirection || `${group.length} 个续写章节`,
            chapterTitle: `${group.length} 章续写集合`,
            batchCount: group.length,
            groupItems: group.sort((a, b) => a.batchIndex - b.batchIndex),
          }
        }),
      )
      setSelectedIds(new Set())
      setTotal(res.total)
      setError('')
    } catch (err) {
      if (version === requestVersion.current) setError((err as Error).message || '加载已生成内容失败')
    } finally {
      if (version === requestVersion.current) setLoading(false)
    }
  }, [filterKind, filterStatus, query, limit, offset, props.scope, props.status, props.novelId])

  useEffect(() => {
    void load()
    return () => {
      requestVersion.current += 1
    }
  }, [load, props.refreshToken])

  /** 撤销删除：10 秒窗口内恢复软删的生成记录。 */
  async function restoreDeleted(ids: string[]) {
    try {
      await aiApi.restoreGenerations(ids)
      toast('已恢复删除的内容', 'success')
      void load()
    } catch (err) {
      toast((err as Error).message || '撤销删除失败', 'error')
    }
  }

  /** 撤销单条发布：删除刚创建的章节并把草稿改回 draft。 */
  async function undoPublish(draftId: string) {
    try {
      await aiApi.writing.unpublishDraft(draftId)
      setMemoryUpdate(null)
      toast('已撤销发布，草稿恢复', 'success')
      void load()
    } catch (err) {
      toast((err as Error).message || '撤销发布失败', 'error')
    }
  }

  /** 撤销整批发布：删除本批章节并恢复草稿。 */
  async function undoBatchPublish(batchId: string) {
    try {
      const res = await aiApi.writing.unpublishBatch(batchId)
      setMemoryUpdate(null)
      toast('已撤销发布，' + res.restored + ' 章恢复为草稿', 'success')
      void load()
    } catch (err) {
      toast((err as Error).message || '撤销发布失败', 'error')
    }
  }

  async function remove(item: { id: string; kind: string; novelTitle: string; chapterTitle: string }) {
    const ok = await confirm({
      title: '删除这条已生成内容？',
      message: `「${item.novelTitle || '未知小说'}」${item.chapterTitle ? ` · ${item.chapterTitle}` : ''}的${kindLabel(item.kind)}会被删除，读者下次访问该内容时会重新生成并计入配额。`,
      okText: '删除',
      cancelText: '取消',
      danger: true,
    })
    if (!ok) return
    setDeletingId(item.id)
    try {
      await aiApi.deleteGeneration(item.id)
      toast('已删除', 'success', { action: { label: '撤销', onClick: () => void restoreDeleted([item.id]) } })
      // 当前页删空时回退一页，避免停在空页
      if (items.length === 1 && offset > 0) setOffset(Math.max(0, offset - limit))
      else void load()
    } catch (err) {
      toast((err as Error).message || '删除失败', 'error')
    } finally {
      setDeletingId(null)
    }
  }

  function idsForItem(item: AiGenerationListItem): string[] {
    return item.groupItems ? item.groupItems.map((chapter) => chapter.id) : [item.id]
  }

  function getItemCheckedState(item: AiGenerationListItem): boolean | 'indeterminate' {
    const itemIds = idsForItem(item)
    const isAllChecked = itemIds.length > 0 && itemIds.every((id) => selectedIds.has(id))
    if (isAllChecked) return true
    if (itemIds.some((id) => selectedIds.has(id))) return 'indeterminate'
    return false
  }

  const selectedCount = [...selectedIds].length
  const allSelected = items.length > 0 && items.every((item) => idsForItem(item).every((id) => selectedIds.has(id)))
  const isAnySelected = items.length > 0 && items.some((item) => idsForItem(item).some((id) => selectedIds.has(id)))
  const headerCheckedState = allSelected ? true : isAnySelected ? 'indeterminate' : false

  function toggleItem(item: AiGenerationListItem, checked: boolean): void {
    setSelectedIds((current) => {
      const next = new Set(current)
      for (const id of idsForItem(item)) {
        if (checked) next.add(id)
        else next.delete(id)
      }
      return next
    })
  }

  async function removeSelected(): Promise<void> {
    if (!selectedCount) return
    const ok = await confirm({
      title: '批量删除已生成内容？',
      message: `确定删除已选择的 ${selectedCount} 条生成记录？删除后无法恢复。`,
      okText: '批量删除',
      cancelText: '取消',
      danger: true,
    })
    if (!ok) return
    setBatchDeleting(true)
    try {
      const deletedIds = [...selectedIds].filter(Boolean).sort()
      const result = await aiApi.deleteGenerations(deletedIds, newOperationId('ai-generations-delete'))
      toast('已删除 ' + result.deleted + ' 条生成记录', 'success', { action: { label: '撤销', onClick: () => void restoreDeleted(deletedIds) } })
      setSelectedIds(new Set())
      void load()
    } catch (err) {
      toast((err as Error).message || '批量删除失败', 'error')
    } finally {
      setBatchDeleting(false)
    }
  }

  async function publish(item: AiGenerationListItem) {
    const title = publishTitle.trim()
    if (!title || !item.novelId) return toast('请填写章节标题并确认关联小说', 'error')
    setPublishing(true)
    try {
      await aiApi.writing.publishDraft(item.id, { novelId: item.novelId, title })
      showMemoryUpdate(item, false)
      toast('已发布为正式章节', 'success', { action: { label: '撤销发布', onClick: () => void undoPublish(item.id) } })
      setViewing(null)
      setViewingBatch(null)
      setPublishTitle('')
      void load()
    } catch (err) {
      toast((err as Error).message || '发布失败', 'error')
    } finally {
      setPublishing(false)
    }
  }

  async function publishBatch(item: AiGenerationListItem) {
    const draftCount = (item.groupItems || []).filter((chapter) => chapter.status === 'draft').length
    if (!draftCount || !item.novelId) return toast('该批次没有可发布的草稿', 'error')
    const ok = await confirm({
      title: '整批发布续写草稿？',
      message: `将按批次顺序把 ${draftCount} 章草稿发布为《${item.novelTitle || '未知小说'}》的正式章节，标题优先使用 AI 生成的标题，缺失时回退「第 N 章」递增，发布后可在章节管理中改名。`,
      okText: '整批发布',
      cancelText: '取消',
    })
    if (!ok) return
    setPublishingBatchId(item.batchId)
    try {
      const result = await aiApi.writing.publishBatch(item.batchId, { novelId: item.novelId })
      showMemoryUpdate(item, false)
      toast('已发布 ' + result.published.length + ' 章为正式章节', 'success', {
        action: { label: '撤销发布', onClick: () => void undoBatchPublish(item.batchId) },
      })
      void load()
    } catch (err) {
      toast((err as Error).message || '整批发布失败', 'error')
    } finally {
      setPublishingBatchId(null)
    }
  }

  async function saveEdit(item: AiGenerationListItem) {
    const text = (editingText || '').trim()
    if (!text) return toast('内容不能为空', 'error')
    setSavingEdit(true)
    try {
      // 保存后正文版本必变；把新的 contentRevision 一并写回，
      // 否则紧接着的选段改写会拿着旧版本号提交，被服务端 409 拒绝。
      const saved = await aiApi.writing.updateDraft(item.id, text)
      updateViewing(item.id, { result: text, contentRevision: saved.contentRevision, quality: saved.quality })
      setEditingText(null)
      toast('草稿已保存', 'success')
      void load()
    } catch (err) {
      toast((err as Error).message || '保存失败', 'error')
    } finally {
      setSavingEdit(false)
    }
  }

  /** 重新读取当前草稿的权威正文与版本号。
   *  改写应用遇到 409（正文已变化）时必须走这里：本地缓存的结果与版本号都已过期，
   *  不重新读取就无法再选段。 */
  async function refreshViewing() {
    const id = viewing?.id
    if (!id) return
    try {
      const { item } = await aiApi.generation(id)
      updateViewing(id, item)
      setEditingText(null)
    } catch (err) {
      toast((err as Error).message || '重新读取草稿失败', 'error')
    }
  }

  async function generateTitles(item: AiGenerationListItem) {
    const current = ++titleRequest.current
    setTitleProgress(null)
    setGeneratingTitles(true)
    setTitleCandidates([])
    try {
      const result = await aiApi.writing.titles({ content: item.result, novelId: item.novelId, contextTitle: item.chapterTitle }, (next) => { if (current === titleRequest.current) setTitleProgress(next) })
      if (current !== titleRequest.current) return
      setTitleCandidates(result.titles)
      toast(`已生成 ${result.titles.length} 个标题候选`, 'success')
    } catch (err) {
      if (current === titleRequest.current) toast((err as Error).message || '标题生成失败', 'error')
    } finally {
      if (current === titleRequest.current) setGeneratingTitles(false)
    }
  }

  const kindOptions = [
    { value: 'all', label: '全部类型' },
    ...(props.scope !== 'writing'
      ? [
          { value: 'summary', label: '前情提要' },
          { value: 'catchup', label: '回顾总结' },
        ]
      : []),
    ...(props.scope !== 'reader'
      ? [
          { value: 'write_outline', label: '创作大纲' },
          { value: 'write_chapter', label: '创作章节' },
          { value: 'continue', label: '续写' },
        ]
      : []),
  ]

  const statusOptions = [
    { value: 'all', label: '全部状态' },
    { value: 'draft', label: '待审草稿' },
    { value: 'published', label: '已发布' },
    { value: 'rejected', label: '已拒绝' },
  ]

  const hasActiveFilter = Boolean(search || (props.status === 'all' && filterStatus !== 'all') || filterKind !== 'all')
  const batchChapters = viewingBatch?.groupItems || []

  return (
    <div className="ai-service-stack">
      {memoryUpdate && <PublishedMemoryUpdate key={memoryUpdate.key} novelId={memoryUpdate.novelId} novelTitle={memoryUpdate.novelTitle} autoStart={memoryUpdate.autoStart} onClose={() => setMemoryUpdate(null)} />}
      {/* Claude 风格单层控制流：搜索框与多维状态/类型胶囊外置于统一胶囊轨道 */}
      <AdminToolbar layout="inline" className="admin-filter-rail ai-generations-filter-rail" ariaLive="polite">
        <SearchField
          id="ai-generation-search"
          label="搜索生成内容"
          type="search"
          placeholder="搜索作品、章节或正文…"
          maxLength={100}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value)
            setOffset(0)
          }}
        />
        <div className="select-filter-chips">
          {props.status === 'all' && (
            <SearchSelect
              compact
              chip
              filterChip
              leadingIcon={<CirclePlus className="size-[var(--select-filter-chip-icon-size)]" />}
              aria-label="按状态筛选生成内容"
              value={filterStatus}
              onChange={(value) => {
                setFilterStatus(value as typeof filterStatus)
                setOffset(0)
              }}
              options={statusOptions}
            />
          )}
          <SearchSelect
            compact
            chip
            filterChip
            leadingIcon={<CirclePlus className="size-[var(--select-filter-chip-icon-size)]" />}
            aria-label="按类型筛选生成内容"
            value={filterKind}
            onChange={(v) => {
              setFilterKind(v as 'all' | 'summary' | 'catchup' | 'write_outline' | 'write_chapter' | 'continue')
              setOffset(0)
            }}
            options={kindOptions}
          />
          {hasActiveFilter && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 rounded-full px-2.5 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => {
                setSearch('')
                if (props.status === 'all') setFilterStatus('all')
                setFilterKind('all')
                setOffset(0)
              }}
            >
              清除筛选
            </Button>
          )}
          <div className="admin-filter-rail__status">
            <span className="tabular-nums">
              {loading && !items.length ? '读取中…' : error && !items.length ? '读取失败' : `${total} 项`}
            </span>
            <span aria-hidden="true" className="opacity-40">·</span>
            <span className="ai-generation-sort-hint">最新优先 · 批次可展开</span>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 rounded-full text-muted-foreground hover:text-foreground"
              onClick={() => void load()}
              disabled={loading}
              title="刷新生成记录"
            >
              <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} aria-hidden="true" />
              <span className="sr-only">刷新生成记录</span>
            </Button>
          </div>
        </div>
      </AdminToolbar>

      {/* 悬浮胶囊岛批量操作栏 */}
      <AdminSelectionBar
        count={selectedCount}
        label={`已选择 ${selectedCount} 条生成记录`}
        onClear={() => setSelectedIds(new Set())}
        clearLabel="取消选择"
        clearPlacement="actions"
      >
        <Button variant="destructive" size="sm" className="ai-generation-delete" disabled={!selectedCount || batchDeleting} onClick={() => void removeSelected()}>
          {batchDeleting ? '正在删除…' : '删除所选'}
        </Button>
      </AdminSelectionBar>

      <AdminDataPanel
        className="ai-generations-card"
        ariaLabel="已生成内容列表"
        columns={AI_GENERATION_COLUMNS}
        density="comfortable"
      >
        {loading && items.length === 0 ? (
          <LoadingState label="正在加载已生成内容" />
        ) : error && items.length === 0 ? (
          <ErrorState message={`生成内容加载失败：${error}`} />
        ) : items.length === 0 ? (
          <AiPanelEmptyState
            configured={query || filterKind !== 'all' || (props.status === 'all' && filterStatus !== 'all') ? true : configured}
            unconfiguredMessage="尚未配置文本 AI 供应商，还没有可审阅的产物"
            unconfiguredHint="配置文本供应商后，生成的草稿会出现在这里。"
            emptyMessage={query || filterKind !== 'all' || (props.status === 'all' && filterStatus !== 'all') ? '没有匹配的生成内容' : '暂无已生成内容'}
            hint={
              query || filterKind !== 'all' || (props.status === 'all' && filterStatus !== 'all')
                ? '尝试更换关键词或调整类型、状态筛选。'
                : '生成完成后草稿会出现在这里，可编辑后再发布为正式章节。'
            }
          />
        ) : (
          <>
            {error && <InlineError message={error} className="mx-5 my-3" />}
            <Table className={cn('admin-data-table admin-data-table--animated', loading && 'admin-data-table--transitioning')}>
              {/* caption 只给表格名称与交互提示。列名由 <th scope="col"> 完整提供，
                  在此复述会让读屏用户先听一遍列名、再听一遍表头。 */}
              <TableCaption className="sr-only">已生成内容，批次行可展开章节</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">
                    <div className="ai-generation-identity">
                      <Checkbox
                        aria-label="全选当前列表"
                        checked={headerCheckedState}
                        onCheckedChange={(checked) => {
                          for (const item of items) toggleItem(item, checked === true)
                        }}
                      />
                      关联内容
                    </div>
                  </TableHead>
                  <TableHead scope="col">类型与状态</TableHead>
                  <TableHead scope="col">内容预览</TableHead>
                  <TableHead scope="col">模型与时间</TableHead>
                  <TableHead scope="col" className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody key={limit}>
                  {items.map((item, index) => (
                    <Fragment key={item.id}>
                      <TableRow style={{ animationDelay: `${getAdminTableRowStaggerDelay(index, items.length)}ms` }} className="ai-generation-row" data-focus-batch={item.groupItems ? item.batchId : undefined}>
                        <TableCell data-primary="" data-label="关联内容">
                          <div className="ai-generation-identity">
                            <Checkbox
                              aria-label={`选择${item.chapterTitle || item.kind}`}
                              checked={getItemCheckedState(item)}
                              onCheckedChange={(checked) => toggleItem(item, checked === true)}
                            />
                            <div className="min-w-0">
                              <div className="ai-generation-title-line">
                                {item.novelId ? (
                                  <Link
                                    to={`/novel/${encodeURIComponent(item.novelId)}`}
                                    className="ai-generation-related__title"
                                    title={`打开《${item.novelTitle || '未知小说'}》详情`}
                                  >
                                    {item.novelTitle || <span className="text-muted-foreground">—</span>}
                                  </Link>
                                ) : (
                                  <div className="ai-generation-related__title">{item.novelTitle || <span className="text-muted-foreground">—</span>}</div>
                                )}
                                {item.groupItems && (
                                  <Button
                                    variant="ghost"
                                    size="xs"
                                    className={cn(
                                      'ai-generation-expand',
                                      expandedBatchId === item.id && 'ai-generation-expand--active',
                                    )}
                                    aria-expanded={expandedBatchId === item.id}
                                    aria-controls={`ai-generation-batch-${item.id}`}
                                    onClick={() => setExpandedBatchId(expandedBatchId === item.id ? null : item.id)}
                                  >
                                    <span>{item.groupItems.length} 章</span>
                                    <ChevronDown
                                      className={cn(
                                        'size-3 text-muted-foreground/80 transition-transform duration-200',
                                        expandedBatchId === item.id && 'rotate-180 text-accent',
                                      )}
                                      aria-hidden="true"
                                    />
                                  </Button>
                                )}
                              </div>
                              {item.chapterTitle ? (
                                item.novelId && item.chapterId && !item.groupItems ? (
                                  <Link
                                    to={`/read/${encodeURIComponent(item.novelId)}/${encodeURIComponent(item.chapterId)}`}
                                    className="ai-generation-related__sub"
                                    title="阅读该章节"
                                  >
                                    {item.chapterTitle}
                                  </Link>
                                ) : (
                                  <div className="ai-generation-related__sub">{item.chapterTitle}</div>
                                )
                              ) : null}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell data-label="类型与状态">
                          <div className="ai-generation-classification">
                            <span>{kindLabel(item.kind)}</span>
                            <AdminStatusBadge tone={item.status === 'draft' ? 'accent' : item.status === 'published' ? 'success' : 'muted'}>
                              {item.groupItems
                                ? item.groupItems.every((chapter) => chapter.status === item.groupItems?.[0]?.status)
                                  ? generationStatusLabel(item.groupItems[0]?.status || 'draft')
                                  : `${item.groupItems.filter((chapter) => chapter.status === 'draft').length} 章待审`
                                : generationStatusLabel(item.status)}
                            </AdminStatusBadge>
                            {qualityCount(item) > 0 && (
                              <AdminStatusBadge tone="warning">{item.groupItems ? `${qualityCount(item)} 章需检查` : '需检查'}</AdminStatusBadge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell data-label="内容预览">
                          <p
                            className="ai-generation-preview"
                            data-preview-label={item.groupItems ? (item.plotDirection ? '选定情节' : '内容摘要') : '正文预览'}
                            title={item.groupItems ? item.plotDirection : undefined}
                          >
                            {item.result || '—'}
                          </p>
                        </TableCell>
                        <TableCell data-label="模型与时间">
                          <AdminModelTime model={item.model} timestamp={item.createdAt} />
                        </TableCell>
                        <TableCell data-actions="">
                          <AdminRowActions
                            label={item.draftTitle || item.chapterTitle || item.novelTitle || '生成记录'}
                            className="justify-end"
                            items={[
                              ...(REWRITABLE_KINDS.has(item.kind) && item.novelId && (item.groupItems ? item.groupItems.some(chapter => chapter.status === 'published') : item.status === 'published')
                                ? [
                                    {
                                      label: '更新故事档案',
                                      icon: RefreshCw,
                                      onSelect: () => showMemoryUpdate(item),
                                    },
                                  ]
                                : []),
                              ...(!item.groupItems
                                ? [
                                    {
                                      label: deletingId === item.id ? '正在删除…' : '删除记录',
                                      icon: Trash2,
                                      danger: true,
                                      disabled: deletingId === item.id,
                                      onSelect: () => void remove(item),
                                    },
                                  ]
                                : []),
                            ]}
                          >
                            {item.groupItems ? (
                              <>
                                {item.groupItems.some((chapter) => chapter.status === 'draft') && (
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    className="content-ratings-edit-button shrink-0"
                                    disabled={publishingBatchId === item.batchId}
                                    onClick={() => void publishBatch(item)}
                                  >
                                    {publishingBatchId === item.batchId ? '发布中…' : '整批发布'}
                                  </Button>
                                )}
                                <Button
                                  type="button"
                                  variant="secondary"
                                  size="sm"
                                  className="content-ratings-edit-button shrink-0"
                                  onClick={() => openGeneration(item)}
                                >
                                  查看
                                </Button>
                              </>
                            ) : (
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                className="content-ratings-edit-button shrink-0"
                                onClick={() => openGeneration(item)}
                              >
                                {item.status === 'draft' ? '审阅' : '查看'}
                              </Button>
                            )}
                          </AdminRowActions>
                        </TableCell>
                      </TableRow>
                      {item.groupItems && expandedBatchId === item.id &&
                        item.groupItems.map((chapter, chapterIndex) => {
                          const wordCount = generationWordCount(chapter.result)
                          const isChapterChecked = selectedIds.has(chapter.id)
                          return (
                            <TableRow
                              key={chapter.id}
                              style={{ animationDelay: `${getAdminTableRowStaggerDelay(chapterIndex, item.groupItems!.length)}ms` }}
                              className="ai-generation-row ai-generation-row--child"
                              data-child-of={item.id}
                            >
                              <TableCell data-primary="" data-label="关联内容">
                                <div className="ai-generation-child-identity">
                                  <CornerDownRight className="ai-generation-child-tree" aria-hidden="true" />
                                  <Checkbox
                                    aria-label={`选择${chapter.draftTitle || chapter.chapterTitle || `第 ${chapter.batchIndex} 章`}`}
                                    checked={isChapterChecked}
                                    onCheckedChange={(checked) => {
                                      setSelectedIds((current) => {
                                        const next = new Set(current)
                                        if (checked === true) next.add(chapter.id)
                                        else next.delete(chapter.id)
                                        return next
                                      })
                                    }}
                                  />
                                  <div className="ai-generation-child-meta min-w-0">
                                    <span className="ai-generation-child-index">第 {chapter.batchIndex} 章</span>
                                    <span
                                      className="ai-generation-child-title"
                                      title={chapter.draftTitle || chapter.chapterTitle || '待命名章节'}
                                    >
                                      {chapter.draftTitle || chapter.chapterTitle || '待命名章节'}
                                    </span>
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell data-label="类型与状态">
                                <div className="ai-generation-classification">
                                  <span>{kindLabel(chapter.kind)}</span>
                                  <AdminStatusBadge
                                    tone={chapter.status === 'draft' ? 'accent' : chapter.status === 'published' ? 'success' : 'muted'}
                                  >
                                    {generationStatusLabel(chapter.status)}
                                  </AdminStatusBadge>
                                  {qualityCount(chapter) > 0 && <AdminStatusBadge tone="warning">需检查</AdminStatusBadge>}
                                </div>
                              </TableCell>
                              <TableCell data-label="内容预览">
                                <p className="ai-generation-preview ai-generation-preview--child" data-preview-label="正文预览">
                                  {chapter.result || '—'}
                                </p>
                              </TableCell>
                              <TableCell data-label="模型与时间">
                                <div className="ai-generation-child-stats">
                                  <span className="ai-generation-child-words tabular-nums">约 {wordCount.toLocaleString()} 字</span>
                                  <AdminModelTime model={chapter.model} timestamp={chapter.createdAt} />
                                </div>
                              </TableCell>
                              <TableCell data-actions="">
                                <AdminRowActions
                                  label={chapter.draftTitle || chapter.chapterTitle || `第 ${chapter.batchIndex} 章`}
                                  className="justify-end"
                                  items={[
                                    {
                                      label: deletingId === chapter.id ? '正在删除…' : '删除章节草稿',
                                      icon: Trash2,
                                      danger: true,
                                      disabled: deletingId === chapter.id,
                                      onSelect: () => void remove(chapter),
                                    },
                                  ]}
                                >
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    className="content-ratings-edit-button shrink-0"
                                    onClick={() => openGeneration(chapter, item)}
                                  >
                                    {chapter.status === 'draft' ? '审阅' : '查看'}
                                  </Button>
                                </AdminRowActions>
                              </TableCell>
                            </TableRow>
                          )
                        })}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
      </AdminDataPanel>
      {total > 0 && items.length > 0 && (
        <Pagination
          variant="detached"
          page={Math.floor(offset / limit) + 1}
          totalPages={Math.max(1, Math.ceil(total / limit))}
          onPage={(page) => setOffset((page - 1) * limit)}
          busy={loading}
          summary={
            <>
              共 {total} 项，显示 {offset + 1}-{Math.min(offset + items.length, total)}（合集计为 1 项）
            </>
          }
          pageSize={{
            value: limit,
            onChange: (value) => {
              setLimit(value)
              setOffset(0)
            },
            options: ADMIN_PAGE_SIZE_OPTIONS,
          }}
        />
      )}
      <p className="ai-generation-help">草稿经审阅后发布；删除生成记录前，会提示对应内容及影响。</p>
      <Dialog
        open={!!viewing || !!viewingBatch}
        onOpenChange={(open) => {
          if (!open) {
            if (savingEdit || publishing || generatingTitles) return
            setViewing(null)
            setViewingBatch(null)
            setPublishTitle('')
            setTitleCandidates([])
            setGeneratingTitles(false)
            setEditingText(null)
          }
        }}
      >
        <ReadingDialog
          ref={readingDialogRef}
          showCloseButton={!savingEdit && !publishing && !generatingTitles}
          title={viewing?.novelTitle || viewingBatch?.novelTitle || '未关联作品'}
          description={viewing ? viewing.draftTitle || viewing.chapterTitle || '未关联章节' : `${batchChapters.length} 章续写集合`}
          bodyLabel={viewing ? '生成内容' : '续写集合'}
          eyebrow={viewing ? (
            <>
              <span>{kindLabel(viewing.kind)}</span>
              <AdminStatusBadge tone={viewing.status === 'draft' ? 'accent' : viewing.status === 'published' ? 'success' : 'muted'}>
                {generationStatusLabel(viewing.status)}
              </AdminStatusBadge>
            </>
          ) : viewingBatch && (
            <>
              <span>续写集合</span>
              {[...new Set(batchChapters.map(chapter => chapter.status))].map(status => (
                <AdminStatusBadge key={status} tone={status === 'draft' ? 'accent' : status === 'published' ? 'success' : 'muted'}>
                  {batchChapters.filter(chapter => chapter.status === status).length} 章{generationStatusLabel(status)}
                </AdminStatusBadge>
              ))}
            </>
          )}
          footer={viewing && viewing.status === 'draft' && editingText === null && (viewing.kind === 'write_chapter' || viewing.kind === 'continue') && (
            <div className={styles.publishRow}>
              <FormField label="发布章节标题" htmlFor="generation-publish-title" className={styles.publishField}>
                <Input
                  id="generation-publish-title"
                  value={publishTitle}
                  disabled={publishing}
                  onChange={(event) => setPublishTitle(event.target.value)}
                  placeholder="例如：第十二章 暴雨前夜"
                />
                <div className={styles.titleOptions}>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={generatingTitles || publishing}
                    onClick={() => void generateTitles(viewing)}
                  >
                    <Sparkles className="size-3 mr-1 text-accent" aria-hidden="true" />
                    {generatingTitles ? '生成中…' : 'AI 生成标题'}
                  </Button>
                  {generatingTitles && <AiStreamPreview progress={titleProgress} structured />}
                  {titleCandidates.map((candidate) => (
                    <Button
                      key={candidate}
                      type="button"
                      variant="secondary"
                      size="sm"
                      className={styles.titleCandidate}
                      disabled={publishing}
                      onClick={() => setPublishTitle(candidate)}
                      title={`使用标题：${candidate}`}
                    >
                      {candidate}
                    </Button>
                  ))}
                </div>
              </FormField>
              <Button
                className={styles.publishSubmit}
                disabled={publishing || generatingTitles || !publishTitle.trim()}
                onClick={() => void publish(viewing)}
              >
                {publishing ? '发布中…' : '发布为正式章节'}
              </Button>
            </div>
          )}
        >
          {viewingBatch && !viewing && (
            <>
              {viewingBatch.plotDirection && (
                <>
                  <ReadingDialogToolbar label="选定情节" />
                  <ReadingDialogText>{viewingBatch.plotDirection}</ReadingDialogText>
                </>
              )}
              <ReadingDialogToolbar
                label="章节目录"
                meta={`共 ${batchChapters.length} 章 · 约 ${batchChapters.reduce((total, chapter) => total + generationWordCount(chapter.result), 0).toLocaleString()} 字`}
              />
              <ol className={styles.batchChapters} aria-label="续写章节目录">
                {batchChapters.map(chapter => {
                  const title = chapter.draftTitle || chapter.chapterTitle || '待命名章节'
                  const action = chapter.status === 'draft' ? '审阅' : '查看'
                  return (
                    <li key={chapter.id} className={styles.batchChapter}>
                      <div className={styles.batchChapterContent}>
                        <div className={styles.batchChapterHeading}>
                          <span className={styles.batchChapterIndex}>第 {chapter.batchIndex} 章</span>
                          <span className={styles.batchChapterTitle}>{title}</span>
                        </div>
                        <div className={styles.batchChapterMeta}>
                          <AdminStatusBadge tone={chapter.status === 'draft' ? 'accent' : chapter.status === 'published' ? 'success' : 'muted'}>
                            {generationStatusLabel(chapter.status)}
                          </AdminStatusBadge>
                          <span>约 {generationWordCount(chapter.result).toLocaleString()} 字</span>
                          {qualityCount(chapter) > 0 && <AdminStatusBadge tone="warning">需检查</AdminStatusBadge>}
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        aria-label={`${action}第 ${chapter.batchIndex} 章：${title}`}
                        onClick={() => openGeneration(chapter, viewingBatch)}
                      >
                        {action}
                      </Button>
                    </li>
                  )
                })}
              </ol>
            </>
          )}
          {viewing && (
            <>
              {/* 中间区是唯一的滚动所有者，发布区常驻可见 */}
              {viewingBatch && (
                <ReadingDialogToolbar
                  label={`集合第 ${viewing.batchIndex} 章 · 共 ${batchChapters.length} 章`}
                  actions={
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={editingText !== null || savingEdit || publishing || generatingTitles}
                      onClick={() => openGeneration(viewingBatch)}
                    >
                      <ArrowLeft aria-hidden="true" />
                      返回集合
                    </Button>
                  }
                />
              )}
              {editingText === null && <WritingQualityNotice quality={viewing.quality} />}

              <ReadingDialogToolbar
                label="生成内容"
                meta={`约 ${generationWordCount(editingText ?? viewing.result).toLocaleString()} 字`}
                actions={viewing.status === 'draft' &&
                  EDITABLE_KINDS.has(viewing.kind) &&
                  (editingText === null ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setEditingText(viewing.result)}
                    >
                      编辑正文
                    </Button>
                  ) : (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={savingEdit}
                        onClick={() => setEditingText(null)}
                      >
                        取消
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        disabled={savingEdit || !editingText.trim()}
                        onClick={() => void saveEdit(viewing)}
                      >
                        {savingEdit ? '保存中…' : '保存草稿'}
                      </Button>
                    </>
                  ))}
              />

              {editingText === null ? (
                <ReadingDialogText>
                  {viewing.result || '暂无内容'}
                </ReadingDialogText>
              ) : (
                <ReadingDialogEditor
                  aria-label="编辑生成正文"
                  value={editingText}
                  onChange={(event) => setEditingText(event.target.value)}
                  disabled={savingEdit}
                />
              )}

              {viewing.prompt && (
                <ReadingDialogDisclosure key={viewing.id} label="生成依据" hint="Prompt">
                  {viewing.prompt}
                </ReadingDialogDisclosure>
              )}

              {viewing.status === 'draft' && editingText === null && REWRITABLE_KINDS.has(viewing.kind) && (
                <>
                  <DraftReview draftId={viewing.id} contentRevision={viewing.contentRevision || ''} disabled={publishing} />
                  <DraftRewrite
                    draftId={viewing.id}
                    content={viewing.result}
                    contentRevision={viewing.contentRevision || ''}
                    onApplied={({ result, contentRevision }) => {
                      updateViewing(viewing.id, { result, contentRevision })
                      void refreshViewing()
                      void load()
                    }}
                    onStale={() => void refreshViewing()}
                  />
                </>
              )}
            </>
          )}
        </ReadingDialog>
      </Dialog>
    </div>
  )
}
