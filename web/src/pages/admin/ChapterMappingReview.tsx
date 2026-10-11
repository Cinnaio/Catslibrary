import { useEffect, useMemo, useRef, useState } from 'react'
import type { SourceSyncManualMapping, SourceSyncPreview } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { MATCH_REASON_LABELS } from './source-sync-labels'

const CONFIDENCE_LABELS = { high: '高', medium: '中', low: '低' }
const PAGE_SIZE = 20

export default function ChapterMappingReview({ preview, disabled, onRemap, onSelectedMappingsChange }: {
  preview: SourceSyncPreview; disabled: boolean; onRemap: (mappings: SourceSyncManualMapping[]) => void
  onSelectedMappingsChange?: (ids: Set<string>) => void
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  function selectMappings(ids: Set<string>) {
    setSelectedIds(ids)
    onSelectedMappingsChange?.(ids)
  }
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'different'>('all')
  const editorHeading = useRef<HTMLHeadingElement>(null)
  function revealEditor() {
    editorHeading.current?.focus({ preventScroll: true })
    editorHeading.current?.scrollIntoView({ block: 'start', behavior: 'instant' })
  }
  const [sourceQuery, setSourceQuery] = useState('')
  const [page, setPage] = useState(1)
  const [editingId, setEditingId] = useState('')
  const [targetKey, setTargetKey] = useState('unmatched')
  useEffect(() => { if (editingId) revealEditor() }, [editingId])
  const locals = preview.localChapters || []
  const sources = preview.sourceChapters || []
  const byLocal = useMemo(() => new Map(preview.mappings.flatMap(mapping => mapping.localChapterIds.map(id => [id, mapping] as const))), [preview])
  const differences = new Map(locals.map(local => {
    const mapping = byLocal.get(local.id)
    const reasons: string[] = []
    if (!mapping) reasons.push('未匹配')
    else {
      if (local.order !== mapping.sourceOrder) reasons.push('序号不同')
      const title = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[\s\p{P}]/gu, '')
      if (mapping.matchReason !== 'exact-title' && title(local.title) !== title(mapping.sourceTitle)) reasons.push('标题不同')
    }
    return [local.id, reasons] as const
  }))
  const differenceCount = locals.filter(local => differences.get(local.id)!.length > 0).length
  const filtered = locals.filter(row => (filter === 'all' || differences.get(row.id)!.length > 0) && `${row.order} ${row.title}`.toLowerCase().includes(query.trim().toLowerCase()))
  const orderChanges = new Map(preview.orderChanges?.map(row => [row.localChapterId, row]) || [])
  const skipped = new Map(preview.orderRepairSkipped?.map(row => [row.localChapterId, row.reason]) || [])
  const selectedSkipped = [...selectedIds].filter(id => skipped.has(id)).length
  const selectedLocals = locals.filter(local => selectedIds.has(local.id))
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

  return <details className="chapter-merge-dialog__preview-section chapter-merge-dialog__mapping-review">
    <summary>核对与调整映射<span>查看匹配依据，处理未匹配章节</span></summary>
    {preview.orderRepairBlockedReason && <p className="chapter-merge-dialog__warning">序号检查：{preview.orderRepairBlockedReason}</p>}
    <div className="chapter-merge-dialog__mapping-tools">
      <div className="chapter-merge-dialog__filters" role="group" aria-label="映射差异筛选">
        <Button variant="ghost" aria-pressed={filter === 'all'} onClick={() => { setFilter('all'); setPage(1); setEditingId('') }}>全部 {locals.length}</Button>
        <Button variant="ghost" aria-pressed={filter === 'different'} onClick={() => { setFilter('different'); setPage(1); setEditingId('') }}>有差异 {differenceCount}</Button>
      </div>
      <Input aria-label="搜索本地章节映射" placeholder="搜索本地标题或序号" value={query} onChange={event => { setQuery(event.target.value); setPage(1); setEditingId('') }} />
    </div>
    <div className="chapter-merge-dialog__mapping-guidance">
      <details><summary>核对说明</summary><p className="admin-dialog-hint">有差异包括序号不同、标题不同和未匹配章节；完整标题一致仍可能存在序号差异。调整后会重新生成差异并清空人工确认。拆分组保留现有映射；源站章节已被占用时，请先解除原对应关系。</p></details>
      <Button variant="ghost" size="sm" disabled={disabled || !preview.manualMappings?.length} onClick={() => onRemap([])}>恢复自动匹配</Button>
    </div>
    <div className="chapter-merge-dialog__mapping-selection">
      <p role="status">已选 {selectedLocals.length} 项映射</p>
      <div>
        <Button variant="secondary" disabled={disabled || !filtered.length} onClick={() => selectMappings(new Set([...selectedIds, ...filtered.map(local => local.id)]))}>全选当前筛选结果 {filtered.length} 项</Button>
        <Button variant="ghost" disabled={disabled || !selectedLocals.length} onClick={() => selectMappings(new Set())}>清空映射选择</Button>
      </div>
      <p className="admin-dialog-hint">全选包含当前筛选结果的所有页。勾选会将待人工核对的标题及可修复序号加入本次同步；点击底部按钮确认应用。没有变化或未匹配的章节保持原样。</p>
      {selectedSkipped > 0 && <p className="admin-dialog-hint" role="status">所选映射中 {selectedSkipped} 项暂不修复序号，原因见对应章节；其余可修复序号按底部数量同步。</p>}
    </div>
    <ol className="chapter-merge-dialog__mapping-list" aria-label="全部章节映射">
      {filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE).map(local => {
        const mapping = byLocal.get(local.id)
        return <li key={local.id}>
          <Checkbox className="chapter-merge-dialog__mapping-checkbox" aria-label={`选择映射：本地 ${local.order}`} checked={selectedIds.has(local.id)} disabled={disabled} onCheckedChange={checked => {
            const next = new Set(selectedIds)
            if (checked === true) next.add(local.id)
            else next.delete(local.id)
            selectMappings(next)
          }} />
          <div className="chapter-merge-dialog__mapping-content">
            <div className="chapter-merge-dialog__mapping-comparison">
              <div><span className="chapter-merge-dialog__mapping-label">本地目录</span><strong>本地 {local.order} · {local.title}</strong></div>
              <div><span className="chapter-merge-dialog__mapping-label">源站目录</span><p>{mapping ? `源站 ${mapping.sourceOrder} · ${mapping.sourceTitle}` : '尚未匹配，保持本地章节原样'}</p></div>
            </div>
            <div className="chapter-merge-dialog__mapping-meta">
              {orderChanges.has(local.id) && <span>序号 {local.order} → {orderChanges.get(local.id)!.newOrder} · {selectedIds.has(local.id) ? '已选，将修复' : '勾选后修复'}</span>}
              {skipped.has(local.id) && <span className="chapter-merge-dialog__warning">暂不修复序号：{skipped.get(local.id)}</span>}
              {!!differences.get(local.id)!.length && <span className="chapter-merge-dialog__warning">{differences.get(local.id)!.join(' · ')}</span>}
              {mapping && <span>{mapping.matchReason ? MATCH_REASON_LABELS[mapping.matchReason] : '旧预览未记录依据'} · 置信度{CONFIDENCE_LABELS[mapping.confidence]}{mapping.relation === 'split' ? ' · 拆分组' : ''}</span>}
              {mapping?.matchEvidence && <details><summary>匹配说明</summary><p>{mapping.matchEvidence}</p></details>}
            </div>
          </div>
          <Button variant="ghost" size="sm" className="chapter-merge-dialog__mapping-adjust" aria-label={`调整映射：本地 ${local.order}`} aria-expanded={editingId === local.id} aria-controls={editingId === local.id ? 'chapter-mapping-editor' : undefined} disabled={disabled || mapping?.relation === 'split' || /[（(]\s*\d+\s*[/／]\s*\d+\s*[)）]$/.test(local.title)} onClick={() => { if (editingId === local.id) revealEditor(); setEditingId(local.id); setTargetKey(mapping?.sourceChapterKey || 'unmatched'); setSourceQuery('') }}>调整映射</Button>
          {editingId === local.id && editing && <section id="chapter-mapping-editor" className="chapter-merge-dialog__mapping-editor" aria-label="人工映射编辑">
            <h4 ref={editorHeading} tabIndex={-1}>调整本地 {editing.order} · {editing.title}</h4>
            <p className="admin-dialog-hint">本地前章：{locals[editingIndex - 1]?.title || '无'}；后章：{locals[editingIndex + 1]?.title || '无'}</p>
            <div className="chapter-merge-dialog__mapping-fields">
              <div className="chapter-dialog-field">
                <Label htmlFor="chapter-mapping-search">查找源站章节</Label>
                <Input id="chapter-mapping-search" aria-label="搜索源站映射目标" placeholder="搜索源站标题或序号" value={sourceQuery} onChange={event => setSourceQuery(event.target.value)} disabled={disabled} />
              </div>
              <div className="chapter-dialog-field">
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
              </div>
            </div>
            {sourceMatches.length > 100 && <p className="admin-dialog-hint">找到 {sourceMatches.length} 章，展示前 100 章；输入标题或序号缩小范围。</p>}
            {selected && <p className="admin-dialog-hint">源站前章：{sources[sourceIndex - 1]?.title || '无'}；后章：{sources[sourceIndex + 1]?.title || '无'}</p>}
            <div className="chapter-merge-dialog__metadata-actions"><Button disabled={disabled} onClick={save}>保存映射并重新预览</Button><Button variant="ghost" disabled={disabled} onClick={() => setEditingId('')}>取消调整</Button></div>
          </section>}
        </li>
      })}
    </ol>
    {!filtered.length && <p>没有符合条件的本地章节。</p>}
    {pages > 1 && <nav className="chapter-merge-dialog__pagination" aria-label="映射核对分页">
      <Button variant="ghost" disabled={currentPage === 1} onClick={() => { setPage(currentPage - 1); setEditingId('') }}>上一页</Button><span>{currentPage} / {pages}</span><Button variant="ghost" disabled={currentPage === pages} onClick={() => { setPage(currentPage + 1); setEditingId('') }}>下一页</Button>
    </nav>}

  </details>
}
