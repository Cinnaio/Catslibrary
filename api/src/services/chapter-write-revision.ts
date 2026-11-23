import { createHash } from 'node:crypto'
import type { ChapterFull } from '../db/mappers'

/** Covers every editable field, including writes made by Agent/import/source-sync. */
export function chapterWriteRevision(chapter: ChapterFull): string {
  return createHash('sha256').update(JSON.stringify([
    chapter.id, chapter.novelId, chapter.title, chapter.content, chapter.order, chapter.sourceUrl,
  ])).digest('hex')
}
