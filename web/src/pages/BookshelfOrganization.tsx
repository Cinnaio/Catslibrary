import { Dialog } from '@/components/ui/dialog'
import { useDeferredValue, useEffect, useId, useRef, useState, useTransition, type CSSProperties, type ReactNode } from 'react'
import { ArrowDown, ArrowDownUp, ArrowUp, Check, FolderOpen, ListChecks, PencilLine, Pin, PinOff, Settings2 } from 'lucide-react'
import type { BookshelfGroup, ShelfOrganization } from '@shared/bookshelf-organization'
import { shelfOrganizationApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { MotionPresence } from '@/components/ui/motion'
import { SearchField } from '@/components/shared/SearchField'
import SearchSelect from '@/components/shared/SearchSelect'
import FormField from '@/components/shared/FormField'
import EmptyState from '@/components/shared/EmptyState'
import { ReadingDialog, ReadingDialogEditor } from '@/components/shared/ReadingDialog'
import Pagination from '@/components/shared/Pagination'
import shelfStyles from './bookshelf.module.css'
import styles from './bookshelf-organization.module.css'

export interface OrganizedFavorite extends ShelfOrganization {
  novelId: string; title?: string; novelTitle?: string; author?: string; updatedAt?: number; progressUpdatedAt?: number
}
export interface ShelfBookOrganization {
  selection: ReactNode
  badge: ReactNode
  menu: ReactNode
  footer: ReactNode
  selected: boolean
}
interface Props<T extends OrganizedFavorite> {
  favorites: T[]; safeMode: boolean; disabled: boolean
  mutate: (action: () => Promise<unknown>) => Promise<boolean>
  renderBook: (book: T, organization: ShelfBookOrganization) => ReactNode
}
export default function BookshelfOrganization<T extends OrganizedFavorite>({ favorites, safeMode, disabled, mutate, renderBook }: Props<T>) {
  const [groups, setGroups] = useState<BookshelfGroup[]>([])
  const [group, setGroup] = useState('')
  const [sort, setSort] = useState('manual')
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [transitioning, startTransition] = useTransition()
  const [organizing, setOrganizing] = useState(false)
  const controlId = useId()
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<string[]>([])
  const [batchGroup, setBatchGroup] = useState('')
  const [managing, setManaging] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [renameId, setRenameId] = useState('')
  const [deleting, setDeleting] = useState<BookshelfGroup | null>(null)
  const [editing, setEditing] = useState<T | null>(null)
  const [note, setNote] = useState('')
  const [memberships, setMemberships] = useState<string[]>([])
  const [error, setError] = useState('')
  const [groupError, setGroupError] = useState('')
  const [groupRetry, setGroupRetry] = useState(0)
  const [busy, setBusy] = useState(false)
  const [groupsReady, setGroupsReady] = useState(false)
  const live = useRef(true)
  const operation = useRef(false)
  const mode = safeMode ? 'safe' : 'adult'
  useEffect(() => {
    live.current = true
    let active = true
    shelfOrganizationApi.groups(mode).then(r => { if (active) { setGroups(r.groups); setGroupsReady(true); setGroupError('') } })
      .catch(e => { if (active) setGroupError(e.message || '分组读取失败，请重试') })
    return () => { active = false; live.current = false }
  }, [mode, favorites, groupRetry])
  const blocked = disabled || busy
  const filtered = favorites.filter(f => (!group || (group === '_ungrouped' ? !f.groupIds?.length : f.groupIds?.includes(group))) &&
    `${f.title ?? f.novelTitle ?? ''} ${f.author ?? ''} ${f.note ?? ''}`.toLocaleLowerCase().includes(deferredQuery.trim().toLocaleLowerCase()))
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || (sort === 'title'
      ? (a.title || a.novelTitle || '').localeCompare(b.title || b.novelTitle || '', 'zh-CN')
      : sort === 'recent' ? (b.progressUpdatedAt || 0) - (a.progressUpdatedAt || 0)
      : (a.position || 0) - (b.position || 0) || (b.updatedAt || 0) - (a.updatedAt || 0)))
  const pages = Math.max(1, Math.ceil(filtered.length / 12)), currentPage = Math.min(page, pages)
  const visible = filtered.slice((currentPage - 1) * 12, currentPage * 12)
  const selectedIds = selected.filter(id => favorites.some(f => f.novelId === id))
  const filtering = transitioning || query !== deferredQuery
  const groupOptions = groups.map(g => ({ value: g.id, label: g.name, note: `${g.count} 本` }))
  const allVisibleSelected = visible.length > 0 && visible.every(f => selectedIds.includes(f.novelId))
  const someVisibleSelected = visible.some(f => selectedIds.includes(f.novelId))
  async function perform(action: () => Promise<unknown>, complete?: () => void) {
    if (operation.current || disabled) return
    operation.current = true; setBusy(true); setError('')
    try {
      if (await mutate(action) && live.current) {
        const r = await shelfOrganizationApi.groups(mode)
        if (live.current) { setGroups(r.groups); setGroupsReady(true); setGroupError(''); complete?.() }
      }
    } catch (e) { if (live.current) setError((e as Error).message || '整理失败，请重试') }
    finally { operation.current = false; if (live.current) setBusy(false) }
  }
  function filterGroup(value: string) { setSelected([]); startTransition(() => { setGroup(value); setPage(1) }) }
  function resetFilters() { setQuery(''); filterGroup('') }
  function toggleOrganizing() { setOrganizing(value => !value); setSelected([]); setBatchGroup('') }
  function selectPage() {
    setSelected(ids => allVisibleSelected
      ? ids.filter(id => !visible.some(f => f.novelId === id))
      : [...new Set([...selectedIds, ...visible.map(f => f.novelId)])].slice(0, 100))
  }
  function openEditor(book: T) { setEditing(book); setNote(book.note || ''); setMemberships(book.groupIds || []); setError('') }
  function toggle(id: string) { setSelected(ids => ids.includes(id) ? ids.filter(x => x !== id) : ids.length < 100 ? [...ids, id] : ids) }
  const errorView = error && <p className={styles.error} role="alert">{error}</p>
  return <div className={styles.organizer} aria-busy={blocked}>
    <div className={styles.toolbar}>
      <div className={styles.search}>
        <SearchField label="搜索收藏与备注" value={query} placeholder="搜索书名、作者或收藏理由"
          aria-controls="bookshelfFavorites" onChange={e => { setQuery(e.target.value); setPage(1); setSelected([]) }} disabled={blocked} />
      </div>
      <div className={styles.filters}>
        <SearchSelect aria-label="私人分组" className={styles.groupFilter} value={group} onChange={filterGroup}
          options={[{ value: '', label: '全部收藏' }, { value: '_ungrouped', label: '未分组' }, ...groupOptions]}
          leadingIcon={<FolderOpen size={16} aria-hidden="true" />} searchable searchPlaceholder="查找分组" disabled={blocked || !groupsReady} />
        <SearchSelect aria-label="收藏排序" className={styles.sortFilter} value={sort}
          onChange={value => startTransition(() => { setSort(value); setPage(1) })}
          options={[{ value: 'manual', label: '我的顺序' }, { value: 'recent', label: '最近阅读' }, { value: 'title', label: '按书名' }]}
          leadingIcon={<ArrowDownUp size={16} aria-hidden="true" />} disabled={blocked} />
      </div>
      <div className={styles.toolbarActions}>
        <Button variant="ghost" disabled={blocked || !groupsReady} onClick={() => { setManaging(true); setError('') }}>
          <Settings2 size={16} aria-hidden="true" />管理分组
        </Button>
        <Button variant={organizing ? 'default' : 'secondary'} aria-pressed={organizing} disabled={blocked || !favorites.length} onClick={toggleOrganizing}>
          {organizing ? <Check size={16} aria-hidden="true" /> : <ListChecks size={16} aria-hidden="true" />}{organizing ? '完成整理' : '整理书架'}
        </Button>
      </div>
    </div>
    {groupError && <div className={styles.feedback} role="alert"><span>{groupError}</span><Button size="sm" variant="ghost" disabled={blocked} onClick={() => setGroupRetry(value => value + 1)}>重试分组</Button></div>}
    {!editing && !managing && errorView}
    <span className="sr-only" role="status">{filtering ? '正在筛选收藏…' : `找到 ${filtered.length} 本收藏`}</span>
    {(group || query) && <div className={styles.filterSummary}>
      <span>{group === '_ungrouped' ? '未分组' : groups.find(g => g.id === group)?.name || '全部收藏'} · {filtered.length} 本{query.trim() && ` · 搜索「${query.trim()}」`}</span>
      <Button size="sm" variant="ghost" disabled={blocked} onClick={resetFilters}>清除筛选</Button>
    </div>}
    <MotionPresence open={organizing} className={styles.batch} role="region" aria-label="批量整理收藏">
      <div className={styles.batchHeading}>
        <Label className={styles.selectionLabel} htmlFor={`${controlId}-all`}>
          <Checkbox id={`${controlId}-all`} aria-label="选择本页收藏" checked={allVisibleSelected ? true : someVisibleSelected ? 'indeterminate' : false}
            disabled={blocked || filtering || !visible.length} onCheckedChange={selectPage} />选择本页
        </Label>
        <span className={styles.selectionCount} role="status">{selectedIds.length ? `已选 ${selectedIds.length} 本` : '选择要整理的书'}</span>
        <Button size="sm" variant="ghost" disabled={blocked || !selectedIds.length} onClick={() => setSelected([])}>取消选择</Button>
      </div>
      <div className={styles.batchActions}>
        <SearchSelect aria-label="批量操作的分组" className={styles.batchSelect} value={batchGroup} onChange={setBatchGroup}
          placeholder="选择分组" options={groupOptions} searchable searchPlaceholder="查找分组" disabled={blocked || !groupsReady || !selectedIds.length} />
        <Button size="sm" disabled={blocked || !batchGroup || !selectedIds.length} onClick={() => void perform(() => shelfOrganizationApi.edit({ novelIds: selectedIds, addGroupIds: [batchGroup] }, mode), () => setSelected([]))}>加入分组</Button>
        <Button size="sm" variant="secondary" disabled={blocked || !batchGroup || !selectedIds.length} onClick={() => void perform(() => shelfOrganizationApi.edit({ novelIds: selectedIds, removeGroupIds: [batchGroup] }, mode), () => setSelected([]))}>移出分组</Button>
        <Button size="sm" variant="ghost" disabled={blocked || !selectedIds.length} onClick={() => void perform(() => shelfOrganizationApi.edit({ novelIds: selectedIds, pinned: true }, mode), () => setSelected([]))}><Pin size={14} aria-hidden="true" />置顶</Button>
      </div>
    </MotionPresence>
    <div className={`${shelfStyles.grid} ${styles.books}`} id="bookshelfFavorites" aria-busy={filtering || blocked} key={`${group}:${deferredQuery}:${sort}:${currentPage}`}>
      {!visible.length && <EmptyState className={styles.empty} message={favorites.length ? '没有找到这本书' : '还没有收藏小说'}
        hint={favorites.length ? '换个分组或搜索词，找找想读的那一本。' : '收藏喜欢的作品，让想读的故事在这里等你。'} />}
      {visible.map((f, index) => {
        const title = f.title || f.novelTitle || f.novelId
        const selectedBook = selectedIds.includes(f.novelId)
        const position = filtered.indexOf(f)
        const groupNames = groups.filter(g => f.groupIds?.includes(g.id)).map(g => g.name).join(' · ')
        return <div className={styles.book} key={f.novelId} style={{ '--shelf-delay': `${index * 18}ms` } as CSSProperties}>
          {renderBook(f, {
            selected: selectedBook,
            selection: organizing && <Label className={styles.selectionLabel} htmlFor={`${controlId}-${f.novelId}`}>
              <Checkbox id={`${controlId}-${f.novelId}`} checked={selectedBook} disabled={blocked || filtering || (!selectedBook && selectedIds.length >= 100)}
                onCheckedChange={() => toggle(f.novelId)} aria-label={`选择《${title}》`} />{selectedBook ? '已选择' : '选择这本'}
            </Label>,
            badge: f.pinned && <span className={styles.pinned}><Pin size={12} aria-hidden="true" />已置顶</span>,
            menu: <>
              <DropdownMenuItem disabled={blocked || !groupsReady} onSelect={() => openEditor(f)}><PencilLine size={15} aria-hidden="true" />分组与收藏理由</DropdownMenuItem>
              <DropdownMenuItem disabled={blocked} onSelect={() => void perform(() => shelfOrganizationApi.edit({ novelIds: [f.novelId], pinned: !f.pinned }, mode))}>
                {f.pinned ? <PinOff size={15} aria-hidden="true" /> : <Pin size={15} aria-hidden="true" />}{f.pinned ? '取消置顶' : '置顶'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>,
            footer: <div className={styles.annotation}>
              {f.note && <p className={styles.note} title={f.note}>{f.note}</p>}
              <div className={styles.annotationTools}>
                <Button className={styles.annotationEdit} size="sm" variant="ghost" aria-label="分组与收藏理由" title={groupNames || '分组与收藏理由'}
                  disabled={blocked || !groupsReady} onClick={() => openEditor(f)}>
                  <FolderOpen size={14} aria-hidden="true" /><span>{groupNames || (f.note ? '添加分组' : '分组与收藏理由')}</span><PencilLine size={13} aria-hidden="true" />
                </Button>
                {organizing && sort === 'manual' && !query && group !== '_ungrouped' && <div className={styles.reorder}>
                  <Button size="icon-sm" variant="ghost" aria-label={`上移《${title}》`} disabled={blocked || position === 0 || !!filtered[position - 1]?.pinned !== !!f.pinned} onClick={() => void perform(() => shelfOrganizationApi.move(f.novelId, 'up', group, mode))}><ArrowUp size={14} aria-hidden="true" /></Button>
                  <Button size="icon-sm" variant="ghost" aria-label={`下移《${title}》`} disabled={blocked || position === filtered.length - 1 || !!filtered[position + 1]?.pinned !== !!f.pinned} onClick={() => void perform(() => shelfOrganizationApi.move(f.novelId, 'down', group, mode))}><ArrowDown size={14} aria-hidden="true" /></Button>
                </div>}
              </div>
            </div>,
          })}
        </div>
      })}
    </div>
    <Pagination page={currentPage} totalPages={pages} onPage={value => startTransition(() => setPage(value))} busy={blocked || filtering} variant="plain" jump={false} summary={`共 ${filtered.length} 本`} />
    <Dialog open={!!editing} onOpenChange={open => { if (!open && !busy) setEditing(null) }}><ReadingDialog title={editing?.title || editing?.novelTitle || '整理收藏'} description="同一本书可以放进多个分组。收藏理由只有你自己可见。"
      footer={<Button disabled={blocked || note.length > 500} onClick={() => editing && void perform(() => shelfOrganizationApi.edit({ novelIds: [editing.novelId], note, groupIds: memberships, expectedVersion: editing.organizationVersion || 0 }, mode), () => setEditing(null))}>{busy ? '保存中…' : '保存'}</Button>}>
      {errorView}<fieldset className={styles.memberships} disabled={blocked}><legend>放进分组</legend>
        {groups.length ? groups.map(g => <Label key={g.id} htmlFor={`${controlId}-group-${g.id}`}><Checkbox id={`${controlId}-group-${g.id}`} disabled={blocked} checked={memberships.includes(g.id)} onCheckedChange={checked => setMemberships(ids => checked === true ? [...ids, g.id] : ids.filter(id => id !== g.id))} />{g.name}</Label>) : <p>先在「管理分组」里建一个自己的分组。</p>}
      </fieldset>
      <FormField label="我的收藏理由" htmlFor="shelf-note" hint={`${note.length} / 500`}><ReadingDialogEditor id="shelf-note" value={note} onChange={e => setNote(e.target.value)} disabled={blocked} maxLength={500} placeholder="为什么想把这本书留在书架上？" /></FormField>
    </ReadingDialog></Dialog>
    <Dialog open={managing} onOpenChange={open => { if (!busy) { setManaging(open); setDeleting(null) } }}><ReadingDialog title="我的私人分组" description="删除分组会解除归类，书籍和收藏理由都会保留。">
      {errorView}<form className={styles.groupForm} onSubmit={e => { e.preventDefault(); if (!groupName.trim()) return; void perform(() => renameId ? shelfOrganizationApi.rename(renameId, groupName.trim()) : shelfOrganizationApi.create(groupName.trim()), () => { setGroupName(''); setRenameId('') }) }}>
        <label className={styles.search}><span className="sr-only">分组名称</span><Input value={groupName} onChange={e => setGroupName(e.target.value)} maxLength={30} disabled={blocked} placeholder="例如：睡前读、想二刷" /></label>
        <Button disabled={blocked || !groupName.trim()} type="submit">{renameId ? '保存名称' : '新建分组'}</Button>
        {renameId && <Button type="button" variant="ghost" onClick={() => { setRenameId(''); setGroupName('') }}>取消</Button>}
      </form>
      {groups.map(g => <div className={styles.groupRow} key={g.id}><span>{g.name}<small> · {g.count} 本</small></span><span><Button size="sm" variant="ghost" disabled={blocked} onClick={() => { setRenameId(g.id); setGroupName(g.name) }}>改名</Button><Button size="sm" variant="ghost" disabled={blocked} onClick={() => setDeleting(g)}>删除</Button></span></div>)}
      {deleting && <div className={styles.confirm} role="alert"><p>删除「{deleting.name}」分组？其中的书仍会留在书架。</p><Button size="sm" disabled={blocked} onClick={() => void perform(() => shelfOrganizationApi.remove(deleting.id), () => { if (group === deleting.id) filterGroup(''); setDeleting(null) })}>确认删除分组</Button><Button size="sm" variant="ghost" disabled={blocked} onClick={() => setDeleting(null)}>保留</Button></div>}
    </ReadingDialog></Dialog>
  </div>
}
