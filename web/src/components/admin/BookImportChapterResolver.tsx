import { useState } from 'react'
import type { BookImportChapterDiff, BookImportChapterResolution, BookImportLocalChapter } from '@shared/types'
import { planImportInsertions } from '@shared/book-import-resolution'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export type ChapterResolutionChoice = { action: 'match'; localChapterId: string } | { action: 'insert'; afterChapterId: string | null }

export default function BookImportChapterResolver({
  chapter,
  local,
  resolutions,
  chapters,
  busy,
  onSave,
  onCancel,
}: {
  chapter: BookImportChapterDiff
  local: BookImportLocalChapter[]
  resolutions: BookImportChapterResolution[]
  chapters: BookImportChapterDiff[]
  busy: boolean
  onSave: (choice: ChapterResolutionChoice) => void
  onCancel: () => void
}) {
  const existing = resolutions.find((item) => item.chapterId === chapter.id)
  const [action, setAction] = useState<'match' | 'insert' | ''>(existing?.action || '')
  const [target, setTarget] = useState(
    existing?.action === 'match' ? existing.localChapterId : existing?.action === 'insert' ? (existing.afterChapterId ?? '__start__') : '',
  )
  const [search, setSearch] = useState('')
  const filtered = local.filter((item) => `${item.order} ${item.title}`.includes(search.trim()) || item.id === target)
  const proposed: BookImportChapterResolution[] = resolutions.filter((item) => item.chapterId !== chapter.id)
  if (action === 'insert' && target) proposed.push({ chapterId: chapter.id, action, afterChapterId: target === '__start__' ? null : target })
  const selectedVersions = new Map<string, string>()
  for (const item of proposed) {
    const group = chapters.find((c) => c.id === item.chapterId)?.variantGroup
    if (group && item.action === 'insert') selectedVersions.set(group, item.chapterId)
  }
  const eligible = proposed.filter((item) => {
    const group = chapters.find((c) => c.id === item.chapterId)?.variantGroup
    return !group || item.action !== 'insert' || selectedVersions.get(group) === item.chapterId
  })
  const plan = planImportInsertions(
    local,
    eligible.sort((a, b) => chapters.findIndex((c) => c.id === a.chapterId) - chapters.findIndex((c) => c.id === b.chapterId)),
  )
  return (
    <section className="book-import__resolution" aria-label={`处理需确认章节：${chapter.incomingTitle}`}>
      <h4>核对章节对应关系</h4>
      <p>此项尚不能勾选。请先确认它对应已有章节，还是需要在指定位置新增。保存只更新预览。</p>
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
          <Label htmlFor={`resolution-search-${chapter.id}`}>查找本地章节</Label>
          <Input
            id={`resolution-search-${chapter.id}`}
            value={search}
            disabled={busy}
            placeholder="按标题或序号筛选"
            onChange={(event) => setSearch(event.target.value)}
          />
          <Label htmlFor={`resolution-target-${chapter.id}`}>{action === 'match' ? '对应的本地章节' : '插入位置'}</Label>
          <select
            id={`resolution-target-${chapter.id}`}
            className="book-import__resolution-select"
            value={target}
            disabled={busy}
            onChange={(event) => setTarget(event.target.value)}
          >
            <option value="">{action === 'match' ? '请选择并核对本地章节' : '请选择插入在哪一章之后'}</option>
            {action === 'insert' && <option value="__start__">放在本书第一章之前</option>}
            {filtered.map((item) => (
              <option value={item.id} key={item.id}>
                {action === 'insert' ? '放在后面：' : ''}
                {item.order} · {item.title}
              </option>
            ))}
          </select>
          {action === 'match' && <p>保存对应关系后可展开比较该章正文，再勾选是否更新；本地序号保留。</p>}
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
            else if (action === 'insert') onSave({ action, afterChapterId: target === '__start__' ? null : target })
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
