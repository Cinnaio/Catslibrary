/**
 * HTML 解析与内容清洗 —— 由 Novel-KV _scrape-parse.js 平移。
 * 基于正则而非 DOM 解析器（与标准 CSS 选择器有差异，保持原语义）。
 */
import { escapeRegex, resolveUrl } from './utils'
import { removeAdPatterns } from '@shared/ad-cleaner'

export interface ScrapeLink {
  href: string
  text: string
  order?: number
}

export function extractLinks(html: string, selector: string, baseUrl: string): ScrapeLink[] {
  const links: ScrapeLink[] = []

  const parts = selector.split(/\s+/)
  let searchHtml = html
  if (parts.length > 1) {
    const ancestorParts = parts.slice(0, -1)
    const classMatch = ancestorParts[0]!.match(/\.([a-zA-Z0-9_-]+)/)
    const idMatch = ancestorParts[0]!.match(/#([a-zA-Z0-9_-]+)/)

    if (classMatch || idMatch) {
      let pattern = '<([a-zA-Z][a-zA-Z0-9]*)\\s[^>]*'
      if (classMatch) pattern += `class\\s*=\\s*["'][^"']*\\b${escapeRegex(classMatch[1]!)}\\b[^"']*["']`
      if (idMatch) pattern += `id\\s*=\\s*["']${escapeRegex(idMatch[1]!)}["']`
      pattern += '[^>]*>'

      const ancestorRe = new RegExp(pattern, 'i')
      const ancestorMatch = ancestorRe.exec(html)

      if (ancestorMatch) {
        const tagName = ancestorMatch[1]!.toLowerCase()
        const startPos = ancestorMatch.index + ancestorMatch[0].length
        const closeTag = `</${tagName}>`
        let closePos = html.indexOf(closeTag, startPos)

        if (closePos !== -1) {
          let nested = 0
          const openTagRe = new RegExp(`<${tagName}[\\s>]`, 'gi')
          let pos = startPos
          while (pos < closePos) {
            openTagRe.lastIndex = pos
            const m = openTagRe.exec(html)
            if (m && m.index < closePos) {
              nested++
              pos = m.index + m[0].length
            } else break
          }
          for (let n = 0; n < nested; n++) {
            const next = html.indexOf(closeTag, closePos + closeTag.length)
            if (next !== -1) closePos = next
            else break
          }
          searchHtml = html.slice(startPos, closePos)
        }
      }
    }
  }

  const needsQueryLinks = selector.includes('chapterNumber')
  const aRegex = needsQueryLinks
    ? /<a\s[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
    : /<a\s[^>]*href\s*=\s*["']([^"']+\.html[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi
  let match: RegExpExecArray | null
  while ((match = aRegex.exec(searchHtml)) !== null) {
    const href = match[1]!
    const text = match[2]!.replace(/<[^>]*>/g, '').replace(/&gt;/gi, '>').replace(/&lt;/gi, '<').trim()
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) continue
    if (/\/(book|author|sort|top|full|history|mybook)[\/\.]/i.test(href)) continue
    if (needsQueryLinks && /\/(a|c)\/[a-z]|anti-scam|privacy|qa|editor$/i.test(href)) continue
    if (/\/\d+_\d+(_\d+)?\/?$/i.test(href)) continue

    const fullHref = resolveUrl(href, baseUrl)
    if (needsQueryLinks && !/chapterNumber=/.test(fullHref)) continue
    if (!links.some((l) => l.href === fullHref)) {
      links.push({ href: fullHref, text: text || fullHref })
    }
  }

  if (links.length === 0 && !needsQueryLinks) {
    const broadRe = /<a\s[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
    const listPageRe = /(^|\/)(list|index|page|search|category|catalog|tags?|rank|readed)(\/|$|\?)/i
    const pageParamRe = /\bpage=\d+|\?page|\/page\/\d+/i
    const assetRe = /\.(css|js|png|jpe?g|gif|svg|ico|woff2?)$/i
    let basePath = ''
    try {
      basePath = new URL(baseUrl).pathname
    } catch {
      basePath = ''
    }
    while ((match = broadRe.exec(searchHtml)) !== null) {
      const href = match[1]!
      const text = match[2]!.replace(/<[^>]*>/g, '').replace(/&gt;/gi, '>').replace(/&lt;/gi, '<').trim()
      if (!href || href.startsWith('#') || href.startsWith('javascript:')) continue
      if (/\/(book|author|sort|top|full|history|mybook)[\/\.]/i.test(href)) continue
      if (/\/\d+_\d+(_\d+)?\/?$/i.test(href)) continue
      if (listPageRe.test(href) || pageParamRe.test(href) || assetRe.test(href)) continue
      const fullHref = resolveUrl(href, baseUrl)
      try {
        const u = new URL(fullHref)
        if (u.pathname === '/' || u.pathname === basePath) continue
      } catch {
        /* keep */
      }
      if (!links.some((l) => l.href === fullHref)) {
        links.push({ href: fullHref, text: text || fullHref })
      }
    }
  }

  return links
}

export function extractLinkHref(html: string, selector: string, baseUrl: string): string | null {
  const parts = String(selector || '').split(/\s+/).filter(Boolean)
  const ancestorSelector = parts.length > 1 ? parts.slice(0, -1).join(' ') : selector
  const searchHtml = ancestorSelector ? extractInnerHtml(html, ancestorSelector) || findFirstElementHtml(html, ancestorSelector) || html : html

  const aRegex = /<a\s[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let match: RegExpExecArray | null
  while ((match = aRegex.exec(searchHtml)) !== null) {
    const text = match[2]!.replace(/<[^>]*>/g, '').replace(/&gt;/gi, '>').replace(/&lt;/gi, '<').trim()
    if (/下[一]?页|下一頁|下頁/i.test(text) || ['>', '›', '»', '≫'].includes(text)) {
      const nextUrl = resolveUrl(match[1]!, baseUrl)
      if (/\.html/i.test(nextUrl)) continue
      return nextUrl
    }
  }
  return null
}

function findFirstElementHtml(html: string, selector: string): string {
  const idMatch = selector.match(/#([a-zA-Z0-9_-]+)/)
  const classMatch = selector.match(/\.([a-zA-Z0-9_-]+)/)
  const tagMatch = selector.match(/^([a-zA-Z][a-zA-Z0-9]*)/)
  let pattern = '<' + (tagMatch ? escapeRegex(tagMatch[1]!) : '[a-zA-Z][a-zA-Z0-9]*') + '\\s[^>]*'
  if (idMatch) pattern += `id\\s*=\\s*["'][^"']*\\b${escapeRegex(idMatch[1]!)}\\b[^"']*["']`
  if (classMatch) pattern += `class\\s*=\\s*["'][^"']*\\b${escapeRegex(classMatch[1]!)}\\b[^"']*["']`
  pattern += '[^>]*>[\\s\\S]*?<\\/' + (tagMatch ? escapeRegex(tagMatch[1]!) : '[a-zA-Z][a-zA-Z0-9]*') + '>'
  return html.match(new RegExp(pattern, 'i'))?.[0] || ''
}

export function cleanTitle(title: string): string {
  let t = removeAdPatterns(String(title || ''))
    .replace(/\s+/g, ' ')
    .trim()

  const core = t.match(/(?:第\s*[0-9０-９零一二三四五六七八九十百千万两〇壹贰叁肆伍陆柒捌玖拾佰仟]+\s*[章节回卷集部篇]|Chapter\s*\d+|^\d+[.、．]\s*)[\s\S]*/i)
  if (core) t = core[0].trim()

  return t
    .replace(/\s*[-_—|｜].*(?:笔趣阁|小说|阅读|无弹窗|最新章节|全文).*$/i, '')
    .replace(/(?:最新网址|本站|手机阅读|加入书签).*$/i, '')
    .replace(/po\s*1\s*8\s*red\s*$/gi, '')
    .replace(/\s*like\.xi\s*$/gi, '')
    .trim()
}

export function extractText(html: string, selector: string): string {
  if (!selector) return ''
  const inner = extractInnerHtml(html, selector)
  const raw = inner ? inner.replace(/<[^>]*>/g, '').replace(/&[a-z]+;/gi, ' ').trim() : ''
  return cleanTitle(raw)
}

export function extractContent(html: string, selector: string): string {
  if (!selector) return ''
  const inner = extractInnerHtml(html, selector)
  if (!inner) return ''

  return inner
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<p[^>]*>/gi, '')
    .replace(/<\/p>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/gi, (_, n) => String.fromCodePoint(Number.parseInt(n)))
    .replace(/\n{3,}/g, '\n\n')
}

export function extractInnerHtml(html: string, selector: string): string {
  if (!html || !selector) return ''
  const idMatch = selector.match(/#([a-zA-Z0-9_-]+)/)
  const classMatch = selector.match(/\.([a-zA-Z0-9_-]+)/g)
  const tagMatch = selector.match(/^([a-zA-Z][a-zA-Z0-9]*)/)

  let openPattern = '<([a-zA-Z][a-zA-Z0-9]*)\\s[^>]*'
  if (idMatch) openPattern += `id\\s*=\\s*["']${escapeRegex(idMatch[1]!)}["'][^>]*`
  if (classMatch) {
    for (const cls of classMatch) {
      openPattern += `class\\s*=\\s*["'][^"']*\\b${escapeRegex(cls.slice(1))}\\b[^"']*["'][^>]*`
    }
  }
  if (tagMatch) {
    openPattern = openPattern.replace(/<[a-zA-Z][a-zA-Z0-9]*/, `<${tagMatch[1]}`)
  }
  openPattern += '>'

  const openRe = new RegExp(openPattern, 'i')
  const openMatch = html.match(openRe)
  if (!openMatch) return ''

  const tagName = openMatch[1]!.toLowerCase()
  const startIdx = openMatch.index! + openMatch[0].length

  let depth = 1
  let pos = startIdx
  const openTagRe = new RegExp(`<${tagName}[\\s>]`, 'gi')
  const closeTagRe = new RegExp(`<\\/${tagName}>`, 'gi')

  while (depth > 0 && pos < html.length) {
    openTagRe.lastIndex = pos
    closeTagRe.lastIndex = pos

    const nextOpen = openTagRe.exec(html)
    const nextClose = closeTagRe.exec(html)

    const openPos = nextOpen ? nextOpen.index : Infinity
    const closePos = nextClose ? nextClose.index : Infinity

    if (closePos === Infinity) break

    if (openPos < closePos) {
      depth++
      pos = openPos + nextOpen![0].length
    } else {
      depth--
      if (depth === 0) {
        return html.slice(startIdx, closePos)
      }
      pos = closePos + nextClose![0].length
    }
  }

  return ''
}

export function cleanText(text: string): string {
  let t = String(text || '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
  t = removeAdPatterns(t)
  return t.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

export function cleanHtml(html: string): string {
  let cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')

  cleaned = cleaned
    .replace(/<ul\s[^>]*class\s*=\s*["'][^"']*novelbutton[^"']*["'][^>]*>[\s\S]*?<\/ul>/gi, '')
    .replace(/<div\s[^>]*class\s*=\s*["'][^"']*content_button[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, '')
    .replace(/<div\s[^>]*class\s*=\s*["'][^"']*content_top[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, '')
    .replace(/<div\s[^>]*class\s*=\s*["'][^"']*bottomad[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, '')

  cleaned = cleaned
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<p[^>]*>/gi, '')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/?div[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, '')

  cleaned = cleaned
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/gi, (_, n) => String.fromCodePoint(Number.parseInt(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(Number.parseInt(n, 16)))

  cleaned = cleaned
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  cleaned = cleaned
    .replace(/\n*(上一章|下一章|返回目录|加入书签|回目录|首　页|首页|下一页|上一页)\n*/g, '\n')
    .replace(/\n*chapter[123]\(\);?\n*/gi, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return cleaned
}

export function extractTextSmart(html: string, selector: string): string {
  if (!selector) return ''
  const parts = selector.split(/\s+/)
  if (parts.length === 1) {
    return extractText(html, selector)
  }

  const ancestorSelector = parts.slice(0, -1).join(' ')
  const targetTag = parts[parts.length - 1]!
  const ancestorInner = extractInnerHtml(html, ancestorSelector)
  if (!ancestorInner) return ''

  const targetRegex = new RegExp(`<${escapeRegex(targetTag)}[^>]*>([\\s\\S]*?)<\\/${escapeRegex(targetTag)}>`, 'i')
  const m = ancestorInner.match(targetRegex)
  if (m) {
    return m[1]!.replace(/<[^>]*>/g, '').trim()
  }
  return ''
}

export function extractAttr(html: string, selector: string, attr: string): string {
  if (!selector) return ''
  const idMatch = selector.match(/#([a-zA-Z0-9_-]+)/)
  const classMatch = selector.match(/\.([a-zA-Z0-9_-]+)/g)

  let elemPattern = '<[a-zA-Z][a-zA-Z0-9]*\\s[^>]*'
  if (idMatch) elemPattern += `id\\s*=\\s*["']${escapeRegex(idMatch[1]!)}["'][^>]*`
  if (classMatch) {
    for (const cls of classMatch) {
      elemPattern += `class\\s*=\\s*["'][^"']*\\b${escapeRegex(cls.slice(1))}\\b[^"']*["'][^>]*`
    }
  }
  elemPattern += `${attr}\\s*=\\s*["']([^"']+)["'][^>]*>`

  const re = new RegExp(elemPattern, 'i')
  const m = html.match(re)
  return m ? m[1]! : ''
}

export function extractCategory(html: string, selector: string): string {
  if (!selector) return ''
  const raw = extractText(html, selector)
  if (!raw) return ''
  const m = raw.match(/[：:]\s*(.+)/)
  return m ? m[1]!.trim() : raw.trim()
}

export function extractByPattern(html: string, selector: string, attribute = ''): string {
  if (!selector || !html) return ''

  if (selector === '.cataloginfo h3') {
    const m = html.match(/class\s*=\s*["']cataloginfo["'][^>]*>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>/i)
    if (m) return m[1]!.replace(/<[^>]*>/g, '').trim()
  }

  if (selector.includes('/author/')) {
    const m =
      html.match(/<a[^>]*href\s*=\s*["'][^"']*\/author\/[^"']*["'][^>]*>([^<]+)<\/a>/i) ||
      html.match(/作者[：:]\s*<a[^>]*>([^<]+)<\/a>/i) ||
      html.match(/作者[：:]\s*([^<\n]{2,20})/i)
    if (m) return m[1]!.trim()
  }

  if (selector.includes(':nth-child(2)')) {
    const infotype = html.match(/class\s*=\s*["']infotype["'][^>]*>([\s\S]*?)<\/div>/i)
    if (infotype) {
      const ps = infotype[1]!.match(/<p[^>]*>([\s\S]*?)<\/p>/gi)
      if (ps && ps.length >= 2) {
        return ps[1]!.replace(/<[^>]*>/g, '').trim()
      }
    }
  }

  if (selector === '.intro p') {
    const introDiv = html.match(/class\s*=\s*["']intro["'][^>]*>([\s\S]*?)<\/div>/i)
    if (introDiv) {
      const pm = introDiv[1]!.match(/<p[^>]*>([\s\S]*?)<\/p>/i)
      if (pm) return pm[1]!.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '').trim()
      const text = introDiv[1]!.replace(/<span[^>]*>[\s\S]*?<\/span>/i, '').replace(/<[^>]*>/g, '').trim()
      if (text) return text
    }
  }

  if (selector === '.pic img') {
    const m =
      html.match(/class\s*=\s*["']pic["'][^>]*>[\s\S]*?<img[^>]*src\s*=\s*["']([^"']+)["']/i) ||
      html.match(/<img[^>]*src\s*=\s*["']([^"']*(?:cover|pic|book|image)[^"']*)["']/i)
    if (m) return attribute === 'src' ? m[1]! : m[0]!
  }

  if (selector.startsWith('meta[')) {
    const prop = selector.match(/property="([^"]+)"/)?.[1]
    const name = selector.match(/name="([^"]+)"/)?.[1]
    const key = prop ? 'property' : 'name'
    const val = prop || name
    if (val) {
      const q = "[\"']"
      const value = '([^"\']*)'
      const m =
        html.match(new RegExp('<meta[^>]*' + key + '\\s*=\\s*' + q + escapeRegex(val) + q + '[^>]*content\\s*=\\s*' + q + value + q + '[^>]*>', 'i')) ||
        html.match(new RegExp('<meta[^>]*content\\s*=\\s*' + q + value + q + '[^>]*' + key + '\\s*=\\s*' + q + escapeRegex(val) + q + '[^>]*>', 'i'))
      if (m) return m[1]!.trim()
    }
  }

  return extractTextSmart(html, selector)
}
