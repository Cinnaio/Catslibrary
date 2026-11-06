import { formatExportText } from './novel-export-text'
import { coverDataToBody } from './covers'
import { isDefaultCoverSource } from '@shared/covers'
import { HTTPException } from 'hono/http-exception'
import { strToU8, zip, type Zippable } from 'fflate'
import { withTx } from '../db/query'
import type { Db } from '../db/pool'

export const MAX_EXPORT_BOOKS = 100
const MAX_EXPORT_BYTES = 64 * 1024 * 1024

export function exportFileName(title: string): string {
  const name = title
    .normalize('NFC')
    .replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '_')
    .replace(/^\.+|[. ]+$/g, '')
    .trim()
  const safe = Array.from(name || '未命名作品')
    .slice(0, 80)
    .join('')
  return /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(safe) ? `_${safe}` : safe
}

export function parseExportIds(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length > MAX_EXPORT_BOOKS ||
    value.some((id) => typeof id !== 'string' || !id.trim() || id.length > 200)
  ) {
    throw new HTTPException(422, { message: `请选择 1–${MAX_EXPORT_BOOKS} 本作品导出` })
  }
  return [...new Set(value.map((id: string) => id.trim()))]
}

export async function exportNovels(
  db: Db,
  ids: string[],
  archive: boolean,
  includeCover = false,
): Promise<{ data: Uint8Array; filename: string; contentType: string }> {
  const books = await withTx(db, async (query) => {
    // Size check and chapter reads must observe the same snapshot.
    await query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const { rows } = await query<{ id: string; title: string; author: string; description: string; cover_url: string }>(
      'SELECT id, title, author, description, cover_url FROM novels WHERE id = ANY($1::text[])',
      [ids],
    )
    if (rows.length !== ids.length) throw new HTTPException(404, { message: '部分作品已不存在，请刷新列表后重试' })
    const size = await query<{ bytes: string }>(
      `SELECT COALESCE(SUM(octet_length(content) + octet_length(title) + 8), 0)::text AS bytes FROM chapters WHERE novel_id = ANY($1::text[])`,
      [ids],
    )
    const metadataBytes = rows.reduce((sum, book) => sum + Buffer.byteLength(book.title + book.author + book.description, 'utf8') + 100, 0)
    if (Number(size.rows[0]?.bytes || 0) + metadataBytes > MAX_EXPORT_BYTES)
      throw new HTTPException(413, { message: '所选正文超过 64 MiB，请减少作品数量后分批导出' })
    const result: Array<{ title: string; data: Uint8Array; cover?: { data: Uint8Array; extension: string } }> = []
    let totalBytes = 0
    for (const id of ids) {
      const book = rows.find((row) => row.id === id)!
      const { rows: chapters } = await query<{ title: string; content: string }>(
        'SELECT title, content FROM chapters WHERE novel_id = $1 ORDER BY sort_order ASC, created_at ASC, id ASC',
        [id],
      )
      const data = strToU8('\uFEFF' + formatExportText(book, chapters).replace(/\n/g, '\r\n') + '\r\n')
      let cover: { data: Uint8Array; extension: string } | undefined
      if (includeCover) {
        const stored = await query<{ data: unknown; content_type: string; source: string }>(
          'SELECT data, content_type, source FROM novel_covers WHERE novel_id = $1',
          [id],
        )
        const current = stored.rows[0]
        const extensions: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' }
        const extension = current && extensions[current.content_type]
        const bytes = current && coverDataToBody(current.data)
        const stale = current && /^https?:\/\//i.test(current.source) && current.source !== book.cover_url
        if (current && !isDefaultCoverSource(current.source) && !stale && extension && bytes?.byteLength) cover = { data: bytes, extension }
      }
      totalBytes += data.byteLength + (cover?.data.byteLength || 0)
      if (totalBytes > MAX_EXPORT_BYTES) throw new HTTPException(413, { message: '导出文本超过 64 MiB，请减少作品数量后分批导出' })
      result.push({ title: book.title, data, ...(cover ? { cover } : {}) })
    }
    return result
  })
  if (!archive && !includeCover) return { data: books[0]!.data, filename: `${exportFileName(books[0]!.title)}.txt`, contentType: 'text/plain; charset=utf-8' }
  // Prefixes avoid collisions for identical titles and case-insensitive file systems.
  const entries: Zippable = Object.create(null)
  books.forEach((book, index) => {
    const folder = `${String(index + 1).padStart(3, '0')}_${exportFileName(book.title)}`
    entries[`${folder}/正文.txt`] = book.data
    if (book.cover) entries[`${folder}/封面.${book.cover.extension}`] = book.cover.data
    else if (includeCover)
      entries[`${folder}/封面说明.txt`] = strToU8('当前没有可导出的独立本地封面，已保留完整正文。通用默认封面、历史版本和未采纳候选不包含在书籍包中。')
  })
  const data = await new Promise<Uint8Array>((resolve, reject) => zip(entries, { level: 6 }, (error, output) => (error ? reject(error) : resolve(output))))
  return { data, filename: `Cat’s Library书籍导出_${ids.length}本.zip`, contentType: 'application/zip' }
}
