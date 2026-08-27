/**
 * 爬虫富化动作 —— 榜单发现 / PO18 搜索 / 章节目录提取 / 标题源搜索 / 封面代理。
 * 由 Novel-KV _scrape-meta.js 的 discoverList / searchPo18 / extractPo18twTitles /
 * extractJjwxcTitles / searchTitleSources 与 _scrape-fetch.js 的 proxyCover 平移。
 */
import iconv from 'iconv-lite'
import { fetchHtml, decodeBytes, type FetchHtmlOptions, type FetchResult } from './fetch'
import { cleanText } from './parse'
import { resolveUrl } from './utils'
import { SITE_PRESETS, buildCoverUrl } from './presets'
import { toSimplifiedForSource } from '../zh-convert'
import { outboundFetch } from '../outbound-fetch'
import type { Db } from '../../db/pool'

const DISCOVER_CACHE_TTL = 5 * 60000
const DISCOVER_CACHE_MAX = 20

const discoverHtmlCache = new Map<string, { ts: number; html: string }>()

// ---------- 封面代理 ----------

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

// ---------- PO18 搜索 ----------

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
}

function gbkEncode(text: string): string {
  return Array.from(iconv.encode(String(text || ''), 'gbk'))
    .map((b) => {
      const ch = String.fromCharCode(b)
      return /[A-Za-z0-9_.~-]/.test(ch) ? ch : '%' + b.toString(16).toUpperCase().padStart(2, '0')
    })
    .join('')
}

export async function searchPo18(
  query: string,
  searchType: string,
  page: number,
  db: Db,
): Promise<{ site: string; total: number; totalPages: number; novels: DiscoverNovel[] }> {
  const q = String(query || '').trim()
  if (!q) throw new Error('query required')
  const url = 'https://www.po18x.vip/modules/article/search.php'
  const form = `searchtype=${searchType === 'author' ? 'author' : 'articlename'}&searchkey=${gbkEncode(q)}&page=${Math.max(1, page || 1)}`
  const res = await outboundFetch(
    url,
    {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form,
    },
    { scope: 'source-enrichment' },
  )
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const html = decodeBytes(new Uint8Array(await res.arrayBuffer()), 'gbk')
  const host = 'www.po18x.vip'
  const preset = SITE_PRESETS[host]
  const novels: DiscoverNovel[] = []
  const seen = new Set<string>()
  const existing = await loadExisting(db)

  const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) || []
  for (const row of rows) {
    if (/<th\b/i.test(row)) continue
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1])
    if (cells.length < 6) continue
    const book = cells[0]!.match(/<a[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i)
    if (!book) continue
    const fullUrl = resolveUrl(book[1]!, `https://${host}/`)
    const id = fullUrl.match(/\/(\d+)\/?$/)?.[1]
    if (!id || seen.has(id)) continue
    seen.add(id)
    const title = cleanText(book[2]!.replace(/<[^>]*>/g, ''))
    const author = cleanText(cells[2]!.replace(/<[^>]*>/g, ''))
    const statusText = cleanText(cells[5]!.replace(/<[^>]*>/g, ''))
    novels.push({
      bookId: id,
      title: toSimplifiedForSource(title, fullUrl),
      author: toSimplifiedForSource(author, fullUrl),
      coverUrl: buildCoverUrl(fullUrl, preset) || '',
      url: fullUrl,
      existing: existing.urls.has(fullUrl) || existing.titles.has(title.slice(0, 100).trim().toLowerCase()),
      description: '',
      chapterCount: 0,
      status: /完|完成|已完结/i.test(statusText) ? 'completed' : 'ongoing',
      categories: [],
    })
  }

  const pageStats = html.match(/<em[^>]*id\s*=\s*["']pagestats["'][^>]*>\s*(\d+)\s*\/\s*(\d+)/i)
  return { site: 'PO18 PC', total: novels.length, totalPages: pageStats ? Number.parseInt(pageStats[2]!, 10) || 1 : 1, novels }
}

// ---------- 榜单发现 ----------

export async function discoverList(
  listUrl: string,
  deps: { db: Db; fetchHtml: typeof fetchHtml; getPreset?: (url: string) => Promise<Record<string, unknown> | null> },
): Promise<{ site: string; total: number; totalPages: number; novels: DiscoverNovel[] }> {
  if (!listUrl) throw new Error('listUrl required')
  const host = new URL(listUrl).hostname
  const existing = await loadExisting(deps.db)
  const preset = (await deps.getPreset?.(listUrl)) || null

  let html: string
  const cached = discoverHtmlCache.get(listUrl)
  if (cached && Date.now() - cached.ts < DISCOVER_CACHE_TTL) {
    html = cached.html
  } else {
    const fetched = await deps.fetchHtml(listUrl)
    html = fetched.html
    discoverHtmlCache.set(listUrl, { ts: Date.now(), html })
    if (discoverHtmlCache.size > DISCOVER_CACHE_MAX) {
      discoverHtmlCache.delete(discoverHtmlCache.keys().next().value as string)
    }
  }

  const novels: DiscoverNovel[] = []
  const seen = new Set<string>()
  const bookRe = /<a\s[^>]*href\s*=\s*["'](?:\/[^"']*)?\/book\/(\d+)\/?["'][^>]*>([\s\S]*?)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = bookRe.exec(html)) !== null) {
    const bookId = m[1]!
    if (seen.has(bookId)) continue
    seen.add(bookId)
    const linkHtml = m[2]!
    let title = linkHtml.replace(/<[^>]*>/g, '').trim()
    if (!title || title.length > 60) {
      const tMatch = linkHtml.match(/<img[^>]*alt\s*=\s*["']([^"']+)["']/i)
      if (tMatch) title = tMatch[1]!.trim()
    }
    const containerStart = Math.max(0, m.index - 600)
    const containerEnd = Math.min(html.length, m.index + m[0].length + 600)
    const container = html.slice(containerStart, containerEnd)
    const imgMatch = container.match(/<img[^>]*src\s*=\s*["']([^"']+(?:jpg|jpeg|png|webp))["'][^>]*>/i)
    let coverUrl = imgMatch ? imgMatch[1]! : ''
    const authorMatch = container.match(/作者[：:]\s*([^<\n]{2,20})/i) || container.match(/\/author\/([^"']+)/i)
    const author = authorMatch ? authorMatch[1]!.trim() : ''

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
    })
  }

  let totalPages = 1
  const pageMatch =
    html.match(/共\s*(\d+)\s*页/i) ||
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

  const presetName = String(preset?.name || '')
  return { site: presetName || host, total: novels.length, totalPages, novels: novels.slice(0, 50) }
}

