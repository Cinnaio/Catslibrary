/** 已生成内容管理：列出 AI 产物，支持按类型筛选、批量删除、草稿发布。 */
import { Fragment, useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { aiApi } from '@/lib/api'
import { useToast, useConfirm } from '@/components/feedback'
import Pagination from '@/components/admin/Pagination'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { kindLabel } from './shared'

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
  groupItems?: AiGenerationListItem[]
}

export default function AiGenerationsPanel(props: { scope: 'all' | 'reader' | 'writing'; status?: 'all' | 'published' | 'draft' | 'rejected' }) {
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const [items, setItems] = useState<AiGenerationListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [limit, setLimit] = useState(50)
  const [offset, setOffset] = useState(0)
  const [filterKind, setFilterKind] = useState<'all' | 'summary' | 'catchup' | 'write_outline' | 'write_chapter' | 'continue'>('all')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [viewing, setViewing] = useState<AiGenerationListItem | null>(null)
  const [publishTitle, setPublishTitle] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [titleCandidates, setTitleCandidates] = useState<string[]>([])
  const [generatingTitles, setGeneratingTitles] = useState(false)
  const [expandedBatchId, setExpandedBatchId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [batchDeleting, setBatchDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await aiApi.generations({ kind: filterKind === 'all' ? undefined : filterKind, scope: props.scope, status: props.status, limit, offset })
      const allowedKinds = props.scope === 'writing'
        ? new Set(['continue', 'write_outline', 'write_chapter'])
        : props.scope === 'reader'
          ? new Set(['summary', 'catchup'])
          : new Set(['summary', 'catchup', 'continue', 'write_outline', 'write_chapter'])
      const filtered = res.items.filter((item) => allowedKinds.has(item.kind))
      const groups = new Map<string, AiGenerationListItem[]>()
      for (const item of filtered) {
        const key = item.batchId || item.id
        const group = groups.get(key) || []
        group.push(item)
        groups.set(key, group)
      }
      setItems(Array.from(groups.entries()).map(([key, group]) => {
        if (!group[0] || !group[0].batchId || group.length === 1) return group[0]!
        const first = group[0]
        return {
          ...first,
          id: key,
          result: `${group.length} 个续写章节草稿`,
          chapterTitle: `${group.length} 章续写集合`,
          batchCount: group.length,
          groupItems: group.sort((a, b) => a.batchIndex - b.batchIndex),
        }
      }))
      setSelectedIds(new Set())
      setTotal(res.total)
    } catch (err) {
      toast((err as Error).message || '加载已生成内容失败', 'error')
    } finally {
      setLoading(false)
    }
  }, [filterKind, limit, offset, props.scope, props.status, toast])

  useEffect(() => {
    void load()
  }, [load])

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
      toast('已删除', 'success')
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

  const selectedCount = [...selectedIds].length
  const allSelected = items.length > 0 && items.every((item) => idsForItem(item).every((id) => selectedIds.has(id)))

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
      const result = await aiApi.deleteGenerations([...selectedIds])
      toast(`已删除 ${result.deleted} 条生成记录`, 'success')
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
      toast('已发布为正式章节', 'success')
      setViewing(null)
      setPublishTitle('')
      void load()
    } catch (err) {
      toast((err as Error).message || '发布失败', 'error')
    } finally {
      setPublishing(false)
    }
  }

  async function generateTitles(item: AiGenerationListItem) {
    setGeneratingTitles(true)
    setTitleCandidates([])
    try {
      const result = await aiApi.writing.titles({ content: item.result, novelId: item.novelId, contextTitle: item.chapterTitle })
      setTitleCandidates(result.titles)
      toast(`已生成 ${result.titles.length} 个标题候选`, 'success')
    } catch (err) {
      toast((err as Error).message || '标题生成失败', 'error')
    } finally {
      setGeneratingTitles(false)
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">已生成内容</CardTitle>
            <p className="text-sm text-muted-foreground">AI 生成的内容记录，可删除后重新生成</p>
          </div>
          <div className="flex w-full items-center gap-2 sm:w-auto">
            {selectedCount > 0 && <Button variant="destructive" size="sm" disabled={batchDeleting} onClick={() => void removeSelected()}>批量删除 ({selectedCount})</Button>}
            <Label htmlFor="gen-filter-kind" className="text-xs text-muted-foreground">类型</Label>
            <Select
              value={filterKind}
              onValueChange={(v) => {
                setFilterKind(v as 'all' | 'summary' | 'catchup' | 'write_outline' | 'write_chapter' | 'continue')
                setOffset(0)
              }}
            >
              <SelectTrigger size="sm" id="gen-filter-kind" className="w-full sm:w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" align="end" sideOffset={4}>
                <SelectItem value="all">全部</SelectItem>
                {props.scope !== 'writing' && <>
                  <SelectItem value="summary">前情提要</SelectItem>
                  <SelectItem value="catchup">回顾总结</SelectItem>
                </>}
                {props.scope !== 'reader' && <>
                  <SelectItem value="write_outline">创作大纲</SelectItem>
                  <SelectItem value="write_chapter">创作章节</SelectItem>
                  <SelectItem value="continue">续写</SelectItem>
                </>}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {loading && items.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-muted-foreground">加载中…</div>
          ) : items.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-muted-foreground">暂无已生成内容</div>
          ) : (
            <>
              <div className="ai-generations-table overflow-hidden rounded-xl border border-border">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead className="border-b bg-muted/50">
                      <tr>
                        <th className="w-10 px-4 py-3 text-left font-medium"><Checkbox aria-label="全选当前列表" checked={allSelected} onCheckedChange={(checked) => { for (const item of items) toggleItem(item, checked === true) }} /></th>
                        <th className="px-4 py-3 text-left font-medium">类型</th>
                        <th className="px-4 py-3 text-left font-medium">关联内容</th>
                        <th className="px-4 py-3 text-left font-medium">内容预览</th>
                        <th className="px-4 py-3 text-left font-medium">模型</th>
                        <th className="px-4 py-3 text-left font-medium">生成时间</th>
                        <th className="px-4 py-3 text-right font-medium">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => (
                        <Fragment key={item.id}>
                        <tr className="ai-generation-row border-b last:border-0 hover:bg-muted/30">
                          <td className="px-4 py-3"><Checkbox aria-label={`选择${item.chapterTitle || item.kind}`} checked={idsForItem(item).every((id) => selectedIds.has(id))} onCheckedChange={(checked) => toggleItem(item, checked === true)} /></td>
                          <td className="px-4 py-3">
                            <Badge variant="secondary">{kindLabel(item.kind)}</Badge>
                          </td>
                          <td className="px-4 py-3">
                            <div className="max-w-[220px]">
                              {item.novelId ? (
                                <Link
                                  to={`/novel/${encodeURIComponent(item.novelId)}`}
                                  className="block truncate font-medium text-foreground hover:text-primary hover:underline"
                                  title={`打开《${item.novelTitle || '未知小说'}》详情`}
                                >
                                  {item.novelTitle || <span className="text-muted-foreground">—</span>}
                                </Link>
                              ) : (
                                <div className="truncate font-medium text-foreground">
                                  {item.novelTitle || <span className="text-muted-foreground">—</span>}
                                </div>
                              )}
                              {item.chapterTitle ? (
                                item.novelId && item.chapterId ? (
                                  <Link
                                    to={`/read/${encodeURIComponent(item.novelId)}/${encodeURIComponent(item.chapterId)}`}
                                    className="block truncate text-xs text-muted-foreground hover:text-primary hover:underline"
                                    title="阅读该章节"
                                  >
                                    📖 {item.chapterTitle}
                                  </Link>
                                ) : (
                                  <div className="truncate text-xs text-muted-foreground">📖 {item.chapterTitle}</div>
                                )
                              ) : null}
                            </div>
                          </td>
                          <td className="max-w-[340px] px-4 py-3">
                            <p className="line-clamp-2 whitespace-pre-line text-xs leading-relaxed text-muted-foreground">
                              {item.result || '—'}
                            </p>
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">{item.model || '—'}</td>
                          <td className="px-4 py-3 text-muted-foreground">
                            <div>{new Date(item.createdAt).toLocaleDateString('zh-CN')}</div>
                            <div className="text-xs">{new Date(item.createdAt).toLocaleTimeString('zh-CN')}</div>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex justify-end gap-2">
                              {item.groupItems ? (
                                <Button variant="outline" size="sm" onClick={() => setExpandedBatchId(expandedBatchId === item.id ? null : item.id)}>{expandedBatchId === item.id ? '收起章节' : '查看章节'}</Button>
                              ) : (
                                <Button variant="outline" size="sm" onClick={() => { setViewing(item); setPublishTitle(item.chapterTitle || ''); setTitleCandidates([]) }}>查看</Button>
                              )}
                              <Button
                                variant="outline"
                                size="sm"
                                className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                disabled={!!item.groupItems || deletingId === item.id}
                                onClick={() => void remove(item)}
                              >
                                {deletingId === item.id ? '删除中…' : '删除'}
                              </Button>
                            </div>
                          </td>
                        </tr>
                        {item.groupItems && expandedBatchId === item.id && item.groupItems.map((chapter) => (
                          <tr key={chapter.id} className="ai-generation-row ai-generation-row--child border-b bg-muted/20 last:border-0">
                            <td className="px-4 py-2" />
                            <td className="px-4 py-2 pl-8"><span className="text-xs text-muted-foreground">第 {chapter.batchIndex} 章</span></td>
                            <td className="px-4 py-2"><span className="text-xs text-muted-foreground">{chapter.chapterTitle || '待命名章节'}</span></td>
                            <td className="max-w-[340px] px-4 py-2"><p className="line-clamp-1 text-xs text-muted-foreground">{chapter.result || '暂无内容'}</p></td>
                            <td className="px-4 py-2 text-xs text-muted-foreground">{chapter.status}</td>
                            <td className="px-4 py-2 text-xs text-muted-foreground">{new Date(chapter.createdAt).toLocaleTimeString('zh-CN')}</td>
                            <td className="px-4 py-2 text-right"><div className="flex justify-end gap-2">
                              <Button variant="outline" size="sm" onClick={() => { setViewing(chapter); setPublishTitle(chapter.chapterTitle || ''); setTitleCandidates([]) }}>查看</Button>
                              <Button variant="outline" size="sm" className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={deletingId === chapter.id} onClick={() => void remove(chapter)}>{deletingId === chapter.id ? '删除中…' : '删除'}</Button>
                            </div></td>
                          </tr>
                        ))}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="ai-list-footer mt-4 flex items-center gap-4">
                <span className="ai-list-total shrink-0 text-sm text-muted-foreground">
                  共 {total} 条，显示 {offset + 1}-{Math.min(offset + limit, total)}
                </span>
                <div className="ai-list-pagination-controls ml-auto flex shrink-0 items-center gap-3">
                  <div className="ai-list-page-size flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
                    <Label htmlFor="generation-page-size">每页</Label>
                    <Select value={String(limit)} onValueChange={(value) => { setLimit(Number(value)); setOffset(0) }}>
                      <SelectTrigger size="sm" id="generation-page-size" className="w-[88px]" aria-label="每页显示数量"><SelectValue /></SelectTrigger>
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
      <Dialog open={!!viewing} onOpenChange={(open) => { if (!open) { setViewing(null); setPublishTitle(''); setTitleCandidates([]); setGeneratingTitles(false) } }}>
        <DialogContent className="ai-generation-dialog flex h-[min(85svh,900px)] max-h-[calc(100svh-2rem)] w-[calc(100%-1.5rem)] max-w-4xl flex-col gap-3 overflow-hidden p-4 sm:gap-4 sm:p-6">
          <DialogHeader>
            <DialogTitle>{viewing ? `${kindLabel(viewing.kind)} · 完整内容` : '完整内容'}</DialogTitle>
            <DialogDescription>仅管理员可查看 AI 生成的完整内容。</DialogDescription>
          </DialogHeader>
          {viewing && (
            <>
              <details className="shrink-0 rounded-md border bg-muted/10 p-3">
                <summary className="cursor-pointer text-sm font-medium">查看本次生成的 Prompt</summary>
                <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap text-xs leading-5 text-muted-foreground">{viewing.prompt || '未记录 Prompt'}</pre>
              </details>
              <div className="min-h-0 flex-1 overflow-y-auto rounded-md border bg-muted/20 p-4 text-sm leading-7 whitespace-pre-wrap sm:p-5">{viewing.result || '暂无内容'}</div>
              {viewing.status === 'draft' && (viewing.kind === 'write_chapter' || viewing.kind === 'continue') && (
                <div className="ai-generation-publish shrink-0 border-t pt-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                  <div className="ai-generation-publish__field grid min-w-0 flex-1 gap-1.5">
                    <Label htmlFor="generation-publish-title">发布章节标题</Label>
                    <Input id="generation-publish-title" className="h-11 focus-visible:border-ring focus-visible:ring-ring/50" value={publishTitle} onChange={(event) => setPublishTitle(event.target.value)} placeholder="例如：第十二章 暴雨前夜" />
                    <div className="ai-generation-title-options flex items-center gap-2">
                      <Button type="button" variant="outline" size="sm" disabled={generatingTitles} onClick={() => void generateTitles(viewing)}>
                        {generatingTitles ? '生成标题中…' : 'AI 生成标题'}
                      </Button>
                      {titleCandidates.map((candidate) => (
                        <Button key={candidate} type="button" variant="secondary" size="sm" className="ai-generation-title-candidate max-w-full" onClick={() => setPublishTitle(candidate)} title={`使用标题：${candidate}`}>
                          {candidate}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <Button className="h-11 w-full shrink-0 md:w-auto" disabled={publishing || !publishTitle.trim()} onClick={() => void publish(viewing)}>{publishing ? '发布中…' : '发布为章节'}</Button>
                  </div>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
