import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { SourceSyncManualMapping, SourceSyncPreview } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
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

// 章节名尾部/中段的分级标记（H/微H/高h），后端 normalizedTitle 会剥离，前端比较键保持一致。
const H_MARKER = /[（(]\s*(?:微|高|小|重|轻|肉|无|超)?\s*[hH]\s*[)）]/g
// 源站章节名尾部夹带的推广水印（「po1⒏homes」）。
const PROMO_SUFFIX = /[「"'“”]?(?:po\s*1[0-9０-９]{0,2}\s*[.．。]?\s*(?:home|homes|com|net|tw|cc|xyz|top|vip|me|info|site|org)|[a-z]{2,10}\s*[.．。]\s*(?:com|net|tw|cc|xyz|top|vip|me|info|site|org))\s*(?:[」"'“”]|[0-9０-９]*)?\s*$/i
// 导入器留下的裸序号前缀（「84.」「12、」「7：」）；其后的章节编号不算噪声。
const IMPORT_ORDER_PREFIX = /^\s*\d{1,4}(?:\.\d+)?\s*[.、:：]\s*/

function strippedTitleKey(value: string): string {
  let text = value.normalize('NFKC')
  for (let round = 0; round < 4; round++) {
    const next = text.replace(PROMO_SUFFIX, '').replace(H_MARKER, '').trim()
    if (next === text) break
    text = next
  }
  return titleKey(text).replace(IMPORT_ORDER_PREFIX, '')
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

export default function ChapterMappingReview({ preview, disabled, onRemap, onSelectedMappingsChange, selectedMappingIds, onPendingMappingsChange, onInspect, onDelete, onPendingDeletionChange }: {
  preview: SourceSyncPreview; disabled: boolean; onRemap: (mappings: SourceSyncManualMapping[]) => void | Promise<boolean>
  onSelectedMappingsChange?: (ids: Set<string>) => void
  selectedMappingIds?: Set<string>
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
  const [filter, setFilter] = useState<'all' | 'different'>('all')
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
  const shiftSegments = useMemo(() => preview.orderShiftSegments || [], [preview])
  // 差异判定：只有 kind='gap' 段（真实错位）才计入「需处理」；kind='layout' 段
  // （作者把番外前移造成的良性排版偏移）只作中性提示，不进「有差异」筛选。
  // orderShiftSegments 缺失（旧响应）时回退到「序号不同即差异」的原行为。
  const differences = new Map(locals.map(local => {
    const mapping = byLocal.get(local.id)
    const reasons: string[] = []
    if (!mapping) reasons.push('未匹配')
    else {
      if (local.order !== mapping.sourceOrder) {
        const segment = segmentOf(shiftSegments, local.order, mapping.localChapterIds)
        if (!segment) reasons.push('序号不同')
        else if (isGapSegment(segment)) reasons.push('序号错位')
        // layout 段不在此处报差异，改由 orderShifts 呈现中性提示。
      }
      // 后端已认定 exact-title 的映射，其差异全部来自 normalizedTitle 已剥离的
      // 噪声成分（导入前缀/分级标记/广告后缀/标点），前端不得再报「标题不同」。
      if (mapping.matchReason !== 'exact-title' && titleKey(local.title) !== titleKey(mapping.sourceTitle)) reasons.push('标题不同')
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
  const layoutShiftCount = locals.filter(local => {
    const shift = orderShifts.get(local.id)
    return Boolean(shift && !shift.gap && shift.shifted)
  }).length
  const filtered = locals.filter(row => (filter === 'all' || differences.get(row.id)!.length > 0) && `${row.order} ${row.title}`.toLowerCase().includes(query.trim().toLowerCase()))
  const orderChanges = new Map(preview.orderChanges?.map(row => [row.localChapterId, row]) || [])
  const skipped = new Map(preview.orderRepairSkipped?.map(row => [row.localChapterId, row]) || [])
  const blockers = useMemo(() => new Map((preview.orderRepairBlockers || []).flatMap(row => row.blockingChapterIds.map(id => [id, row] as const))), [preview])
  const shiftSkipped = new Map<ShiftSegment, string[]>()
  locals.forEach(local => {
    const shift = orderShifts.get(local.id)
    if (!shift?.gap) return
    shiftSkipped.set(shift.segment, [...(shiftSkipped.get(shift.segment) || []), local.id])
  })
  const selectedSkipped = [...selectedIds].filter(id => skipped.has(id)).length
  const selectedLocals = locals.filter(local => selectedIds.has(local.id))
  const deleteLocals = locals.filter(local => deleteIds.has(local.id))
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
  /** 段内首个未修复章节的勾选状态代表整段：段是作为一个整体归位的。 */
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
    {!!shiftSegments.length && (() => {
      const gapSegments = shiftSegments.filter(isGapSegment)
      // 段报告从 orderShiftSegments 直接渲染，与「有差异」筛选无关；两者的计数口径必须对齐，
      // 否则会同时出现「有差异 66」和「60 项需处理」这类自相矛盾的读数。
      const gapTotal = locals.filter(local => { const shift = orderShifts.get(local.id); return Boolean(shift?.gap && shift.shifted) }).length
      const detail = `${shiftSegments.length} 段 · ${differenceCount} 项需处理${layoutShiftCount ? ` · ${layoutShiftCount} 项排版偏移仅提示` : ''}`
      // 真实错位成因是「段前本地多插了无源站对应的章节」，把具体章节号写出来才可核查；
      // 该段没有可独立归位的章节时（被占位章挡住），如实说明而不是写「0 章待归位」。
      const gapIds = [...new Set(gapSegments.flatMap(segment => segment.blockingChapterIds))]
      const cause = gapIds.length
        ? `成因是本地 ${ordersOf(gapIds)} 等 ${gapIds.length} 章无源站对应，把其后本地序号整体顶开`
        : '成因是本段前的本地目录与源站不一致'
      // 真实错位集中于单个不连续段时，分区列表纯属噪音（真实书 8 段里只有少数是错位）。
      const consolidated = gapSegments.length === 1 && gapSegments[0]!.localRange.from === gapSegments[0]!.localRange.to
      if (consolidated) {
        return <p className="chapter-merge-dialog__shift-summary">
          <span>序号偏移 {detail}。真实错位位于{formatSegmentLabel(gapSegments[0]!)}，{cause}；可归位 {gapTotal} 章，{layoutShiftCount} 条排版偏移不生成修复。</span>
          <Button variant="ghost" size="sm" disabled={disabled} onClick={() => focusSegment(gapSegments[0]!)}>定位真实错位</Button>
        </p>
      }
      return <details className="chapter-merge-dialog__shift-summary">
        <summary>序号偏移分段<span>{detail}</span></summary>
        <p className="admin-dialog-hint">按映射偏移切分出的连续区段。真实错位可按源站序号归位（本页 {gapTotal} 章）；排版偏移来自作者主动重排（如把番外前移到中段），归位会打乱章节先后，只作提示。</p>
        <ul>
          {shiftSegments.map(segment => {
            const gap = isGapSegment(segment)
            const ids = gap ? segmentChapterIds(segment) : []
            return <li key={`${segment.localRange.from}-${segment.localRange.to}`}>
              <strong>{formatSegmentLabel(segment)}</strong>
              <span className={gap ? 'chapter-merge-dialog__warning' : 'chapter-merge-dialog__shift-neutral'}>
                {gap ? `真实错位 ${segment.offset > 0 ? '+' : ''}${segment.offset}` : `排版偏移 ${segment.offset > 0 ? '+' : ''}${segment.offset}`}
              </span>
              <span>{gap ? `${ids.length} 章待归位（本地 ${ordersOf(ids)}）` : '仅提示，不生成修复'}</span>
              <Button variant="ghost" size="sm" disabled={disabled} onClick={() => focusSegment(segment)}>定位</Button>
            </li>
          })}
        </ul>
      </details>
    })()}
    {!!blockers.size && <details className="chapter-merge-dialog__shift-summary">
      <summary>序号修复受阻汇总<span>{blockers.size} 个阻塞源 · {(preview.orderRepairBlockers || []).reduce((total, row) => total + row.affectedChapterIds.length, 0)} 项待处理</span></summary>
      <p className="admin-dialog-hint">以下章节因缺少有效源站对应而挡住了其后章节的序号归位。处理阻塞源后可重新核对。</p>
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
              <div><span className="chapter-merge-dialog__mapping-label">本地目录</span><strong tabIndex={-1} ref={element => { if (element) localHeadings.current.set(local.id, element); else localHeadings.current.delete(local.id) }}>本地 {local.order} · {local.title}</strong></div>
              <div><span className="chapter-merge-dialog__mapping-label">源站目录</span><p>{mapping ? `源站 ${mapping.sourceOrder} · ${mapping.sourceTitle}` : '尚未匹配，保持本地章节原样'}</p></div>
            </div>
            <div className="chapter-merge-dialog__mapping-meta">
              {orderChanges.has(local.id) && <span>序号 {local.order} → {orderChanges.get(local.id)!.newOrder} · {selectedIds.has(local.id) ? '已选，将修复' : '勾选后修复'}</span>}
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
                  : <span className="chapter-merge-dialog__shift-neutral">排版偏移 {sign}{shift.segment.offset}（仅提示）</span>
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
                      const occupiedBy = locals.filter(local => local.id !== editingId && effectiveMappings.get(local.id) === source.key)
                      const blocked = occupiedBy.some(local => byLocal.get(local.id)?.relation === 'split' || /[（(]\s*\d+\s*[/／]\s*\d+\s*[)）]$/.test(local.title))
                      return <SelectItem key={source.key} value={source.key} disabled={blocked}>{source.order} · {source.title}{blocked ? '（拆分组已占用）' : occupiedBy.length ? '（选择后交换）' : ''}</SelectItem>
                    })}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {sourceMatches.length > 100 && <p className="admin-dialog-hint">找到 {sourceMatches.length} 章，展示前 100 章；输入标题或序号缩小范围。</p>}
            {selected && <p className="admin-dialog-hint">源站前章：{sources[sourceIndex - 1]?.title || '无'}；后章：{sources[sourceIndex + 1]?.title || '无'}</p>}
            {occupant && <p className="chapter-merge-dialog__warning">将与本地 {occupant.order} · {occupant.title} 交换对应关系；双方都会加入暂存调整。</p>}
            <div className="chapter-merge-dialog__metadata-actions"><Button disabled={disabled} onClick={save}>暂存映射调整</Button><Button variant="ghost" disabled={disabled} onClick={() => setEditingId('')}>取消调整</Button></div>
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
