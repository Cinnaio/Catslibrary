/**
 * 阅读器纯函数工具：滚动/分页计算、章节正文格式化与消毒、
 * 章节过滤、段评哈希与划选解析。从 Reader.tsx 提取，便于复用与单测。
 */
import type { ChapterMeta } from '@shared/types'
import { removeAdPatterns } from '@shared/ad-cleaner'
import { escHtml } from '@shared/utils'

// ---------- 滚动 / 分页 ----------

export function getPageHeight(): number {
  return Math.max(window.innerHeight - 80, 400)
}

export function clamp(num: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, num))
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

export function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? 'auto' : 'smooth'
}

export function jumpScrollTo(y: number): void {
  const root = document.documentElement
  const prev = root.style.scrollBehavior
  root.style.scrollBehavior = 'auto'
  window.scrollTo(0, y)
  root.style.scrollBehavior = prev
}

export function currentScrollPercent(): number {
  const maxScroll = document.documentElement.scrollHeight - window.innerHeight
  if (maxScroll <= 0) return 0
  return clamp(Math.round((window.scrollY / maxScroll) * 1000) / 1000, 0, 1)
}

// ---------- 章节正文格式化 ----------

/** 章节内容格式化：广告清洗 + 纯文本按段落，或允许的安全 HTML 子集。 */
export function formatContent(raw: string): string {
  const content = removeAdPatterns(raw || '') || '暂无章节内容'
  if (/<[a-z][\s\S]*>/i.test(content)) return sanitizeChapterHtml(content)
  return content
    .split(/\n+/)
    .filter((p) => p.trim())
    .map((p) => `<p>${escHtml(p.trim())}</p>`)
    .join('\n')
}

/** 允许的最小安全 HTML 子集（P/BR/EM/STRONG/BLOCKQUOTE）。 */
export function sanitizeChapterHtml(content: string): string {
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

// ---------- 章节工具 ----------

export function chapterLabel(ch: ChapterMeta, i: number): string {
  return (ch.order ? `第${ch.order}章 ` : '') + (ch.title || `章节 ${i + 1}`)
}

export function filterChapters(chapters: ChapterMeta[], query: string): ChapterMeta[] {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return chapters
  return chapters.filter((ch) => {
    if (String(ch.order || '').indexOf(q) === 0) return true
    if (String(ch.title || '').toLowerCase().includes(q)) return true
    return (`第${ch.order}章`).includes(q)
  })
}

// ---------- 段评 / 划选 ----------

export function hashParagraphText(text: string): string {
  let h = 2166136261
  const t = String(text || '').replace(/\s+/g, ' ').trim()
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}

export function excerptText(text: string): string {
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
export function resolveSelectionParagraph(range: Range, contentEl: HTMLElement): { el: HTMLElement; text: string } | null {
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

// ---------- 客户端标识 ----------

export function getReaderClientId(): string {
  const key = 'reader_client_id'
  let id = localStorage.getItem(key)
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : `reader_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
    localStorage.setItem(key, id)
  }
  return id
}
