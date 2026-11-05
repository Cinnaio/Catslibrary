/** 调用审计：分页调用记录，行可展开详情。 */
import { Fragment, useEffect, useState } from 'react'
import { ChevronRight, ListFilter, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { aiApi } from '@/lib/api'
import { getAdminTableRowStaggerDelay } from '@/lib/admin-table-motion'
import { cn } from '@/lib/utils'
import { ErrorState, InlineError, LoadingState } from "@/components/shared/AsyncStates"
import Pagination from "@/components/shared/Pagination"
import { ADMIN_DEFAULT_PAGE_SIZE, ADMIN_PAGE_SIZE_OPTIONS } from '@/lib/admin-pagination'
import AiPanelEmptyState from './AiPanelEmptyState'
import { useAiConfigured } from './useAiConfigured'
import { AdminDataPanel, type AdminColumn } from '@/components/admin/AdminDataPanel'
import SearchSelect from "@/components/shared/SearchSelect"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableCaption } from '@/components/ui/table'
import AdminStatusBadge from '@/components/admin/AdminStatusBadge'
import type { AdminStatusTone } from '@/lib/admin-status'
import { UserAvatar } from "@/components/identity/UserAvatar"
import { formatCost } from './shared'
import styles from '../calls.module.css'

const AUDIT_COLUMNS: readonly AdminColumn[] = [
  { key: 'content', label: '调用内容', width: '28%', primary: true },
  { key: 'user', label: '用户', width: '14%' },
  { key: 'model', label: '模型', width: '16%' },
  { key: 'usage', label: 'Token', width: '18%' },
  { key: 'cost', label: '成本', width: '11%' },
  { key: 'time', label: '时间', width: '13%' },
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
  story_memory: '章节增量记忆',
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
    case 'story_memory':
    case 'import_review':
    case 'content-rating-llm':
      return 'subtle'
    default:
      return 'neutral'
  }
}

interface AiAuditPanelProps {
  from?: number
  refreshKey?: number
  onRefresh?: () => void
  refreshBusy?: boolean
  onLoadingChange?: (loading: boolean) => void
}

