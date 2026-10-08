/**
 * 阅读器纯函数工具：滚动/分页计算、章节正文格式化与消毒、
 * 章节过滤、段评哈希与划选解析。从 Reader.tsx 提取，便于复用与单测。
 */
import type { ChapterMeta, Thought } from '@shared/types'
import { removeAdPatterns } from '@shared/ad-cleaner'
import { escHtml } from '@shared/utils'
import { hashParagraphText } from '@shared/thought-anchor'
export { hashParagraphText } from '@shared/thought-anchor'

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
  const sourceContent = removeAdPatterns(raw || '') || '暂无章节内容'
  const content = sourceContent.replace(/\r\n?/g, '\n')
  if (/<[a-z][\s\S]*>/i.test(content)) return paragraphFallback(sanitizeChapterHtml(content))
  let html = content
    .split(/\n+/)
    .filter((p) => p.trim())
    .map((p) => `<p>${escHtml(p.trim())}</p>`)
    .join('\n')
  // 旧阅读器把纯 CR 正文当成一个段落；恢复换行时保留旧想法所用的源锚点。
  if (sourceContent.includes('\r') && !sourceContent.includes('\n')) {
    const body = document.createElement('div')
    body.innerHTML = html
    if (body.querySelectorAll('p').length > 1) {
      for (const p of body.querySelectorAll('p')) {
        p.dataset.sourceParagraphIndex = '0'
        p.dataset.sourceParagraphHash = hashParagraphText(sourceContent)
      }
      html = body.innerHTML
    }
  }
  return paragraphFallback(html)
}

/** 仅为整章唯一、无换行的长文本块分段；正常多段、短段及显式 BR 保持原样。 */
function paragraphFallback(html: string): string {
  const body = document.createElement('div')
  body.innerHTML = html
  const paragraphs = body.querySelectorAll('p')
  if (paragraphs.length > 1 || body.querySelector('br, blockquote')) return html
  const root = paragraphs[0] || body
  if (root !== body && Array.from(body.childNodes).some((node) => node !== root && node.textContent?.trim())) return html
  const text = root.textContent || ''
  if (text.length < 600 || text.split(/\r?\n/).filter((line) => line.trim()).length > 1 || !/[\u3400-\u9fff]/.test(text)) return html
  if ((text.match(/[。！？!?]/g) || []).length < 4) return html
  const ends: number[] = []
  const closing: Record<string, string> = { '“': '”', '‘': '’', '「': '」', '『': '』' }
  const quotes: string[] = []
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!
    if (closing[char]) quotes.push(closing[char]!)
    else if (char === quotes[quotes.length - 1]) quotes.pop()
    else if (char === '"' && text[i - 1] !== '\\') {
      if (quotes[quotes.length - 1] === '"') quotes.pop()
      else quotes.push('"')
    }
    if (quotes.length || i + 1 - start < 180) continue
    if (/[。！？!?][”’」』"]*$/.test(text.slice(Math.max(start, i - 8), i + 1)) && !/[。！？!?”’」』"]/.test(text[i + 1] || '')) {
      ends.push(i + 1)
      start = i + 1
    }
  }
  if (text.length - start < 40 && ends.length) ends.pop()
  if (ends[ends.length - 1] !== text.length) ends.push(text.length)
  if (ends.length < 2) return html
  const index = buildTextIndex(root)
  const output = document.createElement('div')
  start = 0
  for (const end of ends) {
    const first = index.find((entry) => entry.start <= start && entry.start + entry.node.length > start)
    const last = index.find((entry) => entry.start < end && entry.start + entry.node.length >= end)
    if (!first || !last) return html
    const range = document.createRange()
    range.setStart(first.node, start - first.start)
    range.setEnd(last.node, end - last.start)
    const p = document.createElement('p')
    p.dataset.sourceParagraphIndex = '0'
    p.dataset.sourceParagraphHash = hashParagraphText(text)
    p.append(range.cloneContents())
    output.append(p)
    start = end
  }
  return output.innerHTML
}

/** 优先沿用仍匹配的原位置；移动段落按唯一哈希找回，无法消歧时不挂到其它正文。 */
export function resolveThoughtParagraph(thought: Pick<Thought, 'paragraphIndex' | 'paragraphHash'>, hashes: string[]): number | null {
  const index = thought.paragraphIndex
  if (!thought.paragraphHash) return Number.isInteger(index) && index >= 0 && index < hashes.length ? index : null
  if (hashes[index] === thought.paragraphHash) return index
  const matches = hashes.map((hash, i) => hash === thought.paragraphHash ? i : -1).filter(i => i >= 0)
  return matches.length === 1 ? matches[0]! : null
}

export function groupChapterThoughts(thoughts: Thought[], html: string): Record<string, Thought[]> {
  const body = document.createElement('div')
  body.innerHTML = html
  const paragraphs = Array.from(body.querySelectorAll('p'))
  const hashes = paragraphs.map(p => hashParagraphText(p.textContent || ''))
  const map: Record<string, Thought[]> = {}
  for (const thought of thoughts) {
    const sourceMatches = paragraphs.map((p, i) => ({ p, i })).filter(({ p }) =>
      p.dataset.sourceParagraphHash && (thought.paragraphHash
        ? p.dataset.sourceParagraphHash === thought.paragraphHash
        : Number(p.dataset.sourceParagraphIndex) === thought.paragraphIndex),
    )
    const quote = (thought.selectedText || '').replace(/\s+/g, ' ').trim()
    const index = sourceMatches.length
      ? (quote ? sourceMatches.find(({ p }) => (p.textContent || '').replace(/\s+/g, ' ').includes(quote))?.i ?? null : sourceMatches[0]!.i)
      : resolveThoughtParagraph(thought, hashes)
    ;(map[String(index ?? -1)] ||= []).push(thought)
  }
  return map
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

/** 以原始文本节点构建引用范围，不拆分节点，避免异步加载想法时破坏正在调整的选区。 */
export function thoughtQuoteRanges(paragraph: HTMLElement, quotes: string[]): Range[] {
  const index = buildTextIndex(paragraph)
  const raw = index.map((entry) => entry.node.textContent).join('')
  const starts: number[] = []
  const ends: number[] = []
  let normalized = ''
  for (const match of raw.matchAll(/\s+|\S/g)) {
    normalized += /^\s/.test(match[0]) ? ' ' : match[0]
    starts.push(match.index)
    ends.push(match.index + match[0].length)
  }
  const ranges: Range[] = []
  for (const quote of new Set(quotes.map((text) => text.replace(/\s+/g, ' ').trim()).filter(Boolean))) {
    let from = 0
    let start: number
    while ((start = normalized.indexOf(quote, from)) >= 0) {
      const lo = starts[start]!
      const hi = ends[start + quote.length - 1]!
      const first = index.find((entry) => entry.start <= lo && entry.start + entry.node.length > lo)
      const last = index.find((entry) => entry.start < hi && entry.start + entry.node.length >= hi)
      if (first && last) {
        const range = document.createRange()
        range.setStart(first.node, lo - first.start)
        range.setEnd(last.node, hi - last.start)
        ranges.push(range)
      }
      from = start + quote.length
    }
  }
  return ranges
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
