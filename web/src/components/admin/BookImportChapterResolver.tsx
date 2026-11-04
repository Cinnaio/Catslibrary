import '@/styles/input-fields.css'
import { useState } from 'react'
import type { BookImportChapterDiff, BookImportChapterResolution, BookImportLocalChapter } from '@shared/types'
import { planImportInsertions } from '@shared/book-import-resolution'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import SearchSelect, { type SelectOption } from "@/components/shared/SearchSelect"

export type ChapterResolutionChoice = { action: 'match'; localChapterId: string } | { action: 'insert'; afterChapterId: string | null; afterIncomingChapterId?: string }

export default function BookImportChapterResolver({
  chapter,
  local,
  resolutions,
  chapters,
  selectedIds,
  busy,
  onSave,
  onCancel,
}: {
  chapter: BookImportChapterDiff
  local: BookImportLocalChapter[]
  resolutions: BookImportChapterResolution[]
  chapters: BookImportChapterDiff[]
  selectedIds?: ReadonlySet<string>
  busy: boolean
  onSave: (choice: ChapterResolutionChoice) => void
  onCancel: () => void
}) {
  const existing = resolutions.find((item) => item.chapterId === chapter.id)
  const [action, setAction] = useState<'match' | 'insert' | ''>(existing?.action || '')
  const [target, setTarget] = useState(
    existing?.action === 'match' ? existing.localChapterId : existing?.action === 'insert' ? (existing.afterIncomingChapterId !== undefined ? `incoming:${existing.afterIncomingChapterId}` : existing.afterChapterId === null ? '__start__' : `local:${existing.afterChapterId}`) : '',
  )
  const [search, setSearch] = useState('')
  const selected = new Set(selectedIds ?? chapters.filter(item => item.selected).map(item => item.id))
  const insertionChoice = (): Extract<ChapterResolutionChoice, { action: 'insert' }> => target.startsWith('incoming:')
    ? { action: 'insert', afterChapterId: null, afterIncomingChapterId: target.slice(9) }
    : { action: 'insert', afterChapterId: target === '__start__' ? null : target.slice(6) }
  const proposed: BookImportChapterResolution[] = resolutions.filter((item) => item.chapterId !== chapter.id).map(item => {
    if (action !== 'insert' && existing?.action === 'insert' && item.action === 'insert' && item.afterIncomingChapterId === chapter.id) {
      const { afterIncomingChapterId: _previous, ...rest } = item
      return { ...rest, afterChapterId: existing.afterChapterId, ...(existing.afterIncomingChapterId !== undefined ? { afterIncomingChapterId: existing.afterIncomingChapterId } : {}) }
    }
    return item
  })
  if (action === 'insert' && target) proposed.push({ chapterId: chapter.id, ...insertionChoice() })
  else if (action === 'insert' && existing?.action === 'insert') proposed.push(existing)
  const selectedVersions = new Map<string, string>()
  for (const item of proposed) {
    const group = chapters.find((c) => c.id === item.chapterId)?.variantGroup
    if (group && item.action === 'insert') selectedVersions.set(group, item.chapterId)
  }
  const eligible = new Set(proposed.filter((item) => {
    const group = chapters.find((c) => c.id === item.chapterId)?.variantGroup
    if (item.chapterId === chapter.id && action === 'insert') return true
    if (!selected.has(item.chapterId)) return false
    return !group || item.action !== 'insert' || (selectedIds ? !(chapter.variantGroup === group && action === 'insert') : selectedVersions.get(group) === item.chapterId)
  }).map(item => item.chapterId))
  const plan = planImportInsertions(
    local,
    [...proposed].sort((a, b) => chapters.findIndex((c) => c.id === a.chapterId) - chapters.findIndex((c) => c.id === b.chapterId)),
    eligible,
  )
  // 编辑已有确认时不能选自己或自己的后继，否则会构成环。
  const excluded = new Set([chapter.id])
  for (let changed = true; changed;) {
    changed = false
    for (const item of resolutions) if (item.action === 'insert' && item.afterIncomingChapterId !== undefined && excluded.has(item.afterIncomingChapterId) && !excluded.has(item.chapterId)) {
      excluded.add(item.chapterId)
      changed = true
    }
  }
  const sortedResolutions = [...resolutions].sort((a, b) => chapters.findIndex(c => c.id === a.chapterId) - chapters.findIndex(c => c.id === b.chapterId))
  const currentPlan = planImportInsertions(local, sortedResolutions, selected)
  const referencePlan = planImportInsertions(local, sortedResolutions)
  const candidates: { id: string; title: string; order: number; value: string; incoming: boolean }[] = action === 'match'
    ? local.map(item => ({ ...item, value: item.id, incoming: false }))
    : [
        ...local.map(item => ({ ...item, order: currentPlan.orders.get(item.id) ?? item.order, value: `local:${item.id}`, incoming: false })),
        ...resolutions.flatMap(item => {
          const diff = chapters.find(c => c.id === item.chapterId)
          return item.action === 'insert' && diff && !excluded.has(item.chapterId)
            ? [{ id: item.chapterId, title: diff.incomingTitle, order: currentPlan.insertOrders.get(item.chapterId) ?? referencePlan.insertOrders.get(item.chapterId)!, value: `incoming:${item.chapterId}`, incoming: true }]
            : []
        }),
      ].sort((a, b) => a.order - b.order)
  const filtered = candidates.filter(item => `${item.order} ${item.title}`.includes(search.trim()) || item.value === target)
  // 共享下拉的候选：插入模式必须保留「放在本书第一章之前」，否则排在首位的前章无处可选。
  const targetOptions: SelectOption[] = [
    ...(action === 'insert' ? [{ value: '__start__', label: '放在本书第一章之前' }] : []),
    ...filtered.map((item) => ({
      value: item.value,
      label: `${action === 'insert' ? '放在后面：' : ''}${item.order} · ${item.title}`,
      note: item.incoming ? (selected.has(item.id) ? '本轮新增' : '本轮新增，未勾选') : undefined,
    })),
  ]
  const targetTriggerId = `resolution-target-${chapter.id}`
  return (
    <section className="book-import__resolution" aria-label={`处理需确认章节：${chapter.incomingTitle}`}>
      <h4>核对章节对应关系</h4>
      <p>{chapter.status === 'conflict' ? '此项尚不能勾选。请先确认它对应已有章节，还是需要在指定位置新增。保存只更新预览。' : '可调整已确认的对应关系或插入位置。保存只更新预览，最终写入以勾选和确认导入为准。'}</p>
      <fieldset disabled={busy}>
        <legend>如何处理这一章</legend>
        <label>
          <input
            type="radio"
            name={`resolution-${chapter.id}`}
            checked={action === 'match'}
            onChange={() => {
              setAction('match')
              setTarget('')
            }}
          />
          对应已有章节
        </label>
        <label>
          <input
            type="radio"
            name={`resolution-${chapter.id}`}
            checked={action === 'insert'}
            onChange={() => {
              setAction('insert')
              setTarget('')
            }}
          />
          这是新增章节
        </label>
      </fieldset>
      {action && (
        <>
          <Label htmlFor={`resolution-search-${chapter.id}`}>{action === 'match' ? '查找本地章节' : '查找已有或本轮新增章节'}</Label>
          <Input
            id={`resolution-search-${chapter.id}`}
            value={search}
            disabled={busy}
            placeholder="按标题或序号筛选"
            onChange={(event) => setSearch(event.target.value)}
          />
          <Label id={`${targetTriggerId}-label`} htmlFor={targetTriggerId}>{action === 'match' ? '对应的本地章节' : '插入位置'}</Label>
          <SearchSelect
            id={targetTriggerId}
            className="w-full min-w-0"
            options={targetOptions}
            value={target}
            onChange={setTarget}
            placeholder={action === 'match' ? '请选择并核对本地章节' : '请选择插入在哪一章之后'}
            searchable={false}
            onSearchChange={setSearch}
            matchTriggerWidth
            compactThreshold={12}
            expandAllLabel="展开全部 {count} 项"
            disabled={busy}
            aria-labelledby={`${targetTriggerId}-label`}
          />
          {action === 'match' && <p>保存对应关系后可展开比较该章正文，再勾选是否更新；本地序号保留。</p>}
          {action === 'insert' && <p>可接在已有章节或本轮已确认新增的章节之后，无需先导入上一章。取消勾选前章时，后章仍保留在该位置。</p>}
          {action === 'insert' && target && (
            <div role="status">
              <p>预计新增序号：{plan.insertOrders.get(chapter.id)}。以最终勾选的新增章节计算实际位置。</p>
              {plan.changes.length ? (
                <details>
                  <summary>预计顺延 {plan.changes.length} 个已有章节的序号</summary>
                  <ul>
                    {plan.changes.map((item) => (
                      <li key={item.chapterId}>
                        {item.title}：{item.before} → {item.after}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : (
                <p>无需调整已有章节的序号。</p>
              )}
              <p>已有章节正文和标题保留，序号调整随本次导入记录，可安全撤回。</p>
            </div>
          )}
        </>
      )}
      <div className="book-import__resolution-actions">
        <Button
          size="sm"
          disabled={busy || !action || !target}
          onClick={() => {
            if (action === 'match') onSave({ action, localChapterId: target })
            else if (action === 'insert') onSave(insertionChoice())
          }}
        >
          保存确认并更新预览
        </Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={onCancel}>
          暂不处理
        </Button>
      </div>
    </section>
  )
}
