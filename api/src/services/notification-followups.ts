import type { DbClient } from '../db/pool'
/** Runs inside the existing follow-up finalization transaction. Imports and ordinary chapter edits never call this. */
export async function notifyFollowupReaders(query: DbClient['query'], novelId: string, jobId: string, now: number) {
  // Establish a baseline after changing source or when the directory was unknown at subscription time.
  await query(
    `UPDATE notification_book_watches w SET source_url=COALESCE(sc.source_url,''),
    known_urls=CASE WHEN n.source_chapter_snapshot IS NULL THEN NULL ELSE COALESCE((SELECT jsonb_agg(item->>'url') FROM jsonb_array_elements(n.source_chapter_snapshot) item),'[]'::jsonb) END
    FROM novels n LEFT JOIN scrape_configs sc ON sc.novel_id=n.id WHERE w.novel_id=$1 AND n.id=w.novel_id
    AND (w.known_urls IS NULL OR w.source_url<>COALESCE(sc.source_url,''))`,
    [novelId],
  )
  await query(
    `INSERT INTO notifications(id,user_id,kind,reference_id,novel_id,new_chapters,created_at)
    SELECT md5('chapters:'||$2||':'||w.user_id),w.user_id,'chapters',$2,w.novel_id,counts.total,$3
    FROM notification_book_watches w JOIN users u ON u.id=w.user_id AND u.status='active'
    CROSS JOIN LATERAL (
      SELECT COUNT(DISTINCT i.chapter_url)::int AS total FROM scrape_job_items i
      JOIN chapters c ON c.novel_id=w.novel_id AND c.source_url=i.chapter_url
      WHERE i.job_id=$2 AND i.novel_id=w.novel_id AND i.status='saved' AND i.finished_at>=w.created_at
        AND w.known_urls IS NOT NULL AND NOT (w.known_urls ? i.chapter_url)
    ) counts WHERE w.novel_id=$1 AND counts.total>0 ON CONFLICT DO NOTHING`,
    [novelId, jobId, now],
  )
  // Remember only saved URLs so an incomplete update can notify when its remaining new chapters arrive.
  await query(
    `UPDATE notification_book_watches w SET known_urls=COALESCE((SELECT jsonb_agg(DISTINCT url) FROM (
    SELECT jsonb_array_elements_text(w.known_urls) AS url UNION SELECT chapter_url FROM scrape_job_items
    WHERE job_id=$2 AND novel_id=$1 AND status='saved') seen),'[]'::jsonb) WHERE novel_id=$1 AND known_urls IS NOT NULL`,
    [novelId, jobId],
  )
}
