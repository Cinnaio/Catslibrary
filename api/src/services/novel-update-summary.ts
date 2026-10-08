import type { DbClient } from '../db/pool'
import { all } from '../db/query'
import type { PendingChapterCounts } from '@shared/novel-updates'

export interface SourceChapterCandidate {
  url: string
  title: string
  order: number
  access: 'public' | 'protected' | 'unknown'
}

/** 每次读取都与当前已入库章节对照，入库、导入和删除后不留下过期的待更新计数。 */
export async function getPendingChapterCounts(db: DbClient, novelIds: string[]): Promise<Map<string, PendingChapterCounts>> {
  if (!novelIds.length) return new Map()
  const rows = await all<{ id: string; known: boolean; total: number; protected: number; public: number; unknown: number }>(
    db,
    `
    SELECT n.id, n.source_chapter_snapshot IS NOT NULL AS known, counts.*
    FROM novels n CROSS JOIN LATERAL (
      SELECT COUNT(*)::integer AS total,
        COUNT(*) FILTER (WHERE item->>'access'='protected')::integer AS protected,
        COUNT(*) FILTER (WHERE item->>'access'='public')::integer AS public,
        COUNT(*) FILTER (WHERE item->>'access'='unknown')::integer AS unknown
      FROM jsonb_array_elements(COALESCE(n.source_chapter_snapshot, '[]'::jsonb)) item
      WHERE NOT EXISTS (
        SELECT 1 FROM chapters c WHERE c.novel_id=n.id AND (
          c.source_url=item->>'url'
          OR (c.source_url='' AND TRIM(c.title)=item->>'title')
          OR (item->>'url' LIKE '%#chapter-%' AND TRIM(c.title)=item->>'title' AND c.sort_order=(item->>'order')::integer)
        )
      )
    ) counts WHERE n.id=ANY($1::text[])`,
    [novelIds],
  )
  return new Map(
    rows.map((row) => [
      row.id,
      {
        pendingChapterCount: row.known ? row.total : null,
        pendingProtectedChapterCount: row.known ? row.protected : null,
        pendingPublicChapterCount: row.known ? row.public : null,
        pendingUnknownChapterCount: row.known ? row.unknown : null,
      },
    ]),
  )
}
