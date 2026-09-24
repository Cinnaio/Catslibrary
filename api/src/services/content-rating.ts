import { hasRestrictedCategoryTag } from '@shared/restricted-categories'
import { hasRestrictedText } from '@shared/restricted-patterns'
import type { Db, DbClient } from '../db/pool'
import { withTx } from '../db/query'

interface UnratedNovelRow {
  id: string
  title: string
  description: string
  categories: string
}

interface RatingMatch {
  id: string
  title: string
  reason: string[]
}

export interface ContentRatingPrefillResult {
  scanned: number
  matched: number
  applied: number
  byTag: number
  byText: number
  ids: string[]
  unknown: number
  sample: RatingMatch[]
}

function parseCategories(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw || '[]')
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

/**
 * Only unknown rows can be changed. The write path locks them until commit, so a
 * concurrent manual rating cannot be overwritten by a prefill in progress.
 * This runs before the API starts listening as well as through the admin action.
 */
export async function prefillUnknownContentRatings(db: Db, dryRun = false): Promise<ContentRatingPrefillResult> {
  const execute = async (query: DbClient['query']): Promise<ContentRatingPrefillResult> => {
    const { rows } = await query<UnratedNovelRow>(
      `SELECT id, title, description, categories FROM novels WHERE content_rating = 'unknown'${dryRun ? '' : ' FOR UPDATE'}`,
    )
    const matches: RatingMatch[] = []
    const ids: string[] = []
    let byTag = 0
    let byText = 0

    for (const row of rows) {
      const categories = parseCategories(row.categories)
      const tag = hasRestrictedCategoryTag(categories)
      const text = hasRestrictedText({ title: row.title, description: row.description })
      if (!tag && !text) continue
      const reason = [tag ? 'tag' : '', text ? 'text' : ''].filter(Boolean)
      matches.push({ id: row.id, title: row.title, reason })
      if (tag) byTag++
      if (text) byText++
      if (!dryRun) {
        // Do not change updated_at: rating is governance metadata, not a new novel update.
        const result = await query(
          `UPDATE novels SET content_rating = 'restricted' WHERE id = $1 AND content_rating = 'unknown'`,
          [row.id],
        )
        if (result.rowCount) ids.push(row.id)
      }
    }

    const remaining = await query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM novels WHERE content_rating = 'unknown'`,
    )
    return {
      scanned: rows.length,
      matched: matches.length,
      applied: ids.length,
      byTag,
      byText,
      ids,
      unknown: Number(remaining.rows[0]?.count ?? 0),
      sample: matches.slice(0, 50),
    }
  }

  return dryRun ? execute(db.query.bind(db)) : withTx(db, execute)
}
