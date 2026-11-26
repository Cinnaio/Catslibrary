import type { LibraryNotification, NotificationSettings } from '@shared/notifications'
import type { DbClient } from '../db/pool'
import { all, first } from '../db/query'
import { novelVisibilitySql } from './novel-visibility'

export const defaultNotificationSettings: NotificationSettings = {
  replies: true,
  tasks: true,
  preview: false,
  quietEnabled: false,
  quietStart: '22:00',
  quietEnd: '08:00',
  timeZone: 'Asia/Shanghai',
  revision: 0,
}
export async function notificationSettings(db: DbClient, userId: string): Promise<NotificationSettings> {
  return (
    (await first<NotificationSettings>(
      db,
      `SELECT replies,tasks,preview,quiet_enabled AS "quietEnabled",
    quiet_start AS "quietStart",quiet_end AS "quietEnd",time_zone AS "timeZone",revision
    FROM notification_settings WHERE user_id=$1`,
      [userId],
    )) || { ...defaultNotificationSettings }
  )
}
// Authorization is checked on every list, detail, push and click. Metadata never survives source access revocation.
export function notificationVisibleSql(restricted = false) {
  return `(m.kind='test' OR (
    (m.novel_id='' OR EXISTS (SELECT 1 FROM novels n WHERE n.id=m.novel_id
      AND ${novelVisibilitySql('m.user_id')} ${restricted ? '' : "AND n.content_rating<>'restricted'"}))
    AND ((m.kind='chapters' AND EXISTS (SELECT 1 FROM notification_book_watches w WHERE w.user_id=m.user_id AND w.novel_id=m.novel_id))
    OR (m.kind='reply' AND EXISTS (SELECT 1 FROM novel_comments r JOIN novel_comments p ON p.id=r.parent_id
      WHERE r.id=m.reference_id AND r.status='visible' AND p.status='visible' AND p.user_id=m.user_id))
    OR (m.kind='task' AND EXISTS (SELECT 1 FROM ai_tasks t JOIN users u ON u.id=t.user_id
      WHERE t.id=m.reference_id AND t.user_id=m.user_id AND u.role IN ('admin','super_admin')
      AND t.status IN ('completed','failed'))))))`
}
export interface NotificationRow extends LibraryNotification {
  referenceId: string
  novelId: string
  taskKind: string
  status: string
  error: string
  parentId: string
  reportId: string
}
export async function notificationRows(
  db: DbClient,
  userId: string,
  options: { id?: string; before?: number; beforeId?: string; unread?: boolean; restricted?: boolean } = {},
) {
  return all<NotificationRow>(
    db,
    `SELECT m.id,m.kind,m.reference_id AS "referenceId",m.novel_id AS "novelId",
    m.created_at AS "createdAt",m.read_at AS "readAt",
    CASE WHEN m.kind='chapters' THEN '书架作品更新了 '||m.new_chapters||' 章' WHEN m.kind='reply' THEN '你的评论有了新回复' WHEN m.kind='test' THEN '推送已连接'
      WHEN t.status='failed' THEN 'AI 任务未能完成' ELSE 'AI 任务已完成' END AS title,
    COALESCE(n.title,'') AS body,COALESCE(t.kind,'') AS "taskKind",COALESCE(t.status,'') AS status,
    LEFT(COALESCE(t.error,''),4000) AS error,COALESCE(r.parent_id,'') AS "parentId",
    COALESCE((SELECT id FROM novel_analysis_reports WHERE task_id=t.id AND user_id=m.user_id LIMIT 1),'') AS "reportId"
    FROM notifications m LEFT JOIN novels n ON n.id=m.novel_id
    LEFT JOIN ai_tasks t ON m.kind='task' AND t.id=m.reference_id
    LEFT JOIN novel_comments r ON m.kind='reply' AND r.id=m.reference_id
    WHERE m.user_id=$1 AND ${notificationVisibleSql(options.restricted)}
    AND ($2='' OR m.id=$2) AND (m.created_at<$3 OR (m.created_at=$3 AND m.id<$4))
    ${options.unread ? 'AND m.read_at IS NULL' : ''}
    ORDER BY m.created_at DESC,m.id DESC LIMIT 31`,
    [userId, options.id || '', options.before || Number.MAX_SAFE_INTEGER, options.beforeId || '~'],
  )
}
export function notificationItem(row: NotificationRow): LibraryNotification {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    createdAt: Number(row.createdAt),
    readAt: row.readAt === null ? null : Number(row.readAt),
  }
}
export function quietUntil(settings: NotificationSettings, now: number): number {
  if (!settings.quietEnabled || settings.quietStart === settings.quietEnd) return now
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: settings.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const quiet = (date: number) => {
    const time = formatter.format(new Date(date))
    return settings.quietStart < settings.quietEnd
      ? time >= settings.quietStart && time < settings.quietEnd
      : time >= settings.quietStart || time < settings.quietEnd
  }
  if (!quiet(now)) return now
  // Minute stepping honors DST changes and fractional timezone offsets.
  let next = Math.floor(now / 60000) * 60000 + 60000
  while (next < now + 26 * 3600000 && quiet(next)) next += 60000
  return next
}
