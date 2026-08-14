/**
 * 书架页 —— 收藏、最近阅读、书签、想法、手动同步（由 Novel-KV js/bookshelf.js 平移）。
 */
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { ReadingHistoryEntry, Thought } from '@shared/types'
import { bookmarksApi, bookshelfApi, getToken, progressApi } from '../lib/api'
import { clearHistory, getAllBookmarks, getBookshelf, getRecentHistory, removeFromBookshelf, replaceAllBookmarks, replaceBookshelf, saveHistory } from '../lib/storage'
import { useSession } from '../context/SessionContext'
import { useToast } from '../components/feedback'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { timeAgo } from '../lib/format'
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
  const { toast } = useToast()
  useDocumentTitle('我的书架')

  const [favorites, setFavorites] = useState<Favorite[]>(() => getBookshelf())
  const [recent, setRecent] = useState<ReadingHistoryEntry[]>([])
  const [bookmarks, setBookmarks] = useState(() => getAllBookmarks())
  const [thoughts, setThoughts] = useState<ShelfThought[]>([])
  const [syncStatus, setSyncStatus] = useState('')
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    if (!loading && !user) {
      navigate('/auth', { replace: true, state: { from: '/bookshelf' } })
      return
    }
    if (user) {
      void loadAll()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, loading])

  async function syncBookmarksFromServer() {
    const data = await bookmarksApi.list()
    const byKey = new Map<string, Record<string, unknown>>()
    const local = getAllBookmarks() as unknown as Array<Record<string, unknown>>
    const server = (data.bookmarks || []) as unknown as Array<Record<string, unknown>>
    local.concat(server).forEach((bm) => {
      const key = String(bm.novelId) + '|' + String(bm.chapterId)
      const existing = byKey.get(key)
      if (!existing || Number(bm.timestamp || 0) > Number(existing.timestamp || 0)) byKey.set(key, bm)
    })
    const merged = [...byKey.values()]
    replaceAllBookmarks(merged as never[])
    await bookmarksApi.replace(merged as never[])
  }

  async function syncBookshelfFromServer() {
    const local = getBookshelf()
    for (const item of local) {
      try {
        await bookshelfApi.add(item.novelId)
      } catch {
        /* ignore */
      }
    }
    const data = await bookshelfApi.get()
    replaceBookshelf((data.favorites || []) as Array<{ novelId: string }>)
  }

  async function loadRecent(limit = 8): Promise<ReadingHistoryEntry[]> {
    const local = getRecentHistory(limit)
    if (!getToken()) return local
    try {
      const data = await progressApi.recent(limit)
      // 墓碑：服务端已删除则清本地
      data.tombstones.forEach((t) => {
        if (!t.novelId) return
        const h = getRecentHistory(100).find((x) => x.novelId === t.novelId)
        if (h && (Number(t.updatedAt || 0) >= Number(h.timestamp || 0))) clearHistory(t.novelId)
      })
      const merged = mergeRecent(getRecentHistory(limit), data.progress, limit)
      merged.forEach((h) => saveHistory(h.novelId, h))
      return merged
    } catch {
      return local
    }
  }

  const loadAll = useCallback(async () => {
    setSyncing(true)
    try {
      if (getToken()) {
        await syncBookmarksFromServer()
        await syncBookshelfFromServer()
      }
      const recentList = await loadRecent(8)
      setRecent(recentList)
      setBookmarks(getAllBookmarks().slice(0, 4))
      setFavorites(getBookshelf())
      let serverThoughts: Thought[] = []
      if (getToken()) {
        const data = (await bookshelfApi.get()) as { favorites?: Favorite[]; recent?: ServerRecent[]; thoughts?: Thought[] }
        if (data.favorites) {
          setFavorites(data.favorites)
          replaceBookshelf(data.favorites)
        }
        if (data.recent?.length) setRecent(mergeRecent(recentList, data.recent, 8))
        serverThoughts = data.thoughts || []
        setThoughts(serverThoughts)
      }
      setSyncStatus(`上次同步 · ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`)
    } catch (err) {
      setSyncStatus(`同步失败：${(err as Error).message || '请稍后重试'}`)
    } finally {
      setSyncing(false)
    }
  }, [])

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
    removeFromBookshelf(novelId)
    if (getToken()) {
      try {
        await bookshelfApi.remove(novelId)
      } catch {
        /* ignore */
      }
    }
    setFavorites(getBookshelf())
    toast('已移出书架', 'success')
  }

  async function deleteRecent(novelId: string) {
    if (!novelId) return
    clearHistory(novelId)
    if (getToken()) {
      try {
        await progressApi.remove(novelId)
      } catch {
        /* ignore */
      }
    }
    setRecent(getRecentHistory(8))
    toast('阅读记录已删除', 'success')
  }

  if (loading) {
    return (
      <div className="loading-center" style={{ minHeight: '50vh' }}>
        <div className="spinner spinner--lg"></div>
      </div>
    )
  }

  const recentItems = recent.slice(0, 8)

  return (
    <main className="bookshelf-page">
      <div className="container bookshelf-shell">
        <section className="bookshelf-hero">
          <div className="bookshelf-hero__mark" aria-hidden="true">架</div>
          <div>
            <p className="detail-kicker">LIBRARY</p>
            <h1>我的书架</h1>
            <p className="text-muted">收藏、继续阅读、书签与想法都收在这里。</p>
          </div>
          <div className="profile-sync-card">
            <span className="text-sm text-muted" id="syncStatusText">{syncStatus}</span>
            <button className="btn btn--secondary btn--sm" id="btnSyncNow" disabled={syncing} onClick={() => void manualSync()}>
              {syncing ? '同步中…' : '立即同步'}
            </button>
          </div>
        </section>

        {/* 收藏 */}
        <section className="bookshelf-section">
          <div className="bookshelf-sections">
            <h2 className="bookshelf-subtitle">收藏 <span className="text-muted">· {favorites.length}</span></h2>
            <div className="bookshelf-novel-grid" id="bookshelfFavorites">
              {favorites.length === 0 ? (
                <p className="profile-empty-note">还没有收藏小说</p>
              ) : (
                favorites.slice(0, 12).map((f) => (
                  <div className="bookshelf-novel-card" key={f.novelId}>
                    <Link to={`/novel/${encodeURIComponent(f.novelId)}`} className="novel-card">
                      <CoverOrPlaceholder novelId={f.novelId} title={f.title || f.novelId} updatedAt={f.updatedAt} />
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
        <section className="bookshelf-section">
          <div className="bookshelf-sections">
            <h2 className="bookshelf-subtitle">最近阅读 <span className="text-muted">· {recentItems.length}</span></h2>
            <div className="bookshelf-novel-grid" id="bookshelfRecent">
              {recentItems.length === 0 ? (
                <p className="profile-empty-note">还没有阅读记录</p>
              ) : (
                recentItems.map((h) => (
                  <div className="bookshelf-novel-card" key={h.novelId}>
                    <Link to={h.chapterId ? `/read/${encodeURIComponent(h.novelId)}/${encodeURIComponent(h.chapterId)}` : `/novel/${encodeURIComponent(h.novelId)}`} className="novel-card">
                      <CoverOrPlaceholder novelId={h.novelId} title={h.novelTitle || h.novelId} updatedAt={h.timestamp} />
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
        <section className="bookshelf-section">
          <h2 className="bookshelf-subtitle">书签 <span className="text-muted">· {bookmarks.length}</span></h2>
          <div className="bookshelf-record-panel" id="bookshelfBookmarks">
            {bookmarks.length === 0 ? (
              <p className="profile-empty-note">还没有添加书签</p>
            ) : (
              bookmarks.map((b) => (
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
        <section className="bookshelf-section">
          <h2 className="bookshelf-subtitle">想法 <span className="text-muted">· {thoughts.length}</span></h2>
          <div className="bookshelf-record-panel" id="bookshelfThoughts">
            {thoughts.length === 0 ? (
              <p className="profile-empty-note">还没有写下想法</p>
            ) : (
              thoughts.slice(0, 4).map((t) => (
                <div className="bookshelf-item-wrap" key={t.id}>
                  <Link className="bookshelf-item" to={`/read/${encodeURIComponent(t.novelId)}/${encodeURIComponent(t.chapterId)}?thoughtParagraph=${encodeURIComponent(t.paragraphIndex)}`}>
                    <strong className="bookshelf-item__title">{t.thoughtText}</strong>
                    <span className="bookshelf-item__meta">{t.novelTitle || t.chapterTitle || timeAgo(t.createdAt)}</span>
                  </Link>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </main>
  )
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
