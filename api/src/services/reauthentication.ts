import type { DbClient } from '../db/pool'

/** 将当前会话标记为近期完成高强度身份验证。 */
export async function markSessionReauthenticated(db: DbClient, sessionHash: string, userId?: string): Promise<boolean> {
  const result = userId
    ? await db.query('UPDATE user_sessions SET reauthenticated_at = $2 WHERE token_hash = $1 AND user_id = $3', [sessionHash, Date.now(), userId])
    : await db.query('UPDATE user_sessions SET reauthenticated_at = $2 WHERE token_hash = $1', [sessionHash, Date.now()])
  return Boolean(result.rowCount)
}
