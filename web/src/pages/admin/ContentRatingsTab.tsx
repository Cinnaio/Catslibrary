import AdminContentRatingBadge from '@/components/admin/AdminContentRatingBadge'
import { AdminDialogBody, AdminDialogContent } from '@/components/admin/AdminDialog'
import AdminStatusBadge from '@/components/admin/AdminStatusBadge'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bot, CheckCircle2, CirclePlus, Eye, History, Info, Play, PlusCircle, RefreshCw, Square, XCircle } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import {
  adminApi,
  aiApi,
  type AdminContentRatingEvidence,
  type AdminContentRatingBodySnapshot,
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
  type AiTaskInfo,
  type ApiError,
} from '@/lib/api'
import { formatDateTime, timeAgo } from '@/lib/format'
import type { ContentRating } from '@shared/types'
import { RESTRICTED_BODY_KEYWORDS } from '@shared/restricted-patterns'
import { cn } from '@/lib/utils'
import { useToast } from '@/components/feedback'
import AdminEmptyState from '@/components/admin/AdminEmptyState'
import AdminPage from '@/components/admin/AdminPage'
import { ErrorState, InlineError, LoadingState } from '@/components/admin/AsyncStates'
import CustomSelect, { type SelectOption } from '@/components/admin/CustomSelect'
import Pagination from '@/components/admin/Pagination'
import { ADMIN_DEFAULT_PAGE_SIZE, ADMIN_PAGE_SIZE_OPTIONS } from '@/lib/admin-pagination'
import { AdminDataPanel, AdminPanelHeading, AdminSearch, AdminToolbar, type AdminColumn } from '@/components/admin/AdminWorkspace'
import AiSuggestionBulkReview from './AiSuggestionBulkReview'
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
  { key: 'work', label: '作品', width: '21%', primary: true },
  { key: 'rating', label: '当前分级', width: '11%' },
  { key: 'source', label: '来源', width: '14%' },
  { key: 'evidence', label: '判定证据', width: '25%' },
  { key: 'updated', label: '最近操作', width: '13%' },
  { key: 'actions', label: '操作', width: '16%', actions: true },
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

  let primaryLabel = ''
  let isClean = false

  if (categories.length > 0 && textMatches.length > 0) {
    primaryLabel = `分类：${categories.slice(0, 2).join('、')} · 简介命中`
  } else if (categories.length > 0) {
    primaryLabel = `分类：${categories.slice(0, 3).join('、')}${categories.length > 3 ? ' 等' : ''}`
  } else if (textMatches.length > 0) {
    const fields = new Set(textMatches.map((t) => t.field))
    if (fields.has('title')) primaryLabel = '标题命中敏感词'
    else if (fields.has('body')) primaryLabel = '正文采样命中敏感词'
    else primaryLabel = '简介命中敏感词'
  } else if (item.evidence.length > 0) {
    primaryLabel = item.evidence.map(evidenceLabel).slice(0, 2).join('、')
  } else {
    isClean = true
    primaryLabel = item.source === 'manual' ? '人工指定分级' : '未检出敏感特征'
  }

  let secondaryLabel = ''
  if (item.ruleVersion?.startsWith('llm:')) {
    const modelMatch = item.ruleVersion.match(/llm:([^:]+)/)
    const rawModel = modelMatch ? modelMatch[1] : ''
    const modelName = rawModel.includes('deepseek') ? 'DeepSeek' : rawModel ? rawModel.split('-')[0] : 'AI'
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
    secondaryLabel = '系统巡检'
  }

  return (
    <button
      type="button"
      onClick={onInspect}
      className="content-ratings-evidence-cell text-left min-w-0 w-full group rounded-md py-1 px-1.5 -mx-1.5 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary cursor-pointer"
      title="点击查看完整判定证据链"
    >
      <div className={cn('truncate text-sm font-medium transition-colors group-hover:text-primary', isClean ? 'text-muted-foreground/75' : 'text-foreground')}>
        {primaryLabel}
      </div>
      <div className="mt-0.5 truncate text-xs text-muted-foreground group-hover:text-foreground/70">
        {secondaryLabel}
      </div>
    </button>
  )
}

/**
 * 正文采样证据。
 *
 * 为什么审核员必须看到它：模型给「限制级」还是「继续未标注」，取决于它读到了什么正文。
 * 只给结论不给样本，审核员无法判断这次判级是「读了正文后的判断」还是
 * 「没读正文、只看了简介的猜测」—— 后者正是漏判《入红尘》那类作品的成因。
 */
