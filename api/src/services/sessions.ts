import { isAdministrator } from '@shared/roles'
/**
 * 会话 —— DB 操作层（由 Novel-KV createSession/getUser/deleteSession 平移）。
 */
import type { Db } from '../db/pool'
import { deviceName, hashToken, newToken, SESSION_TTL, type UserRow } from './auth'

export async function createSession(db: Db, userId: string, userAgent: string, salt: string, ttl = SESSION_TTL): Promise<string> {
  const token = newToken()
  const tokenHash = await hashToken(token, salt)
  const now = Date.now()
  // UA 只用于展示设备名称；不同设备可能完全相同，不能据此撤销有效会话。
  await db.query('DELETE FROM user_sessions WHERE expires_at <= $1', [now])
  await db.query(
    `INSERT INTO user_sessions (token_hash, user_id, expires_at, created_at, device_name, user_agent, last_seen_at, reauthenticated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $4, $4)`,
    [tokenHash, userId, now + ttl, now, deviceName(userAgent), userAgent],
  )
  return token
}

export async function getUserByToken(db: Db, token: string, salt: string): Promise<UserRow | undefined> {
  if (!token) return undefined
  const tokenHash = await hashToken(token, salt)
  const { rows } = await db.query<UserRow>(
    `SELECT u.* FROM user_sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > $2 AND u.status = 'active'`,
    [tokenHash, Date.now()],
  )
  if (isAdministrator(rows[0]?.role))
    await db.query('UPDATE user_sessions SET last_seen_at=GREATEST(last_seen_at,$2) WHERE token_hash=$1 AND last_seen_at<$3', [
      tokenHash,
      Date.now(),
      Date.now() - 60000,
    ])
  return rows[0]
}

export async function deleteSessionByToken(db: Db, token: string, salt: string): Promise<void> {
  if (!token) return
  const tokenHash = await hashToken(token, salt)
  await db.query('DELETE FROM user_sessions WHERE token_hash = $1', [tokenHash])
}
