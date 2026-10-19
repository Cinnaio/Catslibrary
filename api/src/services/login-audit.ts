import type { Context } from 'hono'
import type { AuthEnv } from '../middlewares/auth'
import type { DbClient } from '../db/pool'
import { run } from '../db/query'
import { newId } from './auth'
import { clientIpFromContext } from './ai/audit-context'

export async function recordLoginAudit(
  db: DbClient,
  c: Context<AuthEnv>,
  input: {
    userId?: string
    username: string
    status: 'success' | 'failure' | 'limited'
    reason: string
    authMethod?: 'password' | 'passkey'
    passkeyId?: string
  },
): Promise<void> {
  await run(
    db,
    `INSERT INTO login_audit (id, user_id, username, status, reason, ip_address, user_agent, created_at, auth_method, passkey_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      newId('login'),
      input.userId || '',
      input.username,
      input.status,
      input.reason,
      clientIpFromContext(c),
      c.req.header('User-Agent') || '',
      Date.now(),
      input.authMethod || 'password',
      input.passkeyId || '',
    ],
  )
}
