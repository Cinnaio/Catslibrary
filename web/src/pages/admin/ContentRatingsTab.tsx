import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bot, CheckCircle2, Eye, History, Pencil, PlusCircle, RefreshCw, ShieldCheck, Sparkles, XCircle } from 'lucide-react'
import {
  adminApi,
  aiApi,
  type AdminContentRatingEvidence,
  type AdminContentRatingHistoryItem,
  type AdminContentRatingItem,
  type AdminContentRatingAiListResponse,
  type AdminContentRatingAiSuggestion,
  type AdminContentRatingRuleCandidateKind,
  type AdminContentRatingRuleCandidateListResponse,
  type AdminContentRatingRuleCandidate,
  type AdminContentRatingRuleCandidatePreviewResponse,
  type AdminContentRatingSource,
  type AiTaskInfo,
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
  ai_task: 'AI 建议（人工确认）',
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
  onPreview,
}: {
  data: AdminContentRatingRuleCandidateListResponse | null
  loading: boolean
  error: string
  onRetry: () => void
  onPreview: (candidate: AdminContentRatingRuleCandidate) => void
}) {
  return (
    <AdminDataPanel ariaLabel="内容分级规则候选">
      <AdminPanelHeading
        title="规则候选"
        description="先预览会影响哪些未标注作品，再批准应用或拒绝候选；审核动作会保留理由和规则版本。"
        status={
          <span className="text-xs text-muted-foreground">
            待审核 {data ? formatNumber(data.counts.pending) : '—'} 条 · 当前规则 {data?.activeRuleVersion || '—'}
          </span>
        }
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
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => onPreview(candidate)}>
                  <Eye className="size-3.5" aria-hidden="true" />
                  预览影响
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
    </AdminDataPanel>
  )
}

