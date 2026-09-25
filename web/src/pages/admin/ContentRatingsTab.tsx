import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { History, Pencil, PlusCircle, RefreshCw, ShieldCheck } from 'lucide-react'
import {
  adminApi,
  type AdminContentRatingEvidence,
  type AdminContentRatingHistoryItem,
  type AdminContentRatingItem,
  type AdminContentRatingRuleCandidateKind,
  type AdminContentRatingRuleCandidateListResponse,
  type AdminContentRatingSource,
  type ApiError,
} from '@/lib/api'
import { formatDateTime, timeAgo } from '@/lib/format'
import type { ContentRating } from '@shared/types'
import { useToast } from '@/components/feedback'
import AdminEmptyState from '@/components/admin/AdminEmptyState'
import AdminPage from '@/components/admin/AdminPage'
import { ErrorState, InlineError, LoadingState } from '@/components/admin/AsyncStates'
import CustomSelect, { type SelectOption } from '@/components/admin/CustomSelect'
import Pagination from '@/components/admin/Pagination'
import { ADMIN_DEFAULT_PAGE_SIZE, ADMIN_PAGE_SIZE_OPTIONS } from '@/lib/admin-pagination'
import { AdminDataPanel, AdminMetricStrip, AdminPanelHeading, AdminSearch, AdminToolbar, type AdminColumn } from '@/components/admin/AdminWorkspace'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'

const RATING_BADGE: Record<ContentRating, { label: string; className: string }> = {
  general: { label: '一般', className: 'bg-info/10 text-info' },
  restricted: { label: '限制级', className: 'bg-destructive/10 text-destructive' },
  unknown: { label: '未标注', className: 'bg-muted text-muted-foreground' },
}

const RATING_OPTIONS: SelectOption[] = [
  { value: '', label: '全部分级' },
  { value: 'unknown', label: '仅看未标注' },
  { value: 'restricted', label: '限制级' },
  { value: 'general', label: '一般' },
]

const EDIT_RATING_OPTIONS: SelectOption[] = [
  { value: 'unknown', label: '未标注' },
  { value: 'general', label: '一般' },
  { value: 'restricted', label: '限制级' },
]

const SOURCE_LABEL: Record<AdminContentRatingSource, string> = {
  manual: '人工修改',
  prefill: '规则预填',
  source_import: '书源导入',
  migration: '数据迁移',
  system: '系统处理',
  legacy: '历史存量',
}

const SOURCE_OPTIONS: SelectOption[] = [{ value: '', label: '全部来源' }, ...Object.entries(SOURCE_LABEL).map(([value, label]) => ({ value, label }))]

const RATING_COLUMNS: readonly AdminColumn[] = [
  { key: 'work', label: '作品', width: '25%', primary: true },
  { key: 'rating', label: '当前分级', width: '12%' },
  { key: 'source', label: '来源', width: '14%' },
  { key: 'evidence', label: '判定证据', width: '23%' },
  { key: 'updated', label: '最近操作', width: '16%' },
  { key: 'actions', label: '操作', width: '14%', actions: true },
]

const CANDIDATE_KIND_OPTIONS: SelectOption[] = [
  { value: 'category', label: '分类标签' },
  { value: 'phrase', label: '文本短语' },
]

const EMPTY_COUNTS = { general: 0, restricted: 0, unknown: 0 }

function formatNumber(value: number): string {
  return Number(value || 0).toLocaleString('zh-CN')
}

function ratingValue(value: string): ContentRating {
  return value === 'general' || value === 'restricted' ? value : 'unknown'
}

function RatingBadge({ rating }: { rating: ContentRating }) {
  const badge = RATING_BADGE[rating]
  return <Badge className={badge.className}>{badge.label}</Badge>
}

