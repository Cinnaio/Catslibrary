import type { DbClient } from '../db/pool'

// 只匹配 PO18 主机及其子域，不能匹配 po18.tw.evil.example 或查询字符串里的站名。
export const PO18_SOURCE_PATTERN = '^https?://([a-z0-9-]+\\.)*po18\\.tw(:[0-9]+)?([/?#]|$)'

export async function isPo18SessionBlocked(db: DbClient): Promise<boolean> {
  const result = await db.query<{ available: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM source_accounts WHERE site='po18tw' AND session_ciphertext<>'' AND status<>'invalid') AS available",
  )
  return !result.rows[0]?.available
}

/** alias 仅由本模块的源码调用方提供。判定用于调度 LIMIT 之前，避免堵住其他书源。 */
export function po18FollowupBlockedSql(alias: string): string {
  return `(EXISTS (SELECT 1 FROM scrape_configs pc WHERE pc.novel_id=${alias}.novel_id AND pc.source_url ~* '${PO18_SOURCE_PATTERN}')
    AND NOT EXISTS (SELECT 1 FROM source_accounts pa WHERE pa.site='po18tw' AND pa.session_ciphertext<>'' AND pa.status<>'invalid'))`
}

export async function resumePo18Followups(db: DbClient): Promise<void> {
  await db.query(
    `UPDATE novel_followups f SET next_check_at=$1 FROM scrape_configs c, novels n
     WHERE c.novel_id=f.novel_id AND n.id=f.novel_id AND c.source_url ~* $2
       AND f.enabled AND (n.status='ongoing' OR f.user_configured)
       AND NOT EXISTS (SELECT 1 FROM scrape_jobs j WHERE j.novel_id=f.novel_id AND j.status NOT IN ('completed','partial','failed','cancelled'))`,
    [Date.now(), PO18_SOURCE_PATTERN],
  )
}