function AiSuggestionPanel({
  data,
  loading,
  error,
  scanning,
  task,
  onRetry,
  onScan,
  onReview,
}: {
  data: AdminContentRatingAiListResponse | null
  loading: boolean
  error: string
  scanning: boolean
  task: AiTaskInfo | null
  onRetry: () => void
  onScan: () => void
  onReview: (suggestion: AdminContentRatingAiSuggestion) => void
}) {
  return (
    <AdminDataPanel ariaLabel="LLM 内容分级建议">
      <AdminPanelHeading
        title={
          <span className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" aria-hidden="true" />
            LLM 分级建议
          </span>
        }
        description="LLM 只分析未标注作品并生成待审核建议，输出限定为限制级或继续未标注；不会直接修改作品，也不会推断一般。"
        status={
          <span className="text-xs text-muted-foreground">
            待审核 {data ? formatNumber(data.counts.pending) : '—'} 条
            {task && task.status !== 'completed' && task.status !== 'failed' && task.status !== 'cancelled' ? ` · ${task.step || '分析中'}` : ''}
          </span>
        }
        actions={
          <Button type="button" size="sm" variant="secondary" onClick={onScan} disabled={scanning || (!!task && ['queued', 'running'].includes(task.status))}>
            <Bot className={scanning ? 'size-3.5 animate-pulse' : 'size-3.5'} aria-hidden="true" />
            {scanning ? '创建任务…' : '分析 unknown'}
          </Button>
        }
      />
      {error ? (
        <InlineError message={`LLM 建议加载失败：${error}`} onRetry={onRetry} className="mx-5 my-4" />
      ) : loading ? (
        <LoadingState label="正在加载 LLM 分级建议" rows={2} />
      ) : !data || data.items.length === 0 ? (
        <AdminEmptyState message="还没有待审核的 LLM 分级建议；分析任务只会读取 unknown 作品。" />
      ) : (
        <div className="divide-y divide-border px-5">
          {data.items.map((suggestion) => (
            <article className="flex flex-wrap items-start justify-between gap-3 py-4" key={suggestion.id}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">{suggestion.title || '未命名作品'}</span>
                  <Badge className={suggestion.suggestedRating === 'restricted' ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'}>
                    {suggestion.suggestedRating === 'restricted' ? '建议限制级' : '建议继续未标注'}
                  </Badge>
                  <Badge variant="outline">置信度 {Math.round(suggestion.confidence * 100)}%</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {suggestion.author || '未知作者'} · 模型 {suggestion.model || '未记录'} · {suggestion.promptVersion}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-foreground">{suggestion.reason || '未记录 AI 理由'}</p>
                {suggestion.evidence.length > 0 && (
                  <div className="mt-2">
                    <EvidenceList evidence={suggestion.evidence} compact />
                  </div>
                )}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => onReview(suggestion)}>
                  <Eye className="size-3.5" aria-hidden="true" />
                  审核建议
                </Button>
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
  const [candidatePreviewCandidate, setCandidatePreviewCandidate] = useState<AdminContentRatingRuleCandidate | null>(null)
  const [candidatePreview, setCandidatePreview] = useState<AdminContentRatingRuleCandidatePreviewResponse | null>(null)
  const [candidatePreviewLoading, setCandidatePreviewLoading] = useState(false)
  const [candidatePreviewError, setCandidatePreviewError] = useState('')
  const [candidateReviewDecision, setCandidateReviewDecision] = useState<'approve' | 'reject' | null>(null)
  const [candidateReviewReason, setCandidateReviewReason] = useState('')
  const [candidateReviewError, setCandidateReviewError] = useState('')
  const [candidateReviewSaving, setCandidateReviewSaving] = useState(false)

  const [aiData, setAiData] = useState<AdminContentRatingAiListResponse | null>(null)
  const [aiLoading, setAiLoading] = useState(true)
  const [aiError, setAiError] = useState('')
  const [aiScanning, setAiScanning] = useState(false)
  const [aiTask, setAiTask] = useState<AiTaskInfo | null>(null)
  const [aiReviewSuggestion, setAiReviewSuggestion] = useState<AdminContentRatingAiSuggestion | null>(null)
  const [aiReviewDecision, setAiReviewDecision] = useState<'approve' | 'reject' | null>(null)
  const [aiReviewReason, setAiReviewReason] = useState('')
  const [aiReviewError, setAiReviewError] = useState('')
  const [aiReviewSaving, setAiReviewSaving] = useState(false)

  const listSeqRef = useRef(0)
  const historySeqRef = useRef(0)
  const candidatePreviewSeqRef = useRef(0)

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

  const loadAiSuggestions = useCallback(async () => {
    setAiLoading(true)
    setAiError('')
    try {
      const response = await adminApi.contentRatingAi.list({ status: 'pending', limit: 20, offset: 0 })
      setAiData(response)
    } catch (error) {
      setAiError(errorMessage(error, '请检查网络后重试'))
    } finally {
      setAiLoading(false)
    }
  }, [])

  useEffect(() => {
    // This effect keeps the LLM review queue synchronized with the pending suggestions.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadAiSuggestions()
  }, [loadAiSuggestions])

  useEffect(() => {
    const taskId = aiTask?.id
    const taskStatus = aiTask?.status
    if (!taskId || !taskStatus || !['queued', 'running'].includes(taskStatus)) return
    let active = true
    const poll = async () => {
      try {
        const response = await aiApi.task(taskId)
        if (!active) return
        setAiTask(response.task)
        if (['completed', 'failed', 'cancelled'].includes(response.task.status)) {
          await Promise.all([loadAiSuggestions(), load(true)])
        }
      } catch (error) {
        if (active) setAiError(errorMessage(error, 'LLM 任务状态读取失败'))
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 1_500)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [aiTask?.id, aiTask?.status, load, loadAiSuggestions])

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

  const closeCandidatePreview = useCallback(() => {
    setCandidatePreviewCandidate(null)
    setCandidatePreview(null)
    setCandidatePreviewError('')
    setCandidateReviewDecision(null)
    setCandidateReviewReason('')
    setCandidateReviewError('')
  }, [])

  const openCandidatePreview = useCallback(async (candidate: AdminContentRatingRuleCandidate) => {
    const seq = ++candidatePreviewSeqRef.current
    setCandidatePreviewCandidate(candidate)
    setCandidatePreview(null)
    setCandidatePreviewError('')
    setCandidateReviewDecision(null)
    setCandidateReviewReason('')
    setCandidateReviewError('')
    setCandidatePreviewLoading(true)
    try {
      const response = await adminApi.contentRatingRuleCandidates.preview(candidate.id, { limit: 100, offset: 0 })
      if (seq === candidatePreviewSeqRef.current) setCandidatePreview(response)
    } catch (error) {
      if (seq === candidatePreviewSeqRef.current) setCandidatePreviewError(errorMessage(error, '规则影响预览失败，请稍后重试'))
    } finally {
      if (seq === candidatePreviewSeqRef.current) setCandidatePreviewLoading(false)
    }
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

  async function reviewCandidate() {
    if (!candidatePreviewCandidate || !candidatePreview || !candidateReviewDecision) return
    const reason = candidateReviewReason.trim()
    if (!reason) {
      setCandidateReviewError('请填写本次审核决定的理由。')
      return
    }

    setCandidateReviewSaving(true)
    setCandidateReviewError('')
    try {
      const result = await adminApi.contentRatingRuleCandidates.review(candidatePreviewCandidate.id, {
        decision: candidateReviewDecision,
        expectedRevision: candidatePreview.candidate.revision,
        reason,
      })
      closeCandidatePreview()
      toast(result.decision === 'approve' ? `规则已批准并应用，影响 ${formatNumber(result.appliedCount)} 本作品` : '规则候选已拒绝，未修改任何作品', 'success')
      await Promise.all([load(true), loadCandidates()])
    } catch (error) {
      if ((error as ApiError | null)?.status === 409) {
        setCandidateReviewError('规则候选已被其他管理员处理，请关闭后重新加载候选列表。')
      } else {
        setCandidateReviewError(errorMessage(error, '规则审核失败，请稍后重试'))
      }
    } finally {
      setCandidateReviewSaving(false)
    }
  }

  async function scanAiSuggestions() {
    setAiScanning(true)
    setAiError('')
    try {
      const result = await adminApi.contentRatingAi.scan({ limit: 20 })
      if (!result.taskId) {
        toast(result.message || '当前没有可分析的 unknown 作品', 'info')
      } else {
        setAiTask(result.task || null)
        toast(`已提交 LLM 分析任务，将生成 ${formatNumber(result.selected)} 条待审核建议`, 'success')
      }
      await loadAiSuggestions()
    } catch (error) {
      setAiError(errorMessage(error, 'LLM 分析任务创建失败，请检查文本 AI 配置'))
    } finally {
      setAiScanning(false)
    }
  }

  function openAiReview(suggestion: AdminContentRatingAiSuggestion) {
    setAiReviewSuggestion(suggestion)
    setAiReviewDecision(null)
    setAiReviewReason('')
    setAiReviewError('')
  }

  function closeAiReview(force = false) {
    if (aiReviewSaving && !force) return
    setAiReviewSuggestion(null)
    setAiReviewDecision(null)
    setAiReviewReason('')
    setAiReviewError('')
  }

  async function reviewAiSuggestion() {
    if (!aiReviewSuggestion || !aiReviewDecision) return
    const reason = aiReviewReason.trim()
    if (!reason) {
      setAiReviewError('请填写本次审核决定的理由。')
      return
    }

    setAiReviewSaving(true)
    setAiReviewError('')
    try {
      const result = await adminApi.contentRatingAi.review(aiReviewSuggestion.id, {
        decision: aiReviewDecision,
        expectedRevision: aiReviewSuggestion.revision,
        reason,
      })
      closeAiReview(true)
      if (result.decision === 'approve' && result.applied) {
        toast('AI 建议已批准，作品已标为限制级；操作已写入审计记录', 'success')
      } else if (result.decision === 'approve') {
        toast('AI 建议已批准，但未标为限制级的建议仍保持 unknown', 'success')
      } else {
        toast('AI 分级建议已拒绝，作品分级未修改', 'success')
      }
      await Promise.all([load(true), loadAiSuggestions()])
    } catch (error) {
      if ((error as ApiError | null)?.status === 409) {
        setAiReviewError('作品或 AI 建议已被其他管理员更新，请关闭后重新加载。')
      } else {
        setAiReviewError(errorMessage(error, 'AI 建议审核失败，请稍后重试'))
      }
    } finally {
      setAiReviewSaving(false)
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

        <RuleCandidatePanel
          data={candidateData}
          loading={candidateLoading}
          error={candidateError}
          onRetry={() => void loadCandidates()}
          onPreview={(candidate) => void openCandidatePreview(candidate)}
        />

        <AiSuggestionPanel
          data={aiData}
          loading={aiLoading}
          error={aiError}
          scanning={aiScanning}
          task={aiTask}
          onRetry={() => void loadAiSuggestions()}
          onScan={() => void scanAiSuggestions()}
          onReview={openAiReview}
        />
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

      <Dialog open={!!candidatePreviewCandidate} onOpenChange={(open) => !open && !candidateReviewSaving && closeCandidatePreview()}>
        <DialogContent className="max-h-[min(86vh,800px)] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>预览规则影响 · {candidatePreviewCandidate?.value || '规则候选'}</DialogTitle>
            <DialogDescription>批准会把命中的未标注作品改为限制级，并把规则版本写入分级审计；一般作品和已人工确认的作品不会被覆盖。</DialogDescription>
          </DialogHeader>

          {candidatePreviewLoading ? (
            <LoadingState label="正在计算未标注作品的影响范围" rows={4} />
          ) : candidatePreviewError ? (
            <ErrorState message={candidatePreviewError} onRetry={() => candidatePreviewCandidate && void openCandidatePreview(candidatePreviewCandidate)} />
          ) : candidatePreview ? (
            <div className="grid gap-4">
              <div className="rounded-md border border-border bg-muted/30 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{candidateKindLabel(candidatePreview.candidate.kind)}</Badge>
                  <code className="rounded bg-background px-2 py-1 text-sm">{candidatePreview.candidate.value}</code>
                  <Badge className="bg-warning/10 text-warning">待审核</Badge>
                </div>
                <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
                  <div>
                    <span className="text-muted-foreground">预计影响</span>
                    <strong className="ml-2 text-foreground">{formatNumber(candidatePreview.affectedCount)} 本</strong>
                  </div>
                  <div>
                    <span className="text-muted-foreground">当前规则</span>
                    <code className="ml-2 text-xs text-foreground">{candidatePreview.currentRuleVersion}</code>
                  </div>
                  <div>
                    <span className="text-muted-foreground">批准后版本</span>
                    <code className="ml-2 text-xs text-foreground">{candidatePreview.prospectiveRuleVersion}</code>
                  </div>
                </div>
              </div>

              {candidatePreview.items.length === 0 ? (
                <AdminEmptyState message="当前没有命中的未标注作品；批准后仍会对后续新作品生效。" />
              ) : (
                <div className="rounded-md border border-border">
                  <div className="border-b border-border px-4 py-3 text-sm font-medium text-foreground">将被改为限制级的未标注作品</div>
                  <div className="divide-y divide-border px-4">
                    {candidatePreview.items.map((item) => (
                      <article className="flex flex-wrap items-start justify-between gap-3 py-3" key={item.novelId}>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">{item.title}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {item.author || '未知作者'} · 修订 {item.revision} · {item.matchedFields.join('、') || '规则命中'}
                          </p>
                        </div>
                        <EvidenceList evidence={item.evidence} compact />
                      </article>
                    ))}
                  </div>
                  {candidatePreview.affectedCount > candidatePreview.items.length && (
                    <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
                      仅展示前 {candidatePreview.items.length} 本，实际影响范围为 {formatNumber(candidatePreview.affectedCount)} 本。
                    </p>
                  )}
                </div>
              )}

              {candidateReviewDecision && (
                <div className="grid gap-2 rounded-md border border-border bg-background p-4">
                  <Label htmlFor="content-rating-candidate-review-reason">{candidateReviewDecision === 'approve' ? '批准理由' : '拒绝理由'}</Label>
                  <Textarea
                    id="content-rating-candidate-review-reason"
                    value={candidateReviewReason}
                    onChange={(event) => setCandidateReviewReason(event.target.value)}
                    placeholder={
                      candidateReviewDecision === 'approve'
                        ? '说明为什么影响范围可接受，并批准该规则进入自动判定。'
                        : '说明为什么样本不足、误命中风险过高或暂不纳入规则。'
                    }
                    rows={4}
                    maxLength={500}
                    aria-invalid={!!candidateReviewError}
                  />
                  <p className="text-xs text-muted-foreground">理由会写入候选审核记录；批准后命中的作品会各自产生分级审计记录。</p>
                </div>
              )}

              {candidateReviewError && (
                <p className="text-sm text-destructive" role="alert">
                  {candidateReviewError}
                </p>
              )}
            </div>
          ) : null}

          <DialogFooter>
            {!candidateReviewDecision ? (
              <>
                <Button type="button" variant="outline" onClick={closeCandidatePreview} disabled={candidateReviewSaving}>
                  取消
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setCandidateReviewDecision('reject')}
                  disabled={candidatePreviewLoading || !candidatePreview}
                >
                  <XCircle className="size-3.5" aria-hidden="true" />
                  拒绝候选
                </Button>
                <Button type="button" onClick={() => setCandidateReviewDecision('approve')} disabled={candidatePreviewLoading || !candidatePreview}>
                  <CheckCircle2 className="size-3.5" aria-hidden="true" />
                  批准并应用
                </Button>
              </>
            ) : (
              <>
                <Button type="button" variant="outline" onClick={() => setCandidateReviewDecision(null)} disabled={candidateReviewSaving}>
                  返回预览
                </Button>
                <Button type="button" onClick={() => void reviewCandidate()} disabled={candidateReviewSaving || !candidateReviewReason.trim()}>
                  {candidateReviewSaving ? '提交中…' : candidateReviewDecision === 'approve' ? '确认批准并应用' : '确认拒绝候选'}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!aiReviewSuggestion} onOpenChange={(open) => !open && closeAiReview()}>
        <DialogContent className="max-h-[min(86vh,800px)] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>审核 LLM 分级建议 · {aiReviewSuggestion?.title || '作品'}</DialogTitle>
            <DialogDescription>批准限制级建议前请核对元数据证据。LLM 不能直接发布分级；批准“继续未标注”也不会把作品改为一般。</DialogDescription>
          </DialogHeader>

          {aiReviewSuggestion && (
            <div className="grid gap-4">
              <div className="rounded-md border border-border bg-muted/30 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground">AI 建议</span>
                  <Badge
                    className={aiReviewSuggestion.suggestedRating === 'restricted' ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'}
                  >
                    {aiReviewSuggestion.suggestedRating === 'restricted' ? '限制级' : '继续未标注'}
                  </Badge>
                  <Badge variant="outline">置信度 {Math.round(aiReviewSuggestion.confidence * 100)}%</Badge>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-foreground">{aiReviewSuggestion.reason || '未记录 AI 理由'}</p>
                <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>模型：{aiReviewSuggestion.model || '未记录'}</span>
                  <span>提示版本：{aiReviewSuggestion.promptVersion}</span>
                  <span>作品修订：{aiReviewSuggestion.novelRevision}</span>
                </div>
                {aiReviewSuggestion.evidence.length > 0 && (
                  <div className="mt-3">
                    <p className="mb-2 text-xs font-medium text-muted-foreground">模型提取的证据</p>
                    <EvidenceList evidence={aiReviewSuggestion.evidence} />
                  </div>
                )}
              </div>

              <div className="rounded-md border border-border p-4 text-sm">
                <p className="font-medium text-foreground">审核边界</p>
                <p className="mt-2 leading-relaxed text-muted-foreground">
                  当前作品仍是 <RatingBadge rating={aiReviewSuggestion.currentRating} />
                  ；提交时会再次锁定作品并校验修订号。只有管理员批准“限制级”建议时，才会写入
                  <code className="mx-1 rounded bg-muted px-1.5 py-0.5 text-xs">ai_task</code>
                  分级审计。
                </p>
              </div>

              {aiReviewDecision && (
                <div className="grid gap-2 rounded-md border border-border bg-background p-4">
                  <Label htmlFor="content-rating-ai-review-reason">{aiReviewDecision === 'approve' ? '批准理由' : '拒绝理由'}</Label>
                  <Textarea
                    id="content-rating-ai-review-reason"
                    value={aiReviewReason}
                    onChange={(event) => setAiReviewReason(event.target.value)}
                    placeholder={
                      aiReviewDecision === 'approve' ? '说明为什么元数据证据足以支持这次人工确认。' : '说明为什么证据不足、存在误判风险或暂不采纳该建议。'
                    }
                    rows={4}
                    maxLength={500}
                    aria-invalid={!!aiReviewError}
                  />
                </div>
              )}

              {aiReviewError && (
                <p className="text-sm text-destructive" role="alert">
                  {aiReviewError}
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            {!aiReviewDecision ? (
              <>
                <Button type="button" variant="outline" onClick={closeAiReview} disabled={aiReviewSaving}>
                  取消
                </Button>
                <Button type="button" variant="outline" onClick={() => setAiReviewDecision('reject')} disabled={aiReviewSaving}>
                  <XCircle className="size-3.5" aria-hidden="true" />
                  拒绝建议
                </Button>
                <Button type="button" onClick={() => setAiReviewDecision('approve')} disabled={aiReviewSaving}>
                  <CheckCircle2 className="size-3.5" aria-hidden="true" />
                  进入批准确认
                </Button>
              </>
            ) : (
              <>
                <Button type="button" variant="outline" onClick={() => setAiReviewDecision(null)} disabled={aiReviewSaving}>
                  返回查看
                </Button>
                <Button type="button" onClick={() => void reviewAiSuggestion()} disabled={aiReviewSaving || !aiReviewReason.trim()}>
                  {aiReviewSaving ? '提交中…' : aiReviewDecision === 'approve' ? '确认批准建议' : '确认拒绝建议'}
                </Button>
              </>
            )}
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
