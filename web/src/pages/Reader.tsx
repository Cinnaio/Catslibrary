/**
 * Reader 阅读器 —— 沉浸式阅读（由 Novel-KV js/read.js 2723 行平移为 React）。
 * 覆盖：章节加载/缓存/预取、滚动+分页双模式、进度保存/恢复（本地+服务端节流）、
 * 阅读设置（LWW 同步）、书签、自动滚动、键盘快捷键、触摸滑动、段评想法。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { ChapterFull, ChapterMeta, Thought } from '@shared/types'
import { removeAdPatterns } from '@shared/ad-cleaner'
import { bookmarksApi, chaptersApi, getToken, novelsApi, thoughtsApi, url } from '../lib/api'
import { addBookmark, getAllBookmarks, getNovelBookmarks, isBookmarked, removeBookmark, saveHistory, toggleBookmark } from '../lib/storage'
import { escHtml } from '@shared/utils'
import { useSession } from '../context/SessionContext'
import { useToast } from '../components/feedback'
import { useReaderSettings, FONT_SIZES, PAGE_WIDTHS, AUTO_SCROLL_SPEEDS } from '../hooks/useReaderSettings'
import type { ReaderSettingKey } from '../hooks/useReaderSettings'
import { useProgressSync } from '../hooks/useProgressSync'
import { VirtualList } from '../components/reader/VirtualList'
import { SettingsControls } from '../components/reader/SettingsControls'
import ThoughtPanel from '../components/reader/ThoughtPanel'
import ChapterRecap from '../components/reader/ChapterRecap'
import { ThemeMenu } from '../components/ThemeMenu'
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

/** 把内容区内所有文本节点线性化为全局字符索引（{ node, start }，按文档序）。 */
function buildTextIndex(root: Node): Array<{ node: Text; start: number }> {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const entries: Array<{ node: Text; start: number }> = []
  let acc = 0
  let node = walker.nextNode() as Text | null
  while (node) {
    entries.push({ node, start: acc })
    acc += node.textContent.length
    node = walker.nextNode() as Text | null
  }
  return entries
}

/** Range 端点 → 全局字符偏移；元素边界取容器内第一个文本节点。 */
function pointToOffset(pt: { node: Node; off: number }, index: Array<{ node: Text; start: number }>): number {
  for (const e of index) if (e.node === pt.node) return e.start + pt.off
  return -1
}

/** 元素内第一个文本节点起点 / 最后一个文本节点终点（字符偏移）。 */
function elemStartOffset(el: HTMLElement, index: Array<{ node: Text; start: number }>): number {
  const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  const first = tw.nextNode() as Text | null
  if (first) for (const e of index) if (e.node === first) return e.start
  return -1
}

function elemEndOffset(el: HTMLElement, index: Array<{ node: Text; start: number }>): number {
  let last: Text | null = null
  const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let n = tw.nextNode() as Text | null
  while (n) { last = n; n = tw.nextNode() as Text | null }
  if (last) for (const e of index) if (e.node === last) return e.start + last.textContent.length
  return -1
}

/**
 * 划选解析：返回选中文本占比最多的段落。
 * 用全局字符偏移线性化文档，规避 compareBoundaryPoints 对祖先/后代端点的歧义；
 * 跨段划选时也取主段落，避免"划了词却不显示"。
 */
