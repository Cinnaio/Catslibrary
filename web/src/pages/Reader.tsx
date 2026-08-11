/**
 * Reader 阅读器 —— 沉浸式阅读（由 Novel-KV js/read.js 2723 行平移为 React）。
 * 覆盖：章节加载/缓存/预取、滚动+分页双模式、进度保存/恢复（本地+服务端节流）、
 * 阅读设置（LWW 同步）、书签、自动滚动、键盘快捷键、触摸滑动、段评想法。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { ChapterFull, ChapterMeta, Thought } from '@shared/types'
import { removeAdPatterns } from '@shared/ad-cleaner'
import { bookmarksApi, chaptersApi, getToken, novelsApi, thoughtsApi, url } from '../lib/api'
import { addBookmark, getAllBookmarks, getNovelBookmarks, isBookmarked, removeBookmark, saveHistory, toggleBookmark } from '../lib/storage'
import { escHtml } from '@shared/utils'
import { useSession } from '../context/SessionContext'
import { useTheme } from '../context/ThemeContext'
import { useToast } from '../components/feedback'
import { useReaderSettings, FONT_SIZES, FONT_LABELS, PAGE_WIDTHS, AUTO_SCROLL_SPEEDS } from '../hooks/useReaderSettings'
import type { ReaderSettingKey } from '../hooks/useReaderSettings'
import { useProgressSync } from '../hooks/useProgressSync'
import { VirtualList } from '../components/reader/VirtualList'
import { SettingsControls } from '../components/reader/SettingsControls'
import ThoughtPanel from '../components/reader/ThoughtPanel'
import { MoonIcon, SunIcon } from '../components/icons'

const CHAPTER_ROW_H = 34
const MOBILE_ROW_H = 46
const CHAPTER_CACHE_MAX = 6

function getPageHeight(): number {
  return Math.max(window.innerHeight - 80, 400)
}

function clamp(num: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, num))
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? 'auto' : 'smooth'
}

function jumpScrollTo(y: number): void {
  const root = document.documentElement
  const prev = root.style.scrollBehavior
  root.style.scrollBehavior = 'auto'
  window.scrollTo(0, y)
  root.style.scrollBehavior = prev
}

function currentScrollPercent(): number {
  const maxScroll = document.documentElement.scrollHeight - window.innerHeight
  if (maxScroll <= 0) return 0
  return clamp(Math.round((window.scrollY / maxScroll) * 1000) / 1000, 0, 1)
}

/** 章节内容格式化：广告清洗 + 纯文本按段落，或允许的安全 HTML 子集。 */
function formatContent(raw: string): string {
  const content = removeAdPatterns(raw || '') || '暂无章节内容'
  if (/<[a-z][\s\S]*>/i.test(content)) return sanitizeChapterHtml(content)
  return content
    .split(/\n+/)
    .filter((p) => p.trim())
    .map((p) => `<p>${escHtml(p.trim())}</p>`)
    .join('\n')
}

/** 允许的最小安全 HTML 子集（P/BR/EM/STRONG/BLOCKQUOTE）。 */
function sanitizeChapterHtml(content: string): string {
  const template = document.createElement('template')
  template.innerHTML = content
  const allowed: Record<string, boolean> = { P: true, BR: true, EM: true, STRONG: true, BLOCKQUOTE: true }

  function clean(node: Node): Node {
    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent || '')
    if (node.nodeType !== Node.ELEMENT_NODE) return document.createTextNode('')
    const el = node as HTMLElement
    if (!allowed[el.tagName]) {
      const frag = document.createDocumentFragment()
      Array.from(el.childNodes).forEach((child) => frag.appendChild(clean(child)))
      return frag
    }
    const out = document.createElement(el.tagName.toLowerCase())
    Array.from(el.childNodes).forEach((child) => out.appendChild(clean(child)))
    return out
  }

  const out = document.createElement('div')
  Array.from(template.content.childNodes).forEach((node) => out.appendChild(clean(node)))
  return out.innerHTML
}

function chapterLabel(ch: ChapterMeta, i: number): string {
  return (ch.order ? `第${ch.order}章 ` : '') + (ch.title || `章节 ${i + 1}`)
}

function filterChapters(chapters: ChapterMeta[], query: string): ChapterMeta[] {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return chapters
  return chapters.filter((ch) => {
    if (String(ch.order || '').indexOf(q) === 0) return true
    if (String(ch.title || '').toLowerCase().includes(q)) return true
    return (`第${ch.order}章`).includes(q)
  })
}

function hashParagraphText(text: string): string {
  let h = 2166136261
  const t = String(text || '').replace(/\s+/g, ' ').trim()
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}

function excerptText(text: string): string {
  const t = String(text || '').replace(/\s+/g, ' ').trim()
  return t.length > 110 ? t.slice(0, 110) + '…' : t
}

