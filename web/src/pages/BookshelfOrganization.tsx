import { Dialog } from '@/components/ui/dialog'
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, Pin, Settings2 } from 'lucide-react'
import type { BookshelfGroup, ShelfOrganization } from '@shared/bookshelf-organization'
import { shelfOrganizationApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ReadingDialog, ReadingDialogEditor } from '@/components/shared/ReadingDialog'
import Pagination from '@/components/shared/Pagination'
import shelfStyles from './bookshelf.module.css'
import styles from './bookshelf-organization.module.css'

export interface OrganizedFavorite extends ShelfOrganization {
  novelId: string; title?: string; novelTitle?: string; author?: string; updatedAt?: number; progressUpdatedAt?: number
}
interface Props<T extends OrganizedFavorite> {
  favorites: T[]; safeMode: boolean; disabled: boolean
  mutate: (action: () => Promise<unknown>) => Promise<boolean>
  renderBook: (book: T) => ReactNode
}
export default function BookshelfOrganization<T extends OrganizedFavorite>({ favorites, safeMode, disabled, mutate, renderBook }: Props<T>) {
  const [groups, setGroups] = useState<BookshelfGroup[]>([])
  const [group, setGroup] = useState('')
  const [sort, setSort] = useState('manual')
  const [query, setQuery] = useState('')
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
    `${f.title ?? f.novelTitle ?? ''} ${f.author ?? ''} ${f.note ?? ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || (sort === 'title'
      ? (a.title || a.novelTitle || '').localeCompare(b.title || b.novelTitle || '', 'zh-CN')
      : sort === 'recent' ? (b.progressUpdatedAt || 0) - (a.progressUpdatedAt || 0)
      : (a.position || 0) - (b.position || 0) || (b.updatedAt || 0) - (a.updatedAt || 0)))
  const pages = Math.max(1, Math.ceil(filtered.length / 12)), currentPage = Math.min(page, pages)
  const visible = filtered.slice((currentPage - 1) * 12, currentPage * 12)
  const selectedIds = selected.filter(id => favorites.some(f => f.novelId === id))
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
  function filterGroup(value: string) { setGroup(value); setPage(1); setSelected([]) }
  function openEditor(book: T) { setEditing(book); setNote(book.note || ''); setMemberships(book.groupIds || []); setError('') }
  function toggle(id: string) { setSelected(ids => ids.includes(id) ? ids.filter(x => x !== id) : ids.length < 100 ? [...ids, id] : ids) }
  const errorView = error && <p className={styles.error} role="alert">{error}</p>
  return <div className={styles.organizer} aria-busy={blocked}>
    <div className={styles.toolbar}>
      <label className={styles.search}><span className="sr-only">搜索收藏与备注</span><Input value={query} placeholder="找一本书，或一句收藏理由" onChange={e => { setQuery(e.target.value); setPage(1); setSelected([]) }} disabled={blocked} /></label>
      <label><span className="sr-only">私人分组</span><select value={group} onChange={e => filterGroup(e.target.value)} disabled={blocked || !groupsReady}>
        <option value="">全部收藏</option><option value="_ungrouped">未分组</option>
        {groups.map(g => <option key={g.id} value={g.id}>{g.name} · {g.count}</option>)}
      </select></label>
      <label><span className="sr-only">收藏排序</span><select value={sort} onChange={e => { setSort(e.target.value); setPage(1) }} disabled={blocked}>
        <option value="manual">我的顺序</option><option value="recent">最近阅读</option><option value="title">书名</option>
      </select></label>
      <Button variant="secondary" size="sm" disabled={blocked || !groupsReady} onClick={() => { setManaging(true); setError('') }}><Settings2 size={15} />管理分组</Button>
    </div>
    {groupError && <div role="alert"><span>{groupError}</span><Button size="sm" variant="ghost" disabled={blocked} onClick={() => setGroupRetry(value => value + 1)}>重试分组</Button></div>}
    {!editing && !managing && errorView}
    {selectedIds.length > 0 && <div className={styles.batch} role="region" aria-label="批量整理收藏">
      <span>已选 {selectedIds.length} 本</span>
      <label><span className="sr-only">批量操作的分组</span><select value={batchGroup} onChange={e => setBatchGroup(e.target.value)} disabled={blocked}><option value="">选择分组</option>{groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
      <Button size="sm" disabled={blocked || !batchGroup} onClick={() => void perform(() => shelfOrganizationApi.edit({ novelIds: selectedIds, addGroupIds: [batchGroup] }, mode), () => setSelected([]))}>加入分组</Button>
      <Button size="sm" variant="secondary" disabled={blocked || !batchGroup} onClick={() => void perform(() => shelfOrganizationApi.edit({ novelIds: selectedIds, removeGroupIds: [batchGroup] }, mode), () => setSelected([]))}>移出分组</Button>
      <Button size="sm" variant="secondary" disabled={blocked} onClick={() => void perform(() => shelfOrganizationApi.edit({ novelIds: selectedIds, pinned: true }, mode), () => setSelected([]))}>置顶</Button>
      <Button size="sm" variant="ghost" disabled={blocked} onClick={() => setSelected([])}>取消选择</Button>
    </div>}
    <div className={shelfStyles.grid} id="bookshelfFavorites" key={`${group}:${query}:${sort}:${currentPage}`}>
      {!visible.length && <p className="profile-empty-note">{favorites.length ? '这里还没有匹配的收藏，换个分组或搜索词试试。' : '还没有收藏小说'}</p>}
      {visible.map((f, index) => <div className={styles.book} key={f.novelId} style={{ '--shelf-delay': `${index * 18}ms` } as CSSProperties}>
        <div className={styles.bookTools}>
          <label><input type="checkbox" checked={selectedIds.includes(f.novelId)} disabled={blocked || (!selectedIds.includes(f.novelId) && selectedIds.length >= 100)} onChange={() => toggle(f.novelId)} aria-label={`选择《${f.title || f.novelTitle}》`} />整理</label>
          <button type="button" className={styles.pin} aria-label={f.pinned ? '取消置顶' : '置顶'} aria-pressed={!!f.pinned} disabled={blocked} onClick={() => void perform(() => shelfOrganizationApi.edit({ novelIds: [f.novelId], pinned: !f.pinned }, mode))}><Pin size={14} />{f.pinned ? '已置顶' : '置顶'}</button>
        </div>
        {renderBook(f)}
        <div className={styles.annotation}>
          {f.note && <p title={f.note}>{f.note}</p>}
          {!!f.groupIds?.length && <small>{groups.filter(g => f.groupIds?.includes(g.id)).map(g => g.name).join(' · ')}</small>}
          <div className={styles.bookTools}>
            <Button size="sm" variant="ghost" disabled={blocked || !groupsReady} onClick={() => openEditor(f)}>分组与收藏理由</Button>
            {sort === 'manual' && !query && group !== '_ungrouped' && <span>
              <Button size="sm" variant="ghost" aria-label={`上移《${f.title || f.novelTitle}》`} disabled={blocked || filtered.indexOf(f) === 0 || filtered[filtered.indexOf(f) - 1]?.pinned !== f.pinned} onClick={() => void perform(() => shelfOrganizationApi.move(f.novelId, 'up', group, mode))}><ArrowUp size={14} /></Button>
              <Button size="sm" variant="ghost" aria-label={`下移《${f.title || f.novelTitle}》`} disabled={blocked || filtered.indexOf(f) === filtered.length - 1 || filtered[filtered.indexOf(f) + 1]?.pinned !== f.pinned} onClick={() => void perform(() => shelfOrganizationApi.move(f.novelId, 'down', group, mode))}><ArrowDown size={14} /></Button>
            </span>}
          </div>
        </div>
      </div>)}
    </div>
    <Pagination page={currentPage} totalPages={pages} onPage={setPage} busy={blocked} variant="plain" jump={false} summary={`共 ${filtered.length} 本`} />
    <Dialog open={!!editing} onOpenChange={open => { if (!open && !busy) setEditing(null) }}><ReadingDialog title={editing?.title || editing?.novelTitle || '整理收藏'} description="同一本书可以放进多个分组。收藏理由只有你自己可见。"
      footer={<Button disabled={blocked || note.length > 500} onClick={() => editing && void perform(() => shelfOrganizationApi.edit({ novelIds: [editing.novelId], note, groupIds: memberships, expectedVersion: editing.organizationVersion || 0 }, mode), () => setEditing(null))}>{busy ? '保存中…' : '保存'}</Button>}>
      {errorView}<fieldset className={styles.memberships} disabled={blocked}><legend>放进分组</legend>
        {groups.length ? groups.map(g => <label key={g.id}><input type="checkbox" checked={memberships.includes(g.id)} onChange={e => setMemberships(ids => e.target.checked ? [...ids, g.id] : ids.filter(id => id !== g.id))} />{g.name}</label>) : <p>先在「管理分组」里建一个自己的分组。</p>}
      </fieldset>
      <label htmlFor="shelf-note">我的收藏理由</label><ReadingDialogEditor id="shelf-note" value={note} onChange={e => setNote(e.target.value)} disabled={blocked} maxLength={500} placeholder="为什么想把这本书留在书架上？" /><small>{note.length} / 500</small>
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
