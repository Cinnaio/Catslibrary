/** 调用审计：分页调用记录，行可展开详情。 */
import { Fragment, useEffect, useState } from 'react'
import { aiApi } from '@/lib/api'
import { useToast } from '@/components/feedback'
import Pagination from '@/components/admin/Pagination'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
  test: '连通性测试',
}

function aiCallTypeLabel(type: string): string {
  return aiCallTypeLabels[type] || '其他'
}

export default function AiAuditPanel() {
  const { toast } = useToast()
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
      costMillicents: number
      createdAt: number
      ipAddress: string
      userAgent: string
    }>
  >([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [limit, setLimit] = useState(50)
  const [offset, setOffset] = useState(0)
  const [filterType, setFilterType] = useState<string>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    async function loadCalls() {
      setLoading(true)
      try {
        const res = await aiApi.audit.calls({ limit, offset, type: filterType === 'all' ? undefined : filterType })
        setCalls(res.calls)
        setTotal(res.total)
      } catch (err) {
        toast((err as Error).message || '加载调用记录失败', 'error')
      } finally {
        setLoading(false)
      }
    }
    void loadCalls()
  }, [limit, offset, filterType, toast])

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">调用记录</CardTitle>
            <p className="text-sm text-muted-foreground">详细的 AI 调用审计日志，点击行可展开详情</p>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="audit-filter-type" className="text-xs text-muted-foreground">类型</Label>
            <Select
              value={filterType}
              onValueChange={(v) => {
                setFilterType(v)
                setOffset(0)
              }}
            >
              <SelectTrigger size="sm" id="audit-filter-type" className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" align="end" sideOffset={4}>
                <SelectItem value="all">全部</SelectItem>
                <SelectItem value="summary">前情提要</SelectItem>
                <SelectItem value="catchup">回顾总结</SelectItem>
                <SelectItem value="continue">续写</SelectItem>
                <SelectItem value="write_outline">创作大纲</SelectItem>
                <SelectItem value="write_chapter">创作章节</SelectItem>
                <SelectItem value="writing_title">标题生成</SelectItem>
                <SelectItem value="test">连通性测试</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {loading && calls.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-muted-foreground">加载中…</div>
          ) : calls.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-muted-foreground">暂无调用记录</div>
          ) : (
            <>
              <div className="overflow-hidden rounded-xl border border-border">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b bg-muted/50">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium">用户</th>
                        <th className="px-4 py-3 text-left font-medium">类型</th>
                        <th className="px-4 py-3 text-left font-medium">关联内容</th>
                        <th className="px-4 py-3 text-right font-medium">Token</th>
                        <th className="px-4 py-3 text-right font-medium">成本</th>
                        <th className="px-4 py-3 text-left font-medium">时间</th>
                      </tr>
                    </thead>
                    <tbody>
                      {calls.map((call) => {
                        const expanded = expandedId === call.id
                        return (
                          <Fragment key={call.id}>
                            <tr
                              className="cursor-pointer border-b last:border-0 hover:bg-muted/30"
                              onClick={() => setExpandedId(expanded ? null : call.id)}
                            >
                              <td className="px-4 py-3">
                                <div className="font-medium">{call.displayName || call.username || '—'}</div>
                                {call.username && call.displayName && (
                                  <div className="text-xs text-muted-foreground">@{call.username}</div>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                <Badge variant="secondary">
                                  {aiCallTypeLabel(call.type)}
                                </Badge>
                              </td>
                              <td className="px-4 py-3">
                                <div className="max-w-[280px]">
                                  <div className="truncate font-medium text-foreground">
                                    {call.novelTitle || <span className="text-muted-foreground">—</span>}
                                  </div>
                                  {call.chapterTitle && (
                                    <div className="truncate text-xs text-muted-foreground">
                                      📖 {call.chapterTitle}
                                    </div>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-3 text-right tabular-nums">
                                <div className="text-xs">
                                  <span className="text-muted-foreground">入</span>{' '}
                                  <span className="font-medium">{call.promptTokens.toLocaleString()}</span>
                                </div>
                                <div className="text-xs">
                                  <span className="text-muted-foreground">出</span>{' '}
                                  <span className="font-medium">{call.completionTokens.toLocaleString()}</span>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-right tabular-nums font-medium">
                                {formatCost(call.costMillicents)}
                              </td>
                              <td className="px-4 py-3 text-muted-foreground">
                                <div>{new Date(call.createdAt).toLocaleDateString('zh-CN')}</div>
                                <div className="text-xs">{new Date(call.createdAt).toLocaleTimeString('zh-CN')}</div>
                              </td>
                            </tr>
                            {expanded && (
                              <tr className="border-b last:border-0 bg-muted/20">
                                <td colSpan={6} className="px-4 py-4">
                                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                                    <DetailItem label="调用 ID" value={<code className="text-xs">{call.id}</code>} />
                                    <DetailItem label="模型" value={<code className="text-xs">{call.model || '—'}</code>} />
                                    <DetailItem
                                      label="小说 ID"
                                      value={<code className="text-xs">{call.novelId || '—'}</code>}
                                    />
                                    <DetailItem
                                      label="章节 ID"
                                      value={<code className="text-xs">{call.chapterId || '—'}</code>}
                                    />
                                    <DetailItem label="IP 地址" value={<code className="text-xs">{call.ipAddress || '未记录'}</code>} />
                                    <DetailItem label="User-Agent" value={<code className="block max-w-full truncate text-xs" title={call.userAgent}>{call.userAgent || '未记录'}</code>} />
                                  </div>
                                  <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
                                    <span>
                                      输入 Token：<strong className="text-foreground">{call.promptTokens.toLocaleString()}</strong>
                                    </span>
                                    <span>
                                      输出 Token：<strong className="text-foreground">{call.completionTokens.toLocaleString()}</strong>
                                    </span>
                                    <span>
                                      合计：
                                      <strong className="text-foreground">
                                        {(call.promptTokens + call.completionTokens).toLocaleString()}
                                      </strong>
                                    </span>
                                    <span>
                                      成本：<strong className="text-foreground">{formatCost(call.costMillicents)}</strong>
                                    </span>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="ai-list-footer mt-4 flex items-center gap-4">
                <span className="ai-list-total shrink-0 text-sm text-muted-foreground">
                  共 {total} 条记录，显示 {offset + 1}-{Math.min(offset + limit, total)}
                </span>
                <div className="ai-list-pagination-controls ml-auto flex shrink-0 items-center gap-3">
                  <div className="ai-list-page-size flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
                    <Label htmlFor="audit-page-size">每页</Label>
                    <Select value={String(limit)} onValueChange={(value) => { setLimit(Number(value)); setOffset(0) }}>
                      <SelectTrigger size="sm" id="audit-page-size" className="w-[88px]" aria-label="每页显示数量"><SelectValue /></SelectTrigger>
                      <SelectContent position="popper" align="end" sideOffset={4}>
                        <SelectItem value="10">10 条</SelectItem>
                        <SelectItem value="20">20 条</SelectItem>
                        <SelectItem value="50">50 条</SelectItem>
                        <SelectItem value="100">100 条</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Pagination className="ai-list-pagination" page={Math.floor(offset / limit) + 1} totalPages={Math.max(1, Math.ceil(total / limit))} onPage={(page) => setOffset((page - 1) * limit)} />
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
