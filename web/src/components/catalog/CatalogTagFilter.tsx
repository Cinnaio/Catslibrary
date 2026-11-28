import { useRef, useState, type CSSProperties } from 'react'
import { ChevronDown, SlidersHorizontal, X } from 'lucide-react'
import { Dialog, DialogClose, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { DialogBody, DialogFrame } from '@/components/shared/DialogFrame'
import { SearchField } from '@/components/shared/SearchField'
import { Button } from '@/components/ui/button'
import { FilterChip } from '@/components/ui/filter-chip'
import { MotionDetails, MotionView } from '@/components/ui/motion'
import { matchesCategorySearch, type HomeCategoryGroup } from '@/lib/home-categories'
import styles from './CatalogTagFilter.module.css'

interface CatalogTagFilterProps {
  groups: HomeCategoryGroup[]
  selected: string[]
  onApply: (tags: string[]) => void
}

/** The draft lives inside the dialog portal, so closing discards unapplied changes. */
function TagSelection({ groups, selected, onApply, onClose }: CatalogTagFilterProps & { onClose: () => void }) {
  const [draft, setDraft] = useState(selected)
  const [query, setQuery] = useState('')
  const available = new Set(groups.flatMap((group) => group.tags))
  const visibleDraft = draft.filter((tag) => available.has(tag))
  const searching = !!query.trim()
  const matching = groups.map((group) => ({ ...group, tags: group.tags.filter((tag) => matchesCategorySearch(tag, query)) }))
    .filter((group) => group.tags.length > 0)
  const matchCount = matching.reduce((count, group) => count + group.tags.length, 0)

  function toggleTag(tag: string) {
    setDraft(visibleDraft.includes(tag) ? visibleDraft.filter((item) => item !== tag) : [...visibleDraft, tag])
  }

  function tags(group: HomeCategoryGroup) {
    return <div className={styles.tags} role="group" aria-label={group.label}>
      {group.tags.map((tag) => <FilterChip key={tag} selected={visibleDraft.includes(tag)} aria-pressed={visibleDraft.includes(tag)} onClick={() => toggleTag(tag)}>{tag}</FilterChip>)}
    </div>
  }

  return <>
    <DialogHeader className={styles.header}>
      <DialogTitle tabIndex={-1} className={styles.title}>全部标签</DialogTitle>
      <DialogDescription>选择想看的标签，作品会同时满足所选条件。</DialogDescription>
    </DialogHeader>
    <div className={styles.tools}>
      <SearchField label="搜索标签" placeholder="搜索标签，也支持简繁和大小写别名" value={query} onChange={(event) => setQuery(event.target.value)} />
      <p className={styles.resultCount} role="status">{searching ? `找到 ${matchCount} 个标签` : '按题材、情节和关系挑选'}</p>
    </div>
    <DialogBody className={styles.body}>
      {visibleDraft.length > 0 && <section className={styles.selection} aria-label="待应用标签">
        <h3>已选 · 同时满足</h3>
        <div className={styles.tags}>
          {visibleDraft.map((tag) => <FilterChip key={tag} selected aria-label={`移除待选标签 ${tag}`} onClick={() => toggleTag(tag)}>{tag}<X size={12} aria-hidden="true" /></FilterChip>)}
        </div>
      </section>}
      <MotionView className={styles.groups} motionKey={query.trim()}>
        {matching.map((group, index) => group.collapsed && !searching
          ? <MotionDetails className={styles.group} key={group.label} style={{ '--tag-group-order': index } as CSSProperties}>
              <summary><span>{group.label}<small>{group.tags.length}</small></span><ChevronDown size={16} aria-hidden="true" /></summary>
              {tags(group)}
            </MotionDetails>
          : <section className={styles.group} key={group.label} style={{ '--tag-group-order': index } as CSSProperties}>
              <h3>{group.label}<small>{group.tags.length}</small></h3>
              {tags(group)}
            </section>)}
        {matchCount === 0 && <div className={styles.empty}>
          <p>没有找到相关标签</p>
          <span>换个关键词试试，已选标签仍会保留。</span>
          <Button type="button" variant="ghost" onClick={() => setQuery('')}>清空搜索</Button>
        </div>}
      </MotionView>
    </DialogBody>
    <div className={styles.footer}>
      <span className={styles.selectionCount} aria-live="polite">{visibleDraft.length ? `已选 ${visibleDraft.length} 个标签` : '不限标签'}</span>
      <div className={styles.actions}>
        <Button type="button" variant="ghost" disabled={!visibleDraft.length} onClick={() => setDraft([])}>重置</Button>
        <Button type="button" onClick={() => { onApply(visibleDraft); onClose() }}>应用筛选</Button>
      </div>
    </div>
    <DialogClose asChild><Button type="button" variant="ghost" size="icon" className={styles.close} aria-label="关闭标签筛选"><X aria-hidden="true" /></Button></DialogClose>
  </>
}

export default function CatalogTagFilter(props: CatalogTagFilterProps) {
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild>
      <FilterChip className={styles.trigger}><SlidersHorizontal size={14} aria-hidden="true" />全部标签</FilterChip>
    </DialogTrigger>
    <DialogFrame ref={panelRef} className={styles.panel} showCloseButton={false} onOpenAutoFocus={(event) => {
      event.preventDefault()
      panelRef.current?.querySelector<HTMLElement>('[data-slot="dialog-title"]')?.focus()
    }}>
      <TagSelection {...props} onClose={() => setOpen(false)} />
    </DialogFrame>
  </Dialog>
}
