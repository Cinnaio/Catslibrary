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

/**
 * 判据升级时归档旧建议。
 *
 * 为什么必须做：旧建议是「只读元数据」那一版判据的产物，对《入红尘》这类元数据
 * 干净、正文露骨的作品必然给出 unknown。留它们在待审队列里，审核员会照着一份
 * 证据不充分的结论点「批准」，把漏判固化成分级结果。
 *
 * 归档为 `stale` 而不是删除：历史模型输出要留痕，且 `stale` 不占用
 * 「同作品同修订仅一条 pending」的唯一索引，作品随即可被重新分析。
 */
export async function expireOutdatedPromptVersionSuggestions(
  query: DbClient['query'],
  options: { promptVersion: string; now?: number },
): Promise<number> {
  const result = await query(
    `UPDATE content_rating_ai_suggestions
        SET status = 'stale',
            error = '分级判据已升级（新增正文证据），原建议依据不足，需重新分析',
            review_revision = review_revision + 1, updated_at = $1
      WHERE status = 'pending' AND prompt_version <> $2`,
    [options.now ?? Date.now(), options.promptVersion],
  )
  return result.rowCount ?? 0
}
