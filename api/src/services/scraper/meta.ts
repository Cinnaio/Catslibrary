/**
 * 元数据提取 —— 由 Novel-KV _scrape-meta.js 的提取核心平移。
 * 纯函数：输入 HTML + 预设 → 输出 novel 元数据；不直接访问 DB/网络。
 */
import { resolveUrl } from './utils'
import { buildCoverUrl, type SitePreset } from './presets'
import { extractAttr, extractByPattern, extractInnerHtml, extractLinks, extractLinkHref, extractTextSmart, cleanText } from './parse'
import { normalizeCategories, tokenizeConcatenatedTags } from '../categories'
import type { FetchHtmlOptions, FetchResult } from './fetch'
import type { ScrapeStore } from './store'
import { getPresetForUrl } from './store'
import { simplifyNovelForSource } from '../zh-convert'

export interface ScrapeNovel {
  title: string
  author: string
  category: string
  categories: string[]
  description: string
  coverUrl: string
  sourceUrl: string
  status?: string
}

export function extractMetaWithPreset(html: string, preset: SitePreset, sourceUrl: string): ScrapeNovel {
  const m = preset.meta!
  let title = extractByPattern(html, m.title || '') || extractTextSmart(html, m.title || '')
  let author = extractByPattern(html, m.author || '') || extractTextSmart(html, m.author || '')
  let description = extractByPattern(html, m.description || '') || extractTextSmart(html, m.description || '')
  let coverUrl = extractByPattern(html, m.cover || '', 'src') || extractAttr(html, m.cover || '', 'src')

  const czbooksMeta = preset.name === '小說狂人' ? extractCzbooksMeta(html) : null
  if (czbooksMeta) {
    title = czbooksMeta.title || title
    author = czbooksMeta.author || author
    description = czbooksMeta.description || description
    coverUrl = czbooksMeta.coverUrl || coverUrl
  }

  if (!coverUrl || /(?:noimg|no_thumbnail|default_no_thumbnail)\.jpg/i.test(coverUrl)) {
    const builtCover = buildCoverUrl(sourceUrl, preset)
    if (builtCover) coverUrl = builtCover
  }

  let category = extractByPattern(html, m.category || '') || extractTextSmart(html, m.category || '')
  if (czbooksMeta?.category) category = czbooksMeta.category
  if (category) {
    category = category.replace(/^[^:：]+[：:]\s*/, '').replace(/^\s+/, '').trim()
  }

  const novel: ScrapeNovel = {
    title: cleanText(title) || '(未识别)',
    author: cleanText(author) || '未知作者',
    category: category || '未分类',
    categories: category ? [category] : [],
    description: cleanText(description) || '',
    coverUrl: coverUrl ? resolveUrl(coverUrl, sourceUrl) : '',
    sourceUrl,
  }
  if (czbooksMeta?.status) novel.status = czbooksMeta.status
  applyStatusFallback(novel, html, preset)
  return novel
}

interface CzbooksMeta {
  title: string
  author: string
  description: string
  category: string
  status: string
  coverUrl: string
}