function evidenceLabel(item: AdminContentRatingEvidence): string {
  if (item.type === 'category') return item.value ? `分类：${item.value}` : '分类命中'
  if (item.type === 'text') {
    const field = item.field === 'title' ? '标题' : item.field === 'description' ? '简介' : '文本'
    return `${field}命中`
  }
  if (item.type === 'note') return item.value || '备注'
  return item.value || item.type || '记录'
}

function EvidenceList({ evidence, compact = false }: { evidence: AdminContentRatingEvidence[]; compact?: boolean }) {
  if (!evidence.length) return <span className="text-xs text-muted-foreground">暂无证据</span>

  const visible = compact ? evidence.slice(0, 2) : evidence
  const overflow = compact ? evidence.length - visible.length : 0

  return (
    <div className="admin-cell-tags" title={evidence.map(evidenceLabel).join('、')}>
      {visible.map((item, index) => (
        <Badge key={`${item.type}-${item.field || ''}-${index}`} variant="outline" className="admin-cell-tags__tag max-w-full truncate font-normal">
          {evidenceLabel(item)}
        </Badge>
      ))}
      {overflow > 0 && <span className="admin-cell-tags__overflow">+{overflow}</span>}
    </div>
  )
}

function sourceLabel(source: AdminContentRatingSource): string {
  return SOURCE_LABEL[source] || source
}

function isConflictError(error: unknown): boolean {
  const apiError = error as ApiError | null
  const data = apiError?.data as { code?: unknown } | undefined
  return apiError?.status === 409 || data?.code === 'content_rating_conflict'
}

function errorMessage(error: unknown, fallback: string): string {
  return (error as Error)?.message || fallback
}

