import { MotionDetails } from '@/components/ui/motion'
import '../../styles/admin/pages/content-ratings.css'
import { startPolling } from '@/lib/polling'
import AdminContentRatingBadge from '@/components/admin/AdminContentRatingBadge'
import { DialogBody, DialogFrame } from "@/components/shared/DialogFrame"
import AdminStatusBadge from '@/components/admin/AdminStatusBadge'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bot, CheckCircle2, Eye, History, Info, Play, PlusCircle, RefreshCw, Square, XCircle } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  adminApi,
  aiApi,
  type AdminContentRatingEvidence,
  type AdminContentRatingHistoryItem,
  type AdminContentRatingItem,
  type AdminContentRatingAiListResponse,
  type AdminContentRatingAiSuggestion,
  type AdminContentRatingAiTaskProgress,
  type AdminContentRatingRuleCandidateKind,
  type AdminContentRatingRuleCandidateListResponse,
  type AdminContentRatingRuleCandidate,
  type AdminContentRatingRuleCandidatePreviewResponse,
  type AdminContentRatingSource,
  type AiReasoningMode,
  type AiTaskInfo,
  type ApiError,
} from '@/lib/api'
import { formatDateTime, timeAgo } from '@/lib/format'
import type { ContentRating } from '@shared/types'
import { cn } from '@/lib/utils'
import { getAdminTableRowStaggerDelay } from '@/lib/admin-table-motion'
import { useToast } from '@/components/feedback'
import EmptyState from "@/components/shared/EmptyState"
import AdminPage from '@/components/admin/AdminPage'
import { ErrorState, InlineError, LoadingState } from "@/components/shared/AsyncStates"
import SearchSelect, { type SelectOption } from "@/components/shared/SearchSelect"
import Pagination from "@/components/shared/Pagination"
import { ADMIN_DEFAULT_PAGE_SIZE, ADMIN_PAGE_SIZE_OPTIONS } from '@/lib/admin-pagination'
import AdminSelectionBar from '@/components/admin/AdminSelectionBar'
import { AdminDataPanel, type AdminColumn } from '@/components/admin/AdminDataPanel'
import { SearchField } from '@/components/shared/SearchField'
import { AdminToolbar } from '@/components/admin/AdminToolbar'
import AiSuggestionBulkReview from './AiSuggestionBulkReview'
import ContentRatingAiReview from './ContentRatingAiReview'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

type RatingView = 'ledger' | 'rules' | 'ai'

function ratingView(value: string | null): RatingView {
  return value === 'rules' || value === 'ai' ? value : 'ledger'
}

