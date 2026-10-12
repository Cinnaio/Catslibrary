import type { DbClient } from '../db/pool'

/** Keep historical model output, but remove suggestions whose rating snapshot is no longer current. */
export async function expireContentRatingAiSuggestions(
  query: DbClient['query'],
  options: { novelId?: string; excludeSuggestionId?: string; now?: number } = {},
): Promise<number> {
  const result = await query(
    `UPDATE content_rating_ai_suggestions s
        SET status = 'stale', error = '作品分级或修订已变化，原 LLM 建议已过期',
            review_revision = s.review_revision + 1, updated_at = $1
       FROM novels n
      WHERE n.id = s.novel_id AND s.status = 'pending'
        AND (n.content_rating <> 'unknown' OR n.content_rating_revision <> s.novel_rating_revision)
        AND ($2::text IS NULL OR s.novel_id = $2)
        AND ($3::text IS NULL OR s.id <> $3)`,
    [options.now ?? Date.now(), options.novelId ?? null, options.excludeSuggestionId ?? null],
  )
  return result.rowCount ?? 0
}
