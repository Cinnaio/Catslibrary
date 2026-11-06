import { decodeHTML } from 'entities'
import { removeAdPatterns } from '@shared/ad-cleaner'
import { bookMatchPattern, type BookSearchResponse } from '@shared/book-search'
import type { DbClient } from '../db/pool'

export interface SearchCursor { order: number; id: string }

export function parseSearchCursor(value: string): SearchCursor | null {
  if (!value) return { order: -2147483648, id: '' }
  if (value.length > 512) return null
  try {
    const cursor = JSON.parse(Buffer.from(value, 'base64url').toString())
    return Number.isSafeInteger(cursor.order) && cursor.order >= -2147483648 && cursor.order <= 2147483647
      && typeof cursor.id === 'string' && cursor.id.length <= 200 ? cursor : null
  } catch { return null }
}

export function searchableChapterText(raw: string): string {
  let text = removeAdPatterns(raw || '').replace(/\r\n?/g, '\n')
  if (/<[a-z][\s\S]*>/i.test(text)) {
    text = decodeHTML(text.replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
      .replace(/<br\s*\/?>|<\/(?:p|blockquote|div)>/gi, '\n').replace(/<[^>]*>/g, ''))
  }
  return text.split('\n').map(line => line.trim()).filter(Boolean).join('\n')
}

/** Bound each request's database work; a cursor lets both clients continue long searches. */
export async function searchBook(db: DbClient, novelId: string, query: string, after: SearchCursor, signal?: AbortSignal): Promise<BookSearchResponse> {
  const items: BookSearchResponse['items'] = []
  let cursor = after, scanned = 0
  while (scanned < 200 && items.length < 20 && !signal?.aborted) {
    const { rows } = await db.query<{ id: string; title: string; sort_order: number; content: string }>(
      'SELECT id,title,sort_order,content FROM chapters WHERE novel_id=$1 AND (sort_order,id)>($2,$3) ORDER BY sort_order,id LIMIT 20',
      [novelId, cursor.order, cursor.id],
    )
    if (!rows.length) break
    for (const row of rows) {
      cursor = { order: Number(row.sort_order), id: row.id }; scanned++
      const text = searchableChapterText(row.content)
      const pattern = bookMatchPattern(query), first = pattern.exec(text)
      if (first) {
        let matchCount = 1
        while (pattern.exec(text)) matchCount++
        const start = Math.max(0, first.index - 42), end = Math.min(text.length, first.index + first[0].length + 90)
        items.push({ chapterId: row.id, chapterTitle: row.title, chapterOrder: Number(row.sort_order),
          snippet: `${start ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`, matchCount })
      }
      if (items.length === 20 || scanned === 200) break
    }
  }
  const more = await db.query('SELECT 1 FROM chapters WHERE novel_id=$1 AND (sort_order,id)>($2,$3) LIMIT 1', [novelId, cursor.order, cursor.id])
  return { novelId, query, items, scanned, nextCursor: more.rows.length ? Buffer.from(JSON.stringify(cursor)).toString('base64url') : null }
}
