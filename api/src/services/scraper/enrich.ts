/**
 * 爬虫富化动作 —— 榜单发现 / PO18 搜索 / 章节目录提取 / 标题源搜索 / 封面代理。
 * 由 Novel-KV _scrape-meta.js 的 discoverList / searchPo18 / extractPo18twTitles /
 * extractJjwxcTitles / searchTitleSources 与 _scrape-fetch.js 的 proxyCover 平移。
 */
import iconv from 'iconv-lite'
import { fetchHtml, decodeBytes, type FetchHtmlOptions, type FetchResult } from './fetch'
import { cleanText, extractInnerHtml } from './parse'
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
  source?: string
  sourceName?: string
}

function gbkEncode(text: string): string {
  return Array.from(iconv.encode(String(text || ''), 'gbk'))
    .map((b) => {
      const ch = String.fromCharCode(b)
      return /[A-Za-z0-9_.~-]/.test(ch) ? ch : '%' + b.toString(16).toUpperCase().padStart(2, '0')
    })
    .join('')
}

function sourceForHost(hostname: string): { id: string; name: string } {
  const host = hostname.toLowerCase()
  if (host === 'po18.tw' || host.endsWith('.po18.tw')) return { id: 'po18tw', name: 'POPO' }
  if (host === 'po18x.vip' || host.endsWith('.po18x.vip')) return { id: 'po18', name: 'PO18' }
  return { id: host, name: host }
}

function bookPathForHost(hostname: string): string {
  return sourceForHost(hostname).id === 'po18tw' ? 'books' : 'book'
}

