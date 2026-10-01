/** 调用审计：分页调用记录，行可展开详情。 */
import { Fragment, useCallback, useEffect, useState } from 'react'
import { ChevronRight, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { aiApi } from '@/lib/api'
import { ErrorState, InlineError, LoadingState } from '@/components/admin/AsyncStates'
import Pagination from '@/components/admin/Pagination'
import { ADMIN_DEFAULT_PAGE_SIZE, ADMIN_PAGE_SIZE_OPTIONS } from '@/lib/admin-pagination'
import AiPanelEmptyState from './AiPanelEmptyState'
import { useAiConfigured } from './useAiConfigured'
import { AdminDataPanel, AdminPanelHeading, AdminToolbar } from '@/components/admin/AdminWorkspace'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DetailItem, formatCost } from './shared'

const aiCallTypeLabels: Record<string, string> = {
  summary: '前情提要',
  catchup: '回顾总结',
  continue: '续写',
  write_outline: '创作大纲',
  write_chapter: '创作章节',
  writing_title: '标题生成',
  cover: '封面生成',
  cover_prompt: '封面描述词',
  test: '连通性测试',
}

function aiCallTypeLabel(type: string): string {
  return aiCallTypeLabels[type] || '其他'
}

export default function AiAuditPanel({ from }: { from?: number } = {}) {
  const [calls, setCalls] = useState<
    Array<{
      id: string
      type: string
      model: string
      username: string
      displayName: string
      novelTitle: string
      chapterTitle: string
      novelId: string
      chapterId: string
      promptTokens: number
      completionTokens: number
      imageCount: number
      costMillicents: number
      costReported?: boolean
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
    void loadCalls()
  }, [loadCalls])

  return (
    <div className="ai-service-stack">
      <AdminDataPanel className="ai-audit-panel overflow-hidden" ariaLabel="AI 调用记录列表">
        <AdminPanelHeading
          title="调用记录"
          status={
            <span className={`admin-panel-status${error && calls.length === 0 ? ' is-error' : ''}`}>
              {loading && calls.length === 0 ? '读取中' : error && calls.length === 0 ? '读取失败' : calls.length ? `共 ${total} 条` : '暂无内容'}
            </span>
          }
          actions={
            <Button variant="ghost" size="icon" onClick={() => void loadCalls()} disabled={loading} aria-label="刷新调用记录" title="刷新调用记录">
              <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            </Button>
          }
        />
        {/* 类型筛选只作用于本面板的调用记录，与标题、表格同属一个面板。 */}
        <AdminToolbar className="ai-audit-toolbar" ariaLive="polite">
          <Label htmlFor="audit-filter-type" className="text-xs text-muted-foreground">
            类型
          </Label>
          <Select
            value={filterType}
            onValueChange={(v) => {
              setFilterType(v)
              setOffset(0)
            }}
          >
            <SelectTrigger size="sm" id="audit-filter-type" className="min-w-[8.75rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" align="end" sideOffset={4}>
              <SelectItem value="all">全部类型</SelectItem>
              <SelectItem value="summary">前情提要</SelectItem>
              <SelectItem value="catchup">回顾总结</SelectItem>
              <SelectItem value="continue">续写</SelectItem>
              <SelectItem value="write_outline">创作大纲</SelectItem>
              <SelectItem value="write_chapter">创作章节</SelectItem>
              <SelectItem value="writing_title">标题生成</SelectItem>
              <SelectItem value="cover">封面生成</SelectItem>
              <SelectItem value="cover_prompt">封面描述词</SelectItem>
              <SelectItem value="test">连通性测试</SelectItem>
            </SelectContent>
          </Select>
          <span className="calls-audit-scope">类型筛选仅作用于调用记录</span>
        </AdminToolbar>
        {calls.length > 0 && <p className="calls-audit-scroll-hint">左右滑动查看全部字段，点击记录展开详情。</p>}
        <div className="ai-list-body">
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
              {/* 该表含跨列的展开详情行，不能走 AdminDataPanel 的卡片化：
                  900px 以下 td 会被折成字段，colSpan 的详情行会错配。保留原生表格
                  并给容器横向滚动边界。 */}
              <div className="ai-audit-table">
                <table className="ai-audit-table__table">
                  <colgroup>
                    <col style={{ width: '17%' }} />
                    <col style={{ width: '13%' }} />
                    <col style={{ width: '26%' }} />
                    <col style={{ width: '16%' }} />
                    <col style={{ width: '12%' }} />
                    <col style={{ width: '16%' }} />
                  </colgroup>
                  {/* caption 只给表格名称与交互提示。列名由 <th scope="col"> 完整提供，
                      在此复述会让读屏用户先听一遍列名、再听一遍表头。 */}
                  <caption className="sr-only">AI 调用记录，行可展开查看详情</caption>
                  <thead>
                    <tr>
                      <th scope="col">用户</th>
                      <th scope="col">类型</th>
                      <th scope="col">关联内容</th>
                      <th scope="col" className="is-numeric">
                        消耗
                      </th>
                      <th scope="col" className="is-numeric">
                        成本
                      </th>
                      <th scope="col">时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {calls.map((call) => {
                      const expanded = expandedId === call.id
                      const detailId = `ai-audit-detail-${call.id}`
                      const recordName = call.displayName || call.username || '未记录用户'
                      // 可及名称必须逐行唯一：整列按钮若都叫「XX 的调用详情」，
                      // 读屏按按钮导航时会连听 50 遍相同标签而无法区分记录。
                      const recordLabel = `${recordName} ${aiCallTypeLabel(call.type)} ${new Date(call.createdAt).toLocaleString('zh-CN')}`
                      return (
                        <Fragment key={call.id}>
                          <tr className="ai-audit-row" onClick={() => setExpandedId(expanded ? null : call.id)}>
                            <td>
                              <div className="ai-audit-cell__identity">
                                {/* 整行 onClick 只服务鼠标；键盘与读屏需要一个真实控件。
                                    aria-expanded 放在 <tr> 上无效（role=row 不接受该属性），
                                    故把展开状态与 aria-controls 交给身份列内这个 button。
                                    stopPropagation 必须保留：Enter 触发的 click 会冒泡到
                                    行上，不拦截就会连开两次而净效果为零。
                                    aria-controls 仅在展开时给出，避免指向尚未渲染的行。 */}
                                <button
                                  type="button"
                                  className="ai-audit-row__toggle"
                                  aria-expanded={expanded}
                                  aria-controls={expanded ? detailId : undefined}
                                  aria-label={`${recordLabel} 的调用详情`}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    setExpandedId(expanded ? null : call.id)
                                  }}
                                >
                                  <ChevronRight className="ai-audit-row__caret" aria-hidden="true" />
                                </button>
                                <div className="ai-audit-cell__identity-text">
                                  <div className="ai-audit-cell__name">{call.displayName || call.username || '—'}</div>
                                  {call.username && call.displayName && <div className="ai-audit-cell__sub">@{call.username}</div>}
                                </div>
                              </div>
                            </td>
                            <td>
                              <Badge variant="secondary">{aiCallTypeLabel(call.type)}</Badge>
                            </td>
                            <td>
                              <div className="ai-audit-cell__content">
                                <div className="ai-audit-cell__name">{call.novelTitle || <span className="ai-audit-cell__muted">—</span>}</div>
                                {call.chapterTitle && <div className="ai-audit-cell__sub">{call.chapterTitle}</div>}
                              </div>
                            </td>
                            <td className="is-numeric">
                              {call.imageCount > 0 ? (
                                <div className="ai-audit-cell__sub">
                                  <span className="ai-audit-cell__muted">图片</span>{' '}
                                  <span className="ai-audit-cell__strong">{call.imageCount.toLocaleString()}</span>
                                </div>
                              ) : (
                                <>
                                  <div className="ai-audit-cell__sub">
                                    <span className="ai-audit-cell__muted">入</span>{' '}
                                    <span className="ai-audit-cell__strong">{call.promptTokens.toLocaleString()}</span>
                                  </div>
                                  <div className="ai-audit-cell__sub">
                                    <span className="ai-audit-cell__muted">出</span>{' '}
                                    <span className="ai-audit-cell__strong">{call.completionTokens.toLocaleString()}</span>
                                  </div>
                                </>
                              )}
                              <div className="ai-audit-cell__sub" title="上游输入缓存读取量，已包含在输入 Token 中">
                                {call.cacheReadTokens == null
                                  ? '缓存未回传'
                                  : call.cacheReadTokens > 0
                                    ? `缓存命中 ${call.cacheReadTokens.toLocaleString()}`
                                    : '缓存未命中'}
                              </div>
                            </td>
                            <td className="is-numeric ai-audit-cell__strong">{call.costReported === false ? '未回传' : formatCost(call.costMillicents)}</td>
                            <td className="ai-audit-cell__muted">
                              <div>{new Date(call.createdAt).toLocaleDateString('zh-CN')}</div>
                              <div className="ai-audit-cell__sub">{new Date(call.createdAt).toLocaleTimeString('zh-CN')}</div>
                            </td>
                          </tr>
                          {expanded && (
                            <tr className="ai-audit-row ai-audit-row--detail" id={detailId}>
                              <td colSpan={6}>
                                <div className="ai-audit-detail">
                                  <DetailItem label="调用 ID" value={<code className="text-xs">{call.id}</code>} />
                                  <DetailItem label="模型" value={<code className="text-xs">{call.model || '—'}</code>} />
                                  <DetailItem label="小说 ID" value={<code className="text-xs">{call.novelId || '—'}</code>} />
                                  <DetailItem label="章节 ID" value={<code className="text-xs">{call.chapterId || '—'}</code>} />
                                  <DetailItem label="IP 地址" value={<code className="text-xs">{call.ipAddress || '未记录'}</code>} />
                                  <DetailItem
                                    label="User-Agent"
                                    value={
                                      <code className="block max-w-full truncate text-xs" title={call.userAgent}>
                                        {call.userAgent || '未记录'}
                                      </code>
                                    }
                                  />
                                </div>
                                <div className="ai-audit-detail__usage">
                                  <span>
                                    缓存读取：<strong>{call.cacheReadTokens == null ? '未回传' : `${call.cacheReadTokens.toLocaleString()} Token`}</strong>
                                  </span>
                                  <span>
                                    缓存写入：<strong>{call.cacheWriteTokens == null ? '未回传' : `${call.cacheWriteTokens.toLocaleString()} Token`}</strong>
                                  </span>
                                  <span>
                                    推理 Token：<strong>{call.reasoningTokens == null ? '未回传' : call.reasoningTokens.toLocaleString()}</strong>
                                  </span>
                                  {call.imageCount > 0 ? (
                                    <span>
                                      图片生成：
                                      <strong>{call.imageCount.toLocaleString()} 张</strong>
                                    </span>
                                  ) : (
                                    <>
                                      <span>
                                        输入 Token：
                                        <strong>{call.promptTokens.toLocaleString()}</strong>
                                      </span>
                                      <span>
                                        输出 Token：
                                        <strong>{call.completionTokens.toLocaleString()}</strong>
                                      </span>
                                      <span>
                                        合计：
                                        <strong>{(call.promptTokens + call.completionTokens).toLocaleString()}</strong>
                                      </span>
                                    </>
                                  )}
                                  <span>
                                    成本：<strong>{call.costReported === false ? '上游未回传' : formatCost(call.costMillicents)}</strong>
                                  </span>
                                </div>
                                <p className="ai-audit-cell__sub mt-2">
                                  缓存读取与写入属于输入 Token；推理 Token 属于输出 Token，均不重复计入合计。此处统计上游缓存，不包含站内已生成内容的复用。
                                </p>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <Pagination
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
            </>
          )}
        </div>
      </AdminDataPanel>
    </div>
  )
}
