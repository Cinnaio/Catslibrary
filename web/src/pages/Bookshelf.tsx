import { Spinner } from '@/components/ui/spinner'
import '@/styles/account-content.css'
import { Button } from '@/components/ui/button'
import Pagination from '@/components/shared/Pagination'
import cardStyles from '../components/novel-card.module.css'
import styles from './account.module.css'
import shelfStyles from './bookshelf.module.css'
import { useVisibleRefresh } from '../hooks/useVisibleRefresh'
/**
 * 书架页 —— 收藏、最近阅读、书签、想法、手动同步（由 Novel-KV js/bookshelf.js 平移）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { MoreHorizontal } from 'lucide-react'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '../components/ui/dropdown-menu'
import type { ReadingHistoryEntry, Thought } from '@shared/types'
import { bookmarksApi, bookshelfApi, getToken, progressApi } from '../lib/api'
import { applyProgressState } from '../lib/progress-state'
import {
  clearHistory,
  getAllBookmarks,
  getStorageScope,
  getNovelHistory,
  getRecentHistory,
  removeFromBookshelf,
  replaceAllBookmarks,
  replaceBookshelf,
  saveHistory,
} from '../lib/storage'
import { useSession } from '../context/SessionContext'
import { useContentPolicy } from '../context/ContentPolicyContext'
import { useToast } from '../components/feedback'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { timeAgo } from '../lib/format'
import { coverUrl } from '../lib/cover-url'

interface Favorite {
  novelId: string
  title?: string
  author?: string
  chapterCount?: number
  updatedAt?: number
  novelTitle?: string
  chapterId?: string
  chapterTitle?: string
  novelUpdatedAt?: number
  progressUpdatedAt?: number
}

type ShelfThought = Thought & { novelTitle?: string; chapterTitle?: string }

interface ServerRecent {
  novelId: string
  novelTitle?: string
  chapterId?: string
  chapterTitle?: string
  chapterOrder?: number
  updatedAt?: number
  pageMode?: string
  pageIndex?: number
  pagePercent?: number
  scrollPercent?: number
  timestamp?: number
}

function normalizeRecent(item: ServerRecent | ReadingHistoryEntry | undefined | null): ReadingHistoryEntry | null {
  if (!item || !item.novelId) return null
  const s = item as ServerRecent
  return {
    novelId: item.novelId,
    novelTitle: item.novelTitle || '',
    chapterId: item.chapterId || '',
    chapterTitle: item.chapterTitle || '',
    chapterOrder: item.chapterOrder || 0,
    scrollPercent: s.scrollPercent || 0,
    pageMode: s.pageMode || '',
    pageIndex: s.pageIndex || 0,
    pagePercent: s.pagePercent || 0,
    timestamp: Number(s.updatedAt || s.timestamp || 0) || 0,
  }
}

function mergeRecent(local: ReadingHistoryEntry[], server: ServerRecent[], limit: number): ReadingHistoryEntry[] {
  const byNovel = new Map<string, ReadingHistoryEntry>()
  function add(item: ServerRecent | ReadingHistoryEntry | null) {
    const norm = normalizeRecent(item)
    if (!norm) return
    const existing = byNovel.get(norm.novelId)
    if (!existing || norm.timestamp >= existing.timestamp) {
      byNovel.set(norm.novelId, { ...(existing || {}), ...norm })
    }
  }
  local.forEach(add)
  server.forEach(add)
  return [...byNovel.values()].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).slice(0, limit)
}

export default function Bookshelf() {
  const navigate = useNavigate()
  const [viewParams, setViewParams] = useSearchParams()
  const { user, loading } = useSession()
  const { safeMode } = useContentPolicy()
  const { toast } = useToast()
  useDocumentTitle('我的书架')

  const [favorites, setFavorites] = useState<Favorite[]>([])
  const [recent, setRecent] = useState<ReadingHistoryEntry[]>([])
  const [bookmarks, setBookmarks] = useState<ReturnType<typeof getAllBookmarks>>([])
  const [thoughts, setThoughts] = useState<ShelfThought[]>([])
  const [syncStatus, setSyncStatus] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [loadedMode, setLoadedMode] = useState<boolean | null>(null)
  const shelfView = viewParams.get('view') || 'favorites'
  const activeShelf = ['favorites', 'recent', 'bookmarks', 'thoughts'].includes(shelfView) ? shelfView : 'favorites'
  const setActiveShelf = (view: string) => {
    const next = new URLSearchParams(viewParams)
    if (view === 'favorites') next.delete('view')
    else next.set('view', view)
    setViewParams(next)
  }
  const loadRevision = useRef(0)
  const activeLoad = useRef<number | null>(null)
  const contextRevision = useRef(0)
  const pendingMutations = useRef(new Set<string>())
  const [pending, setPending] = useState(new Set<string>())
  const [pages, setPages] = useState<Record<string, number>>({})
  const page = pages[activeShelf] || 1
  const pageSize = 12

  useEffect(() => {
    contextRevision.current++
    pendingMutations.current.clear()
    setPending(new Set())
    if (!loading && !user) {
      navigate('/auth', { replace: true, state: { from: `/bookshelf${viewParams.size ? '?' + viewParams.toString() : ''}` } })
      return
    }
    setFavorites([])
    setBookmarks([])
    setRecent([])
    setPages({})
    setThoughts([])
    setSyncStatus('')
    setSyncing(false)
    if (user) void loadAll()
    return () => { loadRevision.current++; contextRevision.current++ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, loading, safeMode])

  const loadAll = useCallback(async (background = false) => {
    if (background && (pendingMutations.current.size > 0 || activeLoad.current === loadRevision.current)) return
    const token = getToken()
    const scope = getStorageScope()
    if (!token || scope === 'pending') return
    const seq = ++loadRevision.current
    activeLoad.current = seq
    const current = () => seq === loadRevision.current && token === getToken() && scope === getStorageScope()
    if (!background) setSyncing(true)
    try {
      const [bookmarkData, shelfData, progressData] = await Promise.all([
        bookmarksApi.list(safeMode ? 'safe' : 'adult'), bookshelfApi.get({ limit: 50, contentMode: safeMode ? 'safe' : 'adult' }), progressApi.recent(8, safeMode ? 'safe' : 'adult'),
      ])
      if (!current()) return
      const allFavorites = [...shelfData.favorites]
      const allThoughts = [...shelfData.thoughts]
      const maximum = Math.max(shelfData.totals?.favorites || 0, shelfData.totals?.thoughts || 0)
      for (let offset = 50; offset < maximum; offset += 50) {
        const next = await bookshelfApi.get({ limit: 50, offset, contentMode: safeMode ? 'safe' : 'adult' })
        if (!current()) return
        allFavorites.push(...next.favorites); allThoughts.push(...next.thoughts)
      }
      // 云端为权威；读取操作不向服务端写回旧缓存。
      replaceAllBookmarks(bookmarkData.bookmarks)
      replaceBookshelf(allFavorites as Favorite[])
      progressData.tombstones.forEach(t => {
        applyProgressState(t.novelId, { progress: null, tombstone: t })
      })
      const visibleIds = new Set(progressData.progress.map(p => p.novelId))
      // 列表成员以云端为准，缓存只补充仍在列表中的阅读位置。
      // 未返回的记录可能已删除、受限或不在最近八本内，不能重新并入。
      const localRecent = getRecentHistory(Number.MAX_SAFE_INTEGER).filter(h => visibleIds.has(h.novelId))
      const recentList = mergeRecent(localRecent, progressData.progress, 8)
      recentList.forEach(h => saveHistory(h.novelId, h))
      setRecent(recentList)
      setBookmarks(getAllBookmarks())
      // 保留云端章节字段；本机收藏镜像只有基础书目，不能作为阅读状态来源。
      setFavorites(allFavorites as Favorite[])
      setThoughts(allThoughts as ShelfThought[])
      setLoadedMode(safeMode)
      setSyncStatus(`上次同步 · ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`)
    } catch (err) {
      if (current() && !background) setSyncStatus(`同步失败：${(err as Error).message || '请稍后重试'}`)
    } finally {
      if (activeLoad.current === seq) activeLoad.current = null
      if (current() && !background) setSyncing(false)
    }
  }, [safeMode])
  const refreshShelf = useCallback(() => loadAll(true), [loadAll])
  useVisibleRefresh(refreshShelf, !!user && !loading)


  async function manualSync() {
    setSyncStatus('正在同步…')
    await loadAll()
  }

  function beginMutation(novelId: string) {
    if (pendingMutations.current.size > 0) return null
    const token = getToken()
    const scope = getStorageScope()
    const revision = contextRevision.current
    if (!token || scope === 'pending') return null
    const current = () => revision === contextRevision.current && token === getToken() && scope === getStorageScope()
    pendingMutations.current.add(novelId)
    setPending(new Set(pendingMutations.current))
    loadRevision.current++
    setSyncing(false)
    return current
  }

  function finishMutation(novelId: string, current: () => boolean) {
    if (!current()) return
    loadRevision.current++
    pendingMutations.current.delete(novelId)
    setPending(new Set(pendingMutations.current))
    setSyncing(false)
  }

  async function addFavorite(novelId: string, allowed: () => boolean = () => true) {
    if (!allowed()) return
    const current = beginMutation(novelId)
    if (!current) return
    try {
      await bookshelfApi.add(novelId)
      if (!current()) return
      finishMutation(novelId, current)
      await loadAll()
      if (current()) toast('已加入收藏', 'success')
    } catch (err) {
      if (current()) toast((err as Error).message || '收藏失败，请重试', 'error')
    } finally { finishMutation(novelId, current) }
  }

  async function deleteFavorite(novelId: string) {
    if (!novelId) return
    const current = beginMutation(novelId)
    if (!current) return
    try {
      await bookshelfApi.remove(novelId)
      if (!current()) return
      removeFromBookshelf(novelId)
      setFavorites(items => items.filter(item => item.novelId !== novelId))
      toast('已移出书架', 'success', { action: { label: '撤销', onClick: () => { void addFavorite(novelId, current) } } })
    } catch (err) {
      if (current()) toast((err as Error).message || '移出书架失败，请重试', 'error')
    } finally { finishMutation(novelId, current) }
  }

  async function restoreRecent(entry: ReadingHistoryEntry, deletedAt: number, allowed: () => boolean) {
    if (!allowed()) return
    const current = beginMutation(entry.novelId)
    if (!current) return
    try {
      // 仅比本次删除更新一个版本，让删除之后的跨设备阅读/删除继续获胜。
      const state = await progressApi.save({ novelId: entry.novelId, chapterId: entry.chapterId, scrollPercent: entry.scrollPercent, clientUpdatedAt: deletedAt + 1 })
      if (!current()) return
      const sameChapter = state.progress?.chapterId === entry.chapterId
      applyProgressState(entry.novelId, state, {
        novelTitle: entry.novelTitle,
        ...(sameChapter ? { chapterTitle: entry.chapterTitle, chapterOrder: entry.chapterOrder, pageMode: entry.pageMode, pageIndex: entry.pageIndex, pagePercent: entry.pagePercent } : {}),
      })
      finishMutation(entry.novelId, current)
      await loadAll()
      if (current()) toast(state.skipped ? '阅读记录已变化，保留较新的状态' : '已恢复阅读记录', state.skipped ? 'default' : 'success')
    } catch (err) {
      if (current()) toast('恢复阅读记录失败：' + (err as Error).message, 'error')
    } finally { finishMutation(entry.novelId, current) }
  }

  async function deleteRecent(novelId: string) {
    if (!novelId) return
    const current = beginMutation(novelId)
    if (!current) return
    const entry = recent.find(item => item.novelId === novelId)
    try {
        const state = await progressApi.remove(novelId)
        if (!current()) return
        loadRevision.current++
        setSyncing(false)
        applyProgressState(novelId, state)
        // 已删书的幂等删除可能没有墓碑；确认成功后也要清理本机记录。
        if (!state.skipped && !state.progress) clearHistory(novelId)
        setRecent(previous => previous.flatMap(h => {
          const local = getNovelHistory(h.novelId)
          return local ? [local] : []
        }))
        setFavorites(items => items.map(f => f.novelId !== novelId ? f : {
          ...f, chapterId: state.progress?.chapterId || '',
          chapterTitle: state.progress?.chapterId === f.chapterId ? f.chapterTitle : '',
          progressUpdatedAt: state.progress?.updatedAt || 0,
        }))
        const deletedAt = Number(state.tombstone?.updatedAt || state.tombstone?.deletedAt || 0)
        if (!state.skipped && deletedAt && entry?.chapterId) {
          toast('阅读记录已删除', 'success', { action: { label: '撤销', onClick: () => { void restoreRecent(entry, deletedAt, current) } } })
        } else {
          toast(state.skipped ? '阅读位置已更新，保留较新的记录' : '阅读记录已删除', state.skipped ? 'default' : 'success')
        }
    } catch (err) {
      if (current()) toast('删除阅读记录失败：' + (err as Error).message, 'error')
    } finally { finishMutation(novelId, current) }
  }

  if (loading) {
    return (
      <div className="loading-center" style={{ minHeight: '50vh' }}>
        <Spinner size="lg"  />
      </div>
    )
  }

  const recentItems = recent.slice(0, 8)
  const total = activeShelf === 'favorites' ? favorites.length : activeShelf === 'bookmarks' ? bookmarks.length : activeShelf === 'thoughts' ? thoughts.length : recentItems.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const visiblePage = Math.min(page, totalPages)
  const start = (visiblePage - 1) * pageSize

  return (
    <main className={`${styles.shelf} bookshelf-page`}>
      <div className={`container bookshelf-shell ${shelfStyles.layout}`}>
        <section className="bookshelf-hero">
          <div>
            <h1>{activeShelf === 'recent' ? '阅读记录' : '我的书架'}</h1>
            <p className="text-muted">收藏、继续阅读、书签与想法都收在这里。</p>
          </div>
          <div className="profile-sync-card">
            <span className="text-sm text-muted" id="syncStatusText" role="status" aria-live="polite">
              {syncStatus}
            </span>
            <Button variant="secondary" size="sm"  id="btnSyncNow" disabled={syncing || pending.size > 0} onClick={() => void manualSync()}>
              {syncing ? '同步中…' : '立即同步'}
            </Button>
          </div>
        </section>

        <nav className="bookshelf-tabs" aria-label="书架内容">
          {[
            { id: 'favorites', label: '收藏', count: favorites.length },
            { id: 'recent', label: '最近阅读', count: recentItems.length },
            { id: 'bookmarks', label: '书签', count: bookmarks.length },
            { id: 'thoughts', label: '想法', count: thoughts.length },
          ].map((item) => (
            <button type="button" key={item.id} className="bookshelf-tab" aria-pressed={activeShelf === item.id} onClick={() => setActiveShelf(item.id)}>
              {item.label}
              <span>{item.count}</span>
            </button>
          ))}
        </nav>

        {/* 收藏 */}
        <section className="bookshelf-section" hidden={activeShelf !== 'favorites' || loadedMode !== safeMode}>
          <div className="bookshelf-sections">
            <h2 className="bookshelf-subtitle sr-only">
              收藏 <span className="text-muted">· {favorites.length}</span>
            </h2>
            <div className={shelfStyles.grid} id="bookshelfFavorites" aria-busy={syncing} key={`favorites-${visiblePage}`}>
              {favorites.length === 0 ? (
                <p className="profile-empty-note">还没有收藏小说</p>
              ) : (
                favorites.slice(start, start + pageSize).map((f) => {
                  const latest = recent.find(h => h.novelId === f.novelId)
                  const reading = latest && latest.timestamp >= (f.progressUpdatedAt || 0) ? latest : f
                  return <ShelfBookCard key={f.novelId} novelId={f.novelId} title={f.title || f.novelTitle || f.novelId}
                    author={f.author} coverUpdatedAt={f.novelUpdatedAt} reading={reading} favorite
                    time={f.updatedAt ? `收藏于 ${timeAgo(f.updatedAt)}` : undefined}
                    pending={pending.size > 0} onRemove={() => void deleteFavorite(f.novelId)} />
                })
              )}
            </div>
          </div>
        </section>

        {/* 最近阅读 */}
        <section className="bookshelf-section" hidden={activeShelf !== 'recent' || loadedMode !== safeMode}>
          <div className="bookshelf-sections">
            <h2 className="bookshelf-subtitle sr-only">
              最近阅读 <span className="text-muted">· {recentItems.length}</span>
            </h2>
            <div className={shelfStyles.grid} id="bookshelfRecent" aria-busy={syncing}>
              {recentItems.length === 0 ? (
                <p className="profile-empty-note">还没有阅读记录</p>
              ) : (
                recentItems.map(h => <ShelfBookCard key={h.novelId} novelId={h.novelId} title={h.novelTitle || h.novelId}
                  reading={h} recentView favorite={favorites.some(f => f.novelId === h.novelId)}
                  time={h.timestamp ? `上次阅读 · ${timeAgo(h.timestamp)}` : '上次阅读时间未知'}
                  pending={pending.size > 0} onRemove={() => void deleteRecent(h.novelId)}
                  onFavorite={() => void addFavorite(h.novelId)} />)
              )}
            </div>
          </div>
        </section>

        {/* 书签 */}
        <section className="bookshelf-section" hidden={activeShelf !== 'bookmarks' || loadedMode !== safeMode}>
          <h2 className="bookshelf-subtitle sr-only">
            书签 <span className="text-muted">· {bookmarks.length}</span>
          </h2>
          <div className="bookshelf-record-panel" id="bookshelfBookmarks">
            {bookmarks.length === 0 ? (
              <p className="profile-empty-note">还没有添加书签</p>
            ) : (
              bookmarks.slice(start, start + pageSize).map((b) => (
                <div className="bookshelf-item-wrap" key={b.id}>
                  <Link className="bookshelf-item" to={`/read/${encodeURIComponent(b.novelId)}/${encodeURIComponent(b.chapterId)}`}>
                    <strong className="bookshelf-item__title">{b.novelTitle || b.novelId}</strong>
                    <span className="bookshelf-item__meta">{b.chapterTitle || ''}</span>
                  </Link>
                </div>
              ))
            )}
          </div>
        </section>

        {/* 想法 */}
        <section className="bookshelf-section" hidden={activeShelf !== 'thoughts' || loadedMode !== safeMode}>
          <h2 className="bookshelf-subtitle sr-only">
            想法 <span className="text-muted">· {thoughts.length}</span>
          </h2>
          <div className="bookshelf-record-panel" id="bookshelfThoughts">
            {thoughts.length === 0 ? (
              <p className="profile-empty-note">还没有写下想法</p>
            ) : (
              thoughts.slice(start, start + pageSize).map((t) => (
                <div className="bookshelf-item-wrap" key={t.id}>
                  <Link
                    className="bookshelf-item"
                    to={`/read/${encodeURIComponent(t.novelId)}/${encodeURIComponent(t.chapterId)}?thoughtParagraph=${encodeURIComponent(t.paragraphIndex)}&thoughtId=${encodeURIComponent(t.id)}`}
                  >
                    <strong className="bookshelf-item__title">{t.thoughtText}</strong>
                    <span className="bookshelf-item__meta">{t.novelTitle || t.chapterTitle || timeAgo(t.createdAt)}</span>
                  </Link>
                </div>
              ))
            )}
          </div>
        </section>
        {totalPages > 1 && <Pagination variant="plain" ariaLabel="书架分页" page={visiblePage} totalPages={totalPages} busy={syncing} jump={false} summary={`共 ${total} 条`} onPage={page => setPages(current => ({ ...current, [activeShelf]: page }))} />}
      </div>
    </main>
  )
}

