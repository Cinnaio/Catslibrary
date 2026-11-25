import { createHmac, timingSafeEqual } from 'node:crypto'
import { loadConfig } from '../config'
import type { Db } from '../db/pool'
import { discoverySourceIDs, matchSourceBooks, type SourceBookAccess } from './source-rankings'
import { makeDeps } from './scraper/runtime'
import { adapterById, adapterForUrl } from './scraper/sources'

const BOOK_KEY_TTL = 60 * 60_000
export const SOURCE_SEARCH_MAX_PAGE = 1000

interface SearchBookKey {
  userId: string
  sourceId: string
  sourceUrl: string
  coverUrl?: string
  expiresAt: number
}

type SearchEntry = { rank: number; title: string; author: string } & (
  { novelId: string; updatedAt: number } |
  { sourceUrl: string; description: string; searchBookKey: string }
)

function searchableAdapter(sourceId: string) {
  const adapter = discoverySourceIDs.includes(sourceId) ? adapterById(sourceId) : undefined
  return adapter?.search ? adapter : undefined
}

export function sourceSearchOptions() {
  return discoverySourceIDs.map(searchableAdapter).flatMap(adapter => adapter ? [{ id: adapter.id, name: adapter.name }] : [])
}

function signature(payload: string) {
  return createHmac('sha256', `${loadConfig().sessionHashSalt}\0source-search-book-v1`).update(payload).digest()
}

function signBookKey(book: SearchBookKey) {
  const payload = Buffer.from(JSON.stringify(book)).toString('base64url')
  return `${payload}.${signature(payload).toString('base64url')}`
}

function readBookKey(key: string | undefined, userId: string) {
  if (!key || key.length > 4096 || !/^[\w-]+\.[\w-]{43}$/.test(key)) return
  const [payload, encodedSignature] = key.split('.') as [string, string]
  const supplied = Buffer.from(encodedSignature, 'base64url')
  const expected = signature(payload)
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return
  const book = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as SearchBookKey
  if (book.userId !== userId || book.expiresAt < Date.now() || !searchableAdapter(book.sourceId) ||
      adapterForUrl(book.sourceUrl)?.id !== book.sourceId) return
  return book
}

export async function searchDiscoverySource(db: Db, input: {
  sourceId: string
  query: string
  type: 'title' | 'author'
  page: number
  userId: string
}, access: SourceBookAccess) {
  const adapter = searchableAdapter(input.sourceId)
  if (!adapter?.search) return null
  const { fetchHtml } = makeDeps(db)
  const result = await adapter.search(input.query, input.type === 'author' ? 'author' : 'articlename', input.page, { db, fetchHtml })
  const seen = new Set<string>()
  const books = result.novels.slice(0, 100).filter(book => {
    const url = URL.parse(book.url)
    if (!book.title.trim() || !url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        url.href.length > 1000 || adapterForUrl(url.href)?.id !== adapter.id || seen.has(url.href)) return false
    seen.add(url.href)
    return true
  })
  const matches = await matchSourceBooks(db, books.map(book => book.url), access)
  const localIDs = new Set<string>()
  const entries = books.flatMap((book, index): SearchEntry[] => {
    const linked = matches.get(book.url) ?? []
    const [novel] = linked
    const rank = index + 1
    if (linked.length === 1 && novel?.readable && !localIDs.has(novel.id)) {
      localIDs.add(novel.id)
      return [{ rank, title: novel.title, author: novel.author, novelId: novel.id, updatedAt: novel.updated_at }]
    }
    if (linked.length || !access.includeUncollected) return []
    return [{
      rank, title: book.title, author: book.author, sourceUrl: book.url, description: book.description.slice(0, 2000),
      searchBookKey: signBookKey({ userId: input.userId, sourceId: adapter.id, sourceUrl: book.url,
        ...(book.coverUrl && Buffer.byteLength(book.coverUrl) <= 1400 ? { coverUrl: book.coverUrl } : {}), expiresAt: Date.now() + BOOK_KEY_TTL }),
    }]
  })
  return { entries, hasMore: input.page < Math.min(result.totalPages, SOURCE_SEARCH_MAX_PAGE) }
}

export async function findSourceSearchBook(db: Db, key: string | undefined, userId: string, access: SourceBookAccess) {
  if (!access.includeUncollected) return
  const book = readBookKey(key, userId)
  if (!book) return
  const matches = await matchSourceBooks(db, [book.sourceUrl], access)
  if (matches.get(book.sourceUrl)?.length) return
  return book
}