function bookUrlForHost(hostname: string, bookId: string): string {
  const path = `https://${hostname}/${bookPathForHost(hostname)}/${bookId}`
  return sourceForHost(hostname).id === 'po18tw' ? path : `${path}/`
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
      source: 'po18',
      sourceName: 'PO18',
    })
  }

  const pageStats = html.match(/<em[^>]*id\s*=\s*["']pagestats["'][^>]*>\s*(\d+)\s*\/\s*(\d+)/i)
  return { site: 'PO18', total: novels.length, totalPages: pageStats ? Number.parseInt(pageStats[2]!, 10) || 1 : 1, novels }
}

/** POPO（po18.tw）站内搜索，和 PO18（po18x.vip）使用不同的请求与解析规则。 */
export async function searchPo18tw(
  query: string,
  searchType: string,
  page: number,
  db: Db,
  sessionCookie = '',
  requestHtml: HtmlFetcher = fetchHtml,
): Promise<{ site: string; total: number; totalPages: number; novels: DiscoverNovel[] }> {
  const q = String(query || '').trim()
  if (!q) throw new Error('query required')

  const pageUrl = 'https://www.po18.tw/site/alarm'
  const requestOptions: FetchHtmlOptions = { timeoutMs: 12000 }
  const initialCookie = ['po18Limit=1', sessionCookie].filter(Boolean).join('; ')
  requestOptions.headers = { Cookie: initialCookie }
  requestOptions.allowedRedirectHosts = ['po18.tw']
  if (sessionCookie) {
    requestOptions.scope = 'source-auth'
  }
  const pageResult = await requestHtml(pageUrl, requestOptions)
  const requestCookie = mergeCookieHeader(initialCookie, pageResult.setCookies)
  const form = parsePo18SearchForm(pageResult.html, pageUrl)
  const body = new URLSearchParams(form.hidden)
  body.set(form.queryField, q)
  if (form.searchTypeField) body.set(form.searchTypeField, searchType === 'author' ? 'author' : 'book')
  if (page > 1) body.set('page', String(Math.max(1, page)))

  const searchHeaders = new Headers(requestOptions.headers)
  if (requestCookie) searchHeaders.set('Cookie', requestCookie)
  searchHeaders.set('Content-Type', 'application/x-www-form-urlencoded')
  searchHeaders.set('Referer', pageUrl)
  const { html } = await requestHtml(form.action, {
    ...requestOptions,
    method: 'POST',
    headers: searchHeaders,
    body: body.toString(),
    allowedRedirectHosts: requestCookie ? ['po18.tw'] : requestOptions.allowedRedirectHosts,
  })
  if (/<input\b[^>]*(?:type\s*=\s*["']?password|name\s*=\s*["'][^"']*(?:pass|密碼|密码))/i.test(html) && /login|登入|登录/i.test(html)) {
    throw new Error('POPO 搜索需要登录或当前网络不可访问')
  }

  const existing = await loadExisting(db)
  const novels = parsePo18twDiscoverCandidates(html, form.action, existing)
  const totalMatch = extractInnerHtml(html, '#BOOK').match(/共找到\s*<span[^>]*>\s*(\d+)\s*<\/span>/i)
  const pageLinks = [...html.matchAll(/[?&]page=(\d+)/gi)].map((match) => Number.parseInt(match[1]!, 10)).filter(Number.isFinite)
  const total = totalMatch ? Number.parseInt(totalMatch[1]!, 10) || novels.length : novels.length
  const totalPages = pageLinks.length > 0 ? Math.max(1, ...pageLinks) : total > 0 ? Math.ceil(total / 10) : 1
  return { site: 'POPO', total, totalPages, novels }
}

function parsePo18twDiscoverCandidates(html: string, baseUrl: string, existing: { urls: Set<string>; titles: Set<string> }): DiscoverNovel[] {
  const results: DiscoverNovel[] = []
  const bookSection = extractInnerHtml(html, '#BOOK')
  const cardStarts = [...bookSection.matchAll(/<div\b[^>]*class\s*=\s*["'][^"']*\bbook\b[^"']*["'][^>]*>/gi)]
  const seen = new Set<string>()
  for (let index = 0; index < cardStarts.length; index++) {
    const cardStart = (cardStarts[index]!.index || 0) + cardStarts[index]![0].length
    const cardEnd = cardStarts[index + 1]?.index ?? bookSection.length
    const card = bookSection.slice(cardStart, cardEnd)
    const titleBlock = card.match(/<div\b[^>]*class\s*=\s*["'][^"']*\bbook_name\b[^"']*["'][^>]*>[\s\S]*?<\/div>/i)?.[0] || ''
    const titleLink = titleBlock.match(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i)
    const coverMatch = card.match(/<div\b[^>]*class\s*=\s*["'][^"']*\bbook_cover\b[^"']*["'][^>]*>[\s\S]*?<img\b[^>]*src\s*=\s*["']([^"']+)["'][^>]*>/i)
    const href = titleLink?.[1] || card.match(/<a\b[^>]*href\s*=\s*["'](\/books\/\d+)["']/i)?.[1]
    if (!href) continue
    const url = resolveUrl(href, baseUrl)
    const bookId = url.match(/\/books\/(\d+)(?:\/|$)/i)?.[1]
    if (!bookId || seen.has(bookId)) continue
    const coverTitle = card.match(/<img\b[^>]*alt\s*=\s*["']([^"']+)["'][^>]*>/i)?.[1] || ''
    const title = cleanText((titleLink?.[2] || coverTitle).replace(/<[^>]*>/g, ''))
    if (!title) continue
    const authorBlock = card.match(/<div\b[^>]*class\s*=\s*["'][^"']*\bbook_author\b[^"']*["'][^>]*>[\s\S]*?<\/div>/i)?.[0] || ''
    const author = cleanText(authorBlock.replace(/<[^>]*>/g, ''))
    const descriptionBlock = card.match(/<div\b[^>]*class\s*=\s*["'][^"']*\bintro\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || ''
    const description = cleanText(descriptionBlock)
    const coverUrl = coverMatch?.[1] ? resolveUrl(coverMatch[1]!, baseUrl) : ''
    seen.add(bookId)
    results.push({
      bookId,
      title: toSimplifiedForSource(title.slice(0, 100), url),
      author: toSimplifiedForSource(author.slice(0, 30), url),
      coverUrl,
      url,
      existing: existing.urls.has(url) || existing.titles.has(title.slice(0, 100).trim().toLowerCase()),
      description: toSimplifiedForSource(description.slice(0, 120), url),
      chapterCount: 0,
      status: 'ongoing',
      categories: [],
      source: 'po18tw',
      sourceName: 'POPO',
    })
  }
  return results.slice(0, 50)
}

function parsePo18twRankingCandidates(html: string, baseUrl: string, existing: { urls: Set<string>; titles: Set<string> }): DiscoverNovel[] {
  const host = new URL(baseUrl).hostname
  const results: DiscoverNovel[] = []
  const seen = new Set<string>()
  const cards = [...html.matchAll(/<li\b[^>]*class\s*=\s*["'][^"']*\bR_cover\b[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi)]

  for (const match of cards) {
    const card = match[1] || ''
    const titleLink = card.match(/<a\b[^>]*class\s*=\s*["'][^"']*\bbook_name\b[^"']*["'][^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i)
    const href = titleLink?.[1] || card.match(/<a\b[^>]*href\s*=\s*["'](\/books\/\d+\/?)["'][^>]*>/i)?.[1]
    if (!href) continue
    const url = resolveUrl(href, baseUrl)
    const bookId = url.match(/\/books\/(\d+)(?:\/|$)/i)?.[1]
    if (!bookId || seen.has(bookId)) continue

    const coverLink = card.match(/<a\b[^>]*class\s*=\s*["'][^"']*\bbook_cover\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/i)?.[1] || card
    const coverHref = coverLink.match(/<img\b[^>]*src\s*=\s*["']([^"']+)["'][^>]*>/i)?.[1] || ''
    const coverUrl = coverHref ? resolveUrl(coverHref, baseUrl) : ''
    const title = cleanText((titleLink?.[2] || card.match(/<img\b[^>]*alt\s*=\s*["']([^"']+)["']/i)?.[1] || '').replace(/<[^>]*>/g, ''))
    if (!title) continue
    const author = cleanText(
      card.match(/<a\b[^>]*class\s*=\s*["'][^"']*\bbook_author\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/i)?.[1] ||
        card.match(/<div\b[^>]*class\s*=\s*["'][^"']*\bbook_author\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ||
        '',
    )
    const description = cleanText(
      card.match(/<(?:div|p)\b[^>]*class\s*=\s*["'][^"']*\b(?:book_quote|intro)\b[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|p)>/i)?.[1] || '',
    )
    const status = /完結|完本|已完結/i.test(card) ? 'completed' : 'ongoing'
    seen.add(bookId)
    results.push({
      bookId,
      title: toSimplifiedForSource(title.slice(0, 100), url),
      author: toSimplifiedForSource(author.slice(0, 30), url),
      coverUrl,
      url,
      existing: existing.urls.has(url) || existing.titles.has(title.slice(0, 100).trim().toLowerCase()),
      description: toSimplifiedForSource(description.slice(0, 120), url),
      chapterCount: 0,
      status,
      categories: [],
      source: 'po18tw',
      sourceName: 'POPO',
    })
  }

  return results.slice(0, 50)
}

// ---------- 榜单发现 ----------

export async function discoverList(
  listUrl: string,
  deps: { db: Db; fetchHtml: typeof fetchHtml; getPreset?: (url: string) => Promise<Record<string, unknown> | null> },
): Promise<{ site: string; total: number; totalPages: number; novels: DiscoverNovel[] }> {
  if (!listUrl) throw new Error('listUrl required')
  const host = new URL(listUrl).hostname
  const source = sourceForHost(host)
  const existing = await loadExisting(deps.db)
  const preset = (await deps.getPreset?.(listUrl)) || null

  let html: string
  const cached = discoverHtmlCache.get(listUrl)
  if (cached && Date.now() - cached.ts < DISCOVER_CACHE_TTL) {
    html = cached.html
  } else {
    const fetchOptions: FetchHtmlOptions = {}
    if (source.id === 'po18tw') {
      // POPO 的公开页面会先检查成年确认标记；账号 Cookie 仍由专用搜索/目录动作负责注入。
      fetchOptions.headers = { Cookie: 'po18Limit=1' }
      fetchOptions.allowedRedirectHosts = ['po18.tw']
    }
    const fetched = await deps.fetchHtml(listUrl, fetchOptions)
    html = fetched.html
    discoverHtmlCache.set(listUrl, { ts: Date.now(), html })
    if (discoverHtmlCache.size > DISCOVER_CACHE_MAX) {
      discoverHtmlCache.delete(discoverHtmlCache.keys().next().value as string)
    }
  }

  let novels: DiscoverNovel[] = source.id === 'po18tw' ? parsePo18twRankingCandidates(html, listUrl, existing) : []
  if (source.id !== 'po18tw') {
    const seen = new Set<string>()
    const bookRe = /<a\s[^>]*href\s*=\s*["'](?:\/[^"']*)?\/(?:book|books)\/(\d+)\/?["'][^>]*>([\s\S]*?)<\/a>/gi
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
      const authorMatch =
        container.match(/<div\b[^>]*class\s*=\s*["'][^"']*\bbook_author\b[^"']*["'][^>]*>[\s\S]*?<a\b[^>]*>([\s\S]*?)<\/a>/i) ||
        container.match(/作者[：:]\s*([^<\n]{2,20})/i) ||
        container.match(/\/author\/([^"']+)/i) ||
        container.match(/\/users\/[^"']*["'][^>]*>([^<]+)<\/a>/i)
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

      const novelUrl = bookUrlForHost(host, bookId)
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
        source: sourceForHost(host).id,
        sourceName: sourceForHost(host).name,
      })
    }
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
  const site = source.id === host ? presetName || host : source.name
  return { site, total: novels.length, totalPages, novels: novels.slice(0, 50) }
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

type HtmlFetcher = (url: string, opts?: FetchHtmlOptions) => Promise<FetchResult>

export interface TitleSourceSearchOptions {
  /** 仅用于 PO18.tw；不能把 PO18 会话 Cookie 传给晋江。 */
  po18FetchHtml?: HtmlFetcher
  po18SessionCookie?: string
}

function htmlAttribute(tag: string, name: string): string {
  const value = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1] || ''
  return value
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
}

function parsePo18SearchForm(html: string, baseUrl: string): { action: string; queryField: string; searchTypeField: string; hidden: Record<string, string> } {
  const forms = [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)]
  const form = forms.find((item) => /header-search-form|\/search\/index/i.test(item[1] || ''))
  if (!form) throw new Error('无法识别 PO18 搜索表单')
  const formHtml = form[2] || ''
  const inputs = [...formHtml.matchAll(/<input\b[^>]*>/gi)].map((match) => match[0]!)
  const hidden: Record<string, string> = {}
  let queryField = ''
  let searchTypeField = ''
  for (const input of inputs) {
    const name = htmlAttribute(input, 'name')
    if (!name) continue
    const type = (htmlAttribute(input, 'type') || 'text').toLowerCase()
    if (type === 'hidden') hidden[name] = htmlAttribute(input, 'value')
    if (!queryField && type !== 'hidden' && (/^name$/i.test(name) || /搜尋|搜索|search/i.test(`${htmlAttribute(input, 'placeholder')} ${name}`)))
      queryField = name
    if (!searchTypeField && /searchtype/i.test(name)) searchTypeField = name
  }
  if (!queryField) throw new Error('无法识别 PO18 搜索关键词字段')
  const action = resolveUrl(htmlAttribute(form[1] || '', 'action') || '/search/index', baseUrl)
  return { action, queryField, searchTypeField, hidden }
}

function mergeCookieHeader(current: string, setCookies: string[] = []): string {
  const jar = new Map<string, string>()
  for (const part of current.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name && rest.length) jar.set(name, name + '=' + rest.join('='))
  }
  for (const cookie of setCookies) {
    const pair = cookie.split(';', 1)[0]?.trim() || ''
    const [name, ...rest] = pair.split('=')
    if (name && rest.length) jar.set(name, name + '=' + rest.join('='))
  }
  return [...jar.values()].join('; ')
}

export async function searchTitleSources(
  title: string,
  author: string,
  options: TitleSourceSearchOptions = {},
): Promise<{ title: string; author: string; sources: Record<string, { ok: boolean; results: TitleSource[]; error?: string }> }> {
  const [jjwxc, po18tw] = await Promise.all([searchJjwxcTitlesSource(title, author), searchPo18twTitlesSource(title, author, options)])
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

async function searchPo18twTitlesSource(
  title: string,
  author: string,
  options: TitleSourceSearchOptions = {},
): Promise<{ ok: boolean; results: TitleSource[]; error?: string }> {
  try {
    const q = title || author
    const pageUrl = 'https://www.po18.tw/site/alarm'
    const requestOptions: FetchHtmlOptions = { timeoutMs: 10000 }
    if (options.po18SessionCookie) {
      requestOptions.scope = 'source-auth'
      requestOptions.headers = { Cookie: options.po18SessionCookie }
      requestOptions.allowedRedirectHosts = ['po18.tw']
    }
    const requestHtml = options.po18FetchHtml || fetchHtml
    const pageResult = await requestHtml(pageUrl, requestOptions)
    const requestCookie = mergeCookieHeader(options.po18SessionCookie || '', pageResult.setCookies)
    const searchPage = pageResult.html
    const form = parsePo18SearchForm(searchPage, pageUrl)
    const body = new URLSearchParams(form.hidden)
    body.set(form.queryField, q)
    if (form.searchTypeField) body.set(form.searchTypeField, 'all')
    const searchHeaders = new Headers(requestOptions.headers)
    if (requestCookie) searchHeaders.set('Cookie', requestCookie)
    searchHeaders.set('Content-Type', 'application/x-www-form-urlencoded')
    searchHeaders.set('Referer', pageUrl)
    const { html } = await requestHtml(form.action, {
      ...requestOptions,
      method: 'POST',
      headers: searchHeaders,
      body: body.toString(),
      allowedRedirectHosts: requestCookie ? ['po18.tw'] : requestOptions.allowedRedirectHosts,
    })
    if (/<input\b[^>]*(?:type\s*=\s*["']?password|name\s*=\s*["'][^"']*(?:pass|密碼|密码))/i.test(html) && /login|登入|登录/i.test(html))
      throw new Error('搜索需要登录')
    return { ok: true, results: parsePo18twCandidates(html, form.action) }
  } catch (err) {
    const message = (err as Error).message || '当前网络不可访问'
    return {
      ok: false,
      error: message === '搜索需要登录' ? 'PO18.tw 搜索需要登录或当前网络不可访问，请粘贴目录 URL' : `PO18.tw 搜索失败：${message}`,
      results: [],
    }
  }
}

function parsePo18twCandidates(html: string, baseUrl: string): TitleSource[] {
  const results: TitleSource[] = []
  const seen = new Set<string>()
  const bookSection = extractInnerHtml(html, '#BOOK')
  if (!bookSection) return results

  const cardStarts = [...bookSection.matchAll(/<div\b[^>]*class\s*=\s*["'][^"']*\bbook\b[^"']*["'][^>]*>/gi)]
  for (let index = 0; index < cardStarts.length; index++) {
    const cardStart = (cardStarts[index]!.index || 0) + cardStarts[index]![0].length
    const cardEnd = cardStarts[index + 1]?.index ?? bookSection.length
    const card = bookSection.slice(cardStart, cardEnd)
    const titleBlock = card.match(/<div\b[^>]*class\s*=\s*["'][^"']*\bbook_name\b[^"']*["'][^>]*>[\s\S]*?<\/div>/i)?.[0] || ''
    const titleLink = titleBlock.match(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i)
    const coverLink = card.match(/<div\b[^>]*class\s*=\s*["'][^"']*\bbook_cover\b[^"']*["'][^>]*>[\s\S]*?<a\b[^>]*href\s*=\s*["']([^"']+)["']/i)
    const href = titleLink?.[1] || coverLink?.[1]
    if (!href) continue

    const url = resolveUrl(href, baseUrl)
    const bookId = url.match(/\/books\/(\d+)(?:\/|$)/i)?.[1]
    if (!bookId || seen.has(bookId)) continue

    const coverTitle = card.match(/<img\b[^>]*alt\s*=\s*["']([^"']+)["'][^>]*>/i)?.[1] || ''
    const title = cleanText((titleLink?.[2] || coverTitle).replace(/<[^>]*>/g, ''))
    if (!title) continue

    const authorBlock = card.match(/<div\b[^>]*class\s*=\s*["'][^"']*\bbook_author\b[^"']*["'][^>]*>[\s\S]*?<\/div>/i)?.[0] || ''
    const authorLink = authorBlock.match(/<a\b[^>]*>([\s\S]*?)<\/a>/i)
    const author = cleanText((authorLink?.[1] || authorBlock).replace(/<[^>]*>/g, ''))
    seen.add(bookId)
    results.push({
      site: 'po18tw',
      siteName: 'POPO',
      bookId,
      title,
      author,
      // PO18 搜索卡片没有可靠的状态字段，最新章节标题可能包含“完结”字样，不能据此判断全书状态。
      status: 'ongoing',
      url,
    })
  }
  return results
}

// ---------- 章节目录标题提取（晋江 / PO18.tw） ----------

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
  const chapterListUrl = po18ChapterListUrl(url.href)
  const { html } = await requestHtml(chapterListUrl, { timeoutMs: 12000 })
  if (isPo18twLoginPage(html)) throw new Error('PO18.tw 该页面需要登录，请先配置账号或 Cookie')
  const rows = parsePo18twChapterRows(html, chapterListUrl)
  const seen = new Set<string>()
  const titles = rows
    .filter((row) => {
      if (seen.has(row.url)) return false
      seen.add(row.url)
      return true
    })
    .map(({ order, title, url }) => ({ order, title, url }))
  return { site: 'PO18.tw', sourceUrl: chapterListUrl, total: titles.length, titles }
}

export interface Po18ChapterCandidate {
  order: number
  title: string
  url: string
  downloadable: boolean
}

/** 判断 POPO 目录是否被重定向到了登录页。 */
export function isPo18twLoginPage(html: string): boolean {
  return /<input\b[^>]*(?:type\s*=\s*["']?password|name\s*=\s*["'][^"']*(?:pass|密碼|密码))/i.test(html) && /login|登入|登录/i.test(html)
}

/**
 * 判断 POPO 响应是否是登录、拦截或失效链接页面。
 * POPO 可能以 200 返回这些页面，不能只依赖 HTTP 状态码。
 */
export function po18ResponseProblem(finalUrl: string | undefined, html: string): string | null {
  let url: URL | null = null
  try {
    url = finalUrl ? new URL(finalUrl) : null
  } catch {
    /* 由 HTML 特征继续判断 */
  }

  const host = url?.hostname.toLowerCase() || ''
  const path = url?.pathname.toLowerCase().replace(/\/$/, '') || ''
  if (host === 'members.po18.tw' || host.endsWith('.members.po18.tw') || /\/(?:login|login\.php)$/i.test(path)) {
    return 'POPO 返回登录页，账号会话可能已失效，请重新登录或检查 Cookie'
  }
  if (path === '/site/alarm') {
    return 'POPO 返回访问拦截页，请检查账号会话、代理或站点访问限制'
  }
  if ((host === 'www.po18.tw' || host === 'po18.tw') && path === '') {
    return 'POPO 链接已跳转到首页，链接可能已失效或当前会话无权访问'
  }
  if (isPo18twLoginPage(html)) {
    return 'POPO 返回登录页，账号会话可能已失效，请重新登录或检查 Cookie'
  }
  return null
}

/** 解析 POPO 的目录行；付费未购买章节保留标题，但不加入可抓取链接。 */
export function parsePo18twChapterRows(html: string, baseUrl: string): Po18ChapterCandidate[] {
  const chapterListUrl = po18ChapterListUrl(baseUrl)
  const rowStarts = [...html.matchAll(/<div\b[^>]*class\s*=\s*["'][^"']*\bc_l\b[^"']*["'][^>]*>/gi)]
  const fallbackStarts = rowStarts.length ? rowStarts : [...html.matchAll(/<div\b[^>]*class\s*=\s*["'][^"']*\bl_chaptname\b[^"']*["'][^>]*>/gi)]
  const rows: Po18ChapterCandidate[] = []

  for (let index = 0; index < fallbackStarts.length; index++) {
    const marker = fallbackStarts[index]!
    const markerIndex = marker.index || 0
    const isOuterRow = /\bc_l\b/i.test(marker[0] || '')
    const rowStart = isOuterRow ? markerIndex + marker[0].length : markerIndex
    const rowEnd = fallbackStarts[index + 1]?.index ?? html.length
    const row = html.slice(rowStart, rowEnd)
    const nameBlock = row.match(/<div\b[^>]*class\s*=\s*["'][^"']*\bl_chaptname\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || ''
    const nameLink = nameBlock.match(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i)
    const title = cleanText((nameLink?.[2] || nameBlock).replace(/<[^>]*>/g, ''))
    if (!title) continue

    const buttonBlock = row.match(/<div\b[^>]*class\s*=\s*["'][^"']*\bl_btn\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || ''
    const buttonLink = buttonBlock.match(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/i)
    const href = buttonLink?.[1] || nameLink?.[1] || ''
    const safeHref = /^(?:javascript:|#)/i.test(href) ? '' : href
    const counter = row.match(/<div\b[^>]*class\s*=\s*["'][^"']*\bl_counter\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || ''
    const parsedOrder = Number.parseInt(counter.replace(/\D/g, ''), 10)
    const order = Number.isFinite(parsedOrder) && parsedOrder > 0 ? parsedOrder : rows.length + 1
    const url = safeHref ? resolveUrl(safeHref, chapterListUrl) : `${chapterListUrl}#chapter-${order}`
    const downloadable = Boolean(safeHref) && !/訂購|购买|購買/i.test(row)
    rows.push({ order, title, url, downloadable })
  }

  return rows.sort((a, b) => a.order - b.order)
}

export function parsePo18twChapterLinks(html: string, baseUrl: string): { rowCount: number; links: Array<{ href: string; text: string }> } {
  const rows = parsePo18twChapterRows(html, baseUrl)
  return {
    rowCount: rows.length,
    links: rows.filter((row) => row.downloadable && !row.url.includes('#')).map((row) => ({ href: row.url, text: row.title })),
  }
}

export function po18ChapterListUrl(sourceUrl: string): string {
  const url = new URL(sourceUrl)
  const bookId = url.pathname.match(/\/books\/(\d+)(?:\/articles(?:\/\d+)?)?\/?$/i)?.[1]
  return bookId ? `${url.origin}/books/${bookId}/articles` : url.href
}

export function po18ChapterPageUrl(sourceUrl: string, page: number): string {
  const url = new URL(po18ChapterListUrl(sourceUrl))
  if (page > 1) url.searchParams.set('page', String(page))
  return url.href
}

export function po18ChapterContentUrl(chapterUrl: string): string {
  const url = new URL(chapterUrl)
  const match = url.pathname.match(/\/books\/(\d+)\/articles\/(\d+)\/?$/i)
  return match ? `${url.origin}/books/${match[1]}/articlescontent/${match[2]}` : url.href
}

/** POPO 正文接口通常直接返回 HTML 片段；只信任明确的正文容器，找不到时保留整个片段。 */
export function parsePo18twChapterContent(html: string, fallbackTitle: string): { title: string; content: string } {
  const titleHtml = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || ''
  const title = cleanText(titleHtml.replace(/<[^>]*>/g, '')) || cleanText(fallbackTitle)
  const contentSelectors = ['.read-txt', '.read-content', '.article-content', '#article-content', '.pcontent']
  let content = ''
  for (const selector of contentSelectors) {
    const inner = extractInnerHtml(html, selector)
    if (inner.trim()) {
      content = inner
      break
    }
  }
  if (!content) content = html
  content = content.replace(/<blockquote\b[^>]*>[\s\S]*?<\/blockquote>/gi, '').replace(/<h1\b[^>]*>[\s\S]*?<\/h1>/gi, '')
  return { title, content }
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