function RatingHistoryRow({ entry }: { entry: AdminContentRatingHistoryItem }) {
  return (
    <article className="border-b border-border py-4 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <RatingBadge rating={entry.fromRating} />
          <span className="text-muted-foreground" aria-hidden="true">
            →
          </span>
          <RatingBadge rating={entry.toRating} />
          <span className="text-xs text-muted-foreground">{sourceLabel(entry.source)}</span>
        </div>
        <time
          className="text-xs text-muted-foreground"
          dateTime={entry.createdAt ? new Date(entry.createdAt).toISOString() : undefined}
          title={formatDateTime(entry.createdAt)}
        >
          {timeAgo(entry.createdAt) || '未知时间'}
        </time>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground">{entry.reason || '未记录修改理由'}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>操作人：{entry.actorName || '系统'}</span>
        {entry.ruleVersion && <span>规则：{entry.ruleVersion}</span>}
        {entry.operationId && <span className="font-mono">#{entry.operationId}</span>}
      </div>
      {entry.evidence.length > 0 && (
        <div className="mt-3">
          <EvidenceList evidence={entry.evidence} />
        </div>
      )}
    </article>
  )
}

function candidateKindLabel(kind: AdminContentRatingRuleCandidateKind): string {
  return kind === 'category' ? '分类标签' : '文本短语'
}

function RuleCandidatePanel({
  data,
  loading,
  error,
  onRetry,
}: {
  data: AdminContentRatingRuleCandidateListResponse | null
  loading: boolean
  error: string
  onRetry: () => void
}) {
  return (
    <AdminDataPanel ariaLabel="内容分级规则候选">
      <AdminPanelHeading
        title="规则候选"
        description="人工经验先进入待审核候选，不会因为一次提交立即影响其他作品。"
        status={<span className="text-xs text-muted-foreground">待审核 {data ? formatNumber(data.counts.pending) : '—'} 条</span>}
      />
      {error ? (
        <InlineError message={`规则候选加载失败：${error}`} onRetry={onRetry} className="mx-5 my-4" />
      ) : loading ? (
        <LoadingState label="正在加载规则候选" rows={2} />
      ) : !data || data.items.length === 0 ? (
        <AdminEmptyState message="还没有待审核的规则候选" />
      ) : (
        <div className="divide-y divide-border px-5">
          {data.items.map((candidate) => (
            <article className="flex flex-wrap items-start justify-between gap-3 py-4" key={candidate.id}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{candidateKindLabel(candidate.kind)}</Badge>
                  <code className="max-w-full truncate rounded bg-muted px-2 py-1 text-sm text-foreground" title={candidate.value}>
                    {candidate.value}
                  </code>
                  <Badge className="bg-warning/10 text-warning">待审核</Badge>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-foreground">{candidate.latestExample?.reason || '未记录候选理由'}</p>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>例证 {candidate.exampleCount} 本</span>
                  {candidate.latestExample?.novelTitle && <span>来源：{candidate.latestExample.novelTitle}</span>}
                  <span>提交人：{candidate.createdByName || '系统'}</span>
                  <span>{timeAgo(candidate.updatedAt) || '刚刚'}</span>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </AdminDataPanel>
  )
}

export default function ContentRatingsTab() {
  const { toast } = useToast()
  const [data, setData] = useState<Awaited<ReturnType<typeof adminApi.contentRatings.list>> | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [query, setQuery] = useState('')
  const [ratingFilter, setRatingFilter] = useState<ContentRating | ''>('')
  const [sourceFilter, setSourceFilter] = useState<AdminContentRatingSource | ''>('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(ADMIN_DEFAULT_PAGE_SIZE)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState('')

  const [editing, setEditing] = useState<AdminContentRatingItem | null>(null)
  const [draftRating, setDraftRating] = useState<ContentRating>('unknown')
  const [draftReason, setDraftReason] = useState('')
  const [editError, setEditError] = useState('')
  const [saving, setSaving] = useState(false)

  const [historyNovel, setHistoryNovel] = useState<AdminContentRatingItem | null>(null)
  const [history, setHistory] = useState<AdminContentRatingHistoryItem[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState('')

  const [candidateData, setCandidateData] = useState<AdminContentRatingRuleCandidateListResponse | null>(null)
  const [candidateLoading, setCandidateLoading] = useState(true)
  const [candidateError, setCandidateError] = useState('')
  const [candidateNovel, setCandidateNovel] = useState<AdminContentRatingItem | null>(null)
  const [candidateKind, setCandidateKind] = useState<AdminContentRatingRuleCandidateKind>('category')
  const [candidateValue, setCandidateValue] = useState('')
  const [candidateReason, setCandidateReason] = useState('')
  const [candidateFormError, setCandidateFormError] = useState('')
  const [candidateSaving, setCandidateSaving] = useState(false)

  const listSeqRef = useRef(0)
  const historySeqRef = useRef(0)

  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(searchInput.trim())
      setPage(1)
    }, 250)
    return () => clearTimeout(timer)
  }, [searchInput])

  const load = useCallback(
    async (refresh = false) => {
      const seq = ++listSeqRef.current
      if (refresh) setRefreshing(true)
      else setLoading(true)
      setLoadError('')

      try {
        const response = await adminApi.contentRatings.list({
          rating: ratingFilter,
          source: sourceFilter,
          search: query,
          limit: pageSize,
          offset: (page - 1) * pageSize,
        })
        if (seq !== listSeqRef.current) return
        setData(response)
        const totalPages = Math.max(1, Math.ceil(response.total / pageSize))
        if (page > totalPages) setPage(totalPages)
      } catch (error) {
        if (seq !== listSeqRef.current) return
        setLoadError(errorMessage(error, '请检查网络后重试'))
      } finally {
        if (seq === listSeqRef.current) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    },
    [page, pageSize, query, ratingFilter, sourceFilter],
  )

  useEffect(() => {
    // This effect owns the remote list synchronization; load() updates the async status around the request.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  const loadCandidates = useCallback(async () => {
    setCandidateLoading(true)
    setCandidateError('')
    try {
      const response = await adminApi.contentRatingRuleCandidates.list({ status: 'pending', limit: 20, offset: 0 })
      setCandidateData(response)
    } catch (error) {
      setCandidateError(errorMessage(error, '请检查网络后重试'))
    } finally {
      setCandidateLoading(false)
    }
  }, [])

  useEffect(() => {
    // This effect keeps the pending-candidate panel synchronized with the remote audit queue.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadCandidates()
  }, [loadCandidates])

  const openEdit = useCallback((item: AdminContentRatingItem) => {
    setEditing(item)
    setDraftRating(item.contentRating)
    setDraftReason('')
    setEditError('')
  }, [])

  const openCandidate = useCallback((item: AdminContentRatingItem) => {
    setCandidateNovel(item)
    setCandidateKind('category')
    setCandidateValue('')
    setCandidateReason('')
    setCandidateFormError('')
  }, [])

  const openHistory = useCallback(async (item: AdminContentRatingItem) => {
    const seq = ++historySeqRef.current
    setHistoryNovel(item)
    setHistory([])
    setHistoryError('')
    setHistoryLoading(true)
    try {
      const response = await adminApi.contentRatings.history(item.id)
      if (seq === historySeqRef.current) setHistory(response.history || [])
    } catch (error) {
      if (seq === historySeqRef.current) setHistoryError(errorMessage(error, '历史记录加载失败'))
    } finally {
      if (seq === historySeqRef.current) setHistoryLoading(false)
    }
  }, [])

  async function saveEdit() {
    if (!editing) return
    const reason = draftReason.replace(/[\x00-\x1F\x7F]/g, '').trim()
    if (!reason) {
      setEditError('请填写本次修改的理由，便于后续复核。')
      return
    }

    setSaving(true)
    setEditError('')
    try {
      await adminApi.contentRatings.update(editing.id, {
        contentRating: draftRating,
        reason,
        expectedRevision: editing.revision,
      })
      setEditing(null)
      toast('作品分级已更新，修改理由已写入审计记录', 'success')
      await load(true)
      await loadCandidates()
    } catch (error) {
      if (isConflictError(error)) {
        setEditing(null)
        toast('作品分级已被其他管理员修改，列表已刷新，请重新打开后提交', 'error')
        await load(true)
      } else {
        setEditError(errorMessage(error, '保存失败，请稍后重试'))
      }
    } finally {
      setSaving(false)
    }
  }

  async function saveCandidate() {
    if (!candidateNovel) return
    const value = candidateValue.trim()
    const reason = candidateReason.trim()
    if (!value) {
      setCandidateFormError('请填写要沉淀的分类标签或文本短语。')
      return
    }
    if (!reason) {
      setCandidateFormError('请填写为什么这个值可以作为限制级判断依据。')
      return
    }

    setCandidateSaving(true)
    setCandidateFormError('')
    try {
      const result = await adminApi.contentRatingRuleCandidates.create({
        novelId: candidateNovel.id,
        kind: candidateKind,
        value,
        reason,
      })
      setCandidateNovel(null)
      toast(result.created ? '已生成待审核规则候选，不会立即影响其他作品' : '候选已存在，已尝试补充这本书的人工例证', 'success')
      await loadCandidates()
    } catch (error) {
      setCandidateFormError(errorMessage(error, '规则候选保存失败，请稍后重试'))
    } finally {
      setCandidateSaving(false)
    }
  }

  const counts = data?.counts || EMPTY_COUNTS
  const totalPages = Math.max(1, Math.ceil((data?.total || 0) / pageSize))
  const sourceOptions = useMemo(() => {
    const available = new Set(data?.sources || Object.keys(SOURCE_LABEL))
    return SOURCE_OPTIONS.filter((option) => !option.value || available.has(option.value))
  }, [data?.sources])
  const summary = data?.total
    ? `共 ${formatNumber(data.total)} 本，显示 ${(data.offset || 0) + 1}-${Math.min((data.offset || 0) + data.items.length, data.total)}`
    : '共 0 本'

  return (
    <AdminPage
      className="admin-redesign-page--content-ratings"
      title="分级管理"
      description="把作品的分级结果、判定依据和修改历史放在同一张治理账本上。"
      actions={
        <Button variant="secondary" size="sm" onClick={() => void load(true)} disabled={loading || refreshing}>
          <RefreshCw className={refreshing ? 'size-3.5 animate-spin' : 'size-3.5'} />
          {refreshing ? '同步中…' : '刷新账本'}
        </Button>
      }
    >
      <div className="space-y-4">
        <AdminMetricStrip
          ariaLabel="内容分级概览"
          items={[
            { id: 'all', label: '全部作品', value: data ? formatNumber(counts.general + counts.restricted + counts.unknown) : '—', detail: '本' },
            {
              id: 'unknown',
              label: '待标注',
              value: data ? formatNumber(counts.unknown) : '—',
              detail: counts.unknown > 0 ? '需要复核' : '已清零',
              detailTone: counts.unknown > 0 ? 'muted' : 'success',
            },
            { id: 'restricted', label: '限制级', value: data ? formatNumber(counts.restricted) : '—', detail: '需成人模式' },
            { id: 'general', label: '一般', value: data ? formatNumber(counts.general) : '—', detail: '已完成判定' },
          ]}
        />

        {loadError && data && <InlineError message={`分级账本同步失败：${loadError}`} onRetry={() => void load(true)} />}

        {!data ? (
          loading ? (
            <LoadingState className="admin-panel-card" label="正在加载内容分级账本" />
          ) : (
            <ErrorState className="admin-panel-card" message={`分级账本加载失败：${loadError || '未知错误'}`} onRetry={() => void load(true)} />
          )
        ) : (
          <AdminDataPanel ariaLabel="内容分级账本" columns={RATING_COLUMNS}>
            <AdminPanelHeading
              title={
                <span className="flex items-center gap-2">
                  <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
                  作品分级账本
                </span>
              }
              description="自动判定只提供依据，人工修改必须留下理由；未标注不会被当作一般。"
              status={<span className="text-xs text-muted-foreground">{loading ? '正在同步…' : `${formatNumber(data.total)} 本匹配`}</span>}
            />

            <AdminToolbar ariaLive="polite">
              <AdminSearch
                id="content-rating-search"
                type="search"
                label="搜索作品分级记录"
                placeholder="搜索标题、作者或修改理由…"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
              />
              <CustomSelect
                options={RATING_OPTIONS}
                value={ratingFilter}
                onChange={(value) => {
                  setRatingFilter(value as ContentRating | '')
                  setPage(1)
                }}
                compact
                aria-label="按分级筛选"
              />
              <CustomSelect
                options={sourceOptions}
                value={sourceFilter}
                onChange={(value) => {
                  setSourceFilter(value as AdminContentRatingSource | '')
                  setPage(1)
                }}
                compact
                aria-label="按来源筛选"
              />
            </AdminToolbar>

            {data.items.length === 0 ? (
              <AdminEmptyState message={query || ratingFilter || sourceFilter ? '当前筛选条件下没有作品' : '暂无内容分级记录'} />
            ) : (
              <Table className="admin-data-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>作品</TableHead>
                    <TableHead>当前分级</TableHead>
                    <TableHead>来源</TableHead>
                    <TableHead>判定证据</TableHead>
                    <TableHead>最近操作</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell data-primary="" data-label="作品">
                        <div className="min-w-0">
                          <div className="truncate font-medium text-foreground" title={item.title}>
                            {item.title || '未命名作品'}
                          </div>
                          <div className="mt-1 truncate text-xs text-muted-foreground">
                            {(item.author || '未知作者') + ' · ' + formatNumber(item.chapterCount) + ' 章'}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell data-label="当前分级">
                        <RatingBadge rating={item.contentRating} />
                      </TableCell>
                      <TableCell data-label="来源">
                        <div className="min-w-0">
                          <div className="truncate text-sm text-foreground">{sourceLabel(item.source)}</div>
                          <div className="mt-1 truncate text-xs text-muted-foreground">修订 {item.revision}</div>
                        </div>
                      </TableCell>
                      <TableCell data-label="判定证据">
                        <EvidenceList evidence={item.evidence} compact />
                        {item.ruleVersion && <div className="mt-1 truncate text-xs text-muted-foreground">规则：{item.ruleVersion}</div>}
                      </TableCell>
                      <TableCell data-label="最近操作">
                        <div className="min-w-0">
                          <div className="truncate text-sm text-foreground">{item.updatedByName || '系统'}</div>
                          <time
                            className="mt-1 block truncate text-xs text-muted-foreground"
                            dateTime={item.contentRatingUpdatedAt ? new Date(item.contentRatingUpdatedAt).toISOString() : undefined}
                            title={formatDateTime(item.contentRatingUpdatedAt)}
                          >
                            {timeAgo(item.contentRatingUpdatedAt) || '尚无操作时间'}
                          </time>
                        </div>
                      </TableCell>
                      <TableCell data-actions="">
                        <div className="admin-cell-actions justify-end">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="admin-icon-button"
                            aria-label={`查看 ${item.title} 的分级历史`}
                            title="查看历史"
                            onClick={() => void openHistory(item)}
                          >
                            <History aria-hidden="true" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="admin-icon-button"
                            aria-label={`修改 ${item.title} 的分级`}
                            title="修改分级"
                            onClick={() => openEdit(item)}
                          >
                            <Pencil aria-hidden="true" />
                          </Button>
                          {item.contentRating === 'restricted' && item.source === 'manual' && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="admin-icon-button"
                              aria-label={`从 ${item.title} 沉淀规则候选`}
                              title="沉淀规则候选"
                              onClick={() => openCandidate(item)}
                            >
                              <PlusCircle aria-hidden="true" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            <Pagination
              page={page}
              totalPages={totalPages}
              onPage={setPage}
              summary={summary}
              pageSize={{ value: pageSize, options: ADMIN_PAGE_SIZE_OPTIONS, onChange: setPageSize }}
              busy={loading || refreshing}
            />
          </AdminDataPanel>
        )}

        <RuleCandidatePanel data={candidateData} loading={candidateLoading} error={candidateError} onRetry={() => void loadCandidates()} />
      </div>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>修改分级 · {editing?.title || '作品'}</DialogTitle>
            <DialogDescription>人工修改会记录操作人、理由和当前版本。提交前请确认你看到的是最新记录。</DialogDescription>
          </DialogHeader>

          {editing && (
            <div className="grid gap-4">
              <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground">当前结果</span>
                  <RatingBadge rating={editing.contentRating} />
                  <span className="text-xs text-muted-foreground">
                    来源：{sourceLabel(editing.source)} · 修订 {editing.revision}
                  </span>
                </div>
                {editing.evidence.length > 0 && (
                  <div className="mt-3">
                    <EvidenceList evidence={editing.evidence} />
                  </div>
                )}
                {editing.reason && <p className="mt-3 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">最近理由：{editing.reason}</p>}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="content-rating-draft">新的分级</Label>
                <CustomSelect
                  options={EDIT_RATING_OPTIONS}
                  value={draftRating}
                  onChange={(value) => setDraftRating(ratingValue(value))}
                  aria-label="新的分级"
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="content-rating-reason">修改理由</Label>
                <Textarea
                  id="content-rating-reason"
                  value={draftReason}
                  onChange={(event) => setDraftReason(event.target.value)}
                  placeholder="例如：复核标题、分类和简介后，确认作品属于限制级。"
                  rows={4}
                  maxLength={500}
                  aria-invalid={!!editError}
                />
                <p className="text-xs text-muted-foreground">必填，最多 500 字；理由会进入分级审计历史。</p>
              </div>

              {editError && (
                <p className="text-sm text-destructive" role="alert">
                  {editError}
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditing(null)} disabled={saving}>
              取消
            </Button>
            <Button type="button" onClick={() => void saveEdit()} disabled={saving || !draftReason.trim()}>
              {saving ? '保存中…' : '保存分级'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!candidateNovel} onOpenChange={(open) => !open && setCandidateNovel(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>沉淀规则候选 · {candidateNovel?.title || '作品'}</DialogTitle>
            <DialogDescription>这里只记录人工经验，等后续预览和批准后才会影响新作品；本次操作不会立即修改其他作品的分级。</DialogDescription>
          </DialogHeader>

          {candidateNovel && (
            <div className="grid gap-4">
              <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground">人工来源</span>
                  <RatingBadge rating={candidateNovel.contentRating} />
                  <span className="text-xs text-muted-foreground">
                    修订 {candidateNovel.revision} · {candidateNovel.updatedByName || '管理员'}
                  </span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">只有人工确认的 restricted 作品可以生成候选；候选会保留这本书作为人工例证。</p>
              </div>

              <div className="grid gap-2">
                <Label>候选类型</Label>
                <CustomSelect
                  options={CANDIDATE_KIND_OPTIONS}
                  value={candidateKind}
                  onChange={(value) => setCandidateKind(value as AdminContentRatingRuleCandidateKind)}
                  aria-label="候选类型"
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="content-rating-candidate-value">{candidateKind === 'category' ? '分类标签' : '文本短语'}</Label>
                <Input
                  id="content-rating-candidate-value"
                  value={candidateValue}
                  onChange={(event) => setCandidateValue(event.target.value)}
                  placeholder={candidateKind === 'category' ? '例如：新的成人分类标签' : '例如：能够稳定指向限制级的短语'}
                  maxLength={160}
                />
                <p className="text-xs text-muted-foreground">
                  {candidateKind === 'category' ? '分类候选将按完整标签匹配，不会做模糊子串匹配。' : '文本候选先以字面短语保存，后续预览阶段再评估误命中范围。'}
                </p>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="content-rating-candidate-reason">候选理由</Label>
                <Textarea
                  id="content-rating-candidate-reason"
                  value={candidateReason}
                  onChange={(event) => setCandidateReason(event.target.value)}
                  placeholder="说明为什么这个标签或短语能作为限制级依据，以及你在这本书中观察到的证据。"
                  rows={4}
                  maxLength={500}
                  aria-invalid={!!candidateFormError}
                />
              </div>

              {candidateFormError && (
                <p className="text-sm text-destructive" role="alert">
                  {candidateFormError}
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCandidateNovel(null)} disabled={candidateSaving}>
              取消
            </Button>
            <Button type="button" onClick={() => void saveCandidate()} disabled={candidateSaving || !candidateValue.trim() || !candidateReason.trim()}>
              {candidateSaving ? '保存中…' : '保存待审核候选'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!historyNovel} onOpenChange={(open) => !open && setHistoryNovel(null)}>
        <DialogContent className="max-h-[min(80vh,720px)] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>分级历史 · {historyNovel?.title || '作品'}</DialogTitle>
            <DialogDescription>这里保留自动判定、预填和人工修改的完整变更轨迹，便于复核结果从哪里来。</DialogDescription>
          </DialogHeader>

          {historyLoading ? (
            <LoadingState label="正在加载分级历史" rows={3} />
          ) : historyError ? (
            <ErrorState message={historyError} onRetry={() => historyNovel && void openHistory(historyNovel)} />
          ) : history.length === 0 ? (
            <AdminEmptyState message="暂无分级历史记录" />
          ) : (
            <div aria-live="polite">
              {history.map((entry) => (
                <RatingHistoryRow key={entry.id} entry={entry} />
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AdminPage>
  )
}
