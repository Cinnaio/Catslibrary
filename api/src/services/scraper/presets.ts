/**
 * 站点预设 —— 由 Novel-KV _scrape-presets.js 平移。
 * 静态预设仅覆盖少数站点；其余走 Legado 书源表（scrape_sources）。
 */

export interface PresetMeta {
  title?: string
  author?: string
  category?: string
  description?: string
  cover?: string
  status?: string
}

export interface SitePreset {
  name: string
  encoding: string
  meta?: PresetMeta
  selectors?: Record<string, string>
  urlTransform?: (srcUrl: string) => string
  coverRule?: (bookId: string) => string
}

export const SITE_PRESETS: Record<string, SitePreset> = {
  'po18.tw': {
    name: 'PO18.tw',
    encoding: 'utf-8',
    meta: {
      title: '.book_name',
      author: '.book_author',
      category: '.book_intro_tags',
      description: '.B_I_content',
      cover: '.book_cover img',
      status: '.statu',
    },
    // 原作者源站同步会用专用解析器读取 /books/{id}/articles，避免通用选择器漏掉付费章节标题。
    selectors: {},
  },
  'czbooks.net': {
    name: '小說狂人',
    encoding: 'utf-8',
    meta: {
      title: '.info span',
      author: '.author a',
      category: '#novel-category',
      description: '.description',
      cover: '.thumbnail img',
      status: '.thumbnail-state',
    },
    selectors: {
      chapterList: '#chapter-list li a[href*="chapterNumber"]',
      chapterTitle: '.chapter-title',
      chapterContent: '.content',
    },
  },
  'www.po18x.vip': {
    name: 'PO18 PC',
    encoding: 'gbk',
    meta: {
      title: 'meta[property="og:title"]',
      author: 'meta[property="og:novel:author"]',
      category: 'meta[property="og:novel:category"]',
      description: 'meta[name="description"]',
      cover: 'meta[property="og:image"]',
      status: '.ratitle',
    },
    selectors: {
      chapterList: '.chapters li a',
      chapterTitle: '#chaptertitle',
      chapterContent: '#novelcontent',
      nextPage: '.page a',
    },
    urlTransform(srcUrl: string): string {
      const m = srcUrl.match(/\/(\d+)\/(\d+)\/?/)
      if (m) return `https://wap.po18x.vip/${m[1]}/${m[2]}/`
      return srcUrl
    },
    coverRule(bookId: string): string {
      const prefix = Math.floor(Number.parseInt(bookId, 10) / 1000)
      return `https://img.po18x.vip/image/${prefix}/${bookId}/${bookId}s.jpg`
    },
  },
  'wap.po18x.vip': {
    name: 'PO18',
    encoding: 'gbk',
    meta: {
      title: '.cataloginfo h3',
      author: '.infotype a[href*="/author/"]',
      category: '.infotype p:nth-child(2)',
      description: '.intro p',
      cover: '.pic img',
    },
    selectors: {
      chapterList: '.chapters li a',
      chapterTitle: '#chaptertitle',
      chapterContent: '#novelcontent',
      nextPage: '.page a',
    },
    urlTransform(srcUrl: string): string {
      const m = srcUrl.match(/\/book\/(\d+)\/?/)
      if (m) {
        const bookId = m[1]!
        const prefix = bookId.slice(0, 2)
        return srcUrl.replace(/\/book\/\d+.*/, `/${prefix}/${bookId}/`)
      }
      return srcUrl
    },
    coverRule(bookId: string): string {
      const prefix = Math.floor(Number.parseInt(bookId, 10) / 1000)
      return `https://img.po18x.vip/image/${prefix}/${bookId}/${bookId}s.jpg`
    },
  },
}

export function buildCoverUrl(sourceUrl: string, preset?: SitePreset | null): string | null {
  if (!sourceUrl || !preset?.coverRule) return null
  const bookId = extractBookId(sourceUrl)
  return bookId ? preset.coverRule(bookId) : null
}

function extractBookId(url: string): string | null {
  if (!url) return null
  let m = url.match(/\/book\/(\d+)\/?/)
  if (m) return m[1] ?? null
  m = url.match(/\/(\d+)\/(\d+)\/?$/)
  if (m) return m[2] ?? null
  return null
}

export function buildCoverUrlFromHtml(html: string, sourceUrl: string, preset?: SitePreset | null): string | null {
  if (!html || !preset?.coverRule) return null
  const bookMatch = html.match(/\/book\/(\d+)\//)
  if (bookMatch) return preset.coverRule(bookMatch[1]!)
  const altMatch = html.match(/\/top\/\w+_(\d+)\//)
  if (altMatch) return preset.coverRule(altMatch[1]!)
  return null
}
