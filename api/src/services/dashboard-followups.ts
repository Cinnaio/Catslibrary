import type { DashboardFollowupBook, DashboardFollowups } from '../../../shared/admin-dashboard'
import type { Db } from '../db/pool'
import { first } from '../db/query'

/** 只读调度快照；资格与调度器一致，不在总览读取时初始化或改变追更设置。 */
export async function getDashboardFollowups(db: Db, now: number): Promise<DashboardFollowups> {
  const row = await first<Record<string, unknown>>(
    db,
    `
    WITH tracked AS (
      SELECT f.*, n.title,
        (f.enabled AND (n.status='ongoing' OR f.user_configured)) AS eligible,
        EXISTS (SELECT 1 FROM scrape_jobs j WHERE j.novel_id=f.novel_id
          AND j.status NOT IN ('completed','partial','failed','cancelled')) AS active
      FROM novel_followups f JOIN novels n ON n.id=f.novel_id
    )
    SELECT
      COUNT(*) FILTER (WHERE eligible)::int AS enabled,
      COUNT(*) FILTER (WHERE eligible AND NOT active AND next_check_at <= $1)::int AS waiting,
      COUNT(*) FILTER (WHERE eligible AND active)::int AS running,
      COUNT(*) FILTER (WHERE eligible AND NOT active AND result IN ('failed','partial','pending','protected'))::int AS attention,
      (SELECT COALESCE(json_agg(x), '[]'::json) FROM (
        SELECT * FROM tracked WHERE eligible
        ORDER BY active DESC, next_check_at ASC, novel_id LIMIT 6
      ) x) AS scheduled,
      (SELECT COALESCE(json_agg(x), '[]'::json) FROM (
        SELECT * FROM tracked WHERE eligible AND NOT active AND result IN ('failed','partial','pending','protected')
        ORDER BY checked_at DESC, novel_id LIMIT 6
      ) x) AS issues,
      (SELECT COALESCE(json_agg(x), '[]'::json) FROM (
        SELECT * FROM tracked WHERE checked_at > 0 AND NOT active
        ORDER BY checked_at DESC, novel_id LIMIT 6
      ) x) AS recent
    FROM tracked
  `,
    [now],
  )
  function books(value: unknown): DashboardFollowupBook[] {
    return ((value as Record<string, unknown>[]) || []).map((r) => ({
      novelId: String(r.novel_id),
      title: String(r.title || ''),
      enabled: Boolean(r.eligible),
      intervalHours: Number(r.interval_hours),
      nextCheckAt: r.eligible ? Number(r.next_check_at) : 0,
      checkedAt: Number(r.checked_at),
      result: r.active ? 'running' : String(r.result),
      message: r.active ? '正在检查目录与章节' : String(r.message || ''),
      addedCount: Number(r.added_count),
    }))
  }
  return {
    enabled: Number(row?.enabled || 0),
    waiting: Number(row?.waiting || 0),
    running: Number(row?.running || 0),
    attention: Number(row?.attention || 0),
    scheduled: books(row?.scheduled),
    issues: books(row?.issues),
    recent: books(row?.recent),
  }
}
