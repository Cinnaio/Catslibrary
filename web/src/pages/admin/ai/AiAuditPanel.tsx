/** 调用审计：分页调用记录，行可展开详情。 */
import { Fragment, useCallback, useEffect, useState } from 'react'
import { ChevronRight, CirclePlus, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { aiApi } from '@/lib/api'
import { getAdminTableRowStaggerDelay } from '@/lib/admin-table-motion'
import { cn } from '@/lib/utils'
import { ErrorState, InlineError, LoadingState } from '@/components/admin/AsyncStates'
import Pagination from '@/components/admin/Pagination'
import { ADMIN_DEFAULT_PAGE_SIZE, ADMIN_PAGE_SIZE_OPTIONS } from '@/lib/admin-pagination'
import AiPanelEmptyState from './AiPanelEmptyState'
import { useAiConfigured } from './useAiConfigured'
import { AdminDataPanel, type AdminColumn } from '@/components/admin/AdminWorkspace'
import CustomSelect from '@/components/admin/CustomSelect'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableCaption } from '@/components/ui/table'
import AdminStatusBadge from '@/components/admin/AdminStatusBadge'
import type { AdminStatusTone } from '@/lib/admin-status'
import { UserAvatar } from '@/components/ui/user-avatar'
import { formatCost } from './shared'

const AUDIT_COLUMNS: readonly AdminColumn[] = [
  { key: 'user', width: '20%' },
  { key: 'type', width: '12%' },
  { key: 'content', width: '24%' },
  { key: 'usage', width: '20%' },
  { key: 'cost', width: '11%' },
  { key: 'time', width: '13%' },
]

const aiCallTypeLabels: Record<string, string> = {
  summary: '前情提要',
  catchup: '回顾总结',
  continue: '续写',
  write_outline: '创作大纲',
  write_chapter: '创作章节',
  writing_title: '标题生成',
  plot_suggestion: '情节建议',
  plot_outline: '情节大纲',
  rewrite_selection: '选段改写',
  style_profile: '文风分析',
  relationship_profile: '人物关系分析',
  plot_state: '剧情状态分析',
  writing_review: '草稿质量检查',
  import_review: '导入审校',
  'content-rating-llm': '内容分级',
  selection_image: '选段配图',
  cover: '封面生成',
  cover_prompt: '封面描述词',
  test: '连通性测试',
}

function aiCallTypeLabel(type: string): string {
  return aiCallTypeLabels[type] || '其他'
}

function aiCallTone(type: string): AdminStatusTone {
  switch (type) {
    case 'test':
      return 'warning'
    case 'cover':
    case 'cover_prompt':
    case 'selection_image':
      return 'accent'
    case 'continue':
    case 'write_chapter':
    case 'write_outline':
    case 'writing_title':
    case 'plot_suggestion':
    case 'plot_outline':
    case 'rewrite_selection':
      return 'info'
    case 'summary':
    case 'catchup':
    case 'style_profile':
    case 'relationship_profile':
    case 'plot_state':
    case 'import_review':
    case 'content-rating-llm':
      return 'subtle'
    default:
      return 'neutral'
  }
}

