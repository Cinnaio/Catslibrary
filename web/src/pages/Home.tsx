/**
 * Home 页 —— 小说网格、搜索（含拼音）、分类/状态筛选、排序、分页、最近阅读。
 * 由 Novel-KV js/home.js 平移为 React。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { Novel, ReadingHistoryEntry } from '@shared/types'
import { novelsApi, progressApi } from '../lib/api'
import { getRecentHistory, saveHistory, clearHistory } from '../lib/storage'
import { pinyinMatch } from '../lib/pinyin'
import { timeAgo } from '../lib/format'
import { getDemoNovels } from '../lib/demo'
import { useSession } from '../context/SessionContext'
import { useSearch } from '../context/SearchContext'
import NovelCard from '../components/NovelCard'

const PAGE_LIMIT = 20

function isPinyinQueryText(value: string): boolean {
  return !!value && /^[a-z\s]+$/i.test(value)
}

function novelMatches(n: Novel, q: string, usePinyin: boolean): Promise<boolean> | boolean {
  if (usePinyin) return pinyinMatch(n.title, q) || pinyinMatch(n.author, q) || pinyinMatch(n.description || '', q)
  const query = String(q || '').toLowerCase()
  return (
    (n.title || '').toLowerCase().includes(query) ||
    (n.author || '').toLowerCase().includes(query) ||
    (n.description || '').toLowerCase().includes(query)
  )
}

interface ServerRecent {
  novelId: string
  novelTitle?: string
  chapterId: string
  chapterTitle?: string
  chapterOrder?: number
  scrollPercent?: number
  pageMode?: string
  pageIndex?: number
  pagePercent?: number
  updatedAt?: number
  timestamp?: number
}

function normalizeRecent(item: ServerRecent | ReadingHistoryEntry | undefined | null): ReadingHistoryEntry | null {
  if (!item || !item.novelId || !item.chapterId) return null
  const s = item as ServerRecent
  return {
    novelId: item.novelId,
    novelTitle: item.novelTitle || '',
    chapterId: item.chapterId,
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
      const merged = { ...(existing || {}), ...norm } as ReadingHistoryEntry
      if (existing && !norm.pageMode) {
        merged.pageMode = existing.pageMode || ''
        merged.pageIndex = existing.pageIndex || 0
        merged.pagePercent = existing.pagePercent || 0
      }
      byNovel.set(norm.novelId, merged)
    }
  }
  local.forEach((h) => add(h))
  server.forEach((h) => add(h))
  return [...byNovel.values()]
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
    .slice(0, limit)
}

function applyTombstones(tombstones: Array<{ novelId: string; updatedAt?: number }> | undefined): void {
  ;(tombstones || []).forEach((t) => {
    if (!t || !t.novelId) return
    const history = getRecentHistory(100).find((h) => h.novelId === t.novelId)
    if (!history) return
    const deletedAt = Number(t.updatedAt || 0) || 0
    const localAt = Number(history.timestamp || 0) || 0
    if (deletedAt >= localAt) clearHistory(t.novelId)
  })
}

export default function Home() {
  const { query, setQuery } = useSearch()
  const { user } = useSession()
  const [searchParams] = useSearchParams()

  const [novels, setNovels] = useState<Novel[]>([])
  const [totalPages, setTotalPages] = useState(1)
  const [currentPage, setCurrentPage] = useState(1)
  const [activeCategory, setActiveCategory] = useState('')
  const [activeStatus, setActiveStatus] = useState('')
  const [sort, setSort] = useState<string>(() => localStorage.getItem('homeSort') || 'updated_at')
  const [categories, setCategories] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [apiFailed, setApiFailed] = useState(false)
  const [recent, setRecent] = useState<ReadingHistoryEntry[]>([])

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 地址栏 ?q= 初始化（如从别处跳转到首页搜索）
  useEffect(() => {
    const q = searchParams.get('q')
    if (q) setQuery(q)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 拼音查询加载数据映射
  const loadDemo = useCallback(
    async (isPinyin: boolean, usePinyin: boolean) => {
      let filtered = getDemoNovels()
      if (activeCategory) filtered = filtered.filter((n) => n.categories.includes(activeCategory))
      if (activeStatus) filtered = filtered.filter((n) => n.status === activeStatus)
      if (query) {
        const q = query.toLowerCase()
        const results: Novel[] = []
        for (const n of filtered) {
          if (await novelMatches(n, q, usePinyin)) results.push(n)
        }
        filtered = results
      }
      filtered.sort((a, b) => {
        if (sort === 'title') return a.title.localeCompare(b.title, 'zh')
        if (sort === 'chapter_count') return (b.chapterCount || 0) - (a.chapterCount || 0)
        return 0
      })
      const total = Math.ceil(filtered.length / PAGE_LIMIT) || 1
      setTotalPages(total)
      const start = (currentPage - 1) * PAGE_LIMIT
      setNovels(filtered.slice(start, start + PAGE_LIMIT))
      const cats = new Set<string>()
      getDemoNovels().forEach((n) => n.categories.forEach((c) => cats.add(c)))
      setCategories([...cats].sort((a, b) => a.length - b.length || a.localeCompare(b)))
      void loadRecent()
    },
    [activeCategory, activeStatus, currentPage, query, sort],
  )

  const loadRecent = useCallback(async () => {
    const local = getRecentHistory(5)
    if (!user) {
      setRecent(local)
      return
    }
    try {
      const data = await progressApi.recent(5) as { progress?: ServerRecent[]; tombstones?: Array<{ novelId: string; updatedAt?: number }> }
      applyTombstones(data.tombstones)
      const merged = mergeRecent(getRecentHistory(5), data.progress || [], 5)
      merged.forEach((h) => saveHistory(h.novelId, h))
      setRecent(merged)
    } catch {
      setRecent(local)
    }
  }, [user])

  const loadNovels = useCallback(async () => {
    setLoading(true)
    const isPinyin = isPinyinQueryText(query)
    const params: Record<string, string | number> = {
      page: isPinyin ? 1 : currentPage,
      limit: isPinyin ? 100 : PAGE_LIMIT,
      sort,
      order: sort === 'title' ? 'asc' : 'desc',
    }
    if (query && !isPinyin) params.search = query
    if (activeCategory) params.category = activeCategory
    if (activeStatus) params.status = activeStatus

    try {
      const data = await novelsApi.list(params)
      let items = data.novels
      if (isPinyin) {
        const q = query.toLowerCase()
        const matched: Novel[] = []
        for (const n of items) {
          if (await novelMatches(n, q, true)) matched.push(n)
        }
        const total = Math.ceil(matched.length / PAGE_LIMIT) || 1
        setTotalPages(total)
        const start = (currentPage - 1) * PAGE_LIMIT
        items = matched.slice(start, start + PAGE_LIMIT)
      } else {
        setTotalPages(data.totalPages || 1)
      }
      setNovels(items)
      setCategories(data.availableCategories || [])
      setApiFailed(false)
      setLoading(false)
      void loadRecent()
    } catch {
      // API 不可用 → 演示数据 + 重试横幅
      console.warn('API unavailable, using demo data.')
      setApiFailed(true)
      await loadDemo(isPinyin, isPinyinQueryText(query))
      setLoading(false)
    }
  }, [currentPage, query, activeCategory, activeStatus, sort, loadDemo, loadRecent])

  useEffect(() => {
    void loadNovels()
  }, [loadNovels])

  // 搜索防抖：输入变化 300ms 后触发
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => {
      setCurrentPage(1)
      void loadNovels()
    }, 300)
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  // ⌘K / Ctrl+K 聚焦搜索
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        document.querySelector<HTMLInputElement>('.search-bar__input')?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const sectionTitle =
    activeCategory ? `分类: ${activeCategory}` : activeStatus === 'ongoing' ? '连载中' : activeStatus === 'completed' ? '已完结' : '全部小说'

  const hasFilter = !!(query || activeCategory || activeStatus)

  function removeRecent(novelId: string) {
    clearHistory(novelId)
    if (user) void progressApi.remove(novelId).catch(() => {})
    setRecent(getRecentHistory(5))
  }

  return (
    <main className="home-page">
      <section className="home-hero">
        <div className="container home-shell">
          <div className="home-hero__paper-mark" aria-hidden="true">舟</div>
          <div className="home-hero__content">
            <p className="home-kicker">ZHIZHOU LIBRARY</p>
            <h1>在纸页之间，继续你的故事。</h1>
            <p>收藏、搜索、筛选与继续阅读，都收进一个安静的中文小说书库。</p>
            <div className="home-hero__search" aria-hidden="true">
              <span>搜索书名、作者或拼音</span>
              <kbd>⌘ K</kbd>
            </div>
          </div>
        </div>
      </section>

      <section className="section section--hero home-library">
        <div className="container home-shell">
          {recent.length > 0 && (
            <section className="recent-reading" aria-label="最近阅读">
              <div className="recent-reading__head">
                <p className="home-kicker">CONTINUE</p>
                <div className="recent-reading__title">最近阅读</div>
              </div>
              <div className="recent-reading__list">
                {recent.map((h) => {
                  const chapterLabel = h.chapterTitle || (h.chapterOrder ? `第${h.chapterOrder}章` : '')
                  return (
                    <div className="recent-reading__item" key={h.novelId}>
                      <Link
                        to={`/read/${encodeURIComponent(h.novelId)}/${encodeURIComponent(h.chapterId)}`}
                        className="recent-reading__link"
                      >
                        <span className="recent-reading__novel">{h.novelTitle || h.novelId}</span>
                        {chapterLabel && <span className="recent-reading__chapter">{chapterLabel}</span>}
                        <span className="recent-reading__time">{timeAgo(h.timestamp)}</span>
                      </Link>
                      <button className="recent-reading__del" title="删除记录" onClick={() => removeRecent(h.novelId)}>
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                          <line x1="2" y1="2" x2="10" y2="10" />
                          <line x1="10" y1="2" x2="2" y2="10" />
                        </svg>
                      </button>
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          <div className="filter-panel home-filter-card">
            <div className="filter-row">
              <span className="filter-row__label">状态</span>
              <div className="flex flex-wrap gap-sm category-filter">
                {[{ v: '', label: '全部' }, { v: 'ongoing', label: '连载中' }, { v: 'completed', label: '已完结' }].map((s) => (
                  <button
                    key={s.v}
                    className={`filter-btn${activeStatus === s.v ? ' filter-btn--active' : ''}`}
                    onClick={() => {
                      setActiveStatus(s.v)
                      setCurrentPage(1)
                    }}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="filter-row">
              <span className="filter-row__label">分类</span>
              <div className="flex flex-wrap gap-sm category-filter">
                <button className={`filter-btn${activeCategory === '' ? ' filter-btn--active' : ''}`} onClick={() => { setActiveCategory(''); setCurrentPage(1) }}>
                  全部
                </button>
                {categories.map((cat) => (
                  <button
                    key={cat}
                    className={`filter-btn${activeCategory === cat ? ' filter-btn--active' : ''}`}
                    onClick={() => { setActiveCategory(cat); setCurrentPage(1) }}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="sort-tabs-row">
            <div className="sort-tabs">
              {[
                { v: 'updated_at', label: '最近更新' },
                { v: 'created_at', label: '最近添加' },
                { v: 'title', label: '按标题' },
                { v: 'chapter_count', label: '章节数' },
              ].map((tab) => (
                <button
                  key={tab.v}
                  className={`sort-tab${sort === tab.v ? ' sort-tab--active' : ''}`}
                  onClick={() => {
                    if (sort === tab.v) return
                    setSort(tab.v)
                    localStorage.setItem('homeSort', tab.v)
                    setCurrentPage(1)
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="sort-tabs-row__meta">
              <h2 id="sectionTitle">{sectionTitle}</h2>
              <span className="text-muted text-sm">
                {totalPages > 1 ? `共 ${totalPages} 页` : `${novels.length} 本`}
              </span>
            </div>
          </div>

          {apiFailed && (
            <div className="retry-banner">
              <span>API 连接失败，已加载演示数据</span>
              <button className="btn btn--primary btn--sm" onClick={() => { setApiFailed(false); setCurrentPage(1) }}>
                重试连接
              </button>
            </div>
          )}

          {novels.length > 0 ? (
            <div className="grid--novels">
              {novels.map((n) => (
                <NovelCard key={n.id} novel={n} />
              ))}
            </div>
          ) : (
            !loading && (
              <div className="empty-state">
                <div className="empty-state__icon">📖</div>
                <div className="empty-state__title">{hasFilter ? '没有找到相关小说' : '暂无小说'}</div>
                <div className="empty-state__desc">
                  {hasFilter
                    ? query
                      ? `没有找到「${query}」相关的小说，试试其他关键词吧`
                      : '当前筛选条件下没有小说，试试调整筛选条件'
                    : '前往管理页面添加你的第一本小说吧'}
                </div>
                {!hasFilter && (
                  <Link to="/admin" className="btn btn--primary empty-state-btn">前往管理</Link>
                )}
              </div>
            )
          )}

          {totalPages > 1 && (
            <div className="home-pagination">
              <button className="btn btn--secondary btn--sm" disabled={currentPage <= 1} onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}>
                上一页
              </button>
              <span className="home-pagination__info">第 {currentPage} / {totalPages} 页</span>
              <span className="home-pagination__jump">
                跳转 <input type="number" className="form-input" min={1} value={currentPage}
                  onChange={(e) => {
                    const p = Math.min(Math.max(parseInt(e.target.value) || 1, 1), totalPages)
                    setCurrentPage(p)
                  }} /> 页
              </span>
              <button className="btn btn--secondary btn--sm" disabled={currentPage >= totalPages} onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}>
                下一页
              </button>
            </div>
          )}

          {loading && (
            <div className="loading-center">
              <div className="spinner spinner--lg"></div>
            </div>
          )}
        </div>
      </section>
    </main>
  )
}
