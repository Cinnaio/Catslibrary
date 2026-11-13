import type { Db, DbClient } from '../../db/pool'
import type { SourceChapterCandidate } from '../novel-update-summary'
import type { DiscoverDeps, DiscoverResult, TitleSearchResult } from './enrich'
import type { FetchHtmlOptions, FetchResult } from './fetch'
import { installedAdapters } from './installed-sources'
import type { SitePreset } from './presets'
import type { ScrapeLink } from './store'

export { SourceSessionError } from './source-errors'

export type HtmlFetcher = (url: string, opts?: FetchHtmlOptions) => Promise<FetchResult>

export interface SourceRanking {
  id: string
  label: string
  listUrl: string
  rankingKind?: string
  rankingType?: string
}

interface AccountInput {
  username?: string
  password?: string
  sessionCookie?: string
  clearSession?: boolean
}

interface AccountActions {
  status(db: Db): Promise<unknown>
  save(db: Db, input: AccountInput): Promise<unknown>
  captcha(): Promise<unknown>
  login(db: Db, input: { challengeId: string; captcha?: string }): Promise<unknown>
  test(db: Db, sourceUrl?: string): Promise<unknown>
  clear(db: Db): Promise<void>
}

interface ChapterReader {
  matchesSelectors(selectors: Record<string, string> | undefined): boolean
  listUrl(url: string): string
  assertResponse(url: string | undefined, html: string): void
  readDirectory(html: string, url: string): { links: ScrapeLink[]; protectedChapterCount: number; candidates: SourceChapterCandidate[] }
  chapterRequest(link: ScrapeLink, encoding: string, timeoutMs: number): { url: string; options: FetchHtmlOptions }
  parseChapter(html: string, fallbackTitle: string): { title: string; content: string }
}

export interface ScrapeAdapter {
  id: string
  name: string
  hosts: readonly string[]
  presets: Record<string, SitePreset>
  rankings?: readonly SourceRanking[]
  discover?(url: string, deps: DiscoverDeps, ranking?: SourceRanking): Promise<DiscoverResult>
  search?(query: string, type: string, page: number, deps: DiscoverDeps): Promise<DiscoverResult>
  searchTitles?(title: string, author: string, deps: DiscoverDeps): Promise<TitleSearchResult>
  titles?(url: string, fetchHtml: HtmlFetcher): Promise<{ titles: Array<{ order: number; title: string; url: string }> }>
  chapters?: ChapterReader
  account?: AccountActions
  fetch?(db: Db, fetchHtml: HtmlFetcher): HtmlFetcher
  followup?: {
    blockedSql(alias: string): string
    isBlocked(db: DbClient): Promise<boolean>
    message(previous?: string): string
  }
  legacyActions?: { search?: string; account?: string; titles?: string }
}

// Recognize persisted source URLs when their adapters are absent. Parsing, requests
// and UI metadata belong to the installed adapters.
const legacyHosts = { po18: 'po18x.vip', po18tw: 'po18.tw' }
const legacyChapterList = '@po18tw:chapter-list'
export const SOURCE_UNAVAILABLE = '书源未安装'

let adapters = installedAdapters

/** Private test suites can supply the same adapters used by the private build. */
export function setScrapeAdaptersForTest(value: readonly ScrapeAdapter[]): void {
  if (process.env.NODE_ENV !== 'test') throw new Error('测试书源只能在测试进程注册')
  adapters = value
}

function matchesHost(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`)
}

function sourceHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/\.$/, '')
  } catch {
    return ''
  }
}

export function scrapeAdapters(): readonly ScrapeAdapter[] {
  return adapters
}

export function adapterById(id: string): ScrapeAdapter | undefined {
  return adapters.find((adapter) => adapter.id === id)
}

export function adapterForUrl(url: string): ScrapeAdapter | undefined {
  const host = sourceHost(url)
  return adapters.find((adapter) => adapter.hosts.some((domain) => matchesHost(host, domain)))
}

export function assertSourceAvailable(url: string, selectors?: Record<string, string>): void {
  if (isSourceUnavailable(url, selectors?.chapterList)) throw new Error(SOURCE_UNAVAILABLE)
}

export function isSourceUnavailable(url: string, chapterList?: string): boolean {
  const host = sourceHost(url)
  const legacyId = Object.entries(legacyHosts).find(([, domain]) => matchesHost(host, domain))?.[0]
  const adapter = adapterForUrl(url)
  return Boolean((legacyId && !adapter) || (chapterList === legacyChapterList && !adapter?.chapters))
}

export function sourceFetcher(db: Db, baseFetch: HtmlFetcher): HtmlFetcher {
  return async (url, options) => {
    assertSourceAvailable(url)
    return (adapterForUrl(url)?.fetch?.(db, baseFetch) ?? baseFetch)(url, options)
  }
}

export function followupBlockSql(alias: string): string {
  const missing = Object.entries(legacyHosts).filter(([id]) => !adapterById(id)).map(([, domain]) => domain.replace(/\./g, '\\.'))
  const missingUrl = missing.length ? `c.source_url ~* '^https?://([a-z0-9-]+\\.)*(${missing.join('|')})\\.?(:[0-9]+)?([/?#]|$)'` : 'FALSE'
  const missingSelector = !adapterById('po18tw') ? `c.selectors LIKE '%"${legacyChapterList}"%'` : 'FALSE'
  const checks = [
    `WHEN EXISTS (SELECT 1 FROM scrape_configs c WHERE c.novel_id=${alias}.novel_id AND (${missingUrl} OR ${missingSelector})) THEN 'source_unavailable'`,
    ...adapters.flatMap(({ id, followup }) => followup ? [`WHEN ${followup.blockedSql(alias)} THEN '${id.replace(/'/g, "''")}'`] : []),
  ]
  return `(CASE ${checks.join(' ')} ELSE '' END)`
}

export function followupBlockMessage(reason: string, previous?: string): string {
  return reason === 'source_unavailable' ? SOURCE_UNAVAILABLE : adapterById(reason)?.followup?.message(previous) ?? previous ?? ''
}
