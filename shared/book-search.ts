/** A result represents one matching chapter; the snippet is plain text, never HTML. */
export interface BookSearchHit {
  chapterId: string
  chapterTitle: string
  chapterOrder: number
  snippet: string
  matchCount: number
}

export interface BookSearchResponse {
  novelId: string
  query: string
  items: BookSearchHit[]
  scanned: number
  nextCursor: string | null
}

export const BOOK_SEARCH_MAX_QUERY = 80

export function bookMatchPattern(query: string): RegExp {
  return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu')
}

/** Literal, case-insensitive search; punctuation such as %, _ and * has no special meaning. */
export function findBookMatches(text: string, query: string, limit = 1000): { start: number; end: number }[] {
  if (!query) return []
  const matches: { start: number; end: number }[] = []
  for (const match of text.matchAll(bookMatchPattern(query))) {
    matches.push({ start: match.index, end: match.index + match[0].length })
    if (matches.length >= limit) break
  }
  return matches
}