export default function AiAuditPanel({ from, refreshKey = 0, onRefresh, refreshBusy = false, onLoadingChange }: AiAuditPanelProps = {}) {
  const [calls, setCalls] = useState<Awaited<ReturnType<typeof aiApi.audit.calls>>['calls']>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [total, setTotal] = useState(0)
  const [limit, setLimit] = useState(ADMIN_DEFAULT_PAGE_SIZE)
  const [filterType, setFilterType] = useState('all')
  // 将范围和分页绑定；切换时间范围的首个请求直接从第一页开始。
  const [pagination, setPagination] = useState({ from, offset: 0 })
  const offset = pagination.from === from ? pagination.offset : 0
  const [retryKey, setRetryKey] = useState(0)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const configured = useAiConfigured()
  const busy = loading || refreshBusy
  const retry = () => setRetryKey((value) => value + 1)
  const setOffset = (next: number) => setPagination({ from, offset: next })

  useEffect(() => {
    let active = true
    setLoading(true)
    void aiApi.audit.calls({ limit, offset, from, type: filterType === 'all' ? undefined : filterType }).then((res) => {
      if (!active) return
      if (res.total > 0 && offset >= res.total) {
        setPagination({ from, offset: Math.floor((res.total - 1) / limit) * limit })
        return
      }
      setCalls(res.calls)
      setTotal(res.total)
      setExpandedId((current) => res.calls.some((call) => call.id === current) ? current : null)
      setError('')
    }).catch((err: unknown) => {
      if (active) setError(err instanceof Error ? err.message : '加载调用记录失败')
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [limit, offset, filterType, from, refreshKey, retryKey])

  useEffect(() => { onLoadingChange?.(loading) }, [loading, onLoadingChange])

  const callTypeOptions = [
    { value: 'all', label: '全部类型' },
    ...Object.entries(aiCallTypeLabels).map(([value, label]) => ({ value, label })),
  ]

  return (
    <div className={styles.records}>
      <div className={styles.toolbar} aria-live="polite">
        <div className={styles.toolbarLeading}>
          <h3>调用记录</h3>
          <div className={styles.filter}>
            <SearchSelect
              compact
              chip
              filterChip
              leadingIcon={<ListFilter className="size-[var(--select-filter-chip-icon-size)]" />}
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
        <div className={styles.toolbarTrailing}>
          <span className={styles.count} role="status">
            {loading && calls.length === 0 ? '读取中' : error && calls.length === 0 ? '读取失败' : calls.length ? `共 ${total} 条` : '暂无内容'}
          </span>
          <Button variant="secondary" size="sm" onClick={onRefresh ?? retry} disabled={busy} aria-label={onRefresh ? "刷新用量与调用记录" : "刷新调用记录"}>
            <RefreshCw className={busy ? 'size-3.5 animate-spin' : 'size-3.5'} aria-hidden="true" />
            {busy ? '刷新中…' : '刷新'}
          </Button>
        </div>
      </div>
      <AdminDataPanel className={styles.auditPanel} ariaLabel="AI 调用记录列表" columns={AUDIT_COLUMNS} density="comfortable">
        {loading && calls.length === 0 ? (
          <LoadingState label="正在加载调用记录" />
        ) : error && calls.length === 0 ? (
          <ErrorState message={`调用记录加载失败：${error}`} onRetry={retry} />
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
            {error && <InlineError message={error} onRetry={retry} className="mb-3" />}
            <Table className={cn(styles.auditTable, 'admin-data-table admin-data-table--animated', loading && 'admin-data-table--transitioning')} aria-busy={loading}>
              {/* caption 只给表格名称与交互提示。列名由 <TableHead scope="col"> 完整提供，
                    在此复述会让读屏用户先听一遍列名、再听一遍表头。 */}
              <TableCaption className="sr-only">AI 调用记录，行可展开查看详情</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">调用内容</TableHead>
                  <TableHead scope="col">用户</TableHead>
                  <TableHead scope="col">模型</TableHead>
                  <TableHead scope="col" className="text-right">
                    Token / 图片
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
                        className={cn(styles.recordRow, expanded && styles.expanded)}
                        style={{ animationDelay: `${getAdminTableRowStaggerDelay(index, calls.length)}ms` }}
                        onClick={() => setExpandedId(expanded ? null : call.id)}
                      >
                        <TableCell data-primary data-label="调用内容">
                          <div className={styles.contentCell}>
                            <Button type="button" variant="ghost" size="icon" className={styles.rowToggle}
                              aria-expanded={expanded} aria-controls={expanded ? detailId : undefined} aria-label={`${recordLabel} 的调用详情`}
                              onClick={(event) => { event.stopPropagation(); setExpandedId(expanded ? null : call.id) }}>
                              <ChevronRight className={cn(styles.chevron, expanded && styles.rotated)} aria-hidden="true" />
                            </Button>
                            <div className={styles.contentText}>
                              <span className={styles.contentTitle} title={call.novelTitle || '未关联作品'}>{call.novelTitle || '未关联作品'}</span>
                              {call.chapterTitle && <span className={styles.secondary} title={call.chapterTitle}>{call.chapterTitle}</span>}
                              <AdminStatusBadge tone={aiCallTone(call.type)}>{aiCallTypeLabel(call.type)}</AdminStatusBadge>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell data-label="用户">
                          <div className={styles.identity}>
                            <UserAvatar name={recordName} src={call.avatarUrl} className={styles.avatar} />
                            <div className={styles.contentText}>
                              <span className={styles.ellipsis} title={recordName}>{recordName}</span>
                              {call.username && <span className={styles.secondary} title={`@${call.username}`}>@{call.username}</span>}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell data-label="模型"><span className={styles.model} title={call.model || '未记录'}>{call.model || '未记录'}</span></TableCell>
                        <TableCell data-label="消耗" className={styles.numeric}>
                          {call.imageCount > 0 ? <span className={styles.amount}>{call.imageCount.toLocaleString()} <small>张图片</small></span> :
                            <div className={styles.tokenPair}>
                              <span><small>输入</small><span>{call.promptTokens.toLocaleString()}</span></span>
                              <span><small>输出</small><span>{call.completionTokens.toLocaleString()}</span></span>
                            </div>}
                        </TableCell>
                        <TableCell data-label="成本" className={styles.numeric}>
                          <div className={styles.costCell}>
                            <span className={styles.amount}>{call.costReported === false ? '未回传' : formatCost(call.costMillicents)}</span>
                            {call.costReported !== false && <span className={styles.secondary}>{call.costCurrency || '币种未声明'}</span>}
                          </div>
                        </TableCell>
                        <TableCell data-label="时间">
                          <time className={styles.timestamp} dateTime={new Date(call.createdAt).toISOString()}>
                            <span>{new Date(call.createdAt).toLocaleDateString('zh-CN')}</span>
                            <span className={styles.secondary}>{new Date(call.createdAt).toLocaleTimeString('zh-CN', { hour12: false })}</span>
                          </time>
                        </TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow className={styles.detailRow} id={detailId}>
                          <TableCell colSpan={AUDIT_COLUMNS.length} className={styles.detailCell}>
                            <div className={styles.detailSheet}>
                              <section className={styles.detailSection} aria-label="调用信息">
                                <h4>调用信息</h4>
                                <p>{call.novelTitle || '未关联作品'}{call.chapterTitle ? ` · ${call.chapterTitle}` : ''}</p>
                                <p>{aiCallTypeLabel(call.type)} · {call.model || '模型未记录'}</p>
                              </section>
                              <h4>用量与费用</h4>
                              <div className={styles.detailMetrics}>
                                <div className={styles.detailMetric}>
                                  <span className={styles.detailLabel}>输入 Token</span>
                                  <span className={styles.detailValue}>{call.promptTokens.toLocaleString()}</span>
                                </div>
                                <div className={styles.detailMetric}>
                                  <span className={styles.detailLabel}>输出 Token</span>
                                  <span className={styles.detailValue}>{call.completionTokens.toLocaleString()}</span>
                                </div>
                                <div className={styles.detailMetric}>
                                  <span className={styles.detailLabel}>合计 Token</span>
                                  <span className={styles.detailValue}>{(call.promptTokens + call.completionTokens).toLocaleString()}</span>
                                </div>
                                <div className={styles.detailMetric}>
                                  <span className={styles.detailLabel}>缓存读取</span>
                                  <span className={styles.detailValue}>{call.cacheReadTokens == null ? '未回传' : `${call.cacheReadTokens.toLocaleString()} Token`}</span>
                                </div>
                                <div className={styles.detailMetric}>
                                  <span className={styles.detailLabel}>缓存写入</span>
                                  <span className={styles.detailValue}>{call.cacheWriteTokens == null ? '未回传' : `${call.cacheWriteTokens.toLocaleString()} Token`}</span>
                                </div>
                                <div className={styles.detailMetric}>
                                  <span className={styles.detailLabel}>推理 Token</span>
                                  <span className={styles.detailValue}>{call.reasoningTokens == null ? '未回传' : call.reasoningTokens.toLocaleString()}</span>
                                </div>
                                {call.imageCount > 0 && (
                                  <div className={styles.detailMetric}>
                                    <span className={styles.detailLabel}>图片生成</span>
                                    <span className={styles.detailValue}>{call.imageCount.toLocaleString()} 张</span>
                                  </div>
                                )}
                                <div className={styles.detailMetric}>
                                  <span className={styles.detailLabel}>已回传成本</span>
                                  <span className={styles.detailCost}>
                                    {call.costReported === false ? '上游未回传' : formatCost(call.costMillicents)}
                                  </span>
                                </div>
                              </div>

                              <h4>技术信息</h4>
                              <div className={styles.detailGrid}>
                                <div className={styles.detailField}>
                                  <span className={styles.detailLabel}>调用 ID</span>
                                  <span className={styles.detailValue}>{call.id}</span>
                                </div>
                                <div className={styles.detailField}>
                                  <span className={styles.detailLabel}>模型</span>
                                  <span className={styles.detailValue}>{call.model || '—'}</span>
                                </div>
                                <div className={styles.detailField}>
                                  <span className={styles.detailLabel}>上游请求 ID</span>
                                  <span className={styles.detailValue} title={call.upstreamRequestId || '未记录'}>
                                    {call.upstreamRequestId || '未记录'}
                                  </span>
                                </div>
                                <div className={styles.detailField}>
                                  <span className={styles.detailLabel}>成本来源</span>
                                  <span className={styles.detailValue}>
                                    {call.costSource === 'newapi-log' ? '中转站账单' : call.costSource === 'response' ? '生成响应' : '未记录'}
                                  </span>
                                </div>
                                <div className={styles.detailField}>
                                  <span className={styles.detailLabel}>成本币种</span>
                                  <span className={styles.detailValue}>{call.costCurrency || '上游未声明'}</span>
                                </div>
                                <div className={styles.detailField}>
                                  <span className={styles.detailLabel}>小说 ID</span>
                                  <span className={styles.detailValue}>{call.novelId || '—'}</span>
                                </div>
                                <div className={styles.detailField}>
                                  <span className={styles.detailLabel}>章节 ID</span>
                                  <span className={styles.detailValue}>{call.chapterId || '—'}</span>
                                </div>
                                <div className={styles.detailField}>
                                  <span className={styles.detailLabel}>客户端 IP</span>
                                  <span className={styles.detailValue}>{call.ipAddress || '未记录'}</span>
                                </div>
                                <div className={styles.detailFull}>
                                  <span className={styles.detailLabel}>User-Agent</span>
                                  <span className={styles.detailValue} title={call.userAgent}>
                                    {call.userAgent || '未记录'}
                                  </span>
                                </div>
                              </div>

                              <p className={styles.note}>
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
          pageSize={{ value: limit, onChange: (value) => { setLimit(value); setOffset(0) }, options: ADMIN_PAGE_SIZE_OPTIONS }}
        />
      )}
    </div>
  )
}
