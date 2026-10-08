import type { Db } from '../db/pool'
import { withTx } from '../db/query'
import { FOLLOWUP_INTERVAL_HOURS, MAX_BATCH_FOLLOWUPS, type BatchFollowupMode, type BatchFollowupResult } from '@shared/novel-followup'

export async function saveBatchFollowups(db: Db, ids: string[], mode: BatchFollowupMode, hours?: number): Promise<BatchFollowupResult> {
  if (!Array.isArray(ids) || !ids.length || ids.length > MAX_BATCH_FOLLOWUPS || ids.some((id) => typeof id !== 'string' || !id.trim() || id.length > 200))
    throw new Error(`请选择 1–${MAX_BATCH_FOLLOWUPS} 本小说`)
  if (!['enable', 'pause', 'frequency'].includes(mode)) throw new Error('追更操作无效')
  if (mode !== 'pause' && !FOLLOWUP_INTERVAL_HOURS.some((value) => value === hours)) throw new Error('检查频率无效')
  const uniqueIds = [...new Set(ids)]
  return withTx(db, async (q) => {
    const rows = (
      await q<{ id: string; title: string; status: string; selectors: string | null; enabled: boolean | null; interval_hours: number | null }>(
        `
      SELECT n.id,n.title,n.status,c.selectors,f.enabled,f.interval_hours FROM novels n
      LEFT JOIN scrape_configs c ON c.novel_id=n.id LEFT JOIN novel_followups f ON f.novel_id=n.id
      WHERE n.id=ANY($1::text[]) ORDER BY n.id FOR UPDATE OF n`,
        [uniqueIds],
      )
    ).rows
    const byId = new Map(rows.map((row) => [row.id, row]))
    const valid: Array<{ id: string; enabled: boolean; hours: number }> = []
    const results: BatchFollowupResult['results'] = uniqueIds.map((id) => {
      const row = byId.get(id)
      let reason = ''
      if (!row) reason = '作品已删除或不存在'
      else if (mode !== 'pause') {
        if (row.status !== 'ongoing') reason = '已完结作品不参与自动追更'
        else {
          let selectors: Record<string, unknown> = {}
          try {
            selectors = JSON.parse(row.selectors || '{}') || {}
          } catch {
            /* 无效配置按未配置处理 */
          }
          if (
            typeof selectors.chapterList !== 'string' ||
            !selectors.chapterList.trim() ||
            typeof selectors.chapterContent !== 'string' ||
            !selectors.chapterContent.trim()
          )
            reason = '尚未配置有效的目录和正文选择器'
        }
      }
      if (!reason && row)
        valid.push({
          id,
          enabled: mode === 'enable' || (mode === 'frequency' && Boolean(row.enabled)),
          hours: mode === 'pause' ? row.interval_hours || 6 : hours!,
        })
      return { novelId: id, title: row?.title || id, status: reason ? 'skipped' : 'saved', reason }
    })
    if (valid.length) {
      await q(
        `INSERT INTO novel_followups (novel_id,enabled,interval_hours,next_check_at)
        SELECT id,enabled,hours,CASE WHEN enabled THEN $4::bigint + hours * 3600000::bigint ELSE 0 END
        FROM UNNEST($1::text[],$2::boolean[],$3::integer[]) AS items(id,enabled,hours)
        ON CONFLICT (novel_id) DO UPDATE SET enabled=EXCLUDED.enabled,interval_hours=EXCLUDED.interval_hours,next_check_at=EXCLUDED.next_check_at`,
        [valid.map((row) => row.id), valid.map((row) => row.enabled), valid.map((row) => row.hours), Date.now()],
      )
    }
    return { results, saved: valid.length, skipped: results.length - valid.length }
  })
}