export default function AiAuditPanel({ from }: { from?: number } = {}) {
  const [calls, setCalls] = useState<
    Array<{
      id: string
      type: string
      model: string
      username: string
      displayName: string
      avatarUrl?: string
      novelTitle: string
      chapterTitle: string
      novelId: string
      chapterId: string
      promptTokens: number
      completionTokens: number
      imageCount: number
      costMillicents: number
      costReported?: boolean
      upstreamRequestId?: string
      costSource?: string
      costCurrency?: string
      cacheReadTokens?: number | null
      cacheWriteTokens?: number | null
      reasoningTokens?: number | null
      createdAt: number
      ipAddress: string
      userAgent: string
    }>
  >([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [total, setTotal] = useState(0)
  const [limit, setLimit] = useState(ADMIN_DEFAULT_PAGE_SIZE)
  const [offset, setOffset] = useState(0)
  const [filterType, setFilterType] = useState<string>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const configured = useAiConfigured()

  const loadCalls = useCallback(async () => {
    setLoading(true)
    try {
      const res = await aiApi.audit.calls({ limit, offset, from, type: filterType === 'all' ? undefined : filterType })
      setCalls(res.calls)
      setTotal(res.total)
      setError('')
    } catch (err) {
      setError((err as Error).message || '加载调用记录失败')
    } finally {
      setLoading(false)
    }
  }, [limit, offset, filterType, from])

  useEffect(() => {
    setOffset(0)
  }, [from])

  useEffect(() => {
    void loadCalls()
  }, [loadCalls])

  const callTypeOptions = [
    { value: 'all', label: '全部类型' },
    ...Object.entries(aiCallTypeLabels).map(([value, label]) => ({ value, label })),
  ]

  return (
    <div className="ai-service-stack">
      {/* 单层控制流：工作对象标题与类型筛选胶囊同排居左，状态与刷新居右 */}
      <div className="calls-flat-toolbar" aria-live="polite">
        <div className="calls-flat-toolbar__leading">
          <h3 className="calls-flat-toolbar__title">调用记录明细</h3>
          <div className="admin-filter-chips">
            <CustomSelect
              compact
              chip
              filterChip
              leadingIcon={<CirclePlus className="size-[var(--admin-filter-chip-icon-size)]" />}
              aria-label="类型"
              value={filterType}
              onChange={(v) => {
                setFilterType(v)
                setOffset(0)
              }}
              options={callTypeOptions}
            />
          </div>
        </div>
        <div className="calls-flat-toolbar__trailing">
          <span className={`admin-panel-status${error && calls.length === 0 ? ' is-error' : ''}`}>
            {loading && calls.length === 0 ? '读取中' : error && calls.length === 0 ? '读取失败' : calls.length ? `共 ${total} 条` : '暂无内容'}
          </span>
          <Button variant="secondary" size="sm" onClick={() => void loadCalls()} disabled={loading} aria-label="刷新调用记录">
            <RefreshCw className={loading ? 'size-3.5 animate-spin' : 'size-3.5'} aria-hidden="true" />
            {loading ? '刷新中…' : '刷新'}
          </Button>
        </div>
      </div>
      <AdminDataPanel className="ai-audit-panel" ariaLabel="AI 调用记录列表" columns={AUDIT_COLUMNS} density="comfortable" responsive="scroll">
        {loading && calls.length === 0 ? (
          <LoadingState label="正在加载调用记录" />
        ) : error && calls.length === 0 ? (
          <ErrorState message={`调用记录加载失败：${error}`} />
        ) : calls.length === 0 ? (
          <AiPanelEmptyState
            configured={configured}
            unconfiguredMessage="尚未配置文本 AI 供应商，没有可审计的调用"
            unconfiguredHint="配置文本供应商后，每次调用都会留下审计明细。"
            emptyMessage={filterType === 'all' ? '暂无调用记录' : '当前类型筛选下没有调用记录'}
            hint={filterType === 'all' ? '发起任意 AI 生成后，这里会留下调用明细。' : '把类型筛选切回「全部」可以看所有记录。'}
          />
        ) : (
          <>
            {error && <InlineError message={error} onRetry={() => void loadCalls()} className="mb-3" />}
            <Table className={cn('admin-data-table admin-data-table--animated', loading && 'admin-data-table--transitioning')}>
              {/* caption 只给表格名称与交互提示。列名由 <TableHead scope="col"> 完整提供，
                    在此复述会让读屏用户先听一遍列名、再听一遍表头。 */}
              <TableCaption className="sr-only">AI 调用记录，行可展开查看详情</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">用户</TableHead>
                  <TableHead scope="col">类型</TableHead>
                  <TableHead scope="col">关联内容</TableHead>
                  <TableHead scope="col" className="text-right">
                    消耗
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    成本
                  </TableHead>
                  <TableHead scope="col">时间</TableHead>
                </TableRow>
              </TableHeader>
              {/* 换筛选或翻页时重建表体，让阶梯入场动效重新触发；数据本身不在此清空。 */}
              <TableBody key={`${filterType}-${offset}-${limit}`}>
                {calls.map((call, index) => {
                  const expanded = expandedId === call.id
                  const detailId = `ai-audit-detail-${call.id}`
                  const recordName = call.displayName || call.username || '未记录用户'
                  // 可及名称必须逐行唯一：整列按钮若都叫「XX 的调用详情」，
                  // 读屏按按钮导航时会连听 50 遍相同标签而无法区分记录。
                  const recordLabel = `${recordName} ${aiCallTypeLabel(call.type)} ${new Date(call.createdAt).toLocaleString('zh-CN')}`
                  return (
                    <Fragment key={call.id}>
                      <TableRow
                        className={cn(
                          'ai-audit-row transition-colors cursor-pointer',
                          expanded ? 'ai-audit-row--expanded bg-muted/30' : 'hover:bg-muted/20'
                        )}
                        style={{ animationDelay: `${getAdminTableRowStaggerDelay(index, calls.length)}ms` }}
                        onClick={() => setExpandedId(expanded ? null : call.id)}
                      >
                        <TableCell>
                          <div className="flex items-center gap-2.5 min-w-0">
                            <button
                              type="button"
                              className="size-6 -ml-1 rounded flex items-center justify-center text-muted-foreground/60 hover:text-foreground hover:bg-muted/60 transition-transform duration-200 shrink-0"
                              aria-expanded={expanded}
                              aria-controls={expanded ? detailId : undefined}
                              aria-label={`${recordLabel} 的调用详情`}
                              onClick={(event) => {
                                event.stopPropagation()
                                setExpandedId(expanded ? null : call.id)
                              }}
                            >
                              <ChevronRight className={cn('size-3.5 transition-transform duration-200', expanded && 'rotate-90 text-foreground')} aria-hidden="true" />
                            </button>
                            <UserAvatar name={recordName} src={call.avatarUrl} className="size-6 text-[10px] rounded-full shrink-0" />
                            <div className="min-w-0">
                              <div className="text-[13px] font-medium text-foreground truncate">{call.displayName || call.username || '—'}</div>
                              {call.username && call.displayName && <div className="text-[11px] text-muted-foreground font-mono truncate">@{call.username}</div>}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <AdminStatusBadge tone={aiCallTone(call.type)} className="text-[11px] font-normal">
                            {aiCallTypeLabel(call.type)}
                          </AdminStatusBadge>
                        </TableCell>
                        <TableCell>
                          <div className="min-w-0">
                            <div className="text-[13px] font-medium text-foreground truncate" title={call.novelTitle}>
                              {call.novelTitle || <span className="text-muted-foreground/40 text-xs">—</span>}
                            </div>
                            {call.chapterTitle && <div className="text-[11px] text-muted-foreground truncate" title={call.chapterTitle}>{call.chapterTitle}</div>}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          {call.imageCount > 0 ? (
                            <div className="flex flex-col items-end gap-0.5">
                              <span className="font-mono text-[13px] font-semibold text-foreground">
                                {call.imageCount.toLocaleString()} <span className="text-[11px] text-muted-foreground font-normal">张图片</span>
                              </span>
                              <span className="text-[11px] text-muted-foreground font-mono">生图调用</span>
                            </div>
                          ) : (
                            <div className="flex flex-col items-end gap-0.5">
                              <div className="font-mono text-[13px] font-semibold text-foreground">
                                <span className="text-[11px] font-normal text-muted-foreground mr-1">入</span>
                                <span>{call.promptTokens.toLocaleString()}</span>
                                <span className="mx-1 text-muted-foreground/40 font-normal">/</span>
                                <span className="text-[11px] font-normal text-muted-foreground mr-1">出</span>
                                <span>{call.completionTokens.toLocaleString()}</span>
                              </div>
                              <div
                                className={cn(
                                  'text-[11px] font-mono',
                                  call.cacheReadTokens && call.cacheReadTokens > 0
                                    ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                                    : 'text-muted-foreground/75'
                                )}
                                title="上游输入缓存读取量，已包含在输入 Token 中"
                              >
                                {call.cacheReadTokens == null
                                  ? '缓存未回传'
                                  : call.cacheReadTokens > 0
                                    ? `缓存命中 ${call.cacheReadTokens.toLocaleString()}`
                                    : '缓存未命中'}
                              </div>
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="font-mono text-[13px] font-semibold text-foreground">
                            {call.costReported === false ? <span className="font-normal text-muted-foreground text-xs">未回传</span> : formatCost(call.costMillicents)}
                          </span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <div className="font-mono text-xs text-foreground/85">{new Date(call.createdAt).toLocaleDateString('zh-CN')}</div>
                          <div className="font-mono text-[11px] text-muted-foreground">{new Date(call.createdAt).toLocaleTimeString('zh-CN')}</div>
                        </TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow className="ai-audit-row ai-audit-row--detail" id={detailId}>
                          <TableCell colSpan={AUDIT_COLUMNS.length} className="pt-1 pb-4">
                            <div className="ai-audit-detail-sheet">
                              {/* 1. 消耗与成本核算指标行 (Flat Metrics Row) */}
                              <div className="ai-audit-detail-metrics">
                                <div className="ai-audit-detail-metric">
                                  <span className="ai-audit-detail-metric__label">输入 Token</span>
                                  <span className="ai-audit-detail-metric__value">{call.promptTokens.toLocaleString()}</span>
                                </div>
                                <div className="ai-audit-detail-metric">
                                  <span className="ai-audit-detail-metric__label">输出 Token</span>
                                  <span className="ai-audit-detail-metric__value">{call.completionTokens.toLocaleString()}</span>
                                </div>
                                <div className="ai-audit-detail-metric">
                                  <span className="ai-audit-detail-metric__label">合计 Token</span>
                                  <span className="ai-audit-detail-metric__value font-semibold">{(call.promptTokens + call.completionTokens).toLocaleString()}</span>
                                </div>
                                <div className="ai-audit-detail-metric">
                                  <span className="ai-audit-detail-metric__label">缓存读取</span>
                                  <span className="ai-audit-detail-metric__value">{call.cacheReadTokens == null ? '未回传' : `${call.cacheReadTokens.toLocaleString()} Token`}</span>
                                </div>
                                <div className="ai-audit-detail-metric">
                                  <span className="ai-audit-detail-metric__label">缓存写入</span>
                                  <span className="ai-audit-detail-metric__value">{call.cacheWriteTokens == null ? '未回传' : `${call.cacheWriteTokens.toLocaleString()} Token`}</span>
                                </div>
                                <div className="ai-audit-detail-metric">
                                  <span className="ai-audit-detail-metric__label">推理 Token</span>
                                  <span className="ai-audit-detail-metric__value">{call.reasoningTokens == null ? '未回传' : call.reasoningTokens.toLocaleString()}</span>
                                </div>
                                {call.imageCount > 0 && (
                                  <div className="ai-audit-detail-metric">
                                    <span className="ai-audit-detail-metric__label">图片生成</span>
                                    <span className="ai-audit-detail-metric__value">{call.imageCount.toLocaleString()} 张</span>
                                  </div>
                                )}
                                <div className="ai-audit-detail-metric is-cost">
                                  <span className="ai-audit-detail-metric__label">最终成本</span>
                                  <span className="ai-audit-detail-metric__value is-accent">
                                    {call.costReported === false ? '上游未回传' : formatCost(call.costMillicents)}
                                  </span>
                                </div>
                              </div>

                              {/* 2. 详细元数据属性网格 (Flat Metadata Grid) */}
                              <div className="ai-audit-detail-grid">
                                <div className="ai-audit-detail-field">
                                  <span className="ai-audit-detail-field__label">调用 ID</span>
                                  <span className="ai-audit-detail-field__value font-mono select-all">{call.id}</span>
                                </div>
                                <div className="ai-audit-detail-field">
                                  <span className="ai-audit-detail-field__label">模型</span>
                                  <span className="ai-audit-detail-field__value font-mono">{call.model || '—'}</span>
                                </div>
                                <div className="ai-audit-detail-field">
                                  <span className="ai-audit-detail-field__label">上游请求 ID</span>
                                  <span className="ai-audit-detail-field__value font-mono select-all truncate block" title={call.upstreamRequestId || '未记录'}>
                                    {call.upstreamRequestId || '未记录'}
                                  </span>
                                </div>
                                <div className="ai-audit-detail-field">
                                  <span className="ai-audit-detail-field__label">成本来源</span>
                                  <span className="ai-audit-detail-field__value">
                                    {call.costSource === 'newapi-log' ? '中转站账单' : call.costSource === 'response' ? '生成响应' : '未记录'}
                                  </span>
                                </div>
                                <div className="ai-audit-detail-field">
                                  <span className="ai-audit-detail-field__label">成本币种</span>
                                  <span className="ai-audit-detail-field__value font-mono">{call.costCurrency || '上游未声明'}</span>
                                </div>
                                <div className="ai-audit-detail-field">
                                  <span className="ai-audit-detail-field__label">小说 ID</span>
                                  <span className="ai-audit-detail-field__value font-mono">{call.novelId || '—'}</span>
                                </div>
                                <div className="ai-audit-detail-field">
                                  <span className="ai-audit-detail-field__label">章节 ID</span>
                                  <span className="ai-audit-detail-field__value font-mono">{call.chapterId || '—'}</span>
                                </div>
                                <div className="ai-audit-detail-field">
                                  <span className="ai-audit-detail-field__label">客户端 IP</span>
                                  <span className="ai-audit-detail-field__value font-mono">{call.ipAddress || '未记录'}</span>
                                </div>
                                <div className="ai-audit-detail-field col-span-full">
                                  <span className="ai-audit-detail-field__label">User-Agent</span>
                                  <span className="ai-audit-detail-field__value font-mono text-[11px] text-muted-foreground break-all" title={call.userAgent}>
                                    {call.userAgent || '未记录'}
                                  </span>
                                </div>
                              </div>

                              {/* 3. 审计合规附注说明 */}
                              <p className="ai-audit-detail-note">
                                缓存读取与写入属于输入 Token；推理 Token 属于输出 Token，均不重复计入合计。此处统计上游缓存，不包含站内已生成内容的复用。
                              </p>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  )
                })}
              </TableBody>
            </Table>
          </>
        )}
      </AdminDataPanel>
      {/* 分页作为数据面板的兄弟节点：它属于这份列表但不属于纸面本身。 */}
      {calls.length > 0 && (
        <Pagination
          variant="detached"
          page={Math.floor(offset / limit) + 1}
          totalPages={Math.max(1, Math.ceil(total / limit))}
          onPage={(page) => setOffset((page - 1) * limit)}
          busy={loading}
          summary={
            <>
              共 {total} 条记录，显示 {offset + 1}-{Math.min(offset + limit, total)}
            </>
          }
          pageSize={{ value: limit, onChange: setLimit, options: ADMIN_PAGE_SIZE_OPTIONS }}
        />
      )}
    </div>
  )
}