/**
 * 信号词强度查表。
 *
 * 为什么界面必须区分强弱：弱信号词（「胸口」「湿了」「腰肢」）在正常剧情里同样常见，
 * 命中只代表「这段值得让模型看一眼」。如果强弱在界面上长得一样，审核员会把弱词的
 * 误报读成判级依据——那正是这套采样机制要避免的事。
 */
const BODY_KEYWORD_WEIGHT = new Map(RESTRICTED_BODY_KEYWORDS.map((item) => [item.keyword, item.weight]))

function isStrongBodyKeyword(keyword: string): boolean {
  return (BODY_KEYWORD_WEIGHT.get(keyword) ?? 1) >= 3
}

function BodySamplePanel({ body }: { body?: AdminContentRatingBodySnapshot }) {
  if (!body) return null
  if (!body.hasBody) {
    return (
      <div className="content-ratings-review-section content-ratings-body-empty">
        <h3 className="admin-dialog-section-label">正文采样</h3>
        <p className="admin-dialog-hint">
          该书尚未抓取到正文，本次建议只能依据标题、简介与分类。置信度天然偏低，不足以据此确认“非限制级”。
        </p>
      </div>
    )
  }
  const topKeywords = body.keywordHits.slice(0, 8)
  const strongHitCount = body.keywordHits.filter((item) => isStrongBodyKeyword(item.keyword)).length
  return (
    <div className="content-ratings-review-section content-ratings-body-samples">
      <div className="content-ratings-review-section-head">
        <h3 className="admin-dialog-section-label">正文采样</h3>
      </div>
      <p className="admin-dialog-hint">
        已读 {formatNumber(body.chapterCount)} 章 · {formatNumber(body.scannedCharacters)} 字 · 成人词命中 {formatNumber(body.matchedChapterCount)} 章（{Math.round(body.matchedChapterRatio * 100)}%）
      </p>
      {topKeywords.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {topKeywords.map((item) => (
            <Badge key={item.keyword} variant={isStrongBodyKeyword(item.keyword) ? 'destructive' : 'outline'} className="font-normal">
              {item.keyword} · {item.chapters} 章
            </Badge>
          ))}
        </div>
      )}
      <p className="admin-dialog-hint content-ratings-keyword-hint">
        {strongHitCount > 0
          ? `红色为直白词（性器官、性行为、体液），几乎只出现在成人向正文；灰色为语境依赖词，正常剧情同样常见，命中不代表限制级。本次命中 ${strongHitCount} 个直白词。`
          : '本次只命中语境依赖词（灰色），它们在正常剧情里同样常见。是否属于限制级必须读下面的原文片段判断。'}
      </p>
      {body.excerpts.length > 0 ? (
        <div className="content-ratings-excerpts">
          {body.excerpts.map((excerpt, index) => {
            const strong = excerpt.strongKeywords || []
            const weak = excerpt.weakKeywords || []
            return (
              <details key={`${excerpt.chapter}-${index}`} className="content-ratings-excerpt" open={index === 0 ? true : undefined}>
                <summary className="content-ratings-excerpt-summary admin-dialog-hint">
                  {excerpt.chapter} · {excerpt.origin === 'match' ? '成人词命中定位' : '全书均匀抽样'} ·{' '}
                  {strong.length > 0 ? (
                    <span className="text-destructive">本段含直白描写：{strong.slice(0, 8).join('、')}</span>
                  ) : weak.length > 0 ? (
                    <span>仅弱信号：{weak.slice(0, 8).join('、')}</span>
                  ) : (
                    <span>本段未命中成人词</span>
                  )}
                </summary>
                <blockquote className="content-ratings-excerpt-text">{excerpt.text}</blockquote>
              </details>
            )
          })}
        </div>
      ) : (
        <p className="admin-dialog-hint">正文里没有采样到片段，请以元数据证据为准。</p>
      )}
    </div>
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
        <AdminEmptyState message="还没有待审核的规则候选" />
      ) : (
        <div className="content-ratings-queue">
          {data.items.map((candidate) => (
            <article className="content-ratings-queue-item" key={candidate.id}>
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
    <AdminDataPanel ariaLabel="LLM 内容分级建议" className="content-ratings-panel content-ratings-ai-panel">
      <AdminToolbar layout="inline" className="admin-filter-rail content-ratings-ai-rail">
        <CustomSelect
          aria-label="LLM 建议状态"
          value={status}
          options={[{ value: 'pending', label: '待审核建议' }, { value: 'stale', label: '已过期建议' }]}
          onChange={value => { setSelected(new Map()); onStatus(value as 'pending' | 'stale') }}
          disabled={bulkBusy || loading}
          compact
          chip
        />
        <div className="content-ratings-ai-actions ml-auto">
          <Label id="content-rating-batch-label">单批</Label>
          <CustomSelect
            options={AI_BATCH_LIMIT_OPTIONS}
            value={String(batchLimit)}
            onChange={(value) => onBatchLimit(Math.min(AI_BATCH_LIMIT_MAX, Math.max(1, Number(value) || DEFAULT_AI_BATCH_LIMIT)))}
            aria-label="单批分析数量"
            className="content-ratings-batch-select"
            compact
          />
          <Button type="button" size="sm" onClick={onScan} disabled={scanning || active}>
            <Bot className={scanning ? 'size-3.5 animate-pulse' : 'size-3.5'} aria-hidden="true" />
            {scanning ? '创建任务…' : '分析未标注'}
          </Button>
        </div>
      </AdminToolbar>
      <p className="content-ratings-panel-description">
        只分析未标注作品。判级依据是元数据加正文采样片段，正文成人词命中只用于定位采样章节，不直接决定分级。模型建议经人工审核才可修改分级；批准“继续未标注”不会标为一般。
      </p>
      <AiTaskProgressBar task={task} progress={progress} onCancel={onCancel} onResume={onResume} cancelling={cancelling} resuming={resuming} />
      {!history && <div className="content-ratings-ai-selection" role="group" aria-label="LLM 建议批量操作">
        <Label><Checkbox aria-label="全选本页 LLM 建议" checked={allSelected ? true : someSelected ? 'indeterminate' : false} disabled={locked || !rows.length} onCheckedChange={checked => {
          setSelected(previous => {
            const next = new Map(previous)
            rows.forEach(row => { if (checked === true) next.set(row.id, row); else next.delete(row.id) })
            return next
          })
        }} />全选本页</Label>
        <span>已选 {selected.size} 条</span>
        <Button variant="ghost" size="sm" disabled={bulkBusy || !selected.size} onClick={() => setSelected(new Map())}>清空选择</Button>
        <AiSuggestionBulkReview items={[...selected.values()]} disabled={locked} onBusy={setBulkBusy} onCompleted={async ids => {
          setSelected(previous => { const next = new Map(previous); ids.forEach(id => next.delete(id)); return next })
          await onBulkCompleted()
        }} />
      </div>}
      {error ? (
        <ErrorState message={`LLM 建议加载失败：${error}`} onRetry={onRetry} />
      ) : loading && !data ? (
        <LoadingState label="正在加载 LLM 分级建议" rows={2} />
      ) : !data || data.items.length === 0 ? (
        <AdminEmptyState message={history ? '没有已过期的 LLM 分级建议。' : '还没有待审核的 LLM 分级建议；分析任务只会读取未标注作品。'} />
      ) : (
        <div className="content-ratings-queue" key={`${status}-${page}`}>
          {data.items.map((suggestion) => (
            <article className={`content-ratings-queue-item${history ? ' content-ratings-queue-item--stale' : ''}`} key={suggestion.id}>
              {!history && <Checkbox aria-label={`选择 LLM 建议：${suggestion.title || suggestion.id}`} checked={selected.has(suggestion.id)} disabled={locked} onCheckedChange={checked => select(suggestion, checked === true)} />}
              <div className="content-ratings-queue-copy">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">{suggestion.title || '未命名作品'}</span>
                  <AdminStatusBadge tone={suggestion.suggestedRating === 'restricted' ? 'danger' : 'muted'}>
                    {suggestion.suggestedRating === 'restricted' ? '建议限制级' : '建议继续未标注'}
                  </AdminStatusBadge>
                  <Badge variant="outline">置信度 {Math.round(suggestion.confidence * 100)}%</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {suggestion.author || '未知作者'} · 模型 {suggestion.model || '未记录'} · {suggestion.promptVersion}
                </p>
                <p className="content-ratings-queue-reason">{suggestion.reason || '未记录 AI 理由'}</p>
                {suggestion.evidence.length > 0 && (
                  <div className="mt-2">
                    <EvidenceList evidence={suggestion.evidence} compact />
                  </div>
                )}
              </div>
              {history && <p className="content-ratings-stale-reason" role="status">已过期：{suggestion.error || '作品分级或修订已变化'}，当前分级：{suggestion.currentRating === 'restricted' ? '限制级' : suggestion.currentRating === 'general' ? '一般' : '未标注'}。</p>}
              {!history && <div className="content-ratings-queue-actions">
                <Button type="button" variant="outline" size="sm" disabled={locked} onClick={() => onReview(suggestion)}>
                  <Eye className="size-3.5" aria-hidden="true" />
                  审核建议
                </Button>
              </div>}
            </article>
          ))}
        </div>
      )}
      <Pagination variant="detached" page={page} totalPages={Math.max(1, Math.ceil((data?.total || 0) / pageSize))} onPage={onPage}
        summary={`共 ${data?.total ?? '—'} 条建议`}
        pageSize={{ value: pageSize, options: ADMIN_PAGE_SIZE_OPTIONS, onChange: onPageSize }} busy={locked} />
    </AdminDataPanel>
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
  const aiProgressRef = useRef<{ taskId: string; done: number } | null>(null)

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
      const hasNewResult = previous?.taskId === taskId ? result.done > previous.done : result.done > 0
      const finished = ['completed', 'failed', 'cancelled'].includes(result.task.status)
      aiProgressRef.current = { taskId, done: result.done }
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
        aiProgressRef.current = { taskId: latest.task.id, done: latest.done }
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
        if (['completed', 'failed', 'cancelled'].includes(result.task.status)) await load(true)
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
      const result = await adminApi.contentRatingAi.scan({ limit: aiBatchLimit })
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
      actions={
        <Button variant="secondary" size="sm" onClick={refreshCurrentView} disabled={viewRefreshing}>
          <RefreshCw className={viewRefreshing ? 'size-3.5 animate-spin' : 'size-3.5'} />
          {viewRefreshing ? '同步中…' : refreshLabel}
        </Button>
      }
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
          <details ref={policyRef} className="content-ratings-policy">
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
          </details>
        </div>
        <TabsContent value="ledger">
          {!data ? (
            loading ? (
              <LoadingState className="admin-panel-card" label="正在加载内容分级账本" />
            ) : (
              <ErrorState className="admin-panel-card" message={`分级账本加载失败：${loadError || '未知错误'}`} onRetry={() => void load(true)} />
            )
          ) : (
            <>
              {/* 统一全要素胶囊筛选轨道（Filter Rail） */}
              <AdminToolbar layout="inline" className="admin-filter-rail content-ratings-toolbar content-ratings-filter-rail" ariaLive="polite">
                <AdminSearch
                  id="content-rating-search"
                  type="search"
                  label="搜索作品分级记录"
                  placeholder="搜索标题、作者或修改理由…"
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                />
                <div className="admin-filter-chips">
                  <CustomSelect
                    compact
                    chip
                    filterChip
                    leadingIcon={<CirclePlus className="size-[var(--admin-filter-chip-icon-size)]" />}
                    aria-label="分级"
                    options={RATING_OPTIONS}
                    value={ratingFilter}
                    onChange={(value) => {
                      setRatingFilter(value as ContentRating | '')
                      setPage(1)
                    }}
                  />
                  <CustomSelect
                    compact
                    chip
                    filterChip
                    leadingIcon={<CirclePlus className="size-[var(--admin-filter-chip-icon-size)]" />}
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
              </AdminToolbar>

              {loadError && <InlineError message={`分级账本同步失败：${loadError}`} onRetry={() => void load(true)} className="mx-5 my-4" />}

              <AdminDataPanel ariaLabel="内容分级账本" columns={RATING_COLUMNS} className="content-ratings-panel content-ratings-ledger" density="comfortable">

              {data.items.length === 0 ? (
                <AdminEmptyState message={query || ratingFilter || sourceFilter ? '当前筛选条件下没有作品' : '暂无内容分级记录'} />
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
                  <TableBody key={`${query}-${ratingFilter}-${sourceFilter}-${page}`}>
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
            onRetry={() => void loadAiSuggestions()}
            onScan={() => void scanAiSuggestions()}
            onCancel={() => void cancelAiTask()}
            onResume={() => void resumeAiTask()}
            status={aiStatus}
            onStatus={status => { setAiStatus(status); setAiPage(1); setAiData(null) }}
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
        <AdminDialogContent className="content-ratings-dialog sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>修改分级 · {editing?.title || '作品'}</DialogTitle>
            <DialogDescription>人工修改会记录操作人、理由和当前版本。提交前请确认你看到的是最新记录。</DialogDescription>
          </DialogHeader>
          <AdminDialogBody className="space-y-4">
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
          </AdminDialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditing(null)} disabled={saving}>
              取消
            </Button>
            <Button type="button" onClick={() => void saveEdit()} disabled={saving || !draftReason.trim()}>
              {saving ? '保存中…' : '保存分级'}
            </Button>
          </DialogFooter>
        </AdminDialogContent>
      </Dialog>

      <Dialog open={!!candidateNovel} onOpenChange={(open) => !open && setCandidateNovel(null)}>
        <AdminDialogContent className="content-ratings-dialog sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>沉淀规则候选 · {candidateNovel?.title || '作品'}</DialogTitle>
            <DialogDescription>这里只记录人工经验，等后续预览和批准后才会影响新作品；本次操作不会立即修改其他作品的分级。</DialogDescription>
          </DialogHeader>
          <AdminDialogBody className="space-y-4">
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
          </AdminDialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCandidateNovel(null)} disabled={candidateSaving}>
              取消
            </Button>
            <Button type="button" onClick={() => void saveCandidate()} disabled={candidateSaving || !candidateValue.trim() || !candidateReason.trim()}>
              {candidateSaving ? '保存中…' : '保存待审核候选'}
            </Button>
          </DialogFooter>
        </AdminDialogContent>
      </Dialog>

      <Dialog open={!!candidatePreviewCandidate} onOpenChange={(open) => !open && !candidateReviewSaving && closeCandidatePreview()}>
        <AdminDialogContent className="content-ratings-dialog max-h-[min(86vh,800px)] sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>预览规则影响 · {candidatePreviewCandidate?.value || '规则候选'}</DialogTitle>
            <DialogDescription>批准会把命中的未标注作品改为限制级，并把规则版本写入分级审计；一般作品和已人工确认的作品不会被覆盖。</DialogDescription>
          </DialogHeader>
          <AdminDialogBody className="space-y-4">
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
          </AdminDialogBody>
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
        </AdminDialogContent>
      </Dialog>

      <Dialog open={!!aiReviewSuggestion} onOpenChange={(open) => !open && closeAiReview()}>
        <AdminDialogContent
          className="content-ratings-dialog content-ratings-review-dialog"
          onCloseAutoFocus={(event) => {
            if (aiReviewTrigger.current?.isConnected) {
              event.preventDefault()
              aiReviewTrigger.current.focus({ preventScroll: true })
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>审核 LLM 分级建议</DialogTitle>
            <p className="content-ratings-review-work">{aiReviewSuggestion?.title || '作品'}{aiReviewSuggestion?.author && <span> / {aiReviewSuggestion.author}</span>}</p>
            <DialogDescription>核对模型证据与原文后，再决定是否采纳。建议须经人工确认才会生效。</DialogDescription>
          </DialogHeader>
          <AdminDialogBody className="space-y-4">
            {aiReviewSuggestion && (
              <div className="content-ratings-review-content">
                <section className="content-ratings-review-verdict" aria-label="AI 建议">
                  <div className="content-ratings-review-section-head">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="admin-dialog-section-label">AI 建议</h3>
                      <AdminStatusBadge tone={aiReviewSuggestion.suggestedRating === 'restricted' ? 'danger' : 'muted'}>
                        {aiReviewSuggestion.suggestedRating === 'restricted' ? '限制级' : '继续未标注'}
                      </AdminStatusBadge>
                    </div>
                    <span className="content-ratings-review-confidence admin-dialog-hint">模型置信度 <strong>{Math.round(aiReviewSuggestion.confidence * 100)}%</strong></span>
                  </div>
                  <p className="content-ratings-review-reason">{aiReviewSuggestion.reason || '未记录 AI 理由'}</p>
                </section>

                <section className="content-ratings-review-section" aria-label="模型提取的证据">
                  <div className="content-ratings-review-section-head">
                    <h3 className="admin-dialog-section-label">模型提取的证据</h3>
                    <span className="admin-dialog-hint">{aiReviewSuggestion.evidence.length} 条</span>
                  </div>
                  {aiReviewSuggestion.evidence.length > 0 ? (
                    <ol className="content-ratings-review-evidence">
                      {aiReviewSuggestion.evidence.map((item, index) => (
                        <li key={`${item.type}-${item.field || ''}-${index}`}>
                          <span className="content-ratings-review-evidence-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                          <p>{evidenceLabel(item)}</p>
                        </li>
                      ))}
                    </ol>
                  ) : <p className="admin-dialog-hint">暂无模型证据，请核对元数据与原文。</p>}
                </section>

                <BodySamplePanel body={aiReviewSuggestion.inputSnapshot.body} />

                <section className="content-ratings-review-section content-ratings-review-boundary" aria-label="审核边界">
                  <h3 className="admin-dialog-section-label">审核边界</h3>
                  <p className="admin-dialog-hint">当前分级 <AdminContentRatingBadge rating={aiReviewSuggestion.currentRating} />。批准“限制级”将修改分级并记录人工审核；批准“继续未标注”不会将作品标为一般。作品已变化时，本次建议不能批准。</p>
                  <details className="content-ratings-review-metadata admin-dialog-hint">
                    <summary>模型与版本信息</summary>
                    <dl>
                      <div><dt>模型</dt><dd>{aiReviewSuggestion.model || '未记录'}</dd></div>
                      <div><dt>提示版本</dt><dd>{aiReviewSuggestion.promptVersion}</dd></div>
                      <div><dt>作品修订</dt><dd>{aiReviewSuggestion.novelRevision}</dd></div>
                    </dl>
                  </details>
                </section>

                {aiReviewDecision && (
                  <div className="content-ratings-review-form grid gap-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Label htmlFor="content-rating-ai-review-reason">{aiReviewDecision === 'approve' ? '批准理由' : '拒绝理由'}</Label>
                      {aiReviewDecision === 'approve' && aiReviewSuggestion.reason.trim() && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-auto px-2 py-1 text-xs"
                          onClick={() => setAiReviewReason(aiReviewSuggestion.reason.trim().slice(0, 500))}
                          disabled={aiReviewSaving}
                        >
                          复用 AI 建议理由
                        </Button>
                      )}
                    </div>
                    <Textarea
                      ref={aiReviewReasonInput}
                      id="content-rating-ai-review-reason"
                      value={aiReviewReason}
                      onChange={(event) => setAiReviewReason(event.target.value)}
                      placeholder={
                        aiReviewDecision === 'approve' ? '说明元数据与正文证据为何支持这次人工确认。' : '说明为什么证据不足、存在误判风险或暂不采纳该建议。'
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
          </AdminDialogBody>
          <DialogFooter>
            {!aiReviewDecision ? (
              <>
                <Button type="button" variant="outline" onClick={() => closeAiReview()} disabled={aiReviewSaving}>
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
                <Button type="button" onClick={() => void reviewAiSuggestion()} disabled={aiReviewSaving}>
                  {aiReviewSaving ? '提交中…' : aiReviewDecision === 'approve' ? '确认批准建议' : '确认拒绝建议'}
                </Button>
              </>
            )}
          </DialogFooter>
        </AdminDialogContent>
      </Dialog>

      <Dialog open={!!historyNovel} onOpenChange={(open) => !open && setHistoryNovel(null)}>
        <AdminDialogContent className="content-ratings-dialog max-h-[min(80vh,720px)] sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>分级历史 · {historyNovel?.title || '作品'}</DialogTitle>
            <DialogDescription>这里保留自动判定、预填和人工修改的完整变更轨迹，便于复核结果从哪里来。</DialogDescription>
          </DialogHeader>
          <AdminDialogBody className="space-y-4">
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
          </AdminDialogBody>
        </AdminDialogContent>
      </Dialog>

      <Dialog open={!!evidenceNovel} onOpenChange={(open) => !open && setEvidenceNovel(null)}>
        <AdminDialogContent className="content-ratings-dialog sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>判定证据链 · {evidenceNovel?.title || '作品'}</DialogTitle>
            <DialogDescription>
              {evidenceNovel?.author ? `${evidenceNovel.author} · ` : ''}{formatNumber(evidenceNovel?.chapterCount || 0)} 章
            </DialogDescription>
          </DialogHeader>
          <AdminDialogBody className="space-y-4 pt-1">
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
                      全库规则巡检完成，未检出限制级敏感特征。
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
          </AdminDialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEvidenceNovel(null)} className="rounded-full px-5 h-8 text-xs font-medium border-border/80 hover:bg-muted/50">
              关闭
            </Button>
          </DialogFooter>
        </AdminDialogContent>
      </Dialog>
    </AdminPage>
  )
}
