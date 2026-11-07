import { decodeHTML } from 'entities'
import { removeAdPatterns } from '@shared/ad-cleaner'
import { bookMatchPattern, type BookSearchResponse } from '@shared/book-search'
import type { DbClient } from '../db/pool'

export interface SearchCursor { order: number; id: string }

// Bump whenever searchableChapterText (including ad-cleaner behavior) changes.
export const BOOK_SEARCH_TEXT_VERSION = 1

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
  const prepared: Array<{ id: string; revision: number; text: string }> = []
  let preparedBytes = 0
  let cursor = after, scanned = 0
  while (scanned < 200 && items.length < 20 && !signal?.aborted) {
    const { rows } = await db.query<{ id: string; title: string; sort_order: number; search_revision: number; content: string; cached: boolean }>(
      `SELECT c.id,c.title,c.sort_order,c.search_revision,
         COALESCE(s.search_text,c.content) AS content, s.chapter_id IS NOT NULL AS cached
       FROM chapters c LEFT JOIN chapter_search_text s ON s.chapter_id=c.id
         AND s.source_revision=c.search_revision AND s.normalizer_version=$4
       WHERE c.novel_id=$1 AND (c.sort_order,c.id)>($2,$3) ORDER BY c.sort_order,c.id LIMIT 20`,
      [novelId, cursor.order, cursor.id, BOOK_SEARCH_TEXT_VERSION],
    )
    if (!rows.length) break
    for (const row of rows) {
      cursor = { order: Number(row.sort_order), id: row.id }; scanned++
      const text = row.cached ? row.content : searchableChapterText(row.content)
      if (!row.cached) {
        const bytes = Buffer.byteLength(text)
        if (preparedBytes + bytes <= 4 * 1024 * 1024) {
          prepared.push({ id: row.id, revision: Number(row.search_revision), text })
          preparedBytes += bytes
        }
      }
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
  if (prepared.length && !signal?.aborted) {
    // Revision join at read time is essential: an edit can race this insert.
    // Even a late writer can never make stale text searchable or overwrite a newer revision.
    await db.query(`INSERT INTO chapter_search_text(chapter_id,source_revision,normalizer_version,search_text)
        SELECT c.id,p.revision,$2,p.text FROM json_to_recordset($1::json) AS p(id text,revision bigint,text text)
        JOIN chapters c ON c.id=p.id AND c.search_revision=p.revision
        FOR KEY SHARE OF c
        ON CONFLICT(chapter_id) DO UPDATE SET source_revision=EXCLUDED.source_revision,
          normalizer_version=EXCLUDED.normalizer_version,search_text=EXCLUDED.search_text
        WHERE chapter_search_text.source_revision<=EXCLUDED.source_revision
          AND chapter_search_text.normalizer_version<=EXCLUDED.normalizer_version`,
    [JSON.stringify(prepared), BOOK_SEARCH_TEXT_VERSION])
  }
  const more = await db.query('SELECT 1 FROM chapters WHERE novel_id=$1 AND (sort_order,id)>($2,$3) LIMIT 1', [novelId, cursor.order, cursor.id])
  return { novelId, query, items, scanned, nextCursor: more.rows.length ? Buffer.from(JSON.stringify(cursor)).toString('base64url') : null }
}
