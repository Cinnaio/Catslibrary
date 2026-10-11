import { useMemo, useState } from 'react'
import type { SourceSyncManualMapping, SourceSyncPreview } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { MATCH_REASON_LABELS } from './source-sync-labels'

const CONFIDENCE_LABELS = { high: '高', medium: '中', low: '低' }
const PAGE_SIZE = 20

export default function ChapterMappingReview({ preview, disabled, onRemap }: {
  preview: SourceSyncPreview; disabled: boolean; onRemap: (mappings: SourceSyncManualMapping[]) => void
}) {
  const [query, setQuery] = useState('')
  const [sourceQuery, setSourceQuery] = useState('')
  const [page, setPage] = useState(1)
  const [editingId, setEditingId] = useState('')
  const [targetKey, setTargetKey] = useState('unmatched')
  const locals = preview.localChapters || []
  const sources = preview.sourceChapters || []
  const byLocal = useMemo(() => new Map(preview.mappings.flatMap(mapping => mapping.localChapterIds.map(id => [id, mapping] as const))), [preview])
  const filtered = locals.filter(row => `${row.order} ${row.title}`.toLowerCase().includes(query.trim().toLowerCase()))
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, pages)
  const editingIndex = locals.findIndex(row => row.id === editingId)
  const editing = locals[editingIndex]
  const sourceIndex = sources.findIndex(row => row.key === targetKey)
  const sourceMatches = sources.filter(row => `${row.order} ${row.title}`.toLowerCase().includes(sourceQuery.trim().toLowerCase()))
  const shownSources = sourceMatches.slice(0, 100)
  const selected = sources[sourceIndex]
  if (selected && !shownSources.some(row => row.key === selected.key)) shownSources.unshift(selected)
  if (!locals.length || !sources.length) return null
  const save = () => onRemap([
    ...(preview.manualMappings || []).filter(row => row.localChapterId !== editingId),
    { localChapterId: editingId, sourceChapterKey: targetKey === 'unmatched' ? null : targetKey },
  ])

  return <details className="chapter-merge-dialog__preview-section">
    <summary>核对与调整映射<span>查看匹配依据，处理未匹配章节</span></summary>
    <p className="admin-dialog-hint">调整后会重新生成差异并清空人工确认。拆分组保留现有映射；源站章节已被占用时，请先解除原对应关系。</p>
    <div className="chapter-merge-dialog__review-toolbar">
      <Input aria-label="搜索本地章节映射" placeholder="搜索本地标题或序号" value={query} onChange={event => { setQuery(event.target.value); setPage(1) }} />
      <Button variant="ghost" disabled={disabled || !preview.manualMappings?.length} onClick={() => onRemap([])}>恢复自动匹配</Button>
    </div>
    <ol className="chapter-merge-dialog__mapping-list" aria-label="全部章节映射">
      {filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE).map(local => {
        const mapping = byLocal.get(local.id)
        return <li key={local.id}>
          <div><strong>本地 {local.order} · {local.title}</strong><p>{mapping ? `源站 ${mapping.sourceOrder} · ${mapping.sourceTitle}` : '尚未匹配，保持本地章节原样'}</p>
            {mapping && <p className="admin-dialog-hint">{mapping.matchReason ? MATCH_REASON_LABELS[mapping.matchReason] : '旧预览未记录依据'} · 置信度{CONFIDENCE_LABELS[mapping.confidence]}{mapping.relation === 'split' ? ' · 拆分组' : ''}。{mapping.matchEvidence}</p>}
          </div>
          <Button variant="secondary" disabled={disabled || mapping?.relation === 'split' || /[（(]\s*\d+\s*[/／]\s*\d+\s*[)）]$/.test(local.title)} onClick={() => { setEditingId(local.id); setTargetKey(mapping?.sourceChapterKey || 'unmatched'); setSourceQuery('') }}>调整映射：本地 {local.order}</Button>
        </li>
      })}
    </ol>
    {!filtered.length && <p>没有符合条件的本地章节。</p>}
    {pages > 1 && <nav className="chapter-merge-dialog__pagination" aria-label="映射核对分页">
      <Button variant="ghost" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>上一页</Button><span>{currentPage} / {pages}</span><Button variant="ghost" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>下一页</Button>
    </nav>}
    {editing && <section className="chapter-merge-dialog__mapping-editor" aria-label="人工映射编辑">
      <h4>调整本地 {editing.order} · {editing.title}</h4>
      <p className="admin-dialog-hint">本地前章：{locals[editingIndex - 1]?.title || '无'}；后章：{locals[editingIndex + 1]?.title || '无'}</p>
      <Input aria-label="搜索源站映射目标" placeholder="搜索源站标题或序号" value={sourceQuery} onChange={event => setSourceQuery(event.target.value)} disabled={disabled} />
      <Label htmlFor="chapter-mapping-target">对应的源站章节</Label>
      <Select value={targetKey} onValueChange={setTargetKey} disabled={disabled}>
        <SelectTrigger id="chapter-mapping-target" className="w-full min-w-0"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="unmatched">解除匹配，保持本地章节原样</SelectItem>
          {shownSources.map(source => {
            const occupied = preview.mappings.some(mapping => mapping.sourceChapterKey === source.key && mapping.localChapterIds.some(id => id !== editingId))
            return <SelectItem key={source.key} value={source.key} disabled={occupied}>{source.order} · {source.title}{occupied ? '（已占用）' : ''}</SelectItem>
          })}
        </SelectContent>
      </Select>
      {sourceMatches.length > 100 && <p className="admin-dialog-hint">找到 {sourceMatches.length} 章，展示前 100 章；输入标题或序号缩小范围。</p>}
      {selected && <p className="admin-dialog-hint">源站前章：{sources[sourceIndex - 1]?.title || '无'}；后章：{sources[sourceIndex + 1]?.title || '无'}</p>}
      <div className="chapter-merge-dialog__metadata-actions"><Button disabled={disabled} onClick={save}>保存映射并重新预览</Button><Button variant="ghost" disabled={disabled} onClick={() => setEditingId('')}>取消调整</Button></div>
    </section>}
  </details>
}