function getReaderClientId(): string {
  const key = 'reader_client_id'
  let id = localStorage.getItem(key)
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : `reader_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
    localStorage.setItem(key, id)
  }
  return id
}

export default function Reader() {
  const { novelId = '', chapterId = '' } = useParams()
  const navigate = useNavigate()
  const { user } = useSession()
  const { toggleTheme } = useTheme()
  const { toast } = useToast()
  const { settings, set, fontSize, pageMode } = useReaderSettings()
  const { queue: queueProgress, flush: flushProgress } = useProgressSync()

  // 章节状态
  const [chapter, setChapter] = useState<ChapterFull | null>(null)
  const [allChapters, setAllChapters] = useState<ChapterMeta[]>([])
  const [novel, setNovel] = useState<{ id: string; title: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [demoMode, setDemoMode] = useState(false)
  const cacheRef = useRef<Map<string, ChapterFull>>(new Map())

  // 面板状态
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [dropdownQuery, setDropdownQuery] = useState('')
  const [bookmarkPanelOpen, setBookmarkPanelOpen] = useState(false)
  const [bookmarkNoteOpen, setBookmarkNoteOpen] = useState(false)
  const [bookmarkNote, setBookmarkNote] = useState('')
  const [bookmarks, setBookmarks] = useState(() => getAllBookmarks())
  const [settingsPanelOpen, setSettingsPanelOpen] = useState(false)
  const [mobileSettingsOpen, setMobileSettingsOpen] = useState(false)
  const [mobileLibraryOpen, setMobileLibraryOpen] = useState(false)
  const [mobileLibraryTab, setMobileLibraryTab] = useState<'chapters' | 'bookmarks'>('chapters')
  const [mobileChapterQuery, setMobileChapterQuery] = useState('')

  // 分页模式
  const currentPageRef = useRef(0)
  const totalPagesRef = useRef(0)
  const hasRestoredRef = useRef(false)

  // 段评
  const [chapterThoughts, setChapterThoughts] = useState<Thought[]>([])
  const [activeThoughtParagraph, setActiveThoughtParagraph] = useState<number | null>(null)
  const [pendingSelection, setPendingSelection] = useState<{ paragraphIndex: number; paragraphHash: string; selectedText: string } | null>(null)
  const [popoverPos, setPopoverPos] = useState<{ left: number; top: number } | null>(null)
  const [thoughtPanelOpen, setThoughtPanelOpen] = useState(false)

  // 自动滚动
  const autoScrollRef = useRef({ running: false, frame: 0, lastTs: 0, remainder: 0 })
  const [autoScrollRunning, setAutoScrollRunning] = useState(false)

  // 移动端底部工具栏：默认收起，点击阅读区切换显隐
  const [mobileBarHidden, setMobileBarHidden] = useState(true)

  // DOM refs
  const readerAppRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prefetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // wake lock
  const wakeLockRef = useRef<{ release(): Promise<void> } | null>(null)
  const wakeLockSupported = typeof navigator !== 'undefined' && 'wakeLock' in navigator && 'request' in (navigator.wakeLock ?? {})

  const readerTheme = settings.readerTheme || 'default'
  const readerPageWidth = settings.readerPageWidth || 'standard'
  const readerLineHeight = settings.readerLineHeight || '1.95'
  const readerParagraphSpacing = settings.readerParagraphSpacing || '1.4'
  const readerClickPaging = settings.readerClickPaging !== 'off'
  const readerAutoScrollSpeed = settings.readerAutoScrollSpeed || 'off'

  // ---------- 章节加载 ----------
  const cacheChapter = useCallback((ch: ChapterFull): ChapterFull => {
    if (!ch || !ch.id) return ch
    cacheRef.current.delete(ch.id)
    cacheRef.current.set(ch.id, ch)
    while (cacheRef.current.size > CHAPTER_CACHE_MAX) {
      const first = cacheRef.current.keys().next().value
      if (first) cacheRef.current.delete(first)
    }
    return ch
  }, [])

  const loadChapterData = useCallback(
    async (cid: string, useDemo: boolean): Promise<ChapterFull> => {
      const cached = cacheRef.current.get(cid)
      if (cached) return cached
      if (useDemo) {
        const { getDemoChapter } = await import('../lib/demoReader')
        const demo = getDemoChapter(cid)
        if (demo) return cacheChapter(demo as ChapterFull)
        throw new Error('demo chapter not found')
      }
      const data = await chaptersApi.get(cid)
      return cacheChapter(data.chapter)
    },
    [cacheChapter],
  )

  // 初次 / URL 变更加载
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setNotFound(false)
      setChapter(null)
      setChapterThoughts([])
      // 重置每章状态
      currentPageRef.current = 0
      totalPagesRef.current = 0
      hasRestoredRef.current = false
      try {
        let ch: ChapterFull
        let useDemo = false
        try {
          ch = await loadChapterData(chapterId, false)
        } catch {
          useDemo = true
          ch = await loadChapterData(chapterId, true)
          setDemoMode(true)
        }
        if (cancelled) return
        setChapter(ch)
        // 小说上下文（仅首次加载列表）
        const nid = ch.novelId || novelId
        try {
          const [novelData, chaptersData] = await Promise.all([novelsApi.get(nid), chaptersApi.list(nid)])
          if (cancelled) return
          setNovel(novelData.novel || null)
          setAllChapters(chaptersData.chapters || [])
        } catch {
          if (useDemo) {
            const { getDemoChapters, getDemoNovelTitle } = await import('../lib/demoReader')
            setAllChapters(getDemoChapters(nid))
            setNovel({ id: nid, title: getDemoNovelTitle(nid) })
          }
        }
        setLoading(false)
      } catch {
        if (!cancelled) {
          setNotFound(true)
          setLoading(false)
        }
      }
    }
    void load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [novelId, chapterId])

  // ---------- 应用设置到 DOM ----------
  useEffect(() => {
    const app = readerAppRef.current
    const body = bodyRef.current
    if (!app || !body) return
    body.style.fontSize = FONT_SIZES[fontSize]!
    body.classList.toggle('reader-body--sans', settings.fontFamily === 'sans')
    app.setAttribute('data-reader-theme', readerTheme)
    app.style.setProperty('--reader-width', PAGE_WIDTHS[readerPageWidth]!)
    body.style.setProperty('--reader-line-height', readerLineHeight)
    body.style.setProperty('--reader-paragraph-spacing', readerParagraphSpacing + 'em')
    app.classList.toggle('reader-page-mode', pageMode)
    app.classList.toggle('reader-click-paging-off', !readerClickPaging)
  }, [fontSize, settings.fontFamily, readerTheme, readerPageWidth, readerLineHeight, readerParagraphSpacing, pageMode, readerClickPaging, chapter])

  // ---------- 段评段落索引 + 加载想法 ----------
  const indexParagraphs = useCallback(() => {
    const body = bodyRef.current
    if (!body) return
    body.querySelectorAll('p').forEach((p, index) => {
      p.setAttribute('data-paragraph-index', String(index))
      p.setAttribute('data-paragraph-hash', hashParagraphText(p.textContent || ''))
    })
  }, [])

  useEffect(() => {
    if (!chapter) return
    // 等待内容挂载
    const raf = requestAnimationFrame(() => {
      indexParagraphs()
      schedulePageRecalc()
    })
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapter])

  const loadThoughts = useCallback(async () => {
    if (!chapter) return
    if (chapter.id.startsWith('dc')) {
      setChapterThoughts([])
      return
    }
    try {
      const data = await thoughtsApi.list(chapter.id)
      setChapterThoughts(data.thoughts || [])
    } catch {
      setChapterThoughts([])
    }
  }, [chapter])

  useEffect(() => {
    if (!chapter) return
    void loadThoughts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapter?.id])

  const thoughtsByParagraph = useMemo(() => {
    const map: Record<string, Thought[]> = {}
    chapterThoughts.forEach((t) => {
      const key = String(t.paragraphIndex)
      ;(map[key] ||= []).push(t)
    })
    return map
  }, [chapterThoughts])

  // ---------- 进度恢复 ----------
  const saveScrollPosition = useCallback(() => {
    if (!chapter || !hasRestoredRef.current) return
    const nid = chapter.novelId || novelId
    if (!nid) return
    const saved = getNovelHistoryHelper(nid, chapter.id)
    if (pageMode) {
      const total = totalPagesRef.current > 0 ? totalPagesRef.current : calcTotalPages()
      const pageIndex = clamp(currentPageRef.current || 0, 0, Math.max(total - 1, 0))
      const pagePct = total > 1 ? pageIndex / (total - 1) : 0
      saveHistory(nid, {
        novelId: nid, novelTitle: novel?.title || '', chapterId: chapter.id, chapterTitle: chapter.title, chapterOrder: chapter.order,
        scrollPercent: pagePct, pageMode: 'page', pageIndex, pagePercent: pagePct, timestamp: Date.now(),
      })
      queueProgress(nid, chapter.id, pagePct)
      return
    }
    const body = bodyRef.current
    if (!body) return
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight
    if (maxScroll <= 0) return
    const pct = Math.round((window.scrollY / maxScroll) * 1000) / 1000
    if (!Number.isFinite(pct)) return
    const pageModeFromSaved = saved?.pageMode || ''
    saveHistory(nid, {
      novelId: nid, novelTitle: novel?.title || '', chapterId: chapter.id, chapterTitle: chapter.title, chapterOrder: chapter.order,
      scrollPercent: pct, pageMode: pageModeFromSaved || 'scroll', pageIndex: saved?.pageIndex || 0, pagePercent: saved?.pagePercent || 0, timestamp: Date.now(),
    })
    queueProgress(nid, chapter.id, pct)
  }, [chapter, novelId, novel, pageMode, queueProgress])

  const restoreScrollPosition = useCallback(() => {
    if (!chapter) return
    const nid = chapter.novelId || novelId
    if (!nid) return Promise.resolve()
    const history = getNovelHistoryHelper(nid, chapter.id)
    let scrollPct = 0
    let savedPageMode = false
    let savedPage = 0
    if (history && history.chapterId === chapter.id) {
      if (Number(history.scrollPercent) > 0) scrollPct = clamp(Number(history.scrollPercent), 0, 1)
      if (history.pageMode === 'page' || history.pageMode === true || (history.pageMode !== 'scroll' && Number.isFinite(Number(history.pageMode)))) {
        savedPageMode = true
        savedPage = Number.isFinite(Number(history.pageIndex)) ? parseInt(String(history.pageIndex), 10) : parseInt(String(history.pageMode), 10)
        if (!Number.isFinite(savedPage)) savedPage = 0
      }
    }
    return new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        if (pageMode && (savedPageMode || scrollPct > 0)) {
          const total = calcTotalPages()
          totalPagesRef.current = total
          currentPageRef.current = savedPageMode
            ? clamp(savedPage, 0, Math.max(total - 1, 0))
            : clamp(Math.round(scrollPct * Math.max(total - 1, 0)), 0, Math.max(total - 1, 0))
          if (currentPageRef.current > 0) jumpScrollTo(Math.round(currentPageRef.current * getPageHeight()))
          updatePageIndicator()
        } else if (scrollPct > 0) {
          const targetY = scrollPct * (document.documentElement.scrollHeight - window.innerHeight)
          if (Number.isFinite(targetY) && targetY > 0) jumpScrollTo(Math.round(targetY))
        }
        hasRestoredRef.current = true
        updateChapterProgress()
        resolve()
      })
    })
  }, [chapter, novelId, pageMode])

  function getNovelHistoryHelper(nid: string, cid: string) {
    // 从 storage 读取指定章节记录
    try {
      const raw = localStorage.getItem('novel_reading_history')
      const all = raw ? JSON.parse(raw) : {}
      return all[nid] || null
    } catch {
      return null
    }
  }

  // ---------- 页面模式 ----------
  function calcTotalPages(): number {
    const body = bodyRef.current
    if (!body) return 0
    const h = body.scrollHeight + 160
    const ph = getPageHeight()
    return Math.max(1, Math.ceil(h / ph))
  }

  function updatePageIndicator() {
    if (!pageMode) return
    if (totalPagesRef.current <= 0) totalPagesRef.current = calcTotalPages()
    currentPageRef.current = clamp(currentPageRef.current || 0, 0, Math.max(totalPagesRef.current - 1, 0))
    updateChapterProgress()
  }

  function getChapterProgressPercent(): number {
    if (pageMode) {
      if (totalPagesRef.current <= 0) totalPagesRef.current = calcTotalPages()
      return totalPagesRef.current > 1 ? clamp(currentPageRef.current / (totalPagesRef.current - 1), 0, 1) : 0
    }
    return currentScrollPercent()
  }

  function updateChapterProgress() {
    const pct = getChapterProgressPercent()
    const percent = Math.round(pct * 100)
    const text = pageMode
      ? `第 ${Math.min((currentPageRef.current || 0) + 1, Math.max(totalPagesRef.current, 1))} / ${Math.max(totalPagesRef.current, 1)} 页 · 本章 ${percent}%`
      : `本章 ${percent}%`
    setChapterProgressText(text)
    setChapterProgressPercent(percent)
  }

  const [chapterProgressText, setChapterProgressText] = useState('本章 0%')
  const [chapterProgressPercent, setChapterProgressPercent] = useState(0)

  function schedulePageRecalc() {
    if (!pageMode || !readerAppRef.current || !bodyRef.current) return
    const pct = totalPagesRef.current > 1 ? currentPageRef.current / (totalPagesRef.current - 1) : currentScrollPercent()
    requestAnimationFrame(() => {
      totalPagesRef.current = calcTotalPages()
      currentPageRef.current = clamp(Math.round(pct * Math.max(totalPagesRef.current - 1, 0)), 0, Math.max(totalPagesRef.current - 1, 0))
      jumpScrollTo(Math.round(currentPageRef.current * getPageHeight()))
      updatePageIndicator()
    })
  }

  function pageNavigate(direction: 'prev' | 'next') {
    if (!pageMode) return
    if (totalPagesRef.current === 0) totalPagesRef.current = calcTotalPages()
    if (direction === 'next') {
      if (currentPageRef.current < totalPagesRef.current - 1) {
        currentPageRef.current++
        window.scrollTo({ top: Math.round(currentPageRef.current * getPageHeight()), behavior: scrollBehavior() })
        updatePageIndicator()
        saveScrollPosition()
      } else {
        navigateToChapter('next')
      }
    } else {
      if (currentPageRef.current > 0) {
        currentPageRef.current--
        window.scrollTo({ top: Math.round(currentPageRef.current * getPageHeight()), behavior: scrollBehavior() })
        updatePageIndicator()
        saveScrollPosition()
      } else {
        navigateToChapter('prev')
      }
    }
  }

  // ---------- 章节导航 ----------
  const navigateToChapter = useCallback(
    (direction: 'prev' | 'next') => {
      if (allChapters.length === 0 || !chapter) return
      const idx = allChapters.findIndex((c) => c.id === chapter.id)
      const target = direction === 'prev' ? idx - 1 : idx + 1
      if (target < 0 || target >= allChapters.length) return
      const ch = allChapters[target]!
      // 保存当前进度（换章前冲刷）
      saveScrollPosition()
      flushProgress()
      navigate(`/read/${encodeURIComponent(ch.novelId || novelId)}/${encodeURIComponent(ch.id)}`, { replace: true })
    },
    [allChapters, chapter, novelId, navigate, saveScrollPosition, flushProgress],
  )

  const gotoChapter = useCallback(
    (cid: string, nid?: string) => {
      if (!cid) return
      if (nid && novelId && nid !== novelId) {
        navigate(`/read/${encodeURIComponent(nid)}/${encodeURIComponent(cid)}`)
        return
      }
      if (chapter && cid === chapter.id) return
      saveScrollPosition()
      flushProgress()
      navigate(`/read/${encodeURIComponent(novelId)}/${encodeURIComponent(cid)}`, { replace: true })
    },
    [novelId, chapter, navigate, saveScrollPosition, flushProgress],
  )

  // 预取相邻章节
  useEffect(() => {
    if (prefetchTimer.current) clearTimeout(prefetchTimer.current)
    if (!chapter || allChapters.length === 0) return
    prefetchTimer.current = setTimeout(() => {
      const idx = allChapters.findIndex((c) => c.id === chapter.id)
      if (idx === -1) return
      ;[idx + 1, idx - 1].forEach((i) => {
        const ch = allChapters[i]
        if (!ch || !ch.id || cacheRef.current.has(ch.id)) return
        chaptersApi.get(ch.id).then((data) => cacheChapter(data.chapter)).catch(() => {})
      })
    }, 500)
    return () => {
      if (prefetchTimer.current) clearTimeout(prefetchTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapter?.id, allChapters.length])

  // ---------- 滚动跟踪 ----------
  useEffect(() => {
    const onScroll = () => {
      if (scrollTimer.current) clearTimeout(scrollTimer.current)
      scrollTimer.current = setTimeout(saveScrollPosition, 800)
      updateChapterProgress()
    }
    window.addEventListener('scroll', onScroll, { passive: true })

    function persistNow() {
      if (scrollTimer.current) clearTimeout(scrollTimer.current)
      saveScrollPosition()
      flushProgress(true)
    }
    const onVis = () => {
      if (document.visibilityState === 'hidden') persistNow()
    }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('pagehide', persistNow)
    window.addEventListener('beforeunload', persistNow)
    return () => {
      window.removeEventListener('scroll', onScroll)
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('pagehide', persistNow)
      window.removeEventListener('beforeunload', persistNow)
    }
  }, [saveScrollPosition, flushProgress])

  // 章节变化后恢复进度
  useEffect(() => {
    if (!chapter) return
    hasRestoredRef.current = false
    void restoreScrollPosition()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapter?.id])

  // 窗口 resize 重算分页
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const onResize = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(schedulePageRecalc, 120)
    }
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onResize)
      if (timer) clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageMode, chapter?.id])

  // ---------- 键盘快捷键 ----------
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (pageMode) {
        if (e.key === 'ArrowLeft' || e.key === 'PageUp' || (e.key === ' ' && e.shiftKey)) { e.preventDefault(); pageNavigate('prev') }
        if (e.key === 'ArrowRight' || e.key === 'PageDown' || (e.key === ' ' && !e.shiftKey)) { e.preventDefault(); pageNavigate('next') }
      } else {
        if (e.key === 'ArrowLeft') { e.preventDefault(); navigateToChapter('prev') }
        if (e.key === 'ArrowRight') { e.preventDefault(); navigateToChapter('next') }
        if (e.key === ' ') { e.preventDefault(); window.scrollBy({ top: window.innerHeight * 0.85, behavior: scrollBehavior() }) }
      }
      if (e.key === 'Home') { e.preventDefault(); window.scrollTo({ top: 0, behavior: scrollBehavior() }) }
      if (e.key === 'End') { e.preventDefault(); window.scrollTo({ top: document.body.scrollHeight, behavior: scrollBehavior() }) }
      if (e.key === 'Escape') {
        setDropdownOpen(false)
        setSettingsPanelOpen(false)
        setMobileSettingsOpen(false)
        setMobileLibraryOpen(false)
        setBookmarkPanelOpen(false)
        setThoughtPanelOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageMode, chapter?.id, allChapters.length])

  // ---------- 触摸滑动 ----------
  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    let startX = 0, startY = 0, startTime = 0
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      startX = e.touches[0]!.clientX
      startY = e.touches[0]!.clientY
      startTime = Date.now()
    }
    const onEnd = (e: TouchEvent) => {
      if (startX === 0) return
      const endX = e.changedTouches[0]!.clientX
      const endY = e.changedTouches[0]!.clientY
      const dx = endX - startX
      const dy = endY - startY
      const dt = Date.now() - startTime
      startX = 0; startY = 0; startTime = 0
      if (dt > 400) return
      if (Math.abs(dx) < 60) return
      if (Math.abs(dy) > Math.abs(dx) * 0.6) return
      if (pageMode) { if (dx > 0) pageNavigate('prev'); else pageNavigate('next') }
      else { if (dx > 0) navigateToChapter('prev'); else navigateToChapter('next') }
    }
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchend', onEnd, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchend', onEnd)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageMode, chapter?.id])

  // ---------- 分页点击热区 ----------
  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    const zone = el
    function handleTap(e: MouseEvent | TouchEvent) {
      if (!pageMode || !readerClickPaging) return
      if (window.getSelection()?.toString().trim()) return
      const target = e.target as HTMLElement
      if (target.closest('button, a, input, textarea, select, .chapter-dropdown, .bookmark-panel, .reader-controls, .reader-nav-group, .thought-panel, .thought-selection-popover, .thought-marker')) return
      const rect = zone.getBoundingClientRect()
      if (!rect || rect.width === 0) return
      const clientX = 'touches' in e ? e.touches[0]!.clientX : (e as MouseEvent).clientX
      const relX = (clientX - rect.left) / rect.width
      if (relX < 0.35) { e.preventDefault(); pageNavigate('prev') }
      else if (relX > 0.65) { e.preventDefault(); pageNavigate('next') }
    }
    el.addEventListener('click', handleTap)
    el.addEventListener('touchend', handleTap, { passive: false })
    return () => {
      el.removeEventListener('click', handleTap)
      el.removeEventListener('touchend', handleTap)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageMode, readerClickPaging, chapter?.id])

  // ---------- 自动滚动 ----------
  useEffect(() => {
    function tick(ts: number) {
      const s = autoScrollRef.current
      if (!s.running) return
      if (document.hidden || settingsPanelOpen || mobileSettingsOpen || mobileLibraryOpen || thoughtPanelOpen) {
        s.frame = requestAnimationFrame(tick)
        return
      }
      if (!s.lastTs) s.lastTs = ts
      const delta = Math.min(64, ts - s.lastTs)
      s.lastTs = ts
      const speed = AUTO_SCROLL_SPEEDS[readerAutoScrollSpeed] || 0
      if (!speed) { stop(); return }
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight
      if (maxScroll <= 0 || window.scrollY >= maxScroll - 2) { stop(); return }
      s.remainder += (speed * delta) / 1000
      const step = Math.floor(s.remainder)
      if (step >= 1) {
        s.remainder -= step
        window.scrollBy({ top: step, left: 0, behavior: 'instant' })
        updateChapterProgress()
      }
      s.frame = requestAnimationFrame(tick)
    }
    function start() {
      const s = autoScrollRef.current
      if (s.running) return
      if (pageMode) set('readerPageMode', 'scroll')
      s.running = true
      s.lastTs = 0
      s.remainder = 0
      setAutoScrollRunning(true)
      s.frame = requestAnimationFrame(tick)
    }
    function stop() {
      const s = autoScrollRef.current
      s.running = false
      cancelAnimationFrame(s.frame)
      s.frame = 0
      s.lastTs = 0
      setAutoScrollRunning(false)
    }
    function onUserInput() {
      if (autoScrollRef.current.running) stop()
    }
    // 速度非 off 时启动自动滚动（按钮/设置面板仅改 readerAutoScrollSpeed，这里负责真正开跑）
    if (readerAutoScrollSpeed !== 'off') start()
    window.addEventListener('wheel', onUserInput, { passive: true })
    window.addEventListener('touchstart', onUserInput, { passive: true })
    window.addEventListener('keydown', onUserInput, { passive: true })
    return () => {
      window.removeEventListener('wheel', onUserInput)
      window.removeEventListener('touchstart', onUserInput)
      window.removeEventListener('keydown', onUserInput)
      stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readerAutoScrollSpeed, settingsPanelOpen, mobileSettingsOpen, mobileLibraryOpen, thoughtPanelOpen, pageMode])

  // ---------- Wake Lock ----------
  useEffect(() => {
    const enabled = settings.readerWakeLock === 'on'
    async function request() {
      if (!wakeLockSupported || document.visibilityState !== 'visible') return
      try {
        const sentinel = await (navigator.wakeLock as { request(kind: string): Promise<{ release(): Promise<void>; addEventListener(t: string, cb: () => void): void }> }).request('screen')
        wakeLockRef.current = sentinel
        sentinel.addEventListener('release', () => { wakeLockRef.current = null })
      } catch {
        wakeLockRef.current = null
      }
    }
    async function release() {
      if (wakeLockRef.current) {
        await wakeLockRef.current.release().catch(() => {})
        wakeLockRef.current = null
      }
    }
    if (enabled) void request()
    else void release()
    const onVis = () => {
      if (document.visibilityState === 'visible') { if (enabled) void request() }
      else void release()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      void release()
    }
  }, [settings.readerWakeLock, wakeLockSupported])

  // ---------- 书签 ----------
  const currentBookmarked = chapter ? isBookmarked(chapter.novelId || novelId, chapter.id) : false

  function syncBookmarksToServer() {
    if (getToken()) void bookmarksApi.replace(getAllBookmarks()).catch(() => {})
  }

  function handleBookmarkToggle() {
    if (!chapter) return
    const nid = chapter.novelId || novelId
    if (currentBookmarked) {
      toggleBookmark(nid, novel?.title || '', chapter.id, chapter.title, chapter.order)
      syncBookmarksToServer()
    } else if (bookmarkNoteOpen) {
      addBookmark(nid, novel?.title || '', chapter.id, chapter.title, chapter.order, bookmarkNote.trim() || undefined)
      syncBookmarksToServer()
      setBookmarkNoteOpen(false)
      setBookmarkNote('')
    } else {
      setBookmarkNote('')
      setBookmarkNoteOpen(true)
    }
    setBookmarks(getAllBookmarks())
  }

  function handleBookmarkNoteKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleBookmarkToggle()
    else if (e.key === 'Escape') {
      setBookmarkNoteOpen(false)
      setBookmarkNote('')
    }
  }

  function deleteBookmark(id: string) {
    removeBookmark(id)
    syncBookmarksToServer()
    setBookmarks(getAllBookmarks())
  }

  // ---------- 段评交互 ----------
  useEffect(() => {
    if (!chapter) return
    function handleSelection() {
      const selection = window.getSelection()
      if (!selection || selection.rangeCount === 0) {
        setPopoverPos(null)
        return
      }
      const text = selection.toString().replace(/\s+/g, ' ').trim()
      const contentEl = contentRef.current
      if (!text || !contentEl) {
        setPopoverPos(null)
        return
      }
      if (!contentEl.contains(selection.anchorNode) || !contentEl.contains(selection.focusNode)) {
        setPopoverPos(null)
        return
      }
      const startP = closestParagraph(selection.anchorNode)
      const endP = closestParagraph(selection.focusNode)
      if (!startP || !endP || startP !== endP) {
        setPopoverPos(null)
        return
      }
      const paragraphIndex = Number(startP.dataset.paragraphIndex)
      if (!Number.isInteger(paragraphIndex)) return
      const sliced = text.length > 200 ? text.slice(0, 200) : text
      setPendingSelection({
        paragraphIndex,
        paragraphHash: startP.dataset.paragraphHash || '',
        selectedText: sliced,
      })
      const rect = selection.getRangeAt(0).getBoundingClientRect()
      setPopoverPos({
        left: Math.min(window.innerWidth - 104, Math.max(12, rect.left + rect.width / 2 - 44)),
        top: Math.max(12, rect.top - 44),
      })
    }
    let selectionTimer: ReturnType<typeof setTimeout> | null = null
    function onSelectionChange() {
      if (selectionTimer) clearTimeout(selectionTimer)
      selectionTimer = setTimeout(handleSelection, 120)
    }
    const contentEl = contentRef.current
    document.addEventListener('selectionchange', onSelectionChange)
    contentEl?.addEventListener('mouseup', handleSelection)
    contentEl?.addEventListener('touchend', () => setTimeout(handleSelection, 180), { passive: true })
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange)
      contentEl?.removeEventListener('mouseup', handleSelection)
      if (selectionTimer) clearTimeout(selectionTimer)
    }
  }, [chapter?.id])

  function closestParagraph(node: Node | null): HTMLElement | null {
    if (!node) return null
    const el = node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement
    return el ? el.closest<HTMLElement>('.reader-body p') : null
  }

  function openThoughtPanel(index: number) {
    setActiveThoughtParagraph(index)
    setThoughtPanelOpen(true)
    setPopoverPos(null)
  }

  async function submitThought(text: string, displayName: string) {
    if (!chapter || activeThoughtParagraph === null) return
    const paragraph = bodyRef.current?.querySelector<HTMLElement>(`p[data-paragraph-index="${activeThoughtParagraph}"]`)
    const selectedText = pendingSelection && pendingSelection.paragraphIndex === activeThoughtParagraph ? pendingSelection.selectedText : ''
    try {
      const result = await thoughtsApi.create(
        {
          novelId: chapter.novelId || novelId,
          chapterId: chapter.id,
          paragraphIndex: activeThoughtParagraph,
          paragraphHash: paragraph?.dataset.paragraphHash || '',
          selectedText,
          thoughtText: text,
          displayName: displayName || user?.displayName || user?.username || '',
        },
        getReaderClientId(),
      )
      if (result.thought) setChapterThoughts((prev) => [...prev, result.thought])
      setPendingSelection(null)
      if (window.getSelection) window.getSelection()?.removeAllRanges()
    } catch (err) {
      throw err
    }
  }

  async function deleteThought(id: string) {
    try {
      await thoughtsApi.remove(id)
      setChapterThoughts((prev) => prev.filter((t) => t.id !== id))
    } catch (err) {
      toast((err as Error).message || '删除失败', 'error')
    }
  }

  // ---------- 渲染 ----------
  const dropdownMatches = filterChapters(allChapters, dropdownQuery)
  const currentIdx = chapter ? allChapters.findIndex((c) => c.id === chapter.id) : -1
  const mobileChapterMatches = filterChapters(allChapters, mobileChapterQuery)

  if (notFound) {
    return (
      <div className="empty-state" style={{ minHeight: '60vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
        <div className="empty-state__icon">📖</div>
        <div className="empty-state__title">章节未找到</div>
        <div className="empty-state__desc">该章节不存在或已被移除</div>
        <Link to="/" className="btn btn--primary" style={{ marginTop: 20 }}>返回首页</Link>
      </div>
    )
  }

  if (loading || !chapter) {
    return (
      <div className="loading-center" style={{ minHeight: '60vh' }}>
        <div className="spinner spinner--lg"></div>
      </div>
    )
  }

  const nid = chapter.novelId || novelId
  const html = formatContent(chapter.content)

  return (
    <div ref={readerAppRef} className={`reader-app${pageMode ? ' reader-page-mode' : ''}${readerClickPaging ? '' : ' reader-click-paging-off'}`} data-reader-theme={readerTheme}>
      <div className="reader-shell">
        {/* Top bar */}
        <div className="reader-top">
          <span className="reader-novel-title">{novel?.title || ''}</span>
          <div className="reader-nav-group">
            <button className="reader-nav-btn" disabled={currentIdx <= 0} onClick={() => navigateToChapter('prev')}>上一章</button>
            <button
              type="button"
              className="reader-nav-btn reader-chapter-trigger"
              aria-haspopup="listbox"
              aria-expanded={dropdownOpen}
              onClick={(e) => { e.stopPropagation(); setDropdownOpen((v) => !v) }}
            >
              <span>{chapter.order ? `第${chapter.order}章` : (chapter.title || '章节').slice(0, 12)}</span>
              <svg className="chapter-select-arrow" viewBox="0 0 10 10" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><polyline points="2 3 5 7 8 3" /></svg>
            </button>
            <button className="reader-nav-btn" disabled={currentIdx >= allChapters.length - 1} onClick={() => navigateToChapter('next')}>下一章</button>
            <Link to={`/novel/${encodeURIComponent(nid)}`} className="reader-nav-btn reader-nav-toc" title="返回详情">详情</Link>
          </div>
          <div className="reader-controls">
            <button aria-label="缩小字号" onClick={() => set('fontSize', String(Math.max(0, fontSize - 1)))}>A−</button>
            <span>{FONT_LABELS[fontSize]}</span>
            <button aria-label="放大字号" onClick={() => set('fontSize', String(Math.min(5, fontSize + 1)))}>A+</button>
            <button className={`reader-controls__font${settings.fontFamily === 'sans' ? ' active' : ''}`} aria-label="切换字体" title={settings.fontFamily === 'sans' ? '当前: 无衬线 (黑体)' : '当前: 衬线 (宋体)'} onClick={() => set('fontFamily', settings.fontFamily === 'sans' ? 'serif' : 'sans')}>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 2h10M8 2v12M6 14h4" /><path d="M4 8h1.5M10.5 8H12" /></svg>
            </button>
            <button className={`reader-controls__pagemode${pageMode ? ' active' : ''}`} aria-label="切换阅读模式" title="切换阅读模式" onClick={() => set('readerPageMode', pageMode ? 'scroll' : 'page')}>
              <svg className="pagemode-icon pagemode-icon--scroll" style={{ display: pageMode ? 'none' : '' }} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 2h12v12H2z" /><line x1="2" y1="5" x2="14" y2="5" /><line x1="2" y1="11" x2="14" y2="11" /></svg>
              <svg className="pagemode-icon pagemode-icon--page" style={{ display: pageMode ? '' : 'none' }} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 2h12v12H2z" /><line x1="8" y1="2" x2="8" y2="14" /></svg>
            </button>
            <button className={`reader-controls__auto${autoScrollRunning ? ' active' : ''}`} aria-label="自动滚动" title={autoScrollRunning ? '停止自动滚动' : (readerAutoScrollSpeed === 'off' ? '自动滚动：关闭' : `开始自动滚动：${readerAutoScrollSpeed === 'fast' ? '快' : readerAutoScrollSpeed === 'medium' ? '中' : '慢'}`)} onClick={() => { if (autoScrollRunning) set('readerAutoScrollSpeed', 'off'); else set('readerAutoScrollSpeed', readerAutoScrollSpeed === 'off' ? 'slow' : readerAutoScrollSpeed) }}>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M8 2v12" /><polyline points="4.5 9.5 8 13 11.5 9.5" /><path d="M4 3.5h8" /></svg>
            </button>
            <button className={`reader-controls__bookmark${currentBookmarked ? ' bookmarked' : ''}`} aria-label={currentBookmarked ? '移除书签' : '添加书签'} aria-pressed={currentBookmarked} title={currentBookmarked ? '移除书签' : '添加书签'} onClick={handleBookmarkToggle}>
              <svg className="bookmark-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 2h12v12l-6-4-6 4V2z" /></svg>
            </button>
            {bookmarkNoteOpen && (
              <div className="bookmark-note-wrap active">
                <input
                  type="text"
                  className="bookmark-note-input"
                  placeholder="备注（可选）…"
                  maxLength={60}
                  autoFocus
                  value={bookmarkNote}
                  onChange={(e) => setBookmarkNote(e.target.value)}
                  onKeyDown={handleBookmarkNoteKey}
                  onBlur={() => {
                    if (bookmarkNote.trim()) handleBookmarkToggle()
                    else setBookmarkNoteOpen(false)
                  }}
                />
                <button className="bookmark-note-btn" onMouseDown={(e) => e.preventDefault()} onClick={handleBookmarkToggle}>✓</button>
              </div>
            )}
            <button className={`reader-controls__bm-list${bookmarkPanelOpen ? ' active' : ''}`} aria-label="书签列表" title="书签列表" onClick={() => setBookmarkPanelOpen((v) => !v)}>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="1" width="12" height="14" rx="2" /><line x1="5" y1="5" x2="11" y2="5" /><line x1="5" y1="8" x2="11" y2="8" /><line x1="5" y1="11" x2="9" y2="11" /></svg>
            </button>
            <button className={`reader-controls__settings${settingsPanelOpen ? ' active' : ''}`} aria-label="阅读设置" aria-haspopup="dialog" aria-expanded={settingsPanelOpen} title="阅读设置" onClick={(e) => { e.stopPropagation(); setSettingsPanelOpen((v) => !v) }}>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="8" r="2" /><path d="M12.6 9.4l1 .7-1.2 2.1-1.2-.4c-.4.3-.8.5-1.2.7L9.8 14H6.2L6 12.5c-.4-.2-.8-.4-1.2-.7l-1.2.4L2.4 10l1-.7a5 5 0 0 1 0-1.4l-1-.7 1.2-2.1 1.2.4c.4-.3.8-.5 1.2-.7L6.2 2h3.6l.2 1.5c.4.2.8.4 1.2.7l1.2-.4 1.2 2.1-1 .7c.1.5.1 1 0 1.4z" /></svg>
            </button>
            <button className="theme-btn" aria-label="切换主题" onClick={(e) => toggleTheme(e)}>
              <SunIcon className="theme-icon theme-icon--sun" width={12} height={12} />
              <MoonIcon className="theme-icon theme-icon--moon" width={12} height={12} />
            </button>
          </div>

          {/* Desktop settings panel */}
          {settingsPanelOpen && (
            <section className="reader-settings-panel" role="dialog" aria-modal="false" aria-label="阅读设置" onClick={(e) => e.stopPropagation()}>
              <SettingsControls settings={settings} set={set} wakeLockSupported={wakeLockSupported} />
            </section>
          )}
        </div>

        {/* Chapter dropdown */}
        {dropdownOpen && (
          <div
            className="chapter-dropdown open"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="chapter-dropdown__tools">
              <input type="search" className="chapter-dropdown__filter" placeholder="搜索章节号或标题…" autoComplete="off" aria-label="搜索章节" autoFocus value={dropdownQuery} onChange={(e) => setDropdownQuery(e.target.value)} onKeyDown={(e) => {
                if (e.key === 'Escape') { e.stopPropagation(); setDropdownOpen(false) }
                else if (e.key === 'Enter') {
                  const matches = filterChapters(allChapters, dropdownQuery)
                  if (matches.length >= 1) gotoChapter(matches[0]!.id, matches[0]!.novelId || novelId)
                }
              }} />
              <span className="chapter-dropdown__count">{dropdownQuery ? `${dropdownMatches.length} / ${allChapters.length}` : `${allChapters.length} 章`}</span>
            </div>
            {dropdownMatches.length === 0 ? (
              <div className="chapter-dropdown__empty">没有匹配的章节</div>
            ) : (
              <div className="chapter-dropdown__scroll" role="listbox" aria-label="章节列表">
                <VirtualList
                  items={dropdownMatches}
                  rowHeight={CHAPTER_ROW_H}
                  scrollToIndex={Math.max(0, dropdownMatches.findIndex((c) => c.id === chapter.id))}
                  renderRow={(ch, i) => {
                    const isCurrent = ch.id === chapter.id
                    return (
                      <button
                        type="button"
                        className={`chapter-dropdown__item${isCurrent ? ' chapter-dropdown__item--current' : ''}`}
                        role="option"
                        aria-selected={isCurrent}
                        onClick={() => gotoChapter(ch.id, ch.novelId || novelId)}
                      >
                        {chapterLabel(ch, i)}
                      </button>
                    )
                  }}
                />
              </div>
            )}
          </div>
        )}

        {/* Bookmark panel */}
        {bookmarkPanelOpen && (
          <div className="bookmark-panel" onClick={(e) => e.stopPropagation()}>
            <div className="bookmark-panel__header">
              <span>书签</span>
              <span className="text-muted">{getNovelBookmarks(nid).length ? `共 ${getNovelBookmarks(nid).length} 个` : ''}</span>
            </div>
            <div className="bookmark-panel__list">
              {getNovelBookmarks(nid).length === 0 ? (
                <div className="bookmark-panel__empty">暂无书签</div>
              ) : (
                getNovelBookmarks(nid).map((bm) => (
                  <div className={`bookmark-panel__item${bm.chapterId === chapter.id ? ' bookmark-panel__item--current' : ''}`} key={bm.id}>
                    <button className="bookmark-panel__jump" onClick={() => gotoChapter(bm.chapterId, nid)}>
                      <span className="bookmark-panel__title">{bm.chapterTitle || `第 ${bm.chapterOrder || '?'} 章`}</span>
                      {bm.note && <span className="bookmark-panel__note">{bm.note}</span>}
                    </button>
                    <button className="bookmark-panel__del" title="删除书签" onClick={() => deleteBookmark(bm.id)}>
                      <svg viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><line x1="1" y1="1" x2="13" y2="13" /><line x1="13" y1="1" x2="1" y2="13" /></svg>
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Content */}
        <article
          ref={contentRef}
          className="reader-paper"
          onClick={(e) => {
            // 移动端：点击阅读区切换底部工具栏（分页模式下两侧为翻页热区，不抢）
            if (window.innerWidth > 640) return
            if ((e.target as HTMLElement).closest('button, a, input, textarea, select, .chapter-dropdown, .bookmark-panel, .reader-controls, .thought-panel, .thought-selection-popover')) return
            if (pageMode && readerClickPaging) {
              const rect = contentRef.current?.getBoundingClientRect()
              if (rect) {
                const relX = (e.clientX - rect.left) / rect.width
                if (relX < 0.35 || relX > 0.65) return
              }
            }
            setMobileBarHidden((v) => !v)
          }}
        >
          <div className="reader-chapter-num">{chapter.order ? `第 ${chapter.order} 章` : ''}</div>
          <h1 className="reader-chapter-title">{chapter.title}</h1>
          <div ref={bodyRef} className="reader-body" dangerouslySetInnerHTML={{ __html: html }} />
        </article>

        {/* Bottom nav */}
        <div className="reader-bottom">
          <button className="reader-nav-btn" disabled={currentIdx <= 0} onClick={() => navigateToChapter('prev')}>上一章</button>
          <div className="reader-progress">
            <span>{allChapters.length ? `${Math.min(currentIdx + 1, allChapters.length)} / ${allChapters.length} 章` : ''}</span>
            <span className="reader-chapter-progress-text">{chapterProgressText}</span>
            {pageMode && <span className="reader-page-indicator">第 {Math.min(currentPageRef.current + 1, Math.max(totalPagesRef.current, 1))} / {Math.max(totalPagesRef.current, 1)} 页</span>}
            <div className="progress-bar">
              <div className="progress-bar__fill" style={{ width: `${Math.round((currentIdx + 1) / Math.max(allChapters.length, 1) * 100)}%` }} role="progressbar" aria-label="阅读进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((currentIdx + 1) / Math.max(allChapters.length, 1) * 100)}></div>
            </div>
          </div>
          <button className="reader-nav-btn" disabled={currentIdx >= allChapters.length - 1} onClick={() => navigateToChapter('next')}>下一章</button>
        </div>
      </div>

      {/* Mobile reader bar */}
      <div className={`mobile-reader-bar${mobileBarHidden ? ' is-hidden' : ''}`} aria-label="移动端阅读工具栏" onClick={() => setMobileBarHidden(true)}>
        <div className="mobile-reader-progress" aria-hidden="true"><div className="mobile-reader-progress__fill" style={{ width: `${chapterProgressPercent}%` }}></div></div>
        <span className="mobile-reader-progress__text">本章 {chapterProgressPercent}%</span>
        <button type="button" className="mobile-reader-bar__btn" aria-label="章节目录" onClick={(e) => { e.stopPropagation(); setMobileLibraryOpen(true); setMobileLibraryTab('chapters') }}>
          <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="4" x2="15" y2="4" /><line x1="5" y1="9" x2="15" y2="9" /><line x1="5" y1="14" x2="15" y2="14" /><circle cx="2.5" cy="4" r="0.5" /><circle cx="2.5" cy="9" r="0.5" /><circle cx="2.5" cy="14" r="0.5" /></svg>
        </button>
        <button type="button" className="mobile-reader-bar__btn" aria-label="上一章" disabled={currentIdx <= 0} onClick={() => navigateToChapter('prev')}>
          <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="11 4 6 9 11 14" /></svg>
        </button>
        <button type="button" className={`mobile-reader-bar__btn${currentBookmarked ? ' bookmarked' : ''}`} aria-label={currentBookmarked ? '移除书签' : '添加书签'} onClick={handleBookmarkToggle}>
          <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 3h10v12l-5-3.2L4 15V3z" /></svg>
        </button>
        <button type="button" className="mobile-reader-bar__btn" aria-label="下一章" disabled={currentIdx >= allChapters.length - 1} onClick={() => navigateToChapter('next')}>
          <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="7 4 12 9 7 14" /></svg>
        </button>
        <button type="button" className="mobile-reader-bar__btn" aria-label="阅读设置" aria-expanded={mobileSettingsOpen} onClick={(e) => { e.stopPropagation(); setMobileSettingsOpen(true) }}>
          <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="9" r="2.2" /><path d="M14.2 10.6l1.1.8-1.4 2.4-1.3-.5a5.5 5.5 0 0 1-1.4.8L11 15.5H7l-.2-1.4a5.5 5.5 0 0 1-1.4-.8l-1.3.5-1.4-2.4 1.1-.8a5.8 5.8 0 0 1 0-1.6l-1.1-.8 1.4-2.4 1.3.5c.4-.3.9-.6 1.4-.8L7 2.5h4l.2 1.4c.5.2 1 .5 1.4.8l1.3-.5 1.4 2.4-1.1.8c.1.5.1 1.1 0 1.6z" /></svg>
        </button>
        <button type="button" className="mobile-reader-bar__btn theme-btn" aria-label="切换主题" onClick={(e) => toggleTheme(e)}>
          <SunIcon className="theme-icon theme-icon--sun" width={12} height={12} />
          <MoonIcon className="theme-icon theme-icon--moon" width={12} height={12} />
        </button>
      </div>

      {/* Mobile settings sheet */}
      {mobileSettingsOpen && (
        <>
          <div className="mobile-settings-overlay" onClick={() => setMobileSettingsOpen(false)}></div>
          <section className="mobile-settings-sheet" role="dialog" aria-modal="true" aria-labelledby="mobileSettingsTitle">
            <div className="mobile-settings-sheet__handle" aria-hidden="true"></div>
            <div className="mobile-settings-sheet__header">
              <h2 id="mobileSettingsTitle">阅读设置</h2>
              <button type="button" className="mobile-settings-sheet__close" aria-label="关闭阅读设置" onClick={() => setMobileSettingsOpen(false)}>×</button>
            </div>
            <div className="mobile-settings-sheet__body">
              <SettingsControls
                settings={settings}
                set={(key: ReaderSettingKey, value: string) => {
                  set(key, value)
                  setMobileSettingsOpen(false)
                  setMobileBarHidden(true)
                }}
                wakeLockSupported={wakeLockSupported}
              />
            </div>
          </section>
        </>
      )}

      {/* Mobile library sheet */}
      {mobileLibraryOpen && (
        <>
          <div className="mobile-library-overlay" onClick={() => setMobileLibraryOpen(false)}></div>
          <section className="mobile-library-sheet" role="dialog" aria-modal="true" aria-labelledby="mobileLibraryTitle">
            <div className="mobile-settings-sheet__handle" aria-hidden="true"></div>
            <div className="mobile-settings-sheet__header">
              <h2 id="mobileLibraryTitle">阅读面板</h2>
              <button type="button" className="mobile-settings-sheet__close" aria-label="关闭阅读面板" onClick={() => setMobileLibraryOpen(false)}>×</button>
            </div>
            <div className="mobile-library-tabs" role="tablist" aria-label="阅读面板">
              <button type="button" role="tab" aria-controls="mobileChapterList" className={mobileLibraryTab === 'chapters' ? 'active' : ''} onClick={() => setMobileLibraryTab('chapters')}>目录</button>
              <button type="button" role="tab" aria-controls="mobileBookmarkList" className={mobileLibraryTab === 'bookmarks' ? 'active' : ''} onClick={() => setMobileLibraryTab('bookmarks')}>书签</button>
            </div>
            {mobileLibraryTab === 'chapters' ? (
              <div className="mobile-library-panel" role="tabpanel" aria-labelledby="mobileLibraryTabChapters">
                <div className="mobile-library-search">
                  <input type="search" className="mobile-library-search__input" placeholder="搜索章节号或标题…" autoComplete="off" aria-label="搜索章节" value={mobileChapterQuery} onChange={(e) => setMobileChapterQuery(e.target.value)} />
                  <span className="mobile-library-search__count">{mobileChapterQuery ? `${mobileChapterMatches.length} / ${allChapters.length}` : `${allChapters.length} 章`}</span>
                </div>
                {mobileChapterMatches.length === 0 ? (
                  <div className="mobile-library-empty">{allChapters.length === 0 ? '暂无章节' : '没有匹配的章节'}</div>
                ) : (
                  <div className="mobile-library-scroll" role="listbox" aria-label="章节列表">
                    <VirtualList
                      items={mobileChapterMatches}
                      rowHeight={MOBILE_ROW_H}
                      scrollToIndex={Math.max(0, mobileChapterMatches.findIndex((c) => c.id === chapter.id))}
                      renderRow={(ch, i) => {
                        const isCurrent = ch.id === chapter.id
                        return (
                          <button
                            type="button"
                            className={`mobile-library-item${isCurrent ? ' mobile-library-item--current' : ''}`}
                            role="option"
                            aria-selected={isCurrent}
                            onClick={() => gotoChapter(ch.id, ch.novelId || novelId)}
                          >
                            <span className="mobile-library-item__title">{chapterLabel(ch, i)}</span>
                            {isCurrent && <span className="mobile-library-item__badge">在读</span>}
                          </button>
                        )
                      }}
                    />
                  </div>
                )}
              </div>
            ) : (
              <div className="mobile-library-panel" role="tabpanel" aria-labelledby="mobileLibraryTabBookmarks">
                {getNovelBookmarks(nid).length === 0 ? (
                  <div className="mobile-library-empty">暂无书签</div>
                ) : (
                  getNovelBookmarks(nid).map((bm) => (
                    <div className={`mobile-library-bookmark${bm.chapterId === chapter.id ? ' mobile-library-item--current' : ''}`} key={bm.id}>
                      <button type="button" className="mobile-library-bookmark__jump" onClick={() => gotoChapter(bm.chapterId, nid)}>
                        <span className="mobile-library-item__title">{bm.chapterTitle || `第${bm.chapterOrder}章`}</span>
                        {bm.note && <span className="mobile-library-item__meta">{bm.note}</span>}
                      </button>
                      <button type="button" className="mobile-library-bookmark__delete" aria-label="删除书签" onClick={() => deleteBookmark(bm.id)}>×</button>
                    </div>
                  ))
                )}
              </div>
            )}
          </section>
        </>
      )}

      {/* Thought selection popover */}
      {popoverPos && (
        <button
          type="button"
          className="thought-selection-popover"
          style={{ left: popoverPos.left, top: popoverPos.top }}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            if (pendingSelection) openThoughtPanel(pendingSelection.paragraphIndex)
          }}
        >
          写想法
        </button>
      )}

      {/* Thought panel */}
      {thoughtPanelOpen && activeThoughtParagraph !== null && (
        <ThoughtPanel
          thoughts={thoughtsByParagraph[String(activeThoughtParagraph)] || []}
          selectedText={pendingSelection && pendingSelection.paragraphIndex === activeThoughtParagraph ? pendingSelection.selectedText : ''}
          paragraphExcerpt={excerptText(bodyRef.current?.querySelector<HTMLElement>(`p[data-paragraph-index="${activeThoughtParagraph}"]`)?.textContent || '')}
          canDelete={(t) => !!user && t.userId === user.id}
          onClose={() => setThoughtPanelOpen(false)}
          onSubmit={(text, name) => submitThought(text, name).then(() => {})}
          onDelete={(id) => deleteThought(id)}
        />
      )}

      <Link to="/" className="float-top float-top--home visible" aria-label="回到首页" title="回到首页">
        <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 7.5l7-5.5 7 5.5" /><path d="M4.5 8.5v6h3v-4h3v4h3v-6" /></svg>
      </Link>
      <button className="float-top visible" aria-label="回到顶部" title="回到顶部" onClick={() => window.scrollTo({ top: 0, behavior: scrollBehavior() })}>
        <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="12 11 9 7 6 11" /><line x1="4" y1="14" x2="14" y2="14" /></svg>
      </button>
    </div>
  )
}