function ShelfBookCard({ novelId, title, author, coverUpdatedAt, reading, favorite, recentView, time, pending, onRemove, onFavorite }: {
  novelId: string; title: string; author?: string; coverUpdatedAt?: number
  reading: { chapterId?: string; chapterTitle?: string }; favorite: boolean; recentView?: boolean
  time?: string; pending: boolean; onRemove: () => void; onFavorite?: () => void
}) {
  const detail = `/novel/${encodeURIComponent(novelId)}`
  const resume = reading.chapterId ? `/read/${encodeURIComponent(novelId)}/${encodeURIComponent(reading.chapterId)}` : detail
  const target = recentView ? resume : detail
  const positionLabel = reading.chapterId ? `读至 ${reading.chapterTitle || '上次阅读的章节'}` : '尚未开始阅读'
  return <article className={`${cardStyles.card} ${shelfStyles.card}`} aria-label={title} aria-busy={pending}>
    <Link to={target} className={shelfStyles.coverLink} aria-label={`${recentView ? '继续阅读' : '查看作品'}《${title}》封面`}>
      <CoverOrPlaceholder novelId={novelId} title={title} updatedAt={coverUpdatedAt} />
    </Link>
    <div className={shelfStyles.body}>
      <div className={shelfStyles.heading}>
        <Link to={target} className={shelfStyles.title} title={title}>{title}</Link>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><button type="button" className={shelfStyles.more} aria-label={`更多操作：《${title}》`} disabled={pending}><MoreHorizontal size={16} aria-hidden="true" /></button></DropdownMenuTrigger>
          <DropdownMenuContent align="end"><DropdownMenuItem variant="destructive" onSelect={onRemove}>{recentView ? '清除记录' : '取消收藏'}</DropdownMenuItem></DropdownMenuContent>
        </DropdownMenu>
      </div>
      {!recentView && <p className={shelfStyles.meta} title={author || '作者未知'}>{author || '作者未知'}</p>}
      <p className={shelfStyles.position} title={positionLabel}>{positionLabel}</p>
      {recentView && <p className={shelfStyles.meta} title={time}>{time}</p>}
      <div className={shelfStyles.footer}>
        {recentView ? favorite ? <span className={shelfStyles.meta}>已收藏</span> : <button type="button" className={shelfStyles.favorite} disabled={pending} onClick={onFavorite}>加入收藏</button> : <span className={shelfStyles.meta} title={time || '收藏时间未知'}>{time || '收藏时间未知'}</span>}
        <Button asChild size="sm" variant={reading.chapterId ? 'default' : 'secondary'}><Link to={resume} aria-label={`${reading.chapterId ? '继续阅读' : '查看作品'}《${title}》`}>{reading.chapterId ? '继续阅读' : '查看作品'}</Link></Button>
      </div>
    </div>
  </article>
}

function CoverOrPlaceholder({ novelId, title, updatedAt }: { novelId: string; title: string; updatedAt?: number }) {
  const src = coverUrl({ id: novelId, updatedAt })
  const [failed, setFailed] = useState(false)
  const hasCover = !!src && !failed
  return (
    <div className={`novel-card__cover${hasCover ? '' : ' novel-card__cover--placeholder'}`}>
      {hasCover ? (
        <img src={src} alt={title} loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <span className="novel-card__cover-char">{(title || '书').slice(0, 1)}</span>
      )}
    </div>
  )
}
