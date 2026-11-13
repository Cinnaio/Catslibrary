import { adapterForUrl } from './sources'

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
  readMeta?: (html: string) => { title: string; author: string; description: string; coverUrl: string; categories: string[]; status: string } | null
}

const builtinPresets: Record<string, SitePreset> = {
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
}

export function presetForUrl(url: string): SitePreset | undefined {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase().replace(/\.$/, '')
  } catch {
    return undefined
  }
  const adapter = adapterForUrl(url)
  const presets = adapter?.presets ?? builtinPresets
  const domain = Object.keys(presets).sort((a, b) => b.length - a.length)
    .find((domain) => host === domain || host.endsWith(`.${domain}`))
  return domain ? presets[domain] : undefined
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
