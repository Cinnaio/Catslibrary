// ============================================================
// Scrape Tab — TypeScript types & interfaces
// ============================================================

export interface DetectedMeta {
  novel?: {
    title?: string
    author?: string
    description?: string
    coverUrl?: string
    categories?: string[]
    category?: string
    status?: string
    sourceUrl?: string
  }
  selectors?: { chapterList?: string; chapterTitle?: string; chapterContent?: string; nextPage?: string }
  encoding?: string
  chapterListUrl?: string
  chapterCount?: number
  site?: { name?: string }
  error?: string
}

export interface CheckItem {
  label: string
  ok: boolean
  detail?: string
}

export type ConfigRow = [string, string]

export interface JobStatusData {
  id?: string
  status?: string
  step?: string
  current?: number
  total?: number
  progress?: number
  chapterCount?: number
  startedAt?: number
  updatedAt?: number
  successCount?: number
  failedCount?: number
  skippedCount?: number
  speed?: number
  etaSeconds?: number
  failedItems?: Array<{ chapterTitle?: string; chapterUrl?: string; error?: string }>
  summary?: Record<string, number>
  recentLogs?: Array<{ level?: string; message?: string; detail?: string; createdAt?: number | string }>
  novelTitle?: string
  novelId?: string
}

export interface JobCard {
  jobId: string
  novelTitle: string
  status: string
  step: string
  current: number
  total: number
  progress: number
  successCount: number
  failedCount: number
  skippedCount: number
  speed: number
  etaSeconds: number
  failedItems: Array<{ chapterTitle?: string; chapterUrl?: string; error?: string }>
  recentLogs: Array<{ level: string; message: string; detail?: string; createdAt?: number | string }>
  logOpen: boolean
}

export interface DiscoverNovel {
  bookId?: string
  title: string
  author?: string
  coverUrl?: string
  url: string
  existing?: boolean
  description?: string
  chapterCount?: number
  status?: string
}

export interface BatchEntry {
  type: 'novel' | 'ok' | 'skip' | 'err' | 'info'
  text: string
}

export interface BatchState {
  title: string
  entries: BatchEntry[]
  total: number
  success: number
  fail: number
  done: boolean
}

export interface DiscoverDetail {
  item: DiscoverNovel
  loading: boolean
  error: string
  meta: DetectedMeta | null
  chapters: Array<{ text: string; href: string }> | null
  chapterCount: number
  scraping: boolean
}

export interface SourceRow {
  host: string
  name: string
  encoding?: string
  support?: string
  confidence?: number | string
  enabled?: boolean
  connectivity?: 'reachable' | 'unreachable' | 'unknown'
  connectivityError?: string
  connectivityCheckedAt?: number
  chapterList?: string
  chapterContent?: string
  warnings?: string[]
}
