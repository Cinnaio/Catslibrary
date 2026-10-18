import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { SourceSyncManualMapping, SourceSyncPreview } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import CustomSelect from '@/components/admin/CustomSelect'
import { MATCH_REASON_LABELS } from './source-sync-labels'

const CONFIDENCE_LABELS = { high: '高', medium: '中', low: '低' }
const PAGE_SIZE = 20

/**
 * 与后端 normalizedTitle 对齐的标题比较键：剥离标点与空白即可。
 *
 * 这里刻意**不做**前缀剥离。剥离过的两侧可能归一化成相同文本，但源站的编号
 * 前缀与本地作者编号是两个不同约定（本地「12、分岔山路」↔ 源站「第12章 分岔山路」），
 * 抹平后会把真实差异说成「一致」。这是展示层的判定，宁可多提示也不同源站语义混淆。
 * 后端已判定 exact-title 的映射本身就不参与比较（等价于后端 normalizedTitle 相等）。
 */
function titleKey(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}]/gu, '')
}

type ShiftSegment = NonNullable<SourceSyncPreview['orderShiftSegments']>[number]

/** 段内命中不依赖 id 数量：拆分组的多个本地 id 只取首个落在段内的即可。 */
function segmentOf(segments: ShiftSegment[], order: number, ids: string[]): ShiftSegment | undefined {
  return segments.find(row => ids.includes(row.chapterIds[0] || ''))
    || segments.find(row => order >= row.localRange.from && order <= row.localRange.to)
}

/** 缺字段的旧响应回退：段存在但未标注 kind 时，一律按真实错位处理，不静默放行。 */
const isGapSegment = (segment: ShiftSegment) => segment.kind !== 'layout'

/** 段的偏移不等于该章的偏移时（拆分/合并映射），不做段级陈述，避免误导。 */
const matchesShift = (segment: ShiftSegment, order: number, sourceOrder?: number) =>
  sourceOrder === undefined || order - sourceOrder === segment.offset

const formatSegmentLabel = (segment: ShiftSegment) =>
  segment.localRange.from === segment.localRange.to
    ? `本地第 ${segment.localRange.from} 章（源站第 ${segment.sourceRange.from} 章）`
    : `本地 ${segment.localRange.from}–${segment.localRange.to} 章（源站 ${segment.sourceRange.from}–${segment.sourceRange.to} 章）`