// ---------- 标题源搜索（晋江 / PO18.tw） ----------

export interface TitleSource {
  site: string
  siteName: string
  bookId?: string
  title: string
  author: string
  status: string
  url: string
}

export async function searchTitleSources(
  title: string,
  author: string,
): Promise<{ title: string; author: string; sources: Record<string, { ok: boolean; results: TitleSource[]; error?: string }> }> {
  const [jjwxc, po18tw] = await Promise.all([searchJjwxcTitlesSource(title, author), searchPo18twTitlesSource(title, author)])
  return { title, author, sources: { jjwxc, po18tw } }
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

async function searchPo18twTitlesSource(title: string, author: string): Promise<{ ok: boolean; results: TitleSource[]; error?: string }> {
  try {
    const q = title || author
    const url = `https://www.po18.tw/search?q=${encodeURIComponent(q)}`
    const { html } = await fetchHtml(url, { timeoutMs: 10000 })
    if (/<input\b[^>]*(?:type\s*=\s*["']?password|name\s*=\s*["'][^"']*(?:pass|密碼|密码))/i.test(html) && /login|登入|登录/i.test(html))
      throw new Error('搜索需要登录')
    return { ok: true, results: parsePo18twCandidates(html, url) }
  } catch {
    return { ok: false, error: 'PO18.tw 搜索需要登录或当前网络不可访问，请粘贴目录 URL', results: [] }
  }
}

function parsePo18twCandidates(html: string, baseUrl: string): TitleSource[] {
  const results: TitleSource[] = []
  const seen = new Set<string>()
  const re = /<a[^>]*href\s*=\s*["']([^"']*(?:books|book|novel|novels|articles|articlescontent)[^"']*\d+[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const url = resolveUrl(m[1]!, baseUrl)
    if (seen.has(url)) continue
    seen.add(url)
    const title = cleanText(m[2]!.replace(/<[^>]*>/g, ''))
    if (title) results.push({ site: 'po18tw', siteName: 'PO18.tw', title, author: '', status: 'ongoing', url })
  }
  return results
}

// ---------- 章节目录标题提取（晋江 / PO18.tw） ----------

type HtmlFetcher = (url: string, opts?: FetchHtmlOptions) => Promise<FetchResult>

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

export async function extractPo18twTitles(
  sourceUrl: string,
  requestHtml: HtmlFetcher = fetchHtml,
): Promise<{ site: string; sourceUrl: string; total: number; titles: Array<{ order: number; title: string; url: string }> }> {
  let url: URL
  try {
    url = new URL(sourceUrl)
    if (!/(^|\.)po18\.tw$/i.test(url.hostname)) throw new Error('目前仅支持 po18.tw 目录页')
  } catch (err) {
    throw new Error((err as Error).message || 'sourceUrl invalid')
  }
  const { html } = await requestHtml(url.href, { timeoutMs: 12000 })
  if (/<input\b[^>]*(?:type\s*=\s*["']?password|name\s*=\s*["'][^"']*(?:pass|密碼|密码))/i.test(html) && /login|登入|登录/i.test(html))
    throw new Error('PO18.tw 该页面需要登录，请先配置账号或 Cookie')
  const titles: Array<{ order: number; title: string; url: string }> = []
  const seen = new Set<string>()
  const re = /<a[^>]*href\s*=\s*["']([^"']*(?:chapter|chapters|articlescontent)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const href = resolveUrl(m[1]!, url.href)
    if (seen.has(href)) continue
    seen.add(href)
    const title = cleanText(m[2]!.replace(/<[^>]*>/g, ''))
    if (title) titles.push({ order: titles.length + 1, title, url: href })
  }
  return { site: 'PO18.tw', sourceUrl: url.href, total: titles.length, titles }
}

// ---------- 内部 ----------

async function loadExisting(db: Db): Promise<{ urls: Set<string>; titles: Set<string> }> {
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