function resolveSelectionParagraph(range: Range, contentEl: HTMLElement): { el: HTMLElement; text: string } | null {
  const index = buildTextIndex(contentEl)
  const rs = pointToOffset({ node: range.startContainer, off: range.startOffset }, index)
  const re = pointToOffset({ node: range.endContainer, off: range.endOffset }, index)
  if (rs < 0 || re < 0 || re <= rs) return null
  const paras = contentEl.querySelectorAll<HTMLElement>('p')
  let best: { el: HTMLElement; len: number; text: string } | null = null
  for (const para of paras) {
    const s = elemStartOffset(para, index)
    const e = elemEndOffset(para, index)
    if (s < 0 || e < 0) continue
    const lo = Math.max(rs, s)
    const hi = Math.min(re, e)
    if (hi > lo && (best === null || hi - lo > best.len)) {
      // 从字符区间还原该段内的选中文本（可能跨多个文本节点）
      const buf: string[] = []
      for (const ent of index) {
        const es = ent.start
        const ee = ent.start + ent.node.textContent.length
        if (ee > lo && es < hi) {
          const a = Math.max(es, lo)
          const b = Math.min(ee, hi)
          buf.push(ent.node.textContent.slice(a - es, b - es))
        }
      }
      const t = buf.join('').replace(/\s+/g, ' ').trim()
      if (t) best = { el: para, len: t.length, text: t }
    }
  }
  return best ? { el: best.el, text: best.text } : null
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
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null)
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
  // autoScrollRunning 仅由自动滚动 effect 内部写（start/stop），顶栏按钮收进
  // 设置面板后不再有 UI 读取它，故丢弃 useState 的首个绑定。
  const [, setAutoScrollRunning] = useState(false)

  // 移动端底部工具栏：默认收起，点击阅读区切换显隐
  const [mobileBarHidden, setMobileBarHidden] = useState(true)

  // DOM refs
  const readerAppRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const chapterTriggerRef = useRef<HTMLButtonElement>(null)
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
      setPopoverPos(null)
      setPendingSelection(null)
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
  }, [fontSize, settings.fontFamily, readerTheme, readerPageWidth, readerLineHeight, readerParagraphSpacing, pageMode, readerClickPaging, chapter, loading])

  // ---------- 段评段落索引 + 加载想法 ----------
  const indexParagraphs = useCallback(() => {
    const body = bodyRef.current
    if (!body) return
    body.querySelectorAll('p').forEach((p, index) => {
      p.setAttribute('data-paragraph-index', String(index))
      p.setAttribute('data-paragraph-hash', hashParagraphText(p.textContent || ''))
    })
  }, [])

  // 正文由 dangerouslySetInnerHTML 渲染，React 每次重渲染都会重建其子节点，
  // 导致 data-paragraph-index/hash 与 thought-highlight 全部丢失。
  // 因此在每次渲染提交后重新索引并套用划线（幂等且廉价）。
  useLayoutEffect(() => {
    const body = bodyRef.current
    if (!body || !chapter || loading) return
    indexParagraphs()
    applyThoughtHighlights()
  })

  useEffect(() => {
    // 分页高度依赖正文渲染完成后的布局，保留 rAF 延后一次。
    if (!chapter || loading) return
    const raf = requestAnimationFrame(() => {
      schedulePageRecalc()
    })
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapter, loading])

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

  // ---------- 想法划线 ----------
  const applyThoughtHighlights = useCallback(() => {
    const body = bodyRef.current
    if (!body) return
    body.querySelectorAll('p').forEach((p) => {
      const idx = p.getAttribute('data-paragraph-index')
      const hasThoughts = idx !== null && (thoughtsByParagraph[idx]?.length ?? 0) > 0
      p.classList.toggle('thought-highlight', hasThoughts)
    })
  }, [thoughtsByParagraph])

  // 点击有想法的段落打开想法面板
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (window.getSelection()?.toString().trim()) return
      const p = (e.target as HTMLElement).closest<HTMLElement>('p.thought-highlight')
      if (!p) return
      const idx = Number(p.dataset.paragraphIndex)
      if (Number.isInteger(idx)) openThoughtPanel(idx)
    }
    // 事件委托挂到 document：body 在加载期未挂载、重渲染会被替换，绑定在 body 上会丢失
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapter?.id, thoughtsByParagraph])

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
      // 滚动后选区位置变化，划词气泡会错位，直接收起
      setPopoverPos(null)
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
        setPopoverPos(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageMode, chapter?.id, allChapters.length])

  // ---------- 章节下拉：定位 + 点击空白关闭 ----------
  // 下拉用 position:fixed，需按触发按钮的视口坐标计算 top/left；
  // 同时挂一份 document click 监听，点空白处收起（触发按钮自身 stopPropagation，
  // 不会冒泡到 document，所以这里只会在点外部时触发）。
  useLayoutEffect(() => {
    if (!dropdownOpen) {
      setDropdownPos(null)
      return
    }
    const trigger = chapterTriggerRef.current
    if (trigger) {
      const r = trigger.getBoundingClientRect()
      const isMobile = window.matchMedia('(max-width: 768px)').matches
      const edge = isMobile ? 8 : 12
      // 与 reader.css 的响应式宽度保持一致：移动端几乎铺满视口，桌面端最多 360px。
      const dropdownW = isMobile ? Math.max(0, window.innerWidth - edge * 2) : Math.min(360, window.innerWidth - edge * 2)
      // 左沿与触发按钮左沿对齐，视觉上"挂在"按钮正下方（按钮右侧还有
      // 下一章/详情，右对齐会让下拉向左飘出很远）；贴边时再向内收。
      let left = r.left
      if (left < edge) left = edge
      if (left + dropdownW > window.innerWidth - edge) left = window.innerWidth - edge - dropdownW
      setDropdownPos({ top: r.bottom + 6, left })
    }
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('.chapter-dropdown, .reader-chapter-trigger')) return
      setDropdownOpen(false)
    }
    // 下拉用 fixed 定位，页面滚动后位置会错位，直接收起。
    const onScroll = () => setDropdownOpen(false)
    document.addEventListener('click', onDocClick)
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      document.removeEventListener('click', onDocClick)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [dropdownOpen])

  // ---------- 阅读设置面板：点击外部关闭 ----------
  // 面板与触发按钮自身均 stopPropagation，document 上的 click 只会收到真正的外部点击；
  // 滚动/缩放时面板位置随 sticky 顶栏偏移，与章节下拉一致地顺手收起。
  useEffect(() => {
    if (!settingsPanelOpen) return
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('.reader-settings-panel, .reader-controls__settings')) return
      setSettingsPanelOpen(false)
    }
    const onViewportChange = () => setSettingsPanelOpen(false)
    document.addEventListener('click', onDocClick)
    window.addEventListener('scroll', onViewportChange, { passive: true })
    window.addEventListener('resize', onViewportChange)
    return () => {
      document.removeEventListener('click', onDocClick)
      window.removeEventListener('scroll', onViewportChange)
      window.removeEventListener('resize', onViewportChange)
    }
  }, [settingsPanelOpen])

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
      const contentEl = contentRef.current
      // 只在存在有效选区时显示/更新气泡；关闭交由正文点击、滚动、Esc 处理，
      // 避免划词后 selectionchange 的竞态把刚出现的气泡立即关掉。
      if (!selection || selection.rangeCount === 0 || !contentEl) return
      const range = selection.getRangeAt(0)
      if (range.collapsed) return
      const parsed = resolveSelectionParagraph(range, contentEl)
      if (!parsed) return
      // 段落索引由渲染后的索引步骤写入；万一尚未写入，按 DOM 位置兜底计算。
      const paragraphIndex = Number(parsed.el.dataset.paragraphIndex)
      const fallbackIndex = Array.from(contentEl.querySelectorAll<HTMLElement>('p')).indexOf(parsed.el)
      const idx = Number.isInteger(paragraphIndex) ? paragraphIndex : fallbackIndex
      if (idx < 0) return
      setPendingSelection({
        paragraphIndex: idx,
        paragraphHash: parsed.el.dataset.paragraphHash || '',
        selectedText: parsed.text.length > 200 ? parsed.text.slice(0, 200) : parsed.text,
      })
      const rect = range.getBoundingClientRect()
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
    // 触摸划词结束后浏览器需要一点时间才最终确定选区，延迟稍长；
    // 即使此刻选区尚未就绪，handleSelection 也不会误关气泡。
    contentEl?.addEventListener('touchend', () => setTimeout(handleSelection, 300), { passive: true })
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange)
      contentEl?.removeEventListener('mouseup', handleSelection)
      if (selectionTimer) clearTimeout(selectionTimer)
    }
  }, [chapter?.id])

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
  // 前情提要讲的是上一章：首章没有上一章；演示章节（dc*）不在库里，生成必然 404，直接不给入口
  const prevCandidate = currentIdx > 0 ? allChapters[currentIdx - 1] : undefined
  const prevChapter = prevCandidate && !prevCandidate.id.startsWith('dc') ? prevCandidate : undefined
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
              ref={chapterTriggerRef}
              className={`reader-nav-btn reader-chapter-trigger${dropdownOpen ? ' open' : ''}`}
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
            <ThemeMenu className="theme-btn" ariaLabel="主题设置" title="主题设置">
              <SunIcon className="theme-icon theme-icon--sun" width={12} height={12} />
              <MoonIcon className="theme-icon theme-icon--moon" width={12} height={12} />
            </ThemeMenu>
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
            style={dropdownPos ? { top: dropdownPos.top, left: dropdownPos.left } : undefined}
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
              <VirtualList
                className="chapter-dropdown__scroll"
                ariaLabel="章节列表"
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
                      <span className="chapter-dropdown__item-title">{chapterLabel(ch, i)}</span>
                    </button>
                  )
                }}
              />
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
            // 点击正文（非气泡）时收起划词气泡；选区非空视为正在调整划选，不收起
            if (popoverPos && !window.getSelection()?.toString().trim()) {
              setPopoverPos(null)
            }
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
          <ChapterRecap prevChapterId={prevChapter?.id || ''} prevChapterTitle={prevChapter ? chapterLabel(prevChapter, currentIdx - 1) : ''} />
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
        <ThemeMenu className="mobile-reader-bar__btn theme-btn" ariaLabel="主题设置" title="主题设置">
          <SunIcon className="theme-icon theme-icon--sun" width={12} height={12} />
          <MoonIcon className="theme-icon theme-icon--moon" width={12} height={12} />
        </ThemeMenu>
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
                  <VirtualList
                    className="mobile-library-scroll"
                    ariaLabel="章节列表"
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
