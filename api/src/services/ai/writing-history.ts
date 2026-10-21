import { createHash } from 'node:crypto'
import type { Db } from '../../db/pool'
import { all } from '../../db/query'
import type { ContinuationSnapshotV1, WritingBriefV1 } from './writing'
import { cleanStoryText } from './story-memory'

export interface HistoryPassage {
  chapterId: string
  title: string
  sortOrder: number
  text: string
  start: number
  end: number
  fingerprint: string
  matchedTerms: string[]
}

/** Literal search bounded by the frozen continuation anchor. No drafts or
 * other books enter the candidate set; offsets refer to normalized text. */
export async function retrieveWritingHistory(
  db: Db,
  novelId: string,
  anchor: ContinuationSnapshotV1['anchor'],
  brief?: WritingBriefV1,
  instruction = '',
): Promise<HistoryPassage[]> {
  const characters = brief?.characters || []
  const words = `${brief?.objective || ''} ${brief?.requiredFacts || ''} ${instruction}`.match(/[\p{Script=Han}]{2,8}|[a-zA-Z0-9_]{2,32}/gu) || []
  const terms = [...new Set([...characters, ...words].map((term) => term.trim()).filter((term) => term.length >= 2 && term.length <= 80))].slice(0, 20)
  if (!terms.length) return []
  const conditions = terms.map(
    (_, index) => `CASE WHEN POSITION(LOWER($${index + 4}) IN LOWER(content)) > 0 THEN ${index < characters.length ? 3 : 1} ELSE 0 END`,
  )
  const rows = await all<{ id: string; title: string; content: string; sort_order: number }>(
    db,
    `WITH candidates AS (
    SELECT id, title, content, sort_order, (${conditions.join(' + ')}) AS relevance FROM chapters
    WHERE novel_id = $1 AND (sort_order < $2 OR (sort_order = $2 AND id <= $3))
  ) SELECT id, title, content, sort_order FROM candidates WHERE relevance > 0 ORDER BY relevance DESC, sort_order ASC, id ASC LIMIT 8`,
    [novelId, anchor.sortOrder, anchor.chapterId, ...terms],
  )
  return rows
    .map((row) => {
      const content = cleanStoryText(row.content)
      const matchedTerms = terms.filter((term) => content.toLocaleLowerCase().includes(term.toLocaleLowerCase()))
      const position = Math.max(0, content.toLocaleLowerCase().indexOf((matchedTerms[0] || '').toLocaleLowerCase()))
      const start = Math.max(0, position - 400)
      const end = Math.min(content.length, start + 1600)
      return {
        chapterId: row.id,
        title: row.title,
        sortOrder: row.sort_order,
        text: content.slice(start, end),
        start,
        end,
        fingerprint: createHash('sha256').update(content).digest('hex'),
        matchedTerms,
      }
    })
    .filter((item) => item.matchedTerms.length > 0)
}

export function writingMaterialRevision(snapshot: ContinuationSnapshotV1, brief?: WritingBriefV1, instruction = '', outline = ''): string {
  return createHash('sha256').update(JSON.stringify({ snapshot, brief, instruction, outline })).digest('hex')
}
