/**
 * 书架页 —— 收藏、最近阅读、书签、想法、手动同步（由 Novel-KV js/bookshelf.js 平移）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { ReadingHistoryEntry, Thought } from '@shared/types'
import { bookmarksApi, bookshelfApi, getToken, progressApi } from '../lib/api'
import { applyProgressState } from '../lib/progress-state'
import {
  clearHistory,
  getAllBookmarks,
  getStorageScope,
  getBookshelf,
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
import NovelCoverStatus from '../components/NovelCoverStatus'
import { coverUrl } from '../components/NovelCard'

interface Favorite {
  novelId: string
  title?: string
  author?: string
  chapterCount?: number
  updatedAt?: number
  novelTitle?: string
  chapterId?: string
  chapterTitle?: string
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
  const [activeShelf, setActiveShelf] = useState('favorites')
  const loadRevision = useRef(0)
  const [pages, setPages] = useState<Record<string, number>>({})
  const page = pages[activeShelf] || 1
  const pageSize = 12

  useEffect(() => {
    if (!loading && !user) {
      navigate('/auth', { replace: true, state: { from: '/bookshelf' } })
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
    return () => { loadRevision.current++ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, loading, safeMode])

  const loadAll = useCallback(async () => {
    const seq = ++loadRevision.current
    const token = getToken()
    const scope = getStorageScope()
    const current = () => seq === loadRevision.current && token === getToken() && scope === getStorageScope()
    if (!token || scope === 'pending') return
    setSyncing(true)
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
        const h = getRecentHistory(100).find(x => x.novelId === t.novelId)
        if (h && Number(t.updatedAt || 0) >= h.timestamp) clearHistory(t.novelId)
      })
      const visibleIds = new Set(progressData.progress.map(p => p.novelId))
      const localRecent = getRecentHistory(8).filter(h => !safeMode || visibleIds.has(h.novelId))
      const recentList = mergeRecent(localRecent, progressData.progress, 8)
      recentList.forEach(h => saveHistory(h.novelId, h))
      setRecent(recentList)
      setBookmarks(getAllBookmarks())
      setFavorites(getBookshelf())
      setThoughts(allThoughts as ShelfThought[])
      setLoadedMode(safeMode)
      setSyncStatus(`上次同步 · ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`)
    } catch (err) {
      if (current()) setSyncStatus(`同步失败：${(err as Error).message || '请稍后重试'}`)
    } finally {
      if (current()) setSyncing(false)
    }
  }, [safeMode])

  async function manualSync() {
    setSyncing(true)
    setSyncStatus('正在同步…')
    try {
      await loadAll()
    } catch {
      /* loadAll 已设失败信息 */
    } finally {
      setSyncing(false)
    }
  }

  async function deleteFavorite(novelId: string) {
    if (!novelId) return
    loadRevision.current++
    setSyncing(false)
    const token = getToken()
    const scope = getStorageScope()
    try {
      if (token) await bookshelfApi.remove(novelId)
      if (token !== getToken() || scope !== getStorageScope()) return
      removeFromBookshelf(novelId)
      setFavorites(getBookshelf())
      toast('已移出书架', 'success')
    } catch (err) { toast((err as Error).message || '移出书架失败，请重试', 'error') }
  }

  async function deleteRecent(novelId: string) {
    if (!novelId) return
    const token = getToken()
    const scope = getStorageScope()
    try {
      if (token) {
        const state = await progressApi.remove(novelId)
        if (token !== getToken() || scope !== getStorageScope()) return
        applyProgressState(novelId, state)
        setRecent(previous => getRecentHistory(8).filter(h => !safeMode || previous.some(p => p.novelId === h.novelId)))
        toast(state.skipped ? '阅读位置已更新，保留较新的记录' : '阅读记录已删除', state.skipped ? 'default' : 'success')
      } else {
        clearHistory(novelId)
        setRecent(getRecentHistory(8))
        toast('阅读记录已删除', 'success')
      }
    } catch (err) {
      if (token === getToken() && scope === getStorageScope()) toast('删除阅读记录失败：' + (err as Error).message, 'error')
    }
  }

  if (loading) {
    return (
      <div className="loading-center" style={{ minHeight: '50vh' }}>
        <div className="spinner spinner--lg"></div>
      </div>
    )
  }

  const recentItems = recent.slice(0, 8)
  const total = activeShelf === 'favorites' ? favorites.length : activeShelf === 'bookmarks' ? bookmarks.length : activeShelf === 'thoughts' ? thoughts.length : recentItems.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const visiblePage = Math.min(page, totalPages)
  const start = (visiblePage - 1) * pageSize

  return (
    <main className="bookshelf-page">
      <div className="container bookshelf-shell">
        <section className="bookshelf-hero">
          <div>
            <h1>我的书架</h1>
            <p className="text-muted">收藏、继续阅读、书签与想法都收在这里。</p>
          </div>
          <div className="profile-sync-card">
            <span className="text-sm text-muted" id="syncStatusText" role="status" aria-live="polite">
              {syncStatus}
            </span>
            <button className="btn btn--secondary btn--sm" id="btnSyncNow" disabled={syncing} onClick={() => void manualSync()}>
              {syncing ? '同步中…' : '立即同步'}
            </button>
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
            <div className="bookshelf-novel-grid" id="bookshelfFavorites">
              {favorites.length === 0 ? (
                <p className="profile-empty-note">还没有收藏小说</p>
              ) : (
                favorites.slice(start, start + pageSize).map((f) => (
                  <div className="bookshelf-novel-card" key={f.novelId}>
                    <Link to={`/novel/${encodeURIComponent(f.novelId)}`} className="novel-card">
                      <CoverOrPlaceholder novelId={f.novelId} title={f.title || f.novelTitle || f.novelId} updatedAt={f.updatedAt} favorite />
                      <div className="novel-card__body">
                        <div className="novel-card__title">{f.title || f.novelTitle || f.novelId}</div>
                        <div className="novel-card__meta">{f.chapterTitle ? `继续：${f.chapterTitle}` : f.author || '未开始阅读'}</div>
                        {f.updatedAt ? <div className="novel-card__time">{timeAgo(f.updatedAt)}</div> : null}
                      </div>
                    </Link>
                    <button className="bookshelf-card-action" aria-label="取消收藏" onClick={() => void deleteFavorite(f.novelId)}>
                      取消收藏
                    </button>
                  </div>
                ))
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
            <div className="bookshelf-novel-grid" id="bookshelfRecent">
              {recentItems.length === 0 ? (
                <p className="profile-empty-note">还没有阅读记录</p>
              ) : (
                recentItems.map((h) => (
                  <div className="bookshelf-novel-card" key={h.novelId}>
                    <Link
                      to={h.chapterId ? `/read/${encodeURIComponent(h.novelId)}/${encodeURIComponent(h.chapterId)}` : `/novel/${encodeURIComponent(h.novelId)}`}
                      className="novel-card"
                    >
                      <CoverOrPlaceholder novelId={h.novelId} title={h.novelTitle || h.novelId} updatedAt={h.timestamp} read favorite={favorites.some((item) => item.novelId === h.novelId)} />
                      <div className="novel-card__body">
                        <div className="novel-card__title">{h.novelTitle || h.novelId}</div>
                        <div className="novel-card__meta">{h.chapterTitle || '继续阅读'}</div>
                        <div className="novel-card__time">{timeAgo(h.timestamp)}</div>
                      </div>
                    </Link>
                    <button className="bookshelf-card-action" aria-label="清除记录" onClick={() => void deleteRecent(h.novelId)}>
                      清除记录
                    </button>
                  </div>
                ))
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
        {totalPages > 1 && <nav className="home-pagination" aria-label="书架分页">
          <button className="btn btn--secondary" disabled={visiblePage <= 1 || syncing} onClick={() => setPages(p => ({ ...p, [activeShelf]: visiblePage - 1 }))}>上一页</button>
          <span>第 {visiblePage} / {totalPages} 页 · 共 {total} 条</span>
          <button className="btn btn--secondary" disabled={visiblePage >= totalPages || syncing} onClick={() => setPages(p => ({ ...p, [activeShelf]: visiblePage + 1 }))}>下一页</button>
        </nav>}
      </div>
    </main>
  )
}

function CoverOrPlaceholder({ novelId, title, updatedAt, read, favorite }: { novelId: string; title: string; updatedAt?: number; read?: boolean; favorite?: boolean }) {
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
      <NovelCoverStatus read={read ?? !!getNovelHistory(novelId)} favorite={favorite} />
    </div>
  )
}
