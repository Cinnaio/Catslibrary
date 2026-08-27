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

/** POPO 的目录与正文不是普通 CSS 选择器可直接读取的结构，由抓取引擎使用专用标记解析。 */
export const PO18TW_SELECTORS = {
  chapterList: '@po18tw:chapter-list',
  chapterTitle: '@po18tw:chapter-title',
  chapterContent: '@po18tw:chapter-content',
} as const

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
    // POPO 目录通过 /articles 展示，正文通过 /articlescontent/{pid} 返回，交给专用解析器处理。
    selectors: PO18TW_SELECTORS,
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
