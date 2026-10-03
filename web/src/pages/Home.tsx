/**
 * Home 页 —— 小说网格、搜索（含拼音）、分类/状态筛选、排序、分页。
 * 由 Novel-KV js/home.js 平移为 React。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { Novel } from '@shared/types'
import { novelsApi } from '../lib/api'
import { pinyinMatch } from '../lib/pinyin'
import { getDemoNovels } from '../lib/demo'
import { useSearch } from '../context/SearchContext'
import { useContentPolicy } from '../context/ContentPolicyContext'
import { filterVisibleCategories, isRestrictedCategoryTag } from '@shared/restricted-categories'
import { canonicalCategory } from '@shared/category-aliases'
import { homeCategoryOptions } from '../lib/home-categories'
import NovelCard from '../components/NovelCard'
import ContentRestrictionNotice from '../components/ContentRestrictionNotice'
import { SearchIcon } from '../components/icons'
import { ArrowRight, BookOpen, ChevronDown } from 'lucide-react'
import { useSiteBranding } from '../lib/site-branding'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { inputMotion, preserveDisclosureFocus } from '../hooks/useStateChangeMotion'

const PAGE_LIMIT = 20

function isPinyinQueryText(value: string): boolean {
  return !!value && /^[a-z\s]+$/i.test(value)
}

async function novelMatches(n: Novel, q: string, usePinyin: boolean): Promise<boolean> {
  if (usePinyin) return await pinyinMatch(n.title, q) || await pinyinMatch(n.author, q) || await pinyinMatch(n.description || '', q)
  const query = String(q || '').toLowerCase()
  return (n.title || '').toLowerCase().includes(query) || (n.author || '').toLowerCase().includes(query) || (n.description || '').toLowerCase().includes(query)
}

export default function Home() {
  const branding = useSiteBranding()
  useDocumentTitle(null)
  const { query, setQuery } = useSearch()
  const [searchParams, setSearchParams] = useSearchParams()
  const { mode, safeMode, setMode, isAllowed, adultContentEnabled } = useContentPolicy()

  const [novels, setNovels] = useState<Novel[]>([])
  const [totalPages, setTotalPages] = useState(1)
  const [currentPage, setCurrentPage] = useState(1)
  const [activeCategories, setActiveCategories] = useState<string[]>([])
  const [activeStatus, setActiveStatus] = useState('')
  const [sort, setSort] = useState<string>(() => localStorage.getItem('homeSort') || 'updated_at')
  const [categories, setCategories] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [apiFailed, setApiFailed] = useState(false)
  const [retryCount, setRetryCount] = useState(0)
  const [hiddenRestricted, setHiddenRestricted] = useState(false)
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const [moreCategoriesOpen, setMoreCategoriesOpen] = useState(false)
  const [filterMotion, setFilterMotion] = useState<'animated' | 'instant'>('instant')
  const [categoryMotion, setCategoryMotion] = useState<'animated' | 'instant'>('instant')
  const mobileFilters = useMediaQuery('(max-width: 700px)')
  const filterVisible = !mobileFilters || mobileFiltersOpen

  useLayoutEffect(() => {
    if (!filterVisible && document.getElementById('homeFilterPanel')?.contains(document.activeElement)) {
      document.querySelector<HTMLButtonElement>('[aria-controls="homeFilterPanel"]')?.focus({ preventScroll: true })
    }
  }, [filterVisible])

  // 防抖后的搜索词：loadNovels 只依赖它，避免"每次击键立即请求 + 300ms 后再请求"的双发
  const [debouncedQuery, setDebouncedQuery] = useState(query)
  // 响应序号守卫：丢弃乱序返回的过期响应（与 NovelsTab 相同模式）
  const loadSeq = useRef(0)
  const previousSafeMode = useRef(safeMode)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const sortTabsRef = useRef<HTMLDivElement>(null)
  const sortIndicatorRef = useRef<HTMLSpanElement>(null)
  const animateSortRef = useRef(false)
  const urlQuery = searchParams.get('q') || ''

  useLayoutEffect(() => {
    const tabs = sortTabsRef.current
    const indicator = sortIndicatorRef.current
    if (!tabs || !indicator) return
    function positionIndicator(animate = false) {
      const active = tabs!.querySelector<HTMLButtonElement>('[aria-pressed="true"]')
      if (!active) return
      const transform = `translate(${active.offsetLeft}px, ${active.offsetTop + active.offsetHeight - 2}px) scaleX(${active.offsetWidth})`
      if (indicator!.style.transform === transform) return
      indicator!.style.transition = animate ? '' : 'none'
      indicator!.style.transform = transform
      indicator!.style.opacity = '1'
    }
    positionIndicator(animateSortRef.current)
    animateSortRef.current = false
    const observer = new ResizeObserver(() => positionIndicator())
    observer.observe(tabs)
    return () => observer.disconnect()
  }, [sort])

  // 地址栏 ?q= 是可分享搜索状态；浏览器前进/后退时同步回输入框。
  useEffect(() => {
    setQuery(urlQuery)
  }, [setQuery, urlQuery])

  useEffect(() => {
    if (safeMode && activeCategories.some(isRestrictedCategoryTag)) {
      setActiveCategories((selected) => selected.filter((category) => !isRestrictedCategoryTag(category)))
      setCurrentPage(1)
    }
  }, [safeMode, activeCategories])

  useLayoutEffect(() => {
    if (previousSafeMode.current === safeMode) return
    previousSafeMode.current = safeMode
    // 模式变化后旧页码不再对应当前可见集合，旧请求也不得写回。
    loadSeq.current++
    setCurrentPage(1)
  }, [safeMode])

  // 拼音查询加载数据映射
  const loadDemo = useCallback(
    async (usePinyin: boolean, seq: number) => {
      let filtered = getDemoNovels()
      const restrictedCount = safeMode ? filtered.filter((n) => !isAllowed(n)).length : 0
      if (safeMode) filtered = filtered.filter(isAllowed)
      if (activeCategories.length)
        filtered = filtered.filter((n) => activeCategories.every((selected) => n.categories.some((category) => canonicalCategory(category) === selected)))
      if (activeStatus) filtered = filtered.filter((n) => n.status === activeStatus)
      if (debouncedQuery) {
        const q = debouncedQuery.toLowerCase()
        const results: Novel[] = []
        for (const n of filtered) {
          if (await novelMatches(n, q, usePinyin)) results.push(n)
        }
        filtered = results
      }
      if (seq !== loadSeq.current) return
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
      // 分类名用显式枚举过滤，不再复用作品判级逻辑（详见 shared/restricted-categories.ts）。
      const visibleCategories = safeMode ? filterVisibleCategories([...cats]) : [...cats]
      setCategories(visibleCategories.sort((a, b) => a.length - b.length || a.localeCompare(b)))
      setHiddenRestricted(restrictedCount > 0 || visibleCategories.length !== cats.size)
    },
    [activeCategories, activeStatus, currentPage, debouncedQuery, sort, safeMode, isAllowed],
  )

  const loadNovels = useCallback(async () => {
    const seq = ++loadSeq.current
    setLoading(true)
    const isPinyin = isPinyinQueryText(debouncedQuery)
    const params: Record<string, string | number> = {
      page: isPinyin ? 1 : currentPage,
      limit: isPinyin ? 100 : PAGE_LIMIT,
      sort,
      order: sort === 'title' ? 'asc' : 'desc',
      contentMode: safeMode ? 'safe' : 'adult',
    }
    if (debouncedQuery && !isPinyin) params.search = debouncedQuery
    if (activeCategories.length === 1) params.category = activeCategories[0]!
    else if (activeCategories.length > 1) params.categories = JSON.stringify(activeCategories)
    if (activeStatus) params.status = activeStatus

    try {
      const data = await novelsApi.list(params)
      if (seq !== loadSeq.current) return
      let items = data.novels
      let pages = data.totalPages || 1
      const availableCategories = data.availableCategories || []
      let restrictedInPage = safeMode && items.some((n) => !isAllowed(n))
      // 拼音在客户端匹配，需要读取完整候选集合，不能仅搜索前100本。
      if (isPinyin) {
        for (let page = 2; page <= data.totalPages; page++) {
          const next = await novelsApi.list({ ...params, page, includeCategories: 0 })
          if (seq !== loadSeq.current) return
          restrictedInPage ||= safeMode && next.novels.some((n) => !isAllowed(n))
          items = items.concat(next.novels)
        }
      }
      if (safeMode) items = items.filter(isAllowed)
      if (isPinyin) {
        const q = debouncedQuery.toLowerCase()
        const matched: Novel[] = []
        for (const n of items) {
          if (await novelMatches(n, q, true)) matched.push(n)
        }
        pages = Math.ceil(matched.length / PAGE_LIMIT) || 1
        const start = (currentPage - 1) * PAGE_LIMIT
        items = matched.slice(start, start + PAGE_LIMIT)
      }
      if (seq !== loadSeq.current) return
      setTotalPages(pages)
      setNovels(items)
      const visibleCategories = safeMode ? filterVisibleCategories(availableCategories) : availableCategories
      setCategories(visibleCategories)
      setHiddenRestricted(Boolean(data.hiddenRestricted) || restrictedInPage || visibleCategories.length !== availableCategories.length)
      setApiFailed(false)
      setLoading(false)
    } catch {
      if (seq !== loadSeq.current) return
      // API 不可用 → 演示数据 + 重试横幅
      console.warn('API unavailable, using demo data.')
      setApiFailed(true)
      await loadDemo(isPinyin, seq)
      if (seq !== loadSeq.current) return
      setLoading(false)
    }
  }, [currentPage, debouncedQuery, activeCategories, activeStatus, sort, loadDemo, safeMode, isAllowed, retryCount])

  useEffect(() => {
    void loadNovels()
  }, [loadNovels])

  // 搜索防抖：query 落定 300ms 后写入 debouncedQuery（由其触发 loadNovels），并回到第一页
  useEffect(() => {
    if (query === debouncedQuery) return
    const timer = setTimeout(() => {
      setCurrentPage(1)
      setDebouncedQuery(query)
    }, 300)
    return () => clearTimeout(timer)
  }, [query, debouncedQuery])

  // ⌘K / Ctrl+K 聚焦搜索
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        if (!document.querySelector('[role="dialog"]')) searchInputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const sectionTitle =
    activeCategories.length > 1
      ? '筛选结果'
      : activeCategories.length === 1
        ? `分类: ${activeCategories[0]}`
        : activeStatus === 'ongoing'
          ? '连载中'
          : activeStatus === 'completed'
            ? '已完结'
            : '全部小说'

  const hasFilter = !!(query || activeCategories.length || activeStatus)
  const activeFilterCount = activeCategories.length + Number(!!activeStatus)
  const categoryOptions = homeCategoryOptions(safeMode ? filterVisibleCategories(categories) : categories)
  const visibleCommon = [...categoryOptions.common]
  activeCategories.forEach((category) => {
    if (!visibleCommon.includes(category)) visibleCommon.push(category)
  })

  function selectCategory(category: string) {
    setActiveCategories((selected) => (!category ? [] : selected.includes(category) ? selected.filter((tag) => tag !== category) : [...selected, category]))
    setCurrentPage(1)
  }

  function categoryButton(category: string) {
    return (
      <button
        key={category}
        className={`filter-btn${activeCategories.includes(category) ? ' filter-btn--active' : ''}`}
        aria-pressed={activeCategories.includes(category)}
        onClick={() => selectCategory(category)}
      >
        {category}
      </button>
    )
  }

  function submitSearch() {
    const q = query.trim()
    setQuery(q)
    setSearchParams(
      (params) => {
        if (q) params.set('q', q)
        else params.delete('q')
        return params
      },
      { replace: true },
    )
    document.getElementById('homeLibrary')?.scrollIntoView({ block: 'start' })
  }

  return (
    <main className="home-page">
      <section className="home-hero">
        <div className="container home-shell">
          <div className="home-hero__content">
            <div className="home-hero__intro">
              <h1>在纸页之间，继续你的故事。</h1>
              <p>收藏、搜索、筛选与继续阅读，都收进一个安静的中文小说书库。</p>
            </div>
            <div className="home-hero__search-area">
              <form
                className="home-search"
                role="search"
                onSubmit={(event) => {
                  event.preventDefault()
                  submitSearch()
                }}
              >
                <span className="home-search__icon" aria-hidden="true">
                  <SearchIcon />
                </span>
                <label className="sr-only" htmlFor="homeSearch">
                  搜索书名、作者或拼音
                </label>
                <input
                  ref={searchInputRef}
                  id="homeSearch"
                  className="home-search__input"
                  type="search"
                  placeholder="寻找一本书，或一位作者…"
                  autoComplete="off"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <kbd className="home-search__shortcut" aria-hidden="true">
                  Ctrl / ⌘ K
                </kbd>
                <button type="submit" className="home-search__submit" aria-label="搜索小说">
                  <ArrowRight size={20} aria-hidden="true" />
                </button>
              </form>
              <p className="home-search__hint">从一本好书开始。</p>
            </div>
          </div>
        </div>
      </section>

      <section id="homeLibrary" className="section section--hero home-library">
        <div className="container home-shell">
          <button
            type="button"
            className="home-filter-toggle"
            aria-controls="homeFilterPanel"
            aria-expanded={mobileFiltersOpen}
            onClick={event => {
              preserveDisclosureFocus(event, 'homeFilterPanel', mobileFiltersOpen)
              setFilterMotion(inputMotion(event))
              setMobileFiltersOpen(open => !open)
            }}
          >
            <span>筛选条件{activeFilterCount > 0 ? ` · 已选 ${activeFilterCount} 项` : ''}</span>
            <span className="home-filter-toggle__icon" aria-hidden="true">
              {mobileFiltersOpen ? '收起' : '展开'}
            </span>
          </button>

          <div id="homeFilterPanel" className={`filter-panel home-filter-card${mobileFiltersOpen ? ' home-filter-card--open' : ''}`} data-motion={mobileFilters ? filterMotion : 'instant'} data-motion-open={filterVisible} aria-hidden={!filterVisible} inert={!filterVisible}>
            <div className="filter-row">
              <span className="filter-row__label">状态</span>
              <div className="category-filter" role="group" aria-label="小说状态">
                {[
                  { v: '', label: '全部' },
                  { v: 'ongoing', label: '连载中' },
                  { v: 'completed', label: '已完结' },
                ].map((s) => (
                  <button
                    key={s.v}
                    className={`filter-btn${activeStatus === s.v ? ' filter-btn--active' : ''}`}
                    aria-pressed={activeStatus === s.v}
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
              <div className="category-filter" role="group" aria-label="小说分类">
                <button
                  className={`filter-btn${activeCategories.length === 0 ? ' filter-btn--active' : ''}`}
                  aria-pressed={activeCategories.length === 0}
                  onClick={() => {
                    setActiveCategories([])
                    setCurrentPage(1)
                  }}
                >
                  全部
                </button>
                {visibleCommon.map(categoryButton)}
                {categoryOptions.hasMore && (
                  <button
                    type="button"
                    className="filter-btn home-category-more"
                    aria-expanded={moreCategoriesOpen}
                    aria-controls="homeMoreCategories"
                    onClick={event => {
                      preserveDisclosureFocus(event, 'homeMoreCategories', moreCategoriesOpen)
                      setCategoryMotion(inputMotion(event))
                      setMoreCategoriesOpen(open => !open)
                    }}
                  >
                    {moreCategoriesOpen ? '收起标签' : '更多标签'} <ChevronDown size={14} aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>
            {categoryOptions.hasMore && (
              <div id="homeMoreCategories" className="home-category-groups" role="region" aria-label="全部分类标签" data-motion={categoryMotion} data-motion-open={moreCategoriesOpen} aria-hidden={!moreCategoriesOpen} inert={!moreCategoriesOpen}>
                {categoryOptions.groups.map((group) => (
                  <div className="home-category-group" key={group.label}>
                    <h3>{group.label}</h3>
                    <div className="category-filter" role="group" aria-label={group.label}>
                      {group.tags.map(categoryButton)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {activeFilterCount > 0 && (
            <div className="home-active-filters" aria-label="当前筛选">
              <span>已选 · 同时满足</span>
              {activeCategories.map((category) => (
                <button key={category} className="filter-btn filter-btn--active" aria-label={`取消分类 ${category}`} onClick={() => selectCategory(category)}>
                  {category} ×
                </button>
              ))}
              {activeStatus && (
                <button
                  className="filter-btn filter-btn--active"
                  aria-label="取消状态筛选"
                  onClick={() => {
                    setActiveStatus('')
                    setCurrentPage(1)
                  }}
                >
                  {activeStatus === 'ongoing' ? '连载中' : '已完结'} ×
                </button>
              )}
              <button
                className="filter-btn"
                onClick={() => {
                  selectCategory('')
                  setActiveStatus('')
                }}
              >
                清除筛选条件
              </button>
            </div>
          )}

          {safeMode && hiddenRestricted && (
            <ContentRestrictionNotice
              compact
              mode={mode}
              onModeChange={setMode}
              canUnlock={adultContentEnabled}
              title={adultContentEnabled ? '安全模式已隐藏部分作品' : '站点已关闭成人内容模式'}
              description={adultContentEnabled ? '可能包含限制级内容的作品和分类不会出现在当前列表中。' : '限制级作品和分类不会出现在当前列表中。'}
            />
          )}

          <div className="sort-tabs-row">
            <div ref={sortTabsRef} className="sort-tabs" role="group" aria-label="小说排序">
              <span ref={sortIndicatorRef} className="home-sort-indicator" aria-hidden="true" />
              {[
                { v: 'updated_at', label: '最近更新' },
                { v: 'created_at', label: '最近添加' },
                { v: 'title', label: '按标题' },
                { v: 'chapter_count', label: '章节数' },
              ].map((tab) => (
                <button
                  key={tab.v}
                  className={`sort-tab${sort === tab.v ? ' sort-tab--active' : ''}`}
                  aria-pressed={sort === tab.v}
                  onClick={(event) => {
                    if (sort === tab.v) return
                    animateSortRef.current = event.detail > 0
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
              <span className="text-muted text-sm" role="status" aria-live="polite">
                {totalPages > 1 ? `共 ${totalPages} 页` : `${novels.length} 本`}
              </span>
            </div>
          </div>

          {apiFailed && (
            <div className="retry-banner">
              <span>API 连接失败，已加载演示数据</span>
              <button
                className="btn btn--primary btn--sm"
                onClick={() => {
                  setApiFailed(false)
                  setCurrentPage(1)
                  setRetryCount((count) => count + 1)
                }}
              >
                重试连接
              </button>
            </div>
          )}

          {novels.length > 0 ? (
            <div className="grid--novels" aria-busy={loading}>
              {novels.map((n) => (
                <NovelCard key={n.id} novel={n} variant="library" category={n.categories.find((cat) => categories.includes(cat))} />
              ))}
            </div>
          ) : (
            !loading && (
              <div className="empty-state">
                <div className="empty-state__icon" aria-hidden="true">
                  <BookOpen size={28} />
                </div>
                <div className="empty-state__title">{hasFilter ? '没有找到相关小说' : '暂无小说'}</div>
                <div className="empty-state__desc">
                  {hasFilter
                    ? query
                      ? `没有找到「${query}」相关的小说，试试其他关键词吧`
                      : '当前筛选条件下没有小说，试试调整筛选条件'
                    : '前往管理页面添加你的第一本小说吧'}
                </div>
                {!hasFilter && (
                  <Link to="/admin" className="btn btn--primary empty-state-btn">
                    前往管理
                  </Link>
                )}
                {hasFilter && (
                  <button
                    className="btn btn--secondary empty-state-btn"
                    onClick={() => {
                      setQuery('')
                      setActiveCategories([])
                      setActiveStatus('')
                      setCurrentPage(1)
                      setSearchParams(
                        (params) => {
                          params.delete('q')
                          return params
                        },
                        { replace: true },
                      )
                    }}
                  >
                    清除筛选
                  </button>
                )}
              </div>
            )
          )}

          {totalPages > 1 && (
            <div className="home-pagination">
              <button className="btn btn--secondary btn--sm" disabled={currentPage <= 1} onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}>
                上一页
              </button>
              <span className="home-pagination__info">
                第 {currentPage} / {totalPages} 页
              </span>
              <span className="home-pagination__jump">
                跳转{' '}
                <input
                  type="number"
                  className="form-input"
                  min={1}
                  value={currentPage}
                  aria-label="跳转到指定页"
                  onChange={(e) => {
                    const p = Math.min(Math.max(parseInt(e.target.value) || 1, 1), totalPages)
                    setCurrentPage(p)
                  }}
                />{' '}
                页
              </span>
              <button
                className="btn btn--secondary btn--sm"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              >
                下一页
              </button>
            </div>
          )}

          {loading && (
            <div className="loading-center">
              <div className="spinner spinner--lg" role="status" aria-label="正在加载小说"></div>
            </div>
          )}
        </div>
      </section>
      <footer className="container home-shell home-footer">
        <p className="home-footer__signature">
          <img className="home-footer__flower" src="/images/auth-flower.png" width={76} height={38} alt="" aria-hidden="true" loading="lazy" />
          <span className="home-footer__name">{branding.name}</span>
          <span className="home-footer__dot">·</span>
          <span>{branding.tagline}</span>
        </p>
      </footer>
    </main>
  )
}
