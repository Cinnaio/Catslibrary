import iconv from 'iconv-lite'
import { fetchHtml } from './fetch'
import { cleanHtml, cleanText } from './parse'
import { resolveUrl } from './utils'
import { buildCoverUrl } from './presets'
import { toSimplifiedForSource } from '../zh-convert'
import { outboundFetch } from '../outbound-fetch'
import type { Db } from '../../db/pool'
import { rankTitleSources, type TitleSourceMatch } from './title-source-match'
import { adapterForUrl, assertSourceAvailable, scrapeAdapters, type HtmlFetcher, type SourceRanking } from './sources'

export interface DiscoverDeps {
  db: Db
  fetchHtml: HtmlFetcher
  getPreset?: (url: string) => Promise<Record<string, unknown> | null>
}

export interface DiscoverResult {
  site: string
  total: number
  totalPages: number
  novels: DiscoverNovel[]
}

interface ListingFormat {
  id: string
  name: string
  containers?(html: string): Array<{ start: number; end: number; html: string }>
}

const discoverCache = new Map<string, { ts: number; html: string }>()

const PROXY_COVER_MAX_BYTES = 5 * 1024 * 1024

export async function proxyCover(url: string): Promise<{ body: Buffer; contentType: string }> {
  if (!url) throw new Error('url required')
  const res = await outboundFetch(
    url,
    { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } },
    { scope: 'cover-proxy', safe: true },
  )
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`)
  const contentType = res.headers.get('Content-Type') || ''
  if (!/^image\//i.test(contentType)) throw new Error('目标不是图片')
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.byteLength > PROXY_COVER_MAX_BYTES) throw new Error('图片超过大小上限')
  return { body: buf, contentType }
}

export interface DiscoverNovel {
  bookId: string
  title: string
  author: string
  coverUrl: string
  url: string
  existing: boolean
  description: string
  chapterCount: number
  status: string
  categories: string[]
  source?: string
  sourceName?: string
}

export function gbkEncode(text: string): string {
  return Array.from(iconv.encode(String(text || ''), 'gbk'))
    .map((b) => {
      const ch = String.fromCharCode(b)
      return /[A-Za-z0-9_.~-]/.test(ch) ? ch : '%' + b.toString(16).toUpperCase().padStart(2, '0')
    })
    .join('')
}


export async function discoverList(listUrl: string, deps: DiscoverDeps, ranking?: SourceRanking): Promise<DiscoverResult> {
  assertSourceAvailable(listUrl)
  return adapterForUrl(listUrl)?.discover?.(listUrl, deps, ranking) ?? discoverBooks(listUrl, deps)
}

export async function discoverBooks(listUrl: string, deps: DiscoverDeps, format?: ListingFormat): Promise<DiscoverResult> {
  const host = new URL(listUrl).hostname
  const existing = await loadExisting(deps.db)
  const preset = await deps.getPreset?.(listUrl)
  const cached = discoverCache.get(listUrl)
  const html = cached && Date.now() - cached.ts < 5 * 60000 ? cached.html : (await deps.fetchHtml(listUrl)).html
  if (!cached || cached.html !== html || Date.now() - cached.ts >= 5 * 60000) {
    discoverCache.set(listUrl, { ts: Date.now(), html })
    if (discoverCache.size > 20) discoverCache.delete(discoverCache.keys().next().value!)
  }

  const novels: DiscoverNovel[] = []
  const seen = new Set<string>()
  const containers = format?.containers?.(html) ?? []
  const bookRe = /<a\s[^>]*href\s*=\s*["'](?:\/[^"']*)?\/(?:book|books)\/(\d+)\/?["'][^>]*>([\s\S]*?)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = bookRe.exec(html)) !== null) {
    const bookId = m[1]!
    if (seen.has(bookId)) continue
    const linkStart = m.index
    const row = containers.find((candidate) => linkStart >= candidate.start && linkStart < candidate.end)
    if (containers.length > 0 && !row) continue
    seen.add(bookId)
    const linkHtml = m[2]!
    let title = linkHtml.replace(/<[^>]*>/g, '').trim()
    if (!title || title.length > 60) {
      const tMatch = linkHtml.match(/<img[^>]*alt\s*=\s*["']([^"']+)["']/i)
      if (tMatch) title = tMatch[1]!.trim()
    }
    const containerStart = Math.max(0, m.index - 600)
    const containerEnd = Math.min(html.length, m.index + m[0].length + 600)
    const container = row?.html ?? html.slice(containerStart, containerEnd)
    const imgMatch = container.match(/<img[^>]*src\s*=\s*["']([^"']+(?:jpg|jpeg|png|webp))["'][^>]*>/i)
    let coverUrl = imgMatch ? imgMatch[1]! : ''
    const authorMatch =
      container.match(/<div\b[^>]*class\s*=\s*["'][^"']*\bbook_author\b[^"']*["'][^>]*>[\s\S]*?<a\b[^>]*>([\s\S]*?)<\/a>/i) ||
      container.match(/作者[：:]\s*([^<\n]{2,20})/i) ||
      container.match(/<a\b[^>]*href\s*=\s*["'][^"']*\/author\/[^"']*["'][^>]*>([\s\S]*?)<\/a>/i) ||
      container.match(/\/users\/[^"']*["'][^>]*>([^<]+)<\/a>/i)
    const author = authorMatch ? cleanText(cleanHtml(authorMatch[1]!)) : ''

    if (!coverUrl || /noimg\.jpg/i.test(coverUrl)) {
      const builtCover = buildCoverUrl(`https://${host}/book/${bookId}/`, preset as Parameters<typeof buildCoverUrl>[1])
      if (builtCover) coverUrl = builtCover
    }

    let categories: string[] = []
    const catBracket = container.match(/\[([^\]]{2,10})\]/)
    if (catBracket) categories = [catBracket[1]!]
    let description = ''
    const descMatch = container.match(/(?:简介|介绍|文案|内容)[：:]\s*([^<]{10,200})/i)
    if (descMatch) description = descMatch[1]!.trim()
    if (!description || description.length < 10) {
      const pMatch = container.match(/<p[^>]*>([^<]{15,120})<\/p>/i)
      if (pMatch) {
        const pt = pMatch[1]!
          .replace(/[作者|分类][：:][^<]*/gi, '')
          .replace(/<[^>]*>/g, '')
          .trim()
        if (pt.length > 10) description = pt
      }
    }
    let chapterCount = 0
    const chMatch = container.match(/(\d+)\s*章/i) || container.match(/共\s*(\d+)\s*节/i)
    if (chMatch) chapterCount = Number.parseInt(chMatch[1]!, 10) || 0
    let status = ''
    if (/完结|已完结|全集/i.test(container)) status = 'completed'
    else if (/连载|更新中/i.test(container)) status = 'ongoing'

    const novelUrl = `https://${host}/book/${bookId}/`
    novels.push({
      bookId,
      title: toSimplifiedForSource(title.slice(0, 100), novelUrl),
      author: toSimplifiedForSource(author.slice(0, 30), novelUrl),
      coverUrl,
      url: novelUrl,
      existing: existing.urls.has(novelUrl) || existing.titles.has(title.slice(0, 100).trim().toLowerCase()),
      description: toSimplifiedForSource(description.slice(0, 120), novelUrl),
      chapterCount,
      status,
      categories: categories.map((c) => toSimplifiedForSource(c, novelUrl)),
      source: format?.id || host,
      sourceName: format?.name || host,
    })
  }

  let totalPages = 1
  const pageMatch = html.match(/共\s*(\d+)\s*页/i) ||
    html.match(/<[aA][^>]*>(\d+)<\/[aA]>(?!\s*<[aA][^>]*>)/) ||
    html.match(/<span[^>]*class\s*=\s*["']page["'][^>]*>[\s\S]*?(\d+)[^<]*页/)
  if (pageMatch) {
    totalPages = Number.parseInt(pageMatch[1]!, 10) || 1
  } else {
    const pageLinks = html.match(/<a[^>]*href\s*=\s*["'][^"']*_(\d+)\/["'][^>]*>/gi)
    if (pageLinks && pageLinks.length > 0) {
      let maxPage = 1
      for (const pl of pageLinks) {
        const pm = pl.match(/_(\d+)\//)
        if (pm) {
          const n = Number.parseInt(pm[1]!, 10)
          if (n > maxPage) maxPage = n
        }
      }
      totalPages = maxPage
    }
  }

  return { site: format?.name || String(preset?.name || host), total: novels.length, totalPages, novels: novels.slice(0, 50) }
}

export interface TitleSource extends Partial<TitleSourceMatch> {
  site: string
  siteName: string
  bookId?: string
  title: string
  author: string
  status: string
  url: string
}


export interface TitleSearchResult {
  ok: boolean
  results: TitleSource[]
  error?: string
  siteName?: string
}

export async function searchTitleSources(title: string, author: string, deps: DiscoverDeps) {
  const buckets = await Promise.all([
    searchJjwxcTitlesSource(title, author).then(result => ['jjwxc', { ...result, siteName: '晋江' }] as const),
    ...scrapeAdapters().flatMap(adapter => adapter.searchTitles ? [
      adapter.searchTitles(title, author, deps).then(result => [adapter.id, { ...result, siteName: adapter.name }] as const),
    ] : []),
  ])
  const sources: Record<string, TitleSearchResult> = Object.fromEntries(buckets.map(([id, result]) =>
    [id, { ...result, results: rankTitleSources(result.results, title, author) }],
  ))
  return { title, author, sources }
}

async function searchJjwxcTitlesSource(title: string, author: string): Promise<{ ok: boolean; results: TitleSource[]; error?: string }> {
  const queries: Array<{ q: string; type: number }> = []
  if (title) queries.push({ q: title, type: 1 })
  if (author) queries.push({ q: author, type: 2 })
  const results: TitleSource[] = []
  const seen = new Set<string>()
  try {
    for (const item of queries) {
      for (let page = 1; page <= 4; page++) {
        const url = `https://www.jjwxc.net/search.php?kw=${gbkEncode(item.q)}&t=${item.type}${page > 1 ? `&p=${page}` : ''}`
        const { html } = await fetchHtml(url, { forceEncoding: 'gb18030' })
        const before = results.length
        const cards =
          html.match(
            /<div>\s*<h3\s+class\s*=\s*["']title["'][\s\S]*?(?=<div style="margin-top: 20px;border-bottom|<div class="page">|<\/div>\s*<div id="other_search")/gi,
          ) || []
        for (const card of cards) {
          const link = card.match(/<a[^>]*href\s*=\s*["']([^"']*onebook\.php\?novelid=(\d+)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/i)
          if (!link || seen.has(link[2]!)) continue
          seen.add(link[2]!)
          const info = card.match(/<div\s+class\s*=\s*["']info["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || ''
          const authorText = info.match(/作者[：:]\s*<a[^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i)?.[1] || ''
          const statusText = info.match(/进度[：:]\s*<[^>]+>([^<]+)/i)?.[1] || info
          results.push({
            site: 'jjwxc',
            siteName: '晋江',
            bookId: link[2]!,
            title: cleanText(link[3]!.replace(/<[^>]*>/g, '')),
            author: cleanText(authorText.replace(/<[^>]*>/g, '')),
            status: /完结|已完结/i.test(statusText) ? 'completed' : 'ongoing',
            url: resolveUrl(link[1]!, url),
          })
        }
        if (results.length === before || !/search\.php\?[^"']*&p=\d+/i.test(html)) break
      }
    }
    return { ok: true, results }
  } catch (err) {
    return { ok: false, error: `晋江搜索失败: ${(err as Error).message}`, results }
  }
}

export async function extractJjwxcTitles(
  sourceUrl: string,
  requestHtml: HtmlFetcher = fetchHtml,
): Promise<{ titles: Array<{ order: number; title: string; url: string }> }> {
  let url: URL
  try {
    url = new URL(sourceUrl)
    if (!/(^|\.)jjwxc\.net$/i.test(url.hostname)) throw new Error('目前仅支持 jjwxc.net 目录页')
  } catch (err) {
    throw new Error((err as Error).message || 'sourceUrl invalid')
  }
  const { html } = await requestHtml(url.href, { forceEncoding: 'gb18030' })
  const titles: Array<{ order: number; title: string; url: string }> = []
  const seen = new Set<string>()
  // 晋江目录页：<tr itemprop="chapter"><td><span class="date">…</span></td><td><a href="/onebook.php?novelid=..&chapterid=..">章名</a></td>
  const re = /<a[^>]*href\s*=\s*["']([^"']*onebook\.php\?novelid=\d+[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const href = resolveUrl(m[1]!, url.href)
    if (seen.has(href)) continue
    seen.add(href)
    const title = cleanText(m[2]!.replace(/<[^>]*>/g, ''))
    if (title) titles.push({ order: titles.length + 1, title, url: href })
  }
  return { titles }
}

export async function loadExisting(db: Db): Promise<{ urls: Set<string>; titles: Set<string> }> {
  const urls = new Set<string>()
  const titles = new Set<string>()
  try {
    const rows = await db.query<{ source_url: string; title: string }>('SELECT source_url, title FROM novels WHERE source_url IS NOT NULL')
    for (const row of rows.rows) {
      if (row.source_url) urls.add(row.source_url)
      if (row.title) titles.add(row.title.trim().toLowerCase())
    }
  } catch {
    /* non-critical */
  }
  return { urls, titles }
}