function extractCzbooksMeta(html: string): CzbooksMeta | null {
  const descMatch = html.match(/<div\s[^>]*class\s*=\s*["'][^"']*\bdescription\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)
  const descText = descMatch ? htmlToText(descMatch[1]!) : ''
  const infoMatch = html.match(/<div\s[^>]*class\s*=\s*["'][^"']*\binfo\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)
  const infoText = infoMatch ? htmlToText(infoMatch[1]!) : ''
  const metaText = [descText, infoText].filter(Boolean).join('\n')
  const stateMatch = html.match(/<div\s[^>]*class\s*=\s*["'][^"']*\bstate\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)
  const stateText = stateMatch ? htmlToText(stateMatch[1]!) : ''
  const coverUrl = extractCzbooksCover(html)
  if (!metaText && !stateText && !coverUrl) return null

  const title = extractCzbooksInfoTitle(html) || pickLabeled(metaText, ['書名', '书名', 'title']) || ''
  const author = pickLabeled(metaText, ['作者', 'author']) || ''
  let description = pickDescription(metaText)
  if (description === metaText) description = ''

  const category = pickLabeled(stateText || metaText, ['分類', '分类']) || ''
  const statusText = pickLabeled(stateText || metaText, ['連載狀態', '连载状态', '狀態', '状态']) || ''
  const status = /完|已完|完結|完结|全集|完本/i.test(statusText)
    ? 'completed'
    : /连载|連載|更新中/i.test(statusText)
      ? 'ongoing'
      : ''

  return { title, author, description, category, status, coverUrl }
}

function extractCzbooksInfoTitle(html: string): string {
  const infoHtml = extractInnerHtml(html, '.info')
  if (!infoHtml) return ''
  const titleHtml = extractInnerHtml(infoHtml, '.title')
  return titleHtml ? htmlToText(titleHtml) : ''
}

function pickLabeled(text: string, labels: string[]): string {
  if (!text) return ''
  const lines = text.split('\n').map((s) => s.trim()).filter(Boolean)
  for (let i = 0; i < lines.length; i++) {
    for (const label of labels) {
      const spaced = label.split('').join('\\s*')
      const sameLine = lines[i]!.match(new RegExp('^' + spaced + '\\s*[：:]\\s*(.+)$', 'i'))
      if (sameLine?.[1]) return sameLine[1].trim()
      if (new RegExp('^' + spaced + '$', 'i').test(lines[i]!) && lines[i + 1]) return lines[i + 1]!.trim()
    }
  }

  const stopLabels = ['書名', '书名', 'title', '作者', 'author', '分類', '分类', '連載狀態', '连载状态', '狀態', '状态', '作品簡介', '作品简介', '簡介', '简介', '其他作品']
  const stop = stopLabels.map((label) => label.split('').join('\\s*')).join('|')
  for (const label of labels) {
    const spaced = label.split('').join('\\s*')
    const m = text.match(new RegExp(spaced + '\\s*[：:]?\\s*([\\s\\S]*?)(?=' + stop + '\\s*[：:]?|$)', 'i'))
    if (m?.[1]?.trim()) return m[1].trim()
  }
  return ''
}

function pickDescription(text: string): string {
  const description = pickLabeled(text, ['作品簡介', '作品简介'])
  if (!description) return ''
  return description.replace(/\n?其他作品[：:][\s\S]*$/i, '').trim()
}

function extractCzbooksCover(html: string): string {
  const thumbnailPos = html.search(/class\s*=\s*["'][^"']*\bthumbnail\b/i)
  if (thumbnailPos === -1) return ''
  const nearby = html.slice(thumbnailPos, thumbnailPos + 800)
  const imgs = [...nearby.matchAll(/<img\b[^>]*?\s+src\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]!)
  return imgs.find((src) => !/(?:noimg|no_thumbnail|default_no_thumbnail)\.jpg/i.test(src)) || imgs[0] || ''
}

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function applyStatusFallback(novel: ScrapeNovel, html: string, preset: SitePreset): void {
  if (novel.status || !preset?.meta?.status) return
  const statusText = extractByPattern(html, preset.meta.status) || extractTextSmart(html, preset.meta.status)
  if (/完|已完|完結|完结|全集|完本/i.test(statusText)) novel.status = 'completed'
  else if (/连载|連載|更新中/i.test(statusText)) novel.status = 'ongoing'
}

/** 从标题括号提取分类，如「书名（1V1，都市H）」→ categories: ['1v1','都市H']。 */
export function extractCategoryFromTitle(title: string): { cleanTitle: string; categories: string[] } | null {
  if (!title) return null
  title = title.trim().replace(/^《\s*/, '').replace(/\s*》$/, '')
  const m = title.match(/(?:[（(]([^）)]+)[）)]|【([^】]+)】|\[([^\]]+)\]|\{([^}]+)\}|「([^」]+)」|〔([^〕]+)〕|〈([^〉]+)〉)\s*$/)
  const cleanTitle = title
    .replace(/(?:[（(][^）)]+[）)]|【[^】]+】|\[[^\]]+\]|\{[^}]+\}|「[^」]+」|〔[^〕]+〕|〈[^〉]+〉)\s*$/, '')
    .trim()
  if (!m) return cleanTitle !== title ? { cleanTitle, categories: [] } : null
  const raw = (m[1] || m[2] || m[3] || m[4] || m[5] || m[6] || m[7] || '').trim()
  const parts = raw.split(/[，、,•·・.。/\\／\s]+/).map((s) => s.trim()).filter(Boolean)
  const categories: string[] = []
  for (const part of parts) {
    const tokens = tokenizeConcatenatedTags(part)
    categories.push(...(tokens.length ? tokens : [part]))
  }
  return { cleanTitle, categories }
}

export function applyTitleCategories(novel: ScrapeNovel): void {
  const catFromTitle = extractCategoryFromTitle(novel.title)
  if (!catFromTitle) return
  novel.title = catFromTitle.cleanTitle
  novel.categories = normalizeCategories([...(novel.categories || []), ...catFromTitle.categories])
  novel.category = novel.categories[0] || novel.category
}

/** 通用元数据提取（无预设站点），含章节列表分页收集。 */
export function extractMetaGeneric(html: string, sourceUrl: string): ScrapeNovel {
  let title = ''
  const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i)
  if (titleMatch) {
    title = titleMatch[1]!
      .replace(/<[^>]*>/g, '')
      .replace(/[-_|]\s*(小说网|PO18|笔趣阁|起点|小说|全文阅读|TXT|在线阅读).*/i, '')
      .trim()
  }
  if (!title) {
    title = extractTextSmart(html, 'h1') || extractTextSmart(html, 'h2')
  }

  let author = ''
  const authorPatterns = [
    /作者[：:]\s*<a[^>]*>([^<]+)<\/a>/i,
    /作者[：:]\s*([^<\n]{2,20})/i,
    /author[：:]\s*<a[^>]*>([^<]+)<\/a>/i,
    /<meta\s+name\s*=\s*["']author["'][^>]*content\s*=\s*["']([^"']+)["']/i,
  ]
  for (const re of authorPatterns) {
    const m = html.match(re)
    if (m) {
      author = m[1]!.trim()
      break
    }
  }
  if (!author) author = '未知作者'

  let description = ''
  const descMatch = html.match(/<meta\s+name\s*=\s*["']description["'][^>]*content\s*=\s*["']([^"']+)["']/i)
  if (descMatch) description = descMatch[1]!.trim()
  if (!description) {
    description = extractTextSmart(html, '.intro') || extractTextSmart(html, '.description') || extractTextSmart(html, '#intro')
  }

  let coverUrl = ''
  const imgRegex = /<img[^>]+src\s*=\s*["']([^"']+)["'][^>]*>/gi
  let imgMatch: RegExpExecArray | null
  let bestImg = ''
  let bestSize = 0
  while ((imgMatch = imgRegex.exec(html)) !== null) {
    const src = imgMatch[1]!
    const tag = imgMatch[0]!
    const wMatch = tag.match(/width\s*=\s*["']?(\d+)/i)
    const hMatch = tag.match(/height\s*=\s*["']?(\d+)/i)
    const size = (wMatch ? Number.parseInt(wMatch[1]!, 10) : 0) * (hMatch ? Number.parseInt(hMatch[1]!, 10) : 0)
    if (size > bestSize || (!bestImg && /cover|封面|book|pic|img/.test(src))) {
      bestSize = size
      bestImg = src
    }
  }
  coverUrl = bestImg ? resolveUrl(bestImg, sourceUrl) : ''

  return {
    title: cleanText(title),
    author: cleanText(author),
    category: '未分类',
    categories: [],
    description: cleanText(description),
    coverUrl,
    sourceUrl,
  }
}

export interface CollectLinksResult {
  links: Array<{ href: string; text: string }>
  limited: boolean
}

/** 元数据探测的依赖注入面（store 可为 null：无书源表时走静态预设+通用提取）。 */
export interface MetaDeps {
  store: ScrapeStore | null
  fetchHtml: (url: string, opts?: FetchHtmlOptions) => Promise<FetchResult>
}

export interface DetectMetaResult {
  novel: ScrapeNovel
  site: { name: string; encoding: string }
  selectors: Record<string, string>
  chapterListUrl: string
  chapterCount: number
  hasMoreChapters: boolean
  encoding: string
}

/** 智能分析：预设（静态/书源）→ 抓取 → 提取元数据 → 统计章节数。 */
export async function detectMeta(sourceUrl: string, deps: MetaDeps): Promise<DetectMetaResult> {
  const preset = (await getPresetForUrl(sourceUrl, deps.store)) as (SitePreset & { source?: string }) | null

  const { html, encoding } = await deps.fetchHtml(sourceUrl, { forceEncoding: preset?.encoding })

  const novel = preset?.meta ? extractMetaWithPreset(html, preset, sourceUrl) : extractMetaGeneric(html, sourceUrl)
  applyTitleCategories(novel)
  const simplified = simplifyNovelForSource(novel, sourceUrl)

  let chapterListUrl = sourceUrl
  if (preset?.urlTransform) chapterListUrl = preset.urlTransform(sourceUrl)

  let chapterCount = 0
  let hasMoreChapters = false
  if (preset?.selectors?.chapterList) {
    try {
      const list = await deps.fetchHtml(chapterListUrl, { forceEncoding: encoding })
      const counted = await collectChapterLinks(list.html, preset, chapterListUrl, encoding, (url) => deps.fetchHtml(url, { forceEncoding: encoding }))
      chapterCount = counted.links.length
      hasMoreChapters = counted.limited
    } catch {
      /* 章节统计失败不阻断分析 */
    }
  }

  return {
    novel: simplified,
    site: preset ? { name: preset.name, encoding: preset.encoding } : { name: '通用', encoding: encoding || 'utf-8' },
    selectors: preset?.selectors || { chapterList: '', chapterTitle: 'h1', chapterContent: 'article, .content, #content' },
    chapterListUrl,
    chapterCount,
    hasMoreChapters,
    encoding: encoding || 'utf-8',
  }
}

/** 分页收集章节链接（fetch 由调用方注入，保持纯函数可测）。 */
export async function collectChapterLinks(
  firstHtml: string,
  preset: SitePreset,
  chapterListUrl: string,
  encoding: string,
  fetchPage: (url: string) => Promise<{ html: string }>,
): Promise<CollectLinksResult> {
  const selectors = preset.selectors || {}
  let links = extractLinks(firstHtml, selectors.chapterList || '', chapterListUrl)
  let nextUrl = selectors.nextPage ? extractLinkHref(firstHtml, selectors.nextPage, chapterListUrl) : ''
  const seenPages = new Set([chapterListUrl])

  while (nextUrl && !seenPages.has(nextUrl)) {
    seenPages.add(nextUrl)
    const { html } = await fetchPage(nextUrl)
    const moreLinks = extractLinks(html, selectors.chapterList || '', nextUrl)
    if (!moreLinks.length) break
    links = links.concat(moreLinks)
    nextUrl = extractLinkHref(html, selectors.nextPage || '', nextUrl)
  }

  const seenLinks = new Set<string>()
  links = links.filter((link) => {
    if (seenLinks.has(link.href)) return false
    seenLinks.add(link.href)
    return true
  })
  return { links, limited: false }
}