export default function ChapterMappingReview({ preview, disabled, onRemap, onSelectedMappingsChange, selectedMappingIds, confirmedManualIds, onPendingMappingsChange, onInspect, onDelete, onPendingDeletionChange }: {
  preview: SourceSyncPreview; disabled: boolean; onRemap: (mappings: SourceSyncManualMapping[]) => void | Promise<boolean>
  onSelectedMappingsChange?: (ids: Set<string>) => void
  selectedMappingIds?: Set<string>
  confirmedManualIds?: Set<string>
  onPendingMappingsChange?: (count: number) => void
  onInspect?: (id: string) => void
  onDelete?: (ids: string[]) => void
  onPendingDeletionChange?: (count: number) => void
}) {
  const [internalSelectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const selectedIds = selectedMappingIds || internalSelectedIds
  const [drafts, setDrafts] = useState<SourceSyncManualMapping[]>([])
  const [deleteIds, setDeleteIds] = useState<Set<string>>(new Set())
  function selectDeletions(ids: Set<string>) {
    setDeleteIds(ids)
    onPendingDeletionChange?.(ids.size)
  }
  function updateDrafts(next: SourceSyncManualMapping[]) {
    setDrafts(next)
    onPendingMappingsChange?.(next.length)
  }
  function selectMappings(ids: Set<string>) {
    setSelectedIds(ids)
    onSelectedMappingsChange?.(ids)
  }
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'different' | 'unmatched' | 'title' | 'order' | 'blocked'>('different')
  const editorHeading = useRef<HTMLHeadingElement>(null)
  function revealEditor() {
    editorHeading.current?.focus({ preventScroll: true })
    editorHeading.current?.scrollIntoView({ block: 'start', behavior: 'instant' })
  }
  const [sourceQuery, setSourceQuery] = useState('')
  const [page, setPage] = useState(1)
  const [editingId, setEditingId] = useState('')
  const [inspection, setInspection] = useState<{ id: string } | null>(null)
  const localHeadings = useRef(new Map<string, HTMLElement>())
  useLayoutEffect(() => {
    const heading = localHeadings.current.get(inspection?.id || '')
    heading?.focus({ preventScroll: true })
    heading?.scrollIntoView({ block: 'center', behavior: 'instant' })
  }, [inspection])
  const [targetKey, setTargetKey] = useState('unmatched')
  useEffect(() => { if (editingId) revealEditor() }, [editingId])
  const locals = preview.localChapters || []
  const sources = preview.sourceChapters || []
  const byLocal = useMemo(() => new Map(preview.mappings.flatMap(mapping => mapping.localChapterIds.map(id => [id, mapping] as const))), [preview])
  const titleChanges = new Map((preview.changes || []).map(change => [change.localChapterId, change]))
  const shiftSegments = useMemo(() => preview.orderShiftSegments || [], [preview])
  // 序号不同即进入核对；分段种类不再隐藏排序差异。
  // orderShiftSegments 缺失（旧响应）时回退到「序号不同即差异」的原行为。
  const differences = new Map(locals.map(local => {
    const mapping = byLocal.get(local.id)
    const reasons: string[] = []
    if (preview.orderRepairSkipped?.some(row => row.localChapterId === local.id && row.blockingChapterIds?.length)) reasons.push('修复受阻')
    if (!mapping) reasons.push('未匹配')
    else {
      if (local.order !== mapping.sourceOrder) {
        const segment = segmentOf(shiftSegments, local.order, mapping.localChapterIds)
        if (!segment) reasons.push('序号不同')
        else reasons.push(isGapSegment(segment) ? '序号错位' : '序号不同')
      }
      // 后端已认定 exact-title 的映射，其差异全部来自 normalizedTitle 已剥离的
      // 噪声成分（导入前缀/分级标记/广告后缀/标点），前端不得再报「标题不同」。
      if (mapping.matchReason !== 'exact-title' && titleKey(local.title) !== titleKey(mapping.sourceTitle)) reasons.push('标题不同')
      else if (titleChanges.has(local.id)) reasons.push('标题待同步')
    }
    return [local.id, reasons] as const
  }))
  const orderShifts = new Map(locals.flatMap(local => {
    const mapping = byLocal.get(local.id)
    if (!mapping || local.order === mapping.sourceOrder) return []
    const segment = segmentOf(shiftSegments, local.order, mapping.localChapterIds)
    if (!segment) return []
    return [[local.id, { segment, shifted: matchesShift(segment, local.order, mapping.sourceOrder), gap: isGapSegment(segment) }] as const]
  }))
  const differenceCount = locals.filter(local => differences.get(local.id)!.length > 0).length
  const orderChanges = new Map(preview.orderChanges?.map(row => [row.localChapterId, row]) || [])
  const skipped = new Map(preview.orderRepairSkipped?.map(row => [row.localChapterId, row]) || [])
  const blockedIds = new Set((preview.orderRepairSkipped || []).filter(row => row.blockingChapterIds?.length).map(row => row.localChapterId))
  function inFilter(id: string, value: typeof filter) {
    if (value === 'all') return true
    if (value === 'unmatched') return !byLocal.has(id)
    if (value === 'title') return titleChanges.has(id) || differences.get(id)!.includes('标题不同')
    if (value === 'order') return orderChanges.has(id)
    if (value === 'blocked') return blockedIds.has(id)
    return differences.get(id)!.length > 0 || blockedIds.has(id)
  }
  const filtered = locals.filter(row => inFilter(row.id, filter) && `${row.order} ${row.title}`.toLowerCase().includes(query.trim().toLowerCase()))
  const blockers = useMemo(() => new Map((preview.orderRepairBlockers || []).flatMap(row => row.blockingChapterIds.map(id => [id, row] as const))), [preview])
  const shiftSkipped = new Map<ShiftSegment, string[]>()
  locals.forEach(local => {
    const shift = orderShifts.get(local.id)
    if (!shift?.gap) return
    shiftSkipped.set(shift.segment, [...(shiftSkipped.get(shift.segment) || []), local.id])
  })
  const selectedSkipped = [...selectedIds].filter(id => skipped.has(id)).length
  const selectedLocals = locals.filter(local => selectedIds.has(local.id))
  const selectedTitles = selectedLocals.filter(local => { const change = titleChanges.get(local.id); return change && !change.eligible && (confirmedManualIds ? confirmedManualIds.has(local.id) : true) }).length
  const selectedOrders = selectedLocals.filter(local => orderChanges.has(local.id)).length
  const missingDependencies = new Set(selectedLocals.flatMap(local => orderChanges.get(local.id)?.requiredChapterIds || []).filter(id => !selectedIds.has(id)))
  const selectedUnchanged = selectedLocals.filter(local => !orderChanges.has(local.id) && !titleChanges.has(local.id) && !skipped.has(local.id)).length
  const deleteLocals = locals.filter(local => deleteIds.has(local.id))
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, pages)
  const editingIndex = locals.findIndex(row => row.id === editingId)
  const editing = locals[editingIndex]
  const sameTitleCandidates = editing ? sources.filter(source => titleKey(source.title) === titleKey(editing.title) && titleKey(editing.title)) : []
  const sourceIndex = sources.findIndex(row => row.key === targetKey)
  const sourceMatches = sources.filter(row => `${row.order} ${row.title}`.toLowerCase().includes(sourceQuery.trim().toLowerCase()))
  const shownSources = sourceMatches.slice(0, 100)
  const selected = sources[sourceIndex]
  if (selected && !shownSources.some(row => row.key === selected.key)) shownSources.unshift(selected)
  if (!locals.length || !sources.length) return null
  const effectiveMappings = new Map(locals.map(local => [local.id, byLocal.get(local.id)?.sourceChapterKey || null]))
  drafts.forEach(row => effectiveMappings.set(row.localChapterId, row.sourceChapterKey))
  const occupant = targetKey === 'unmatched' ? undefined : locals.find(local => local.id !== editingId && effectiveMappings.get(local.id) === targetKey)
  const save = () => {
    const updates: SourceSyncManualMapping[] = [{ localChapterId: editingId, sourceChapterKey: targetKey === 'unmatched' ? null : targetKey }]
    if (occupant) updates.push({ localChapterId: occupant.id, sourceChapterKey: effectiveMappings.get(editingId) || null })
    updateDrafts([...drafts.filter(row => !updates.some(update => update.localChapterId === row.localChapterId)), ...updates])
    setEditingId('')
  }
  async function saveDrafts() {
    const merged = [...(preview.manualMappings || []).filter(row => !drafts.some(draft => draft.localChapterId === row.localChapterId)), ...drafts]
    if (await onRemap(merged) !== false) updateDrafts([])
  }
  /** 定位只改变筛选、分页与焦点，不改变同步勾选。 */
  function focusSegment(segment: ShiftSegment) {
    const ids = shiftSkipped.get(segment) || segment.chapterIds
    const first = locals.findIndex(local => local.id === ids[0])
    if (first < 0) return
    setQuery('')
    setFilter('all')
    setPage(Math.floor(first / PAGE_SIZE) + 1)
    setEditingId('')
    setInspection({ id: ids[0]! })
  }
  /** 分段与受阻汇总共用：列出段/组内章节序号，供人工定位与勾选。 */
  function segmentChapterIds(segment: ShiftSegment): string[] {
    const submitted = shiftSkipped.get(segment)
    return submitted?.length ? submitted : segment.chapterIds
  }
  function ordersOf(ids: string[]): string {
    const orders = ids.map(id => locals.find(local => local.id === id)?.order).filter((order): order is number => order !== undefined)
    return orders.length > 6 ? `${orders.slice(0, 6).join('、')}…` : orders.join('、')
  }

  return <details className="chapter-merge-dialog__preview-section chapter-merge-dialog__mapping-review">
    <summary>核对与调整映射<span>查看匹配依据，处理未匹配章节</span></summary>
    {preview.orderRepairBlockedReason && <p className="chapter-merge-dialog__warning">序号检查：{preview.orderRepairBlockedReason}</p>}
    {shiftSegments.some(segment => segment.offset !== 0) && (() => {
      const shiftedSegments = shiftSegments.filter(segment => segment.offset !== 0)
      const detail = `${shiftedSegments.length} 段 · ${orderChanges.size} 个序号可修复 · ${blockedIds.size} 章受阻`
      return <details className="chapter-merge-dialog__shift-summary">
        <summary>序号偏移分段<span>{detail}</span></summary>
        <p className="admin-dialog-hint">序号不同的章节可勾选按源站排序，未勾选保持原样。移动依赖其他章节让位时需一并选择；受阻项先核对占位章节。</p>
        <ul>
          {shiftedSegments.map(segment => {
            const gap = isGapSegment(segment)
            const ids = segmentChapterIds(segment)
            const repairable = ids.filter(id => orderChanges.has(id)).length
            const blocked = ids.filter(id => blockedIds.has(id)).length
            return <li key={`${segment.localRange.from}-${segment.localRange.to}`}>
              <strong>{formatSegmentLabel(segment)}</strong>
              <span className={gap ? 'chapter-merge-dialog__warning' : 'chapter-merge-dialog__shift-neutral'}>
                {gap ? `真实错位 ${segment.offset > 0 ? '+' : ''}${segment.offset}` : `编排差异 ${segment.offset > 0 ? '+' : ''}${segment.offset}`}
              </span>
              <span>{repairable} 章可修复{blocked ? ` · ${blocked} 章受阻` : ''}（本地 {ordersOf(ids)}）</span>
              <Button variant="ghost" size="sm" disabled={disabled} onClick={() => focusSegment(segment)}>定位</Button>
            </li>
          })}
        </ul>
      </details>
    })()}
    {!!blockers.size && <details className="chapter-merge-dialog__shift-summary">
      <summary>序号修复受阻汇总<span>{blockers.size} 个阻塞源 · {(preview.orderRepairBlockers || []).reduce((total, row) => total + row.affectedChapterIds.length, 0)} 项待处理</span></summary>
      <p className="admin-dialog-hint">修复目标序号被以下本地章节占用。请先核对阻塞源，再重新生成修复方案。</p>
      <ul>
        {(preview.orderRepairBlockers || []).map(row => <li key={row.blockingChapterIds.join('|')}>
          <strong>阻塞源 {row.blockingChapterIds.map(id => `本地 ${locals.find(local => local.id === id)?.order ?? id}`).join('、')}</strong>
          <span className="chapter-merge-dialog__warning">{row.reason}</span>
          <span>影响 {row.affectedChapterIds.length} 章</span>
          <Button variant="ghost" size="sm" disabled={disabled} onClick={() => {
            const index = locals.findIndex(local => local.id === row.blockingChapterIds[0])
            if (index < 0) return
            setQuery('')
            setFilter('all')
            setPage(Math.floor(index / PAGE_SIZE) + 1)
            setEditingId('')
            setInspection({ id: row.blockingChapterIds[0]! })
          }}>定位阻塞源</Button>
        </li>)}
      </ul>
    </details>}
    <div className="chapter-merge-dialog__mapping-tools">
      <div className="chapter-merge-dialog__filters" role="group" aria-label="映射差异筛选">
        <Button variant="ghost" aria-pressed={filter === 'all'} onClick={() => { setFilter('all'); setPage(1); setEditingId('') }}>全部 {locals.length}</Button>
        <Button variant="ghost" aria-pressed={filter === 'different'} onClick={() => { setFilter('different'); setPage(1); setEditingId('') }}>有差异 {differenceCount}</Button>
        {([['unmatched', '未匹配'], ['title', '标题待同步'], ['order', '可修复序号'], ['blocked', '修复受阻']] as const).map(([value, label]) => <Button key={value} variant="ghost" aria-pressed={filter === value} onClick={() => { setFilter(value); setPage(1); setEditingId('') }}>{label} {locals.filter(local => inFilter(local.id, value)).length}</Button>)}
      </div>
      <Input aria-label="搜索本地章节映射" placeholder="搜索本地标题或序号" value={query} onChange={event => { setQuery(event.target.value); setPage(1); setEditingId('') }} />
    </div>
    <div className="chapter-merge-dialog__mapping-guidance">
      <details><summary>核对说明</summary><p className="admin-dialog-hint">可以先暂存多条调整，再统一保存并重新预览。未受影响的确认与勾选会保留，变化的映射需重新确认。选择已占用的源站章节可交换对应关系；拆分组保持原样。</p></details>
      <Button variant="ghost" size="sm" disabled={disabled || !preview.manualMappings?.length || !!drafts.length} onClick={() => void onRemap([])}>恢复自动匹配</Button>
    </div>
    {!!drafts.length && <div className="chapter-merge-dialog__mapping-selection">
      <p role="status">已暂存 {drafts.length} 项映射调整，保存后生成新的更新预览。</p>
      <Button disabled={disabled} onClick={() => void saveDrafts()}>保存 {drafts.length} 项映射并重新预览</Button>
      <Button variant="ghost" disabled={disabled} onClick={() => updateDrafts([])}>放弃暂存调整</Button>
    </div>}
    {onDelete && !!deleteLocals.length && <div className="chapter-merge-dialog__mapping-selection">
      <p role="status">待删除 {deleteLocals.length} 个本地章节。删除正文前会再次确认。</p>
      <Button variant="destructive" disabled={disabled || !!drafts.length} onClick={() => onDelete(deleteLocals.map(local => local.id))}>删除 {deleteLocals.length} 个杂章并重新匹配</Button>
      <Button variant="ghost" disabled={disabled} onClick={() => selectDeletions(new Set())}>清空删除选择</Button>
    </div>}
    <div className="chapter-merge-dialog__mapping-selection">
      <p role="status">已选 {selectedLocals.length} 项映射</p>
      {!!selectedLocals.length && <p role="status">本次映射选择：确认 {selectedTitles} 个标题 · 修复 {selectedOrders} 个序号 · {selectedUnchanged} 项无需更新</p>}
      {!!missingDependencies.size && <div role="status">
        <p className="chapter-merge-dialog__warning">所选序号仍需 {missingDependencies.size} 项关联映射同时让位，补选后再应用。</p>
        <Button variant="secondary" disabled={disabled} onClick={() => selectMappings(new Set([...selectedIds, ...missingDependencies]))}>补选 {missingDependencies.size} 项关联映射</Button>
      </div>}
      <div>
        <Button variant="secondary" disabled={disabled || !filtered.length} onClick={() => selectMappings(new Set([...selectedIds, ...filtered.map(local => local.id)]))}>全选当前筛选结果 {filtered.length} 项</Button>
        <Button variant="ghost" disabled={disabled || !selectedLocals.length} onClick={() => selectMappings(new Set())}>清空映射选择</Button>
      </div>
      <p className="admin-dialog-hint">全选包含当前筛选结果的所有页。勾选将确认对应标题及可修复序号；自动更新的标题不受映射勾选影响，本次全部变化以底部数量为准。</p>
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
              <div><span className="chapter-merge-dialog__mapping-label">本地目录</span><strong tabIndex={-1} ref={element => { if (element) localHeadings.current.set(local.id, element); else localHeadings.current.delete(local.id) }}>本地 {local.order} · {local.title}</strong></div>
              <div><span className="chapter-merge-dialog__mapping-label">源站目录</span><p>{mapping ? `源站 ${mapping.sourceOrder} · ${mapping.sourceTitle}` : '尚未匹配，保持本地章节原样'}</p></div>
            </div>
            <div className="chapter-merge-dialog__mapping-meta">
              {orderChanges.has(local.id) && <span>序号 {local.order} → {orderChanges.get(local.id)!.newOrder} · {selectedIds.has(local.id) ? '已选，将修复' : '勾选后修复'}</span>}
              {blockedIds.has(local.id) && mapping && <span>序号 {local.order} → {mapping.sourceOrder} · 修复受阻</span>}
              {!!orderChanges.get(local.id)?.requiredChapterIds?.length && <span>需关联 {orderChanges.get(local.id)!.requiredChapterIds!.length} 项映射同时让位</span>}
              {skipped.has(local.id) && <span className="chapter-merge-dialog__warning">暂不修复序号：{skipped.get(local.id)!.reason}</span>}
              {skipped.get(local.id)?.blockingChapterIds?.map(blockerId => {
                const blockerIndex = locals.findIndex(row => row.id === blockerId)
                const blocker = locals[blockerIndex]
                if (!blocker) return null
                return <Button key={blockerId} variant="ghost" size="sm" disabled={disabled} aria-label={`查看阻塞章节：本地 ${blocker.order} · ${blocker.title}`} onClick={() => {
                  setQuery('')
                  setFilter('all')
                  setPage(Math.floor(blockerIndex / PAGE_SIZE) + 1)
                  setEditingId('')
                  setInspection({ id: blockerId })
                }}>查看阻塞章节 · 本地 {blocker.order}</Button>
              })}
              {!!differences.get(local.id)!.length && <span className="chapter-merge-dialog__warning">{differences.get(local.id)!.join(' · ')}</span>}
              {(() => {
                const shift = orderShifts.get(local.id)
                if (!shift) return null
                const sign = shift.segment.offset > 0 ? '+' : ''
                // 拆分/合并映射的偏移与所在段不一致，不做段级陈述。
                if (!shift.shifted) return <span className="chapter-merge-dialog__shift-neutral">序号偏移仅提示</span>
                // 真实错位与良性排版在 matchReason 上完全同形（都是 exact-title），
                // 唯一可靠判据是后端段级 kind，因此提示必须明确写出判据与来源。
                // 文案保持短：一个 66 章的错位段会渲染 66 条同样的提示。
                return shift.gap
                  ? <span className="chapter-merge-dialog__shift-gap">序号错位 {sign}{shift.segment.offset}（真实错位）</span>
                  : <span className="chapter-merge-dialog__shift-neutral">序号偏移 {sign}{shift.segment.offset}（按勾选同步）</span>
              })()}
              {mapping && <span>{mapping.matchReason ? MATCH_REASON_LABELS[mapping.matchReason] : '旧预览未记录依据'} · 置信度{CONFIDENCE_LABELS[mapping.confidence]}{mapping.relation === 'split' ? ' · 拆分组' : ''}</span>}
              {mapping?.matchEvidence && <details><summary>匹配说明</summary><p>{mapping.matchEvidence}</p></details>}
              {drafts.some(row => row.localChapterId === local.id) && <span className="chapter-merge-dialog__warning">暂存目标：{sources.find(source => source.key === effectiveMappings.get(local.id))?.title || '解除匹配'}（尚未保存）</span>}
              {onInspect && <Button variant="ghost" size="sm" disabled={disabled} onClick={() => onInspect(local.id)} aria-label={`预览正文：本地 ${local.order}`}>预览正文</Button>}
              {onDelete && <label className="chapter-merge-dialog__manual-choice"><Checkbox aria-label={`标记删除：本地 ${local.order}`} checked={deleteIds.has(local.id)} disabled={disabled} onCheckedChange={checked => {
                const next = new Set(deleteIds)
                if (checked === true) next.add(local.id); else next.delete(local.id)
                selectDeletions(next)
              }} /><span>杂章待删除</span></label>}
            </div>
          </div>
          <Button variant="ghost" size="sm" className="chapter-merge-dialog__mapping-adjust" aria-label={`调整映射：本地 ${local.order}`} aria-expanded={editingId === local.id} aria-controls={editingId === local.id ? 'chapter-mapping-editor' : undefined} disabled={disabled || mapping?.relation === 'split' || /[（(]\s*\d+\s*[/／]\s*\d+\s*[)）]$/.test(local.title)} onClick={() => { if (editingId === local.id) revealEditor(); setEditingId(local.id); setTargetKey(effectiveMappings.get(local.id) || 'unmatched'); setSourceQuery('') }}>调整映射</Button>
          {editingId === local.id && editing && <section id="chapter-mapping-editor" className="chapter-merge-dialog__mapping-editor" aria-label="人工映射编辑">
            <h4 ref={editorHeading} tabIndex={-1}>调整本地 {editing.order} · {editing.title}</h4>
            <p className="admin-dialog-hint">本地前章：{locals[editingIndex - 1]?.title || '无'}；后章：{locals[editingIndex + 1]?.title || '无'}</p>
            {onInspect && <Button variant="ghost" size="sm" disabled={disabled} onClick={() => onInspect(editing.id)}>预览此章正文</Button>}
            {!!sameTitleCandidates.length && <div className="chapter-merge-dialog__mapping-candidates" aria-label="同名源站候选">
              <p className="admin-dialog-hint">找到 {sameTitleCandidates.length} 个同名候选，仅供核对，不会自动匹配。请选择候选查看源站邻章，并结合正文确认。</p>
              {sameTitleCandidates.map(source => <Button key={source.key} variant="secondary" size="sm" disabled={disabled || locals.some(local => local.id !== editingId && effectiveMappings.get(local.id) === source.key && (byLocal.get(local.id)?.relation === 'split' || /[（(]\s*\d+\s*[/／]\s*\d+\s*[)）]$/.test(local.title)))} aria-pressed={targetKey === source.key} onClick={() => setTargetKey(source.key)}>核对源站 {source.order} · {source.title}</Button>)}
            </div>}
            <div className="chapter-merge-dialog__mapping-fields">
              <div className="chapter-dialog-field">
                <Label htmlFor="chapter-mapping-search">查找源站章节</Label>
                <Input id="chapter-mapping-search" aria-label="搜索源站映射目标" placeholder="搜索源站标题或序号" value={sourceQuery} onChange={event => setSourceQuery(event.target.value)} disabled={disabled} />
              </div>
              <div className="chapter-dialog-field">
                <Label htmlFor="chapter-mapping-target">对应的源站章节</Label>
                <CustomSelect
                  options={[
                    { value: 'unmatched', label: '解除匹配，保持本地章节原样' },
                    ...shownSources.map(source => {
                      const occupiedBy = locals.filter(local => local.id !== editingId && effectiveMappings.get(local.id) === source.key)
                      const blocked = occupiedBy.some(local => byLocal.get(local.id)?.relation === 'split' || /[（(]\s*\d+\s*[/／]\s*\d+\s*[)）]$/.test(local.title))
                      return { value: source.key, label: `${source.order} · ${source.title}`, disabled: blocked, note: blocked ? '拆分组已占用' : occupiedBy.length ? '选择后交换' : undefined }
                    }),
                  ]}
                  value={targetKey}
                  onChange={setTargetKey}
                  // 页面上已有「查找源站章节」输入并负责过滤 shownSources，
                  // 交给 CustomSelect 受控搜索，浮层里不再出现第二个搜索框。
                  search={sourceQuery}
                  onSearchChange={setSourceQuery}
                  emptyText="没有匹配的源站章节"
                  // 源站可达上百章，浮层只渲染选中项附近一窗，其余按需展开。
                  compactThreshold={12}
                  expandAllLabel="展开全部 {count} 个源站章节"
                  matchTriggerWidth
                  className="w-full min-w-0"
                  disabled={disabled}
                  // Label 用 htmlFor 指过来；只给 id，不再叠加 aria-labelledby，避免标签被念两遍。
                  id="chapter-mapping-target"
                />
              </div>
            </div>
            {sourceMatches.length > 100 && <p className="admin-dialog-hint">找到 {sourceMatches.length} 章，展示前 100 章；输入标题或序号缩小范围。</p>}
            {selected && <p className="admin-dialog-hint">源站前章：{sources[sourceIndex - 1]?.title || '无'}；后章：{sources[sourceIndex + 1]?.title || '无'}</p>}
            {selected && Math.abs(selected.order - editing.order) > 20 && <p className="chapter-merge-dialog__warning">两侧相距 {Math.abs(selected.order - editing.order)} 个序号，位置差异较大；同名不足以证明对应，请结合邻章与正文核实。</p>}
            {occupant && <p className="chapter-merge-dialog__warning">将与本地 {occupant.order} · {occupant.title} 交换对应关系；双方都会加入暂存调整。</p>}
            <div className="chapter-merge-dialog__metadata-actions"><Button disabled={disabled} onClick={save}>暂存映射调整</Button><Button variant="ghost" disabled={disabled} onClick={() => setEditingId('')}>取消调整</Button></div>
          </section>}
        </li>
      })}
    </ol>
    {!filtered.length && <p role="status">{!query && filter === 'different' ? '当前没有需要处理的映射差异，可切换“全部”查看完整目录。' : '没有符合条件的本地章节。'}</p>}
    {pages > 1 && <nav className="chapter-merge-dialog__pagination" aria-label="映射核对分页">
      <Button variant="ghost" disabled={currentPage === 1} onClick={() => { setPage(currentPage - 1); setEditingId('') }}>上一页</Button><span>{currentPage} / {pages}</span><Button variant="ghost" disabled={currentPage === pages} onClick={() => { setPage(currentPage + 1); setEditingId('') }}>下一页</Button>
    </nav>}

  </details>
}