const RATING_OPTIONS: SelectOption[] = [
  { value: '', label: '全部' },
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

const SOURCE_OPTIONS: SelectOption[] = [{ value: '', label: '全部' }, ...Object.entries(SOURCE_LABEL).map(([value, label]) => ({ value, label }))]

const RATING_COLUMNS: readonly AdminColumn[] = [
  { key: 'work', label: '作品', width: '21%', primary: true },
  { key: 'rating', label: '当前分级', width: '11%' },
  { key: 'source', label: '来源', width: '14%' },
  { key: 'evidence', label: '判定证据', width: '25%' },
  { key: 'updated', label: '最近操作', width: '13%' },
  { key: 'actions', label: '操作', width: '16%', actions: true },
]

const AI_SUGGESTION_COLUMNS: readonly AdminColumn[] = [
  { key: 'work', label: '作品', width: '22%', primary: true },
  { key: 'rating', label: 'AI 建议', width: '13%' },
  { key: 'model', label: '模型与规则', width: '15%' },
  { key: 'evidence', label: '判定依据与证据', width: '38%' },
  { key: 'actions', label: '操作', width: '12%', actions: true },
]

const CANDIDATE_KIND_OPTIONS: SelectOption[] = [
  { value: 'category', label: '分类标签' },
  { value: 'phrase', label: '文本短语' },
]

const EMPTY_COUNTS = { general: 0, restricted: 0, unknown: 0 }

/**
 * 单次 LLM 分析的批次规模。服务端上限 100，这里给几档显式选项。
 *
 * 为什么必须可调：批次就是断点的边界。固定 20 时，398 本 unknown 要跑 20 次
 * 手动点击，且每次中止后「剩余缺口」只在这一批内计算，用户看到的是「无缺口」，
 * 会误以为全库已经分析完。放开选择后，一次点满 100 就能覆盖整批。
 */
const AI_BATCH_LIMIT_OPTIONS: SelectOption[] = [
  { value: '20', label: '20 本' },
  { value: '50', label: '50 本' },
  { value: '100', label: '100 本（单批上限）' },
]
const DEFAULT_AI_BATCH_LIMIT = 20
const AI_BATCH_LIMIT_MAX = 100

function formatNumber(value: number): string {
  return Number(value || 0).toLocaleString('zh-CN')
}

function ratingValue(value: string): ContentRating {
  return value === 'general' || value === 'restricted' ? value : 'unknown'
}

function evidenceLabel(item: AdminContentRatingEvidence): string {
  if (item.type === 'category') return item.value ? `分类：${item.value}` : '分类命中'
  if (item.type === 'text') {
    const field = item.field === 'title' ? '标题' : item.field === 'description' ? '简介' : item.field === 'body' ? '正文' : '文本'
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
    <div className={compact ? 'admin-cell-tags' : 'content-ratings-evidence'} title={evidence.map(evidenceLabel).join('、')}>
      {visible.map((item, index) => (
        <Badge key={`${item.type}-${item.field || ''}-${index}`} variant="outline" className={compact ? 'admin-cell-tags__tag max-w-full truncate font-normal' : 'content-ratings-evidence__tag font-normal'}>
          {evidenceLabel(item)}
        </Badge>
      ))}
      {overflow > 0 && <span className="admin-cell-tags__overflow">+{overflow}</span>}
    </div>
  )
}

function EvidenceCell({ item, onInspect }: { item: AdminContentRatingItem; onInspect?: () => void }) {
  const categories = item.evidence
    .filter((e) => e.type === 'category' && e.value)
    .map((e) => e.value as string)
  const textMatches = item.evidence.filter((e) => e.type === 'text')
  const textLabels = [...new Set(textMatches.map(evidenceLabel))].join('、')

  let primaryLabel = ''
  let isClean = false

  if (categories.length > 0 && textMatches.length > 0) {
    primaryLabel = `分类：${categories.slice(0, 2).join('、')} · ${textLabels}`
  } else if (categories.length > 0) {
    primaryLabel = `分类：${categories.slice(0, 3).join('、')}${categories.length > 3 ? ' 等' : ''}`
  } else if (textMatches.length > 0) {
    primaryLabel = textLabels
  } else if (item.evidence.length > 0) {
    primaryLabel = item.evidence.map(evidenceLabel).slice(0, 2).join('、')
  } else {
    isClean = true
    primaryLabel = item.source === 'manual' ? '人工指定分级' : '未记录判定证据'
  }

  let secondaryLabel = ''
  if (item.ruleVersion?.startsWith('llm:')) {
    const modelMatch = item.ruleVersion.match(/llm:([^:]+)/)
    const rawModel = modelMatch?.[1] ?? ''
    const modelName = rawModel.includes('deepseek') ? 'DeepSeek' : rawModel ? (rawModel.split('-')[0] ?? 'AI') : 'AI'
    const note = item.reason && !isGenericSystemReason(item.reason)
      ? item.reason.replace(/^管理员批准\s*AI\s*分级建议[：:]\s*/, '')
      : ''
    secondaryLabel = note ? `${modelName} 模型 · ${note}` : `${modelName} 模型建议判定`
  } else if (item.ruleVersion) {
    const vTag = item.ruleVersion.replace(/^restricted-rules-/, '')
    const ruleDisplayTag = vTag ? `规则 ${vTag}` : item.ruleVersion
    if (item.source === 'source_import') secondaryLabel = `${ruleDisplayTag} · 导入时执行`
    else if (item.source === 'prefill') secondaryLabel = `${ruleDisplayTag} · 规则预填`
    else if (item.source === 'system') secondaryLabel = `${ruleDisplayTag} · 系统扫描`
    else secondaryLabel = ruleDisplayTag
  } else if (item.reason && !isGenericSystemReason(item.reason)) {
    secondaryLabel = item.reason
  } else if (item.source === 'manual') {
    secondaryLabel = '小说编辑手动修改'
  } else {
    secondaryLabel = '未记录判定方式'
  }

  return (
    <button
      type="button"
      onClick={onInspect}
      aria-label={`查看 ${item.title || '作品'} 的判定依据`}
      className="content-ratings-evidence-cell text-left min-w-0 w-full group rounded-md py-1 px-1.5 -mx-1.5 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary cursor-pointer"
      title="点击查看完整判定证据链"
    >
      <div className={cn('truncate text-sm font-medium transition-colors group-hover:text-primary', isClean ? 'text-muted-foreground/75' : 'text-foreground')}>
        {primaryLabel}
      </div>
      <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground group-hover:text-foreground/70">
        <span className="truncate">{secondaryLabel}</span>
        <span className="shrink-0 text-primary">查看依据</span>
      </div>
    </button>
  )
}

function sourceLabel(source: AdminContentRatingSource): string {
  return SOURCE_LABEL[source] || source
}

function isGenericSystemReason(reason?: string | null): boolean {
  if (!reason) return true
  const trimmed = reason.trim()
  return (
    trimmed === '书籍导入时执行内容分级规则' ||
    trimmed === '创建作品时执行分级规则' ||
    trimmed === '执行全量内容分级规则扫描' ||
    trimmed === '系统自动执行分级规则' ||
    trimmed === '批量执行内容分级规则' ||
    trimmed === '规则版本批量重算' ||
    trimmed.startsWith('执行内容分级规则')
  )
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
          <AdminContentRatingBadge rating={entry.fromRating} />
          <span className="text-muted-foreground" aria-hidden="true">
            →
          </span>
          <AdminContentRatingBadge rating={entry.toRating} />
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
    <AdminDataPanel ariaLabel="内容分级规则候选" className="content-ratings-panel content-ratings-rules-panel">
      <AdminToolbar layout="inline" className="admin-filter-rail content-ratings-meta-rail">
        <p className="content-ratings-panel-description-inline">
          从人工判定中沉淀规则，先核对命中作品，再决定是否启用。批准仅影响未标注作品，保留已人工确认的分级。
        </p>
        <span className="text-xs tabular-nums text-muted-foreground ml-auto shrink-0">
          待审核 {data ? formatNumber(data.counts.pending) : '—'} 条 · 当前规则 {data?.activeRuleVersion || '—'}
        </span>
      </AdminToolbar>
      {error ? (
        <ErrorState message={`规则候选加载失败：${error}`} onRetry={onRetry} />
      ) : loading ? (
        <LoadingState label="正在加载规则候选" rows={2} />
      ) : !data || data.items.length === 0 ? (
        <EmptyState message="还没有待审核的规则候选" />
      ) : (
        <div className="content-ratings-queue">
          {data.items.map((candidate, index) => (
            <article className="content-ratings-queue-item" key={candidate.id} style={{ animationDelay: `${getAdminTableRowStaggerDelay(index, data.items.length)}ms` }}>
              <div className="content-ratings-queue-copy">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{candidateKindLabel(candidate.kind)}</Badge>
                  <code className="max-w-full truncate rounded bg-muted px-2 py-1 text-sm text-foreground" title={candidate.value}>
                    {candidate.value}
                  </code>
                  <AdminStatusBadge tone="warning">待审核</AdminStatusBadge>
                </div>
                <p className="content-ratings-queue-reason">{candidate.latestExample?.reason || '未记录候选理由'}</p>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>例证 {candidate.exampleCount} 本</span>
                  {candidate.latestExample?.novelTitle && <span>来源：{candidate.latestExample.novelTitle}</span>}
                  <span>提交人：{candidate.createdByName || '系统'}</span>
                  <span>{timeAgo(candidate.updatedAt) || '刚刚'}</span>
                </div>
              </div>
              <div className="content-ratings-queue-actions">
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

/**
 * 分级任务的进度控制条：进度可视化 + 中止 + 断点恢复。
 *
 * 进度不直接用 task.current/total：那只是本次执行器的游标，进程重启或断点恢复后
 * 会归零。真正的口径是服务端 /progress 算出的「批次已处理 / 剩余缺口」，
 * 所以这里始终以 progress 数据为准，task 只用来判断活动状态。
 */
function AiTaskProgressBar({
  task,
  progress,
  onCancel,
  onResume,
  cancelling,
  resuming,
}: {
  task: AiTaskInfo | null
  progress: AdminContentRatingAiTaskProgress | null
  onCancel: () => void
  onResume: () => void
  cancelling: boolean
  resuming: boolean
}) {
  if (!task) return null

  const total = progress?.total ?? Math.max(1, Number(task.total) || 1)
  const done = progress ? progress.done : Number(task.current) || 0
  const remaining = progress ? progress.remaining : Math.max(0, total - done)
  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0
  const active = task.status === 'queued' || task.status === 'running'
  const failed = task.status === 'failed'
  const cancelled = task.status === 'cancelled'

  return (
    <div className="content-ratings-task-progress" aria-label="LLM 分级任务进度">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <AdminStatusBadge
              tone={
                ['queued', 'running'].includes(task.status) ? 'info' : task.status === 'failed' ? 'danger' : task.status === 'cancelled' ? 'muted' : 'success'
              }
            >
              {task.status === 'queued'
                ? '排队中'
                : task.status === 'running'
                  ? '分析中'
                  : task.status === 'completed'
                    ? '已完成'
                    : task.status === 'cancelled'
                      ? '已中止'
                      : '已中断'}
            </AdminStatusBadge>
            <span className="text-xs tabular-nums text-muted-foreground">
              已处理 {formatNumber(done)} / {formatNumber(total)} 本{remaining > 0 ? ` · 剩余 ${formatNumber(remaining)} 本` : ' · 无缺口'}
            </span>
            {task.step && (
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={task.step}>
                {task.step}
              </span>
            )}
          </div>

          {/* 进度条：未完成的缺口用 muted 底，已处理部分用 primary 填充 */}
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`LLM 分级任务已完成 ${percent}%`}
          >
            <div
              className={`content-ratings-progress-fill h-full rounded-full ${failed || cancelled ? 'bg-warning' : 'bg-primary'}`}
              style={{ transform: `scaleX(${percent / 100})` }}
            />
          </div>

          {task.error && <p className="text-xs text-destructive">{task.error}</p>}
          {cancelled && <p className="text-xs text-muted-foreground">任务已中止，已完成的建议保留在下方待审核列表；可断点恢复只补剩余作品。</p>}
          {failed && <p className="text-xs text-muted-foreground">任务中断，已完成的建议已保留；可断点恢复只补未分析的部分。</p>}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {active && (
            <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={cancelling}>
              <Square className="size-3.5" aria-hidden="true" />
              {cancelling ? '中止中…' : '中止任务'}
            </Button>
          )}
          {!active && (progress?.canResume ?? false) && (
            <Button type="button" size="sm" onClick={onResume} disabled={resuming}>
              <Play className="size-3.5" aria-hidden="true" />
              {resuming ? '恢复中…' : `断点恢复（${formatNumber(remaining)} 本）`}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

function AiSuggestionPanel({
  data,
  loading,
  error,
  scanning,
  task,
  progress,
  cancelling,
  resuming,
  batchLimit,
  onBatchLimit,
  reasoningMode,
  onReasoningMode,
  onRetry,
  onScan,
  onCancel,
  onResume,
  onReview,
  page, pageSize, onPage, onPageSize, onBulkCompleted, status, onStatus,
}: {
  data: AdminContentRatingAiListResponse | null
  loading: boolean
  error: string
  scanning: boolean
  task: AiTaskInfo | null
  progress: AdminContentRatingAiTaskProgress | null
  cancelling: boolean
  resuming: boolean
  batchLimit: number
  onBatchLimit: (value: number) => void
  reasoningMode: AiReasoningMode
  onReasoningMode: (value: AiReasoningMode) => void
  onRetry: () => void
  onScan: () => void
  onCancel: () => void
  onResume: () => void
  onReview: (suggestion: AdminContentRatingAiSuggestion) => void
  page: number
  pageSize: number
  onPage: (page: number) => void
  onPageSize: (size: number) => void
  status: 'pending' | 'stale'
  onStatus: (status: 'pending' | 'stale') => void
  onBulkCompleted: () => Promise<void>
}) {
  const [selected, setSelected] = useState(new Map<string, AdminContentRatingAiSuggestion>())
  const [bulkBusy, setBulkBusy] = useState(false)
  const locked = loading || !!error || bulkBusy
  const history = status === 'stale'
  const rows = data?.items || []
  const allSelected = rows.length > 0 && rows.every(row => selected.has(row.id))
  const someSelected = rows.some(row => selected.has(row.id))
  function select(row: AdminContentRatingAiSuggestion, checked: boolean) {
    setSelected(previous => {
      const next = new Map(previous)
      if (checked) next.set(row.id, row)
      else next.delete(row.id)
      return next
    })
  }
  const active = !!task && ['queued', 'running'].includes(task.status)

  return (
    <>
      {/* 独立外置工具条与全局操作区（位于表格之外） */}
      <AdminToolbar layout="inline" className="admin-filter-rail content-ratings-ai-rail" ariaLive="polite">
        <SearchSelect
          aria-label="LLM 建议状态"
          value={status}
          options={[
            { value: 'pending', label: '待审核建议' },
            { value: 'stale', label: '已过期建议' },
          ]}
          onChange={(value) => {
            setSelected(new Map())
            onStatus(value as 'pending' | 'stale')
          }}
          disabled={bulkBusy || loading}
          compact
          chip
        />
        <div className="content-ratings-ai-actions ml-auto flex items-center gap-2">
          <Label id="content-rating-reasoning-label" className="text-xs text-muted-foreground">
            思考
          </Label>
          <SearchSelect
            options={[
              { value: 'inherit', label: '跟随默认' },
              { value: 'disabled', label: '关闭思考' },
              { value: 'low', label: '低强度' },
              { value: 'high', label: '高强度' },
            ]}
            value={reasoningMode}
            onChange={(value) => onReasoningMode(value as AiReasoningMode)}
            aria-label="分级思考模式"
            className="content-ratings-reasoning-select"
            compact
          />
          <Label id="content-rating-batch-label" className="text-xs text-muted-foreground">
            单批
          </Label>
          <SearchSelect
            options={AI_BATCH_LIMIT_OPTIONS}
            value={String(batchLimit)}
            onChange={(value) => onBatchLimit(Math.min(AI_BATCH_LIMIT_MAX, Math.max(1, Number(value) || DEFAULT_AI_BATCH_LIMIT)))}
            aria-label="单批分析数量"
            className="content-ratings-batch-select"
            compact
          />
          <Button type="button" size="sm" onClick={onScan} disabled={scanning || active} className="rounded-full px-4 h-9 text-xs font-medium">
            <Bot className={scanning ? 'size-3.5 animate-pulse mr-1' : 'size-3.5 mr-1'} aria-hidden="true" />
            {scanning ? '创建任务…' : '分析未标注'}
          </Button>
        </div>
      </AdminToolbar>

      <p className="content-ratings-panel-description text-xs text-muted-foreground/80 leading-relaxed mb-3">
        只分析未标注作品。判级依据是元数据加正文采样片段，正文成人词命中只用于定位采样章节，不直接决定分级。模型建议经人工审核才可修改分级；批准“继续未标注”不会标为一般。
        可前往{' '}
        <Link to="/admin/ai?sub=params&group=contentRating" className="underline underline-offset-2 hover:text-foreground">
          AI 参数调优
        </Link>{' '}
        调整输出 Token 预算与默认思考强度。
      </p>

      {/* 任务进度条独立卡片 */}
      <AiTaskProgressBar task={task} progress={progress} onCancel={onCancel} onResume={onResume} cancelling={cancelling} resuming={resuming} />

      {/* 底部悬浮胶囊岛（批量操作） */}
      {!history && (
        <AdminSelectionBar
          count={selected.size}
          label={`已选 ${selected.size} 条`}
          onClear={() => setSelected(new Map())}
          clearLabel="清空选择"
          clearPlacement="actions"
        >
          <AiSuggestionBulkReview
            items={[...selected.values()]}
            disabled={locked || bulkBusy}
            onBusy={setBulkBusy}
            onCompleted={async (ids) => {
              setSelected((previous) => {
                const next = new Map(previous)
                ids.forEach((id) => next.delete(id))
                return next
              })
              await onBulkCompleted()
            }}
          />
        </AdminSelectionBar>
      )}

      {/* 复用表格设计规范的主数据面板 */}
      <AdminDataPanel ariaLabel="LLM 内容分级建议" columns={AI_SUGGESTION_COLUMNS} className="content-ratings-panel content-ratings-ai-panel" density="comfortable">
        {error ? (
          <ErrorState message={`LLM 建议加载失败：${error}`} onRetry={onRetry} />
        ) : loading && !data ? (
          <LoadingState label="正在加载 LLM 分级建议" rows={2} />
        ) : !data || data.items.length === 0 ? (
          <EmptyState message={history ? '没有已过期的 LLM 分级建议。' : '还没有待审核的 LLM 分级建议；分析任务只会读取未标注作品。'} />
        ) : (
          <Table className={cn('admin-data-table admin-data-table--animated', (loading || bulkBusy) && 'admin-data-table--transitioning')}>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <div className="flex items-center gap-2.5">
                    {!history && (
                      <Checkbox
                        aria-label="全选本页 LLM 建议"
                        checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                        disabled={locked || !rows.length}
                        onCheckedChange={(checked) => {
                          setSelected((previous) => {
                            const next = new Map(previous)
                            rows.forEach((row) => {
                              if (checked === true) next.set(row.id, row)
                              else next.delete(row.id)
                            })
                            return next
                          })
                        }}
                      />
                    )}
                    <span>作品</span>
                  </div>
                </TableHead>
                <TableHead>AI 建议</TableHead>
                <TableHead>模型与规则</TableHead>
                <TableHead>判定依据与证据</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody key={`${status}-${page}-${pageSize}`}>
              {data.items.map((suggestion, index) => (
                <TableRow key={suggestion.id} style={{ animationDelay: `${getAdminTableRowStaggerDelay(index, data.items.length)}ms` }} className={history ? 'content-ratings-queue-item--stale opacity-75' : undefined}>
                  <TableCell data-primary="" data-label="作品">
                    <div className="flex items-start gap-2.5 min-w-0">
                      {!history && (
                        <Checkbox
                          className="mt-0.5 shrink-0"
                          aria-label={`选择 LLM 建议：${suggestion.title || suggestion.id}`}
                          checked={selected.has(suggestion.id)}
                          disabled={locked}
                          onCheckedChange={(checked) => select(suggestion, checked === true)}
                        />
                      )}
                      <div className="min-w-0">
                        <div className="truncate font-medium text-foreground" title={suggestion.title}>
                          {suggestion.title || '未命名作品'}
                        </div>
                        <div className="mt-1 truncate text-xs text-muted-foreground">
                          {suggestion.author || '未知作者'}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell data-label="AI 建议">
                    <AdminStatusBadge tone={suggestion.suggestedRating === 'restricted' ? 'danger' : 'muted'}>
                      {suggestion.suggestedRating === 'restricted' ? '建议限制级' : '建议继续未标注'}
                    </AdminStatusBadge>
                    <div className="mt-1 text-xs text-muted-foreground tabular-nums">
                      置信度 {Math.round(suggestion.confidence * 100)}%
                    </div>
                  </TableCell>
                  <TableCell data-label="模型与规则">
                    <div className="min-w-0">
                      <div className="truncate text-sm text-foreground">{suggestion.model || '未记录模型'}</div>
                      <div className="mt-1 truncate text-xs text-muted-foreground font-mono" title={suggestion.promptVersion}>
                        {suggestion.promptVersion}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell data-label="判定依据与证据">
                    <div className="min-w-0 space-y-1">
                      <p className="text-xs text-foreground/90 line-clamp-2 leading-relaxed" title={suggestion.reason}>
                        {suggestion.reason || '未记录 AI 理由'}
                      </p>
                      {suggestion.evidence.length > 0 && (
                        <div className="mt-1">
                          <EvidenceList evidence={suggestion.evidence} compact />
                        </div>
                      )}
                      {history && (
                        <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                          已过期：{suggestion.error || '作品分级或修订已变化'}
                        </p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell data-label="操作" className="text-right">
                    {!history ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={locked}
                        onClick={() => onReview(suggestion)}
                        className="rounded-full px-3.5 h-7 text-xs font-medium border-border/80 hover:bg-muted/50 cursor-pointer"
                      >
                        <Eye className="size-3.5 mr-1" aria-hidden="true" />
                        审核建议
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">已失效</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </AdminDataPanel>

      {/* 分页组件位于表格面板外部 */}
      <Pagination
        variant="detached"
        page={page}
        totalPages={Math.max(1, Math.ceil((data?.total || 0) / pageSize))}
        onPage={onPage}
        summary={`共 ${data?.total ?? '—'} 条建议`}
        pageSize={{ value: pageSize, options: ADMIN_PAGE_SIZE_OPTIONS, onChange: onPageSize }}
        busy={locked}
      />
    </>
  )
}

export default function ContentRatingsTab() {
  const { toast } = useToast()
  const [params, setParams] = useSearchParams()
  const view = ratingView(params.get('view'))
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

  const [evidenceNovel, setEvidenceNovel] = useState<AdminContentRatingItem | null>(null)

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

  const [aiStatus, setAiStatus] = useState<'pending' | 'stale'>('pending')
  const [aiPage, setAiPage] = useState(1)
  const [aiPageSize, setAiPageSize] = useState(ADMIN_DEFAULT_PAGE_SIZE)
  const [aiData, setAiData] = useState<AdminContentRatingAiListResponse | null>(null)
  const [aiLoading, setAiLoading] = useState(true)
  const [aiError, setAiError] = useState('')
  const [aiScanning, setAiScanning] = useState(false)
  const [aiTask, setAiTask] = useState<AiTaskInfo | null>(null)
  const [aiProgress, setAiProgress] = useState<AdminContentRatingAiTaskProgress | null>(null)
  const [aiCancelling, setAiCancelling] = useState(false)
  const [aiResuming, setAiResuming] = useState(false)
  const [aiBatchLimit, setAiBatchLimit] = useState<number>(DEFAULT_AI_BATCH_LIMIT)
  const [aiReasoningMode, setAiReasoningMode] = useState<AiReasoningMode>('inherit')
  const [aiReviewSuggestion, setAiReviewSuggestion] = useState<AdminContentRatingAiSuggestion | null>(null)
  const [aiReviewDecision, setAiReviewDecision] = useState<'approve' | 'reject' | null>(null)
  const [aiReviewReason, setAiReviewReason] = useState('')
  const [aiReviewError, setAiReviewError] = useState('')
  const [aiReviewSaving, setAiReviewSaving] = useState(false)
  const aiReviewReasonInput = useRef<HTMLTextAreaElement>(null)
  const aiReviewTrigger = useRef<HTMLElement | null>(null)

  const listSeqRef = useRef(0)
  const historySeqRef = useRef(0)
  const candidatePreviewSeqRef = useRef(0)
  const aiListSeqRef = useRef(0)
  const aiProgressRef = useRef<{ taskId: string; done: number; finished: boolean } | null>(null)

  useEffect(() => {
    if (view !== 'ledger') return
    const timer = setTimeout(() => {
      setQuery(searchInput.trim())
      setPage(1)
    }, 250)
    return () => clearTimeout(timer)
  }, [searchInput, view])

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
    if (view !== 'ledger') return
    // This effect owns the remote list synchronization; load() updates the async status around the request.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
    // 切换视图或查询后，旧请求不能再更新账本或加载状态。
    return () => {
      listSeqRef.current++
    }
  }, [load, view])

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
    const seq = ++aiListSeqRef.current
    setAiLoading(true)
    setAiError('')
    try {
      const response = await adminApi.contentRatingAi.list({ status: aiStatus, limit: aiPageSize, offset: (aiPage - 1) * aiPageSize })
      if (seq === aiListSeqRef.current) {
        const lastPage = Math.max(1, Math.ceil(response.total / aiPageSize))
        if (aiPage > lastPage) setAiPage(lastPage)
        else setAiData(response)
      }
    } catch (error) {
      if (seq === aiListSeqRef.current) setAiError(errorMessage(error, '请检查网络后重试'))
    } finally {
      if (seq === aiListSeqRef.current) setAiLoading(false)
    }
  }, [aiPage, aiPageSize, aiStatus])

  useEffect(() => {
    // This effect keeps the LLM review queue synchronized with the pending suggestions.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadAiSuggestions()
  }, [loadAiSuggestions])

  /**
   * 应用批次进度，并在服务端处理出新结果时增量刷新待审核队列。
   *
   * done 是服务端在每本作品完成（成功或失败）后递增的批次游标；只在它前进时
   * 拉取列表，避免 1.5 秒轮询在没有新结果时反复打满审核接口。任务结束时仍强制
   * 刷新一次，用来收敛最后一个结果和终态信息。
   */
  const applyAiProgress = useCallback(
    async (result: AdminContentRatingAiTaskProgress) => {
      const previous = aiProgressRef.current
      const taskId = result.task.id
      const finished = ['completed', 'failed', 'cancelled'].includes(result.task.status)
      if (previous?.taskId === taskId && (result.done < previous.done || (previous.finished && !finished))) return
      const hasNewResult = previous?.taskId === taskId ? result.done > previous.done : result.done > 0
      aiProgressRef.current = { taskId, done: result.done, finished }
      setAiTask(result.task)
      setAiProgress(result)
      if (hasNewResult || finished) await loadAiSuggestions()
    },
    [loadAiSuggestions],
  )

  /** 拉取批次进度：批次口径（已处理/剩余缺口）以服务端为准，避免恢复后游标归零造成误读。 */
  const loadAiProgress = useCallback(
    async (taskId: string) => {
      try {
        const result = await adminApi.contentRatingAi.progress(taskId)
        await applyAiProgress(result)
        return result
      } catch {
        // 优先级低于建议列表：进度读取失败不应打断审核流程，界面回退到任务自身字段。
        return null
      }
    },
    [applyAiProgress],
  )

  /**
   * 挂载时对齐服务端「当前批次」。
   *
   * 任务 id 只存在内存里时，刷新页面就丢掉了整条控制链路：进度条消失、无法中止、
   * 无法断点恢复，而任务在服务端可能还在跑。这里改为以服务端最近一条
   * content_rating_review 任务为准，刷新后仍能接管。
   */
  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const latest = await adminApi.contentRatingAi.latest()
        if (!active || !latest.task) return
        setAiTask(latest.task)
        setAiProgress({ ...latest, task: latest.task })
        aiProgressRef.current = { taskId: latest.task.id, done: latest.done, finished: ['completed', 'failed', 'cancelled'].includes(latest.task.status) }
      } catch {
        // 对齐失败只是拿不到上次的进度，不影响新建任务；不打断审核流程。
      }
    })()
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const taskId = aiTask?.id
    const taskStatus = aiTask?.status
    if (!taskId || !taskStatus || !['queued', 'running'].includes(taskStatus)) return
    let active = true
    const poll = async () => {
      try {
        const result = await adminApi.contentRatingAi.progress(taskId)
        if (!active) return
        await applyAiProgress(result)
        if (['completed', 'failed', 'cancelled'].includes(result.task.status)) {
          await load(true)
          return false
        }
      } catch (error) {
        if (active) setAiError(errorMessage(error, 'LLM 任务状态读取失败'))
      }
    }
    const stop = startPolling(poll, 1_500)
    return () => {
      active = false
      stop()
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
      const payload: { limit: number; reasoningMode?: AiReasoningMode } = { limit: aiBatchLimit }
      if (aiReasoningMode && aiReasoningMode !== 'inherit') payload.reasoningMode = aiReasoningMode
      const result = await adminApi.contentRatingAi.scan(payload)
      if (!result.taskId) {
        toast(result.message || '当前没有可分析的 unknown 作品', 'default')
      } else {
        setAiTask(result.task || null)
        setAiProgress(null)
        toast(`已提交 LLM 分析任务，将生成 ${formatNumber(result.selected)} 条待审核建议`, 'success')
        // 立即拉一次批次进度，让进度条在首个轮询周期前就有正确总数
        await loadAiProgress(result.taskId)
      }
      await loadAiSuggestions()
    } catch (error) {
      setAiError(errorMessage(error, 'LLM 分析任务创建失败，请检查文本 AI 配置'))
    } finally {
      setAiScanning(false)
    }
  }

  /** 中止：任务停下后已有建议全部保留；缺口留给断点恢复。 */
  async function cancelAiTask() {
    const taskId = aiTask?.id
    if (!taskId) return
    setAiCancelling(true)
    setAiError('')
    try {
      await aiApi.cancelTask(taskId)
      toast('已中止分析任务，已生成的建议保留在下方列表', 'success')
      await Promise.all([loadAiProgress(taskId), loadAiSuggestions()])
    } catch (error) {
      setAiError(errorMessage(error, '中止任务失败'))
    } finally {
      setAiCancelling(false)
    }
  }

  /** 断点恢复：跳过已有终态建议的作品，只补未分析与失败的部分。 */
  async function resumeAiTask() {
    const taskId = aiTask?.id
    if (!taskId) return
    setAiResuming(true)
    setAiError('')
    try {
      const result = await adminApi.contentRatingAi.resume(taskId)
      if (!result.taskId) {
        toast(result.message || '没有需要补跑的作品，批次已完成', 'default')
        await loadAiProgress(taskId)
      } else {
        setAiTask(result.task || null)
        toast(`已断点恢复：跳过 ${formatNumber(result.skipped)} 本，补跑 ${formatNumber(result.selected)} 本`, 'success')
        await loadAiProgress(result.taskId)
      }
      await loadAiSuggestions()
    } catch (error) {
      setAiError(errorMessage(error, '断点恢复失败'))
    } finally {
      setAiResuming(false)
    }
  }

  function openAiReview(suggestion: AdminContentRatingAiSuggestion) {
    aiReviewTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
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
      aiReviewReasonInput.current?.focus({ preventScroll: true })
      aiReviewReasonInput.current?.scrollIntoView({ block: 'center', behavior: 'instant' })
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
  const viewRefreshing = view === 'ledger' ? loading || refreshing : view === 'rules' ? candidateLoading : aiLoading
  const refreshLabel = view === 'ledger' ? '刷新账本' : view === 'rules' ? '刷新候选' : '刷新建议'

  const policyRef = useRef<HTMLDetailsElement>(null)

  useEffect(() => {
    function handlePointerDown(event: MouseEvent | TouchEvent) {
      const el = policyRef.current
      if (el && el.open && !el.contains(event.target as Node)) {
        el.open = false
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && policyRef.current?.open) {
        policyRef.current.open = false
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('touchstart', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('touchstart', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  function refreshCurrentView() {
    if (view === 'rules') void loadCandidates()
    else if (view === 'ai') void loadAiSuggestions()
    else void load(true)
  }

  return (
    <AdminPage
      className="admin-redesign-page--content-ratings"
      title="分级管理"
      description="维护作品分级与判定依据，让每一次修改都有据可查。"
      actions={view !== 'ledger' && (
        <Button variant="secondary" size="sm" onClick={refreshCurrentView} disabled={viewRefreshing}>
          <RefreshCw className={viewRefreshing ? 'size-3.5 animate-spin' : 'size-3.5'} />
          {viewRefreshing ? '同步中…' : refreshLabel}
        </Button>
      )}
    >
      <Tabs
        value={view}
        className="content-ratings-tabs"
        onValueChange={(next) => {
          const query = new URLSearchParams(params)
          query.set('view', ratingView(next))
          setParams(query)
        }}
      >
        <div className="content-ratings-workspace-nav">
          <TabsList aria-label="分级工作视图">
            <TabsTrigger value="ledger">分级账本</TabsTrigger>
            <TabsTrigger value="rules">
              规则候选 <span className="content-ratings-tab-count">{candidateData ? formatNumber(candidateData.counts.pending) : '—'}</span>
            </TabsTrigger>
            <TabsTrigger value="ai">
              LLM 建议 <span className="content-ratings-tab-count">{aiData ? formatNumber(aiData.counts.pending) : '—'}</span>
            </TabsTrigger>
          </TabsList>
          <MotionDetails ref={policyRef} className="content-ratings-policy">
            <summary>
              <Info aria-hidden="true" />
              分级与审核口径
            </summary>
            <div className="content-ratings-policy-popover">
              <div className="content-ratings-policy-spectrum">
                <div className="content-ratings-policy-spectrum__head">
                  <span className="font-medium text-foreground">全库治理健康度</span>
                  <span className="content-ratings-filter-counts text-xs tabular-nums text-muted-foreground" data-testid="rating-progress">
                    待标注 {formatNumber(counts.unknown)} · 限制级 {formatNumber(counts.restricted)}
                  </span>
                </div>
                {(() => {
                  const total = (counts.general || 0) + (counts.restricted || 0) + (counts.unknown || 0)
                  if (!total) return null
                  const gPct = ((counts.general || 0) / total) * 100
                  const rPct = ((counts.restricted || 0) / total) * 100
                  const uPct = 100 - gPct - rPct
                  return (
                    <div className="content-ratings-policy-spectrum__body">
                      <div
                        className="content-ratings-mini-bar content-ratings-mini-bar--wide"
                        role="img"
                        aria-label="分级比例条"
                      >
                        <span className="spectrum-segment spectrum-segment--general" style={{ width: `${gPct}%` }} />
                        <span className="spectrum-segment spectrum-segment--restricted" style={{ width: `${rPct}%` }} />
                        <span className="spectrum-segment spectrum-segment--unknown" style={{ width: `${uPct}%` }} />
                      </div>
                      <div className="content-ratings-policy-spectrum__legend">
                        <span className="content-ratings-policy-spectrum__item">
                          <span className="content-ratings-dot-legend content-ratings-dot--general" />
                          一般 {Math.round(gPct)}%
                        </span>
                        <span className="content-ratings-policy-spectrum__item">
                          <span className="content-ratings-dot-legend content-ratings-dot--restricted" />
                          限制级 {Math.round(rPct)}%
                        </span>
                        <span className="content-ratings-policy-spectrum__item">
                          <span className="content-ratings-dot-legend content-ratings-dot--unknown" />
                          待标注 {Math.round(uPct)}%
                        </span>
                      </div>
                    </div>
                  )
                })()}
              </div>

              <hr className="content-ratings-policy-divider" />

              <p>
                未标注不等于一般。R18 对应限制级；规则与 LLM
                只提出限制级或继续未标注的判断，不自动标为一般。规则批准前预览影响范围，模型建议经人工审核才可修改分级；人工修改必须填写理由并保留审计记录。
              </p>
            </div>
          </MotionDetails>
        </div>
        <TabsContent value="ledger" className="content-ratings-ledger-view">
          <AdminToolbar layout="inline" className="admin-filter-rail content-ratings-toolbar content-ratings-filter-rail" ariaLive="polite">
            <SearchField
              id="content-rating-search"
              type="search"
              label="搜索作品分级记录"
              placeholder="搜索标题、作者或修改理由…"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
            />
            <div className="content-ratings-filters">
              <SearchSelect
                compact
                leadingIcon={<span>分级：</span>}
                aria-label="分级"
                options={RATING_OPTIONS}
                value={ratingFilter}
                onChange={(value) => {
                  setRatingFilter(value as ContentRating | '')
                  setPage(1)
                }}
              />
              <SearchSelect
                compact
                leadingIcon={<span>来源：</span>}
                aria-label="按来源筛选"
                options={sourceOptions}
                value={sourceFilter}
                onChange={(value) => {
                  setSourceFilter(value as AdminContentRatingSource | '')
                  setPage(1)
                }}
              />
              {(searchInput || ratingFilter || sourceFilter) && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="content-ratings-clear"
                  onClick={() => {
                    setSearchInput('')
                    setRatingFilter('')
                    setSourceFilter('')
                    setPage(1)
                  }}
                >
                  清除筛选
                </Button>
              )}
            </div>
            <div className="content-ratings-toolbar-actions">
              <span className="content-ratings-result-count">
                {loading || refreshing ? '正在更新…' : data ? `共 ${formatNumber(data.total)} 本` : '—'}
              </span>
              <Button variant="secondary" size="sm" onClick={refreshCurrentView} disabled={viewRefreshing}>
                <RefreshCw className={viewRefreshing ? 'size-3.5 animate-spin' : 'size-3.5'} />
                {viewRefreshing ? '同步中…' : refreshLabel}
              </Button>
            </div>
          </AdminToolbar>

          {!data ? (
            loading ? (
              <LoadingState className="admin-panel-card" label="正在加载内容分级账本" />
            ) : (
              <ErrorState className="admin-panel-card" message={`分级账本加载失败：${loadError || '未知错误'}`} onRetry={() => void load(true)} />
            )
          ) : (
            <>
              {loadError && <InlineError message={`分级账本同步失败：${loadError}`} onRetry={() => void load(true)} className="mx-5 my-4" />}

              <AdminDataPanel ariaLabel="内容分级账本" columns={RATING_COLUMNS} className="content-ratings-panel content-ratings-ledger" density="comfortable">

              {data.items.length === 0 ? (
                <EmptyState message={query || ratingFilter || sourceFilter ? '当前筛选条件下没有作品' : '暂无内容分级记录'} />
              ) : (
                <Table className={cn('admin-data-table admin-data-table--animated', (loading || refreshing) && 'admin-data-table--transitioning')}>
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
                  <TableBody key={`${query}-${ratingFilter}-${sourceFilter}-${page}-${pageSize}`}>
                    {data.items.map((item, index) => (
                      <TableRow key={item.id} style={{ animationDelay: `${getAdminTableRowStaggerDelay(index, data.items.length)}ms` }}>
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
                          <AdminContentRatingBadge rating={item.contentRating} />
                        </TableCell>
                        <TableCell data-label="来源">
                          <div className="min-w-0">
                            <div className="truncate text-sm text-foreground">{sourceLabel(item.source)}</div>
                            <div className="mt-1 truncate text-xs text-muted-foreground">修订 {item.revision}</div>
                          </div>
                        </TableCell>
                        <TableCell data-label="判定证据">
                          <EvidenceCell item={item} onInspect={() => setEvidenceNovel(item)} />
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
                              variant="secondary"
                              size="sm"
                              className="content-ratings-edit-button"
                              aria-label={`修改 ${item.title} 的分级`}
                              title="修改分级"
                              onClick={() => openEdit(item)}
                            >
                              修改
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
            </AdminDataPanel>

              <Pagination
                variant="detached"
                page={page}
                totalPages={totalPages}
                onPage={setPage}
                summary={summary}
                pageSize={{ value: pageSize, options: ADMIN_PAGE_SIZE_OPTIONS, onChange: setPageSize }}
                busy={loading || refreshing}
              />
            </>
          )}
        </TabsContent>
        <TabsContent value="rules">
          <RuleCandidatePanel
            data={candidateData}
            loading={candidateLoading}
            error={candidateError}
            onRetry={() => void loadCandidates()}
            onPreview={(candidate) => void openCandidatePreview(candidate)}
          />
        </TabsContent>
        <TabsContent value="ai">
          <AiSuggestionPanel
            data={aiData}
            loading={aiLoading}
            error={aiError}
            scanning={aiScanning}
            task={aiTask}
            progress={aiProgress}
            cancelling={aiCancelling}
            resuming={aiResuming}
            batchLimit={aiBatchLimit}
            onBatchLimit={setAiBatchLimit}
            reasoningMode={aiReasoningMode}
            onReasoningMode={setAiReasoningMode}
            onRetry={() => void loadAiSuggestions()}
            onScan={() => void scanAiSuggestions()}
            onCancel={() => void cancelAiTask()}
            onResume={() => void resumeAiTask()}
            status={aiStatus}
            onStatus={status => { setAiStatus(status); setAiPage(1) }}
            page={aiPage}
            pageSize={aiPageSize}
            onPage={setAiPage}
            onPageSize={size => { setAiPageSize(size); setAiPage(1) }}
            onBulkCompleted={async () => { await Promise.all([load(true), loadAiSuggestions()]) }}
            onReview={openAiReview}
          />
        </TabsContent>
      </Tabs>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogFrame className="content-ratings-dialog sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>修改分级 · {editing?.title || '作品'}</DialogTitle>
            <DialogDescription>人工修改会记录操作人、理由和当前版本。提交前请确认你看到的是最新记录。</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            {editing && (
              <div className="grid gap-4">
                <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-muted-foreground">当前结果</span>
                    <AdminContentRatingBadge rating={editing.contentRating} />
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
                  <SearchSelect
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
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditing(null)} disabled={saving}>
              取消
            </Button>
            <Button type="button" onClick={() => void saveEdit()} disabled={saving || !draftReason.trim()}>
              {saving ? '保存中…' : '保存分级'}
            </Button>
          </DialogFooter>
        </DialogFrame>
      </Dialog>

      <Dialog open={!!candidateNovel} onOpenChange={(open) => !open && setCandidateNovel(null)}>
        <DialogFrame className="content-ratings-dialog sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>沉淀规则候选 · {candidateNovel?.title || '作品'}</DialogTitle>
            <DialogDescription>这里只记录人工经验，等后续预览和批准后才会影响新作品；本次操作不会立即修改其他作品的分级。</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            {candidateNovel && (
              <div className="grid gap-4">
                <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-muted-foreground">人工来源</span>
                    <AdminContentRatingBadge rating={candidateNovel.contentRating} />
                    <span className="text-xs text-muted-foreground">
                      修订 {candidateNovel.revision} · {candidateNovel.updatedByName || '管理员'}
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    只有人工确认的 restricted 作品可以生成候选；候选会保留这本书作为人工例证。
                  </p>
                </div>

                <div className="grid gap-2">
                  <Label>候选类型</Label>
                  <SearchSelect
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
                    {candidateKind === 'category'
                      ? '分类候选将按完整标签匹配，不会做模糊子串匹配。'
                      : '文本候选先以字面短语保存，后续预览阶段再评估误命中范围。'}
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
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCandidateNovel(null)} disabled={candidateSaving}>
              取消
            </Button>
            <Button type="button" onClick={() => void saveCandidate()} disabled={candidateSaving || !candidateValue.trim() || !candidateReason.trim()}>
              {candidateSaving ? '保存中…' : '保存待审核候选'}
            </Button>
          </DialogFooter>
        </DialogFrame>
      </Dialog>

      <Dialog open={!!candidatePreviewCandidate} onOpenChange={(open) => !open && !candidateReviewSaving && closeCandidatePreview()}>
        <DialogFrame className="content-ratings-dialog max-h-[min(86vh,800px)] sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>预览规则影响 · {candidatePreviewCandidate?.value || '规则候选'}</DialogTitle>
            <DialogDescription>批准会把命中的未标注作品改为限制级，并把规则版本写入分级审计；一般作品和已人工确认的作品不会被覆盖。</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
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
                    <AdminStatusBadge tone="warning">待审核</AdminStatusBadge>
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
                  <EmptyState message="当前没有命中的未标注作品；批准后仍会对后续新作品生效。" />
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
          </DialogBody>
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
        </DialogFrame>
      </Dialog>

      <ContentRatingAiReview
        suggestion={aiReviewSuggestion}
        decision={aiReviewDecision}
        reason={aiReviewReason}
        error={aiReviewError}
        saving={aiReviewSaving}
        reasonInputRef={aiReviewReasonInput}
        triggerRef={aiReviewTrigger}
        onDecision={setAiReviewDecision}
        onReason={setAiReviewReason}
        onClose={() => closeAiReview()}
        onSubmit={() => void reviewAiSuggestion()}
      />

      <Dialog open={!!historyNovel} onOpenChange={(open) => !open && setHistoryNovel(null)}>
        <DialogFrame className="content-ratings-dialog max-h-[min(80vh,720px)] sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>分级历史 · {historyNovel?.title || '作品'}</DialogTitle>
            <DialogDescription>这里保留自动判定、预填和人工修改的完整变更轨迹，便于复核结果从哪里来。</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            {historyLoading ? (
              <LoadingState label="正在加载分级历史" rows={3} />
            ) : historyError ? (
              <ErrorState message={historyError} onRetry={() => historyNovel && void openHistory(historyNovel)} />
            ) : history.length === 0 ? (
              <EmptyState message="暂无分级历史记录" />
            ) : (
              <div aria-live="polite">
                {history.map((entry) => (
                  <RatingHistoryRow key={entry.id} entry={entry} />
                ))}
              </div>
            )}
          </DialogBody>
        </DialogFrame>
      </Dialog>

      <Dialog open={!!evidenceNovel} onOpenChange={(open) => !open && setEvidenceNovel(null)}>
        <DialogFrame className="content-ratings-dialog sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>判定证据链 · {evidenceNovel?.title || '作品'}</DialogTitle>
            <DialogDescription>
              {evidenceNovel?.author ? `${evidenceNovel.author} · ` : ''}{formatNumber(evidenceNovel?.chapterCount || 0)} 章
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4 pt-1">
            {evidenceNovel && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl bg-muted/35 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">当前分级</span>
                    <AdminContentRatingBadge rating={evidenceNovel.contentRating} />
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <span>来源：{sourceLabel(evidenceNovel.source)}</span>
                    <span className="text-border">·</span>
                    <span>修订 {evidenceNovel.revision}</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <h4 className="text-xs font-medium text-muted-foreground">命中特征证据</h4>
                  {evidenceNovel.evidence.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5 pt-0.5">
                      {evidenceNovel.evidence.map((ev, i) => (
                        <span
                          key={i}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-normal bg-muted/50 text-foreground border border-border/60"
                        >
                          <span className="size-1.5 rounded-full bg-primary/70 shrink-0" aria-hidden="true" />
                          {evidenceLabel(ev)}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground/80 italic py-0.5">
                      当前记录未附判定证据，无法据此确认是否执行过规则扫描。
                    </p>
                  )}
                </div>

                {evidenceNovel.reason && (
                  <div className="space-y-2">
                    <h4 className="text-xs font-medium text-muted-foreground">执行说明 / 理由</h4>
                    <div className="text-xs text-foreground/90 leading-relaxed rounded-r-lg rounded-l-xs bg-muted/25 px-3.5 py-2.5 border-l-2 border-primary/50 break-words font-normal">
                      {evidenceNovel.reason}
                    </div>
                  </div>
                )}

                <div className="pt-2 text-xs text-muted-foreground space-y-2 border-t border-border/40">
                  {evidenceNovel.ruleVersion && (
                    <div className="flex items-center justify-between">
                      <span>生效规则链</span>
                      <code className="text-[11px] font-mono px-2 py-0.5 rounded bg-muted/40 text-foreground/80 border border-border/50">
                        {evidenceNovel.ruleVersion}
                      </code>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span>最近操作人</span>
                    <span className="text-foreground/90 font-medium">{evidenceNovel.updatedByName || '系统'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>更新时间</span>
                    <time className="text-foreground/80">{formatDateTime(evidenceNovel.contentRatingUpdatedAt)}</time>
                  </div>
                </div>
              </>
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEvidenceNovel(null)} className="rounded-full px-5 h-8 text-xs font-medium border-border/80 hover:bg-muted/50">
              关闭
            </Button>
          </DialogFooter>
        </DialogFrame>
      </Dialog>
    </AdminPage>
  )
}
