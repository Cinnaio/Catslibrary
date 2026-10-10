import { useMemo, useState } from 'react'
import type { SourceSyncPreview } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ArrowRight } from 'lucide-react'

interface Props {
  preview: SourceSyncPreview
  fields: string[]
  onFieldsChange: (fields: string[]) => void
  mode: 'missing' | 'replace'
  onModeChange: (mode: 'missing' | 'replace') => void
  disabled: boolean
}

const PAGE_SIZE = 20

export default function ChapterMergePreview({ preview, fields, onFieldsChange, mode, onModeChange, disabled }: Props) {
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const eligible = preview.changes.filter((change) => change.eligible).length
  const manual = preview.changes.length - eligible
  const filtered = useMemo(() => preview.changes.filter((change) => {
    if (filter === 'eligible' && !change.eligible) return false
    if (filter === 'manual' && change.eligible) return false
    const text = query.trim().toLowerCase()
    return !text || `${change.localOrder} ${change.oldTitle} ${change.newTitle}`.toLowerCase().includes(text)
  }), [preview, filter, query])
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, pages)
  const metadata: Array<[string, string, string]> = [
    ['title', '书名', preview.metadata.title],
    ['author', '作者', preview.metadata.author],
    ['description', '简介', preview.metadata.description],
    ['coverUrl', '封面链接', preview.metadata.coverUrl],
    ['categories', '分类', preview.metadata.categories.join('、')],
    ['status', '状态', preview.metadata.status === 'completed' ? '已完结' : preview.metadata.status === 'ongoing' ? '连载中' : preview.metadata.status],
  ]
  const selected = metadata.filter(([field, , value]) => value && fields.includes(field)).length

  return <section className="chapter-merge-dialog__preview" aria-label="源站匹配预览">
    <div className="chapter-merge-dialog__preview-summary" role="status">
      <h3>可更新 <strong>{eligible}</strong> 个章节名</h3>
      <p>{preview.site === 'jjwxc' ? '晋江' : preview.site === 'po18tw' ? 'PO18.tw' : preview.site} · 源站 {preview.sourceChapterCount} 章 / 本地 {preview.localChapterCount} 节 · 已匹配 {preview.matchedSourceCount} 章</p>
      {manual > 0 && <p className="chapter-merge-dialog__warning">{manual} 个标题需要人工核对，本次不会自动更新。</p>}
      {(preview.unmatchedSource.length > 0 || preview.unmatchedLocal.length > 0) && <details className="chapter-merge-dialog__unmatched">
        <summary>未匹配：源站 {preview.unmatchedSource.length} 章，本地 {preview.unmatchedLocal.length} 节</summary>
        <p className="admin-dialog-hint">未匹配章节保持原样，可对照目录后单独处理。</p>
        {preview.unmatchedSource.length > 0 && <p>源站：{preview.unmatchedSource.map((chapter) => `第 ${chapter.order} 章 ${chapter.title}`).join('；')}</p>}
        {preview.unmatchedLocal.length > 0 && <p>本地：{preview.unmatchedLocal.map((chapter) => `第 ${chapter.order} 节 ${chapter.title}`).join('；')}</p>}
      </details>}
      {preview.warnings.map((warning) => <p className="chapter-merge-dialog__warning" key={warning}>{warning}</p>)}
    </div>

    <div className="chapter-merge-dialog__preview-section">
      <div className="chapter-merge-dialog__review-toolbar">
        <div className="chapter-merge-dialog__filters" role="group" aria-label="标题变化筛选">
          {([['all', `全部 ${preview.changes.length}`], ['eligible', `可更新 ${eligible}`], ['manual', `需确认 ${manual}`]] as const).map(([value, label]) =>
            <Button key={value} variant="ghost" aria-pressed={filter === value} onClick={() => { setFilter(value); setPage(1) }}>{label}</Button>,
          )}
        </div>
        <Input type="search" aria-label="搜索标题变化" placeholder="搜索标题或序号" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} />
      </div>
      <div className="chapter-merge-dialog__comparison-head" aria-hidden="true"><span>序号</span><span>原章节名</span><span /><span>更新后</span></div>
      <ol className="chapter-merge-dialog__changes" aria-label="章节名变化">
        {filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE).map((change) => <li key={change.localChapterId}>
          <span className="chapter-merge-dialog__order">{change.localOrder}</span>
          <span className="chapter-merge-dialog__old"><span className="sr-only">原章节名：</span>{change.oldTitle}</span>
          <ArrowRight size={14} aria-hidden="true" />
          <span className="chapter-merge-dialog__new"><span className="sr-only">更新后：</span>{change.newTitle}
            {change.partCount > 1 && <small>拆分 {change.partIndex}/{change.partCount}</small>}
            {!change.eligible && <small className="chapter-merge-dialog__warning">需人工确认 · 本次跳过</small>}
          </span>
        </li>)}
      </ol>
      {filtered.length === 0 && <p className="chapter-merge-dialog__empty">{preview.changes.length ? '没有符合当前条件的标题，试试其他筛选或关键词。' : '没有需要补全的章节名。仍可按需同步小说信息。'}</p>}
      {filtered.length > 0 && <nav className="chapter-merge-dialog__pagination" aria-label="标题预览分页">
        <span>{(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} / {filtered.length}</span>
        <Button variant="ghost" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>上一页</Button>
        <span>{currentPage} / {pages}</span>
        <Button variant="ghost" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>下一页</Button>
      </nav>}
    </div>

    <details className="chapter-merge-dialog__metadata chapter-merge-dialog__preview-section">
      <summary>同步小说信息<span>{selected} 项已选 · {mode === 'replace' ? '覆盖已有信息' : '仅补全空字段'}</span></summary>
      <p className="admin-dialog-hint">可选操作。取消勾选全部字段即可只更新章节名。</p>
      <div className="chapter-merge-dialog__metadata-actions">
        <Button variant="ghost" disabled={disabled} onClick={() => onFieldsChange(metadata.filter(([, , value]) => value).map(([field]) => field))}>全选可用字段</Button>
        <Button variant="ghost" disabled={disabled || !selected} onClick={() => onFieldsChange([])}>清空选择</Button>
      </div>
      <div className="chapter-merge-dialog__metadata-fields">
        {metadata.map(([field, label, value]) => <div className="chapter-merge-dialog__metadata-field" key={field}>
          <Label htmlFor={`merge-metadata-${field}`}><Checkbox id={`merge-metadata-${field}`} checked={Boolean(value) && fields.includes(field)} disabled={disabled || !value} onCheckedChange={(checked) => onFieldsChange(checked ? [...new Set([...fields, field])] : fields.filter((item) => item !== field))} />{label}</Label>
          <div>{field === 'description' && value ? <details><summary>{value.slice(0, 72)}{value.length > 72 ? '… 展开全文' : ''}</summary><p>{value}</p></details> : <span>{value || '源站未提供'}</span>}</div>
        </div>)}
      </div>
      <Label className="chapter-merge-dialog__replace"><Checkbox checked={mode === 'replace'} disabled={disabled || !selected} onCheckedChange={(checked) => onModeChange(checked ? 'replace' : 'missing')} />覆盖已有小说信息</Label>
      {mode === 'replace' && selected > 0 && <p className="chapter-merge-dialog__warning">已选字段将替换现有内容，请在更新前核对源站信息。</p>}
    </details>
    {preview.mappings.some((mapping) => mapping.relation === 'split') && <details className="chapter-merge-dialog__preview-section">
      <summary>查看拆分章节映射</summary>
      {preview.mappings.filter((mapping) => mapping.relation === 'split').map((mapping) => <p key={mapping.sourceChapterKey}>源站第 {mapping.sourceOrder} 章「{mapping.sourceTitle}」 → 本地 {mapping.localChapterIds.length} 节</p>)}
    </details>}
  </section>
}
