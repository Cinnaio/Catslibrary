import type { MiddlewareHandler } from 'hono'
import { BUSINESS_LOCK, encryptionReady } from '../services/backups/config'
import { maintenance } from '../services/backups/store'
import type { Db } from '../db/pool'
import { Pool } from 'pg'
import { loadConfig } from '../config'

let gatePool: Pool | null = null
let gateRequired = false
export function requireBackupGate() {
  gateRequired = true
}
// 与业务连接池分开，避免请求持有 gate 连接后又等待业务查询导致池耗尽。
function businessGatePool() {
  if (!gatePool) {
    gatePool = new Pool({ connectionString: loadConfig().databaseUrl, max: 24, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000 })
    gatePool.on('error', () => console.error('[backups] maintenance connection unavailable'))
  }
  return gatePool
}

export async function withBusinessActivity(db: Db, work: () => Promise<void>) {
  if (!encryptionReady() && !gateRequired) return work()
  const client = await db.connect()
  let locked = false
  try {
    const lock = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock_shared($1) AS locked', [BUSINESS_LOCK])
    locked = Boolean(lock.rows[0]?.locked)
    if (locked && !(await maintenance(client))) await work()
  } finally {
    if (locked) await client.query('SELECT pg_advisory_unlock_shared($1)', [BUSINESS_LOCK]).catch(() => {})
    client.release()
  }
}

/** 请求级共享锁：恢复只有在所有业务请求释放锁后才能开始。 */
export function backupMaintenance(): MiddlewareHandler {
  return async (c, next) => {
    if ((!encryptionReady() && !gateRequired) || c.req.path === '/api/health' || c.req.path.startsWith('/api/admin/backups')) return next()
    const client = await businessGatePool().connect()
    let locked = false
    try {
      const lock = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock_shared($1) AS locked', [BUSINESS_LOCK])
      locked = Boolean(lock.rows[0]?.locked)
      if (!locked || (await maintenance(client)))
        return c.json({ error: '站点正在恢复备份，请稍后重试', code: 'BACKUP_MAINTENANCE' }, 503, { 'Retry-After': '30' })
      await next()
    } finally {
      if (locked) await client.query('SELECT pg_advisory_unlock_shared($1)', [BUSINESS_LOCK]).catch(() => {})
      client.release()
    }
  }
}
