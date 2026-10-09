import { Pool } from 'pg'
import { isIP } from 'node:net'
import { randomBytes } from 'node:crypto'
import type { BackupSettings, BackupSettingsInput } from '@shared/backups'
import type { Db, DbClient } from '../../db/pool'
import { first, withTx } from '../../db/query'
import { loadConfig } from '../../config'
import { allowedHosts, BACKUP_LOCK, BackupError, seal, unseal } from './config'

type Stored = Omit<BackupSettingsInput, 'rehearsalUrl'> & { rehearsalSecret: string; rehearsalLabel: string }
async function stored(db: DbClient): Promise<Stored> {
  const row = await first<{ value: string }>(db, "SELECT value FROM backup_control.settings WHERE key='runtime'", [])
  return row
    ? JSON.parse(row.value)
    : {
        revision: 0,
        hostSource: 'environment',
        allowedHosts: [],
        rehearsalSource: 'environment',
        rehearsalSecret: '',
        rehearsalLabel: '',
        retryLimit: 3,
        logRetentionDays: 180,
      }
}
function connectionLabel(url: string) {
  try {
    const u = new URL(url)
    return `${u.hostname}${u.port ? `:${u.port}` : ''}${u.pathname}`
  } catch {
    return '部署端连接地址无效'
  }
}
export async function backupSettings(db: DbClient): Promise<BackupSettings> {
  const config = await stored(db)
  const environment = process.env.BACKUP_REHEARSAL_DATABASE_URL || ''
  return {
    revision: config.revision,
    hostSource: config.hostSource,
    allowedHosts: config.hostSource === 'environment' ? allowedHosts() : config.allowedHosts,
    rehearsalSource: config.rehearsalSource,
    rehearsalConfigured:
      config.rehearsalSource === 'custom' ? Boolean(config.rehearsalSecret) : config.rehearsalSource === 'environment' && Boolean(environment),
    rehearsalLabel:
      config.rehearsalSource === 'custom' ? config.rehearsalLabel : config.rehearsalSource === 'environment' && environment ? connectionLabel(environment) : '',
    retryLimit: config.retryLimit,
    logRetentionDays: config.logRetentionDays,
  }
}
export async function rehearsalConnection(db: DbClient) {
  const config = await stored(db)
  return config.rehearsalSource === 'disabled'
    ? ''
    : config.rehearsalSource === 'environment'
      ? process.env.BACKUP_REHEARSAL_DATABASE_URL || ''
      : config.rehearsalSecret
        ? unseal<string>(config.rehearsalSecret)
        : ''
}
export function normalizeHosts(input: unknown) {
  if (!Array.isArray(input) || input.length > 100 || input.some((host) => typeof host !== 'string'))
    throw new BackupError('INVALID_CONFIG', '最多允许 100 个服务器主机')
  const hosts = [...new Set((input as string[]).map((host) => host.trim().toLowerCase()).filter(Boolean))]
  if (
    hosts.some(
      (host) => host.length > 253 || !(isIP(host) || /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(host)),
    )
  )
    throw new BackupError('INVALID_CONFIG', '允许列表请填写准确的主机名或 IP，不包含协议、端口或通配符')
  return hosts
}
function validateUrl(value: string) {
  try {
    const target = new URL(value),
      live = new URL(loadConfig().databaseUrl)
    if (
      !['postgres:', 'postgresql:'].includes(target.protocol) ||
      !target.hostname ||
      !target.pathname.slice(1) ||
      value.length > 4096 ||
      /[\r\n\0]/.test(value)
    )
      throw new Error()
    if (decodeURIComponent(target.pathname) === decodeURIComponent(live.pathname)) throw new Error()
    return target
  } catch {
    throw new BackupError('REHEARSAL_UNSAFE', '请输入有效的 PostgreSQL 连接地址，演练库名称必须与业务库不同')
  }
}
export async function verifyRehearsalConnection(db: DbClient, connectionString: string) {
  validateUrl(connectionString)
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000, statement_timeout: 5000, query_timeout: 6000 })
  try {
    const live = await db.query<{ name: string }>('SELECT current_database() AS name')
    const shadow = await pool.query('SELECT current_database() AS name')
    if (live.rows[0]?.name === shadow.rows[0]?.name) throw new BackupError('REHEARSAL_UNSAFE', '演练库名称必须与业务库不同')
    const marker = await pool.query("SELECT value FROM backup_rehearsal.guard WHERE key='purpose'")
    if (marker.rows[0]?.value !== 'zhi-zhou-backup-rehearsal') throw new BackupError('REHEARSAL_UNSAFE', '演练数据库缺少专属保护标记，请先按部署文档初始化')
  } catch (error) {
    if (error instanceof BackupError) throw error
    throw new BackupError('REHEARSAL_UNAVAILABLE', '演练数据库连接或保护标记验证失败，请检查地址、权限与初始化；未保存设置')
  } finally {
    await pool.end()
  }
}
export async function saveBackupSettings(db: Db, input: BackupSettingsInput) {
  if (
    !Number.isInteger(input.revision) ||
    input.revision < 0 ||
    !['environment', 'custom'].includes(input.hostSource) ||
    !['environment', 'custom', 'disabled'].includes(input.rehearsalSource) ||
    !Number.isInteger(input.retryLimit) ||
    input.retryLimit < 0 ||
    input.retryLimit > 3 ||
    !Number.isInteger(input.logRetentionDays) ||
    input.logRetentionDays < 7 ||
    input.logRetentionDays > 3650 ||
    (input.rehearsalUrl !== undefined && typeof input.rehearsalUrl !== 'string')
  )
    throw new BackupError('INVALID_CONFIG', '配置来源、重试次数或日志保留天数无效')
  const hosts = normalizeHosts(input.allowedHosts)
  return withTx(db, async (query) => {
    const locked = await query<{ locked: boolean }>('SELECT pg_try_advisory_xact_lock($1) AS locked', [BACKUP_LOCK])
    if (!locked.rows[0]?.locked) throw new BackupError('BACKUP_BUSY', '备份任务正在执行，请稍后保存设置', 409)
    await query('SELECT pg_advisory_xact_lock(730049)')
    const client = { query }
    const maintenance = await first<{ value: string }>(client, "SELECT value FROM backup_control.settings WHERE key='maintenance'")
    if (maintenance?.value === 'true') throw new BackupError('MAINTENANCE', '恢复中不能修改设置', 409)
    const current = await stored(client)
    if (current.revision !== input.revision) throw new BackupError('REVISION_CONFLICT', '备份设置已被更新，请重新加载', 409)
    let secret = current.rehearsalSecret,
      label = current.rehearsalLabel
    if (input.rehearsalSource === 'custom') {
      const connection = input.rehearsalUrl?.trim() || (secret ? unseal<string>(secret) : '')
      if (!connection) throw new BackupError('INVALID_CONFIG', '请填写演练数据库连接地址')
      await verifyRehearsalConnection(client, connection)
      secret = seal(connection)
      label = connectionLabel(connection)
    } else {
      secret = ''
      label = ''
    }
    const next: Stored = {
      revision: current.revision + 1,
      hostSource: input.hostSource,
      allowedHosts: hosts,
      rehearsalSource: input.rehearsalSource,
      rehearsalSecret: secret,
      rehearsalLabel: label,
      retryLimit: input.retryLimit,
      logRetentionDays: input.logRetentionDays,
    }
    await query(
      "INSERT INTO backup_control.settings(key,value,updated_at) VALUES('runtime',$1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=EXCLUDED.updated_at",
      [JSON.stringify(next), Date.now()],
    )
    await query('UPDATE backup_control.copies SET retry_at=0 WHERE retry_at>0 AND attempts>$1', [next.retryLimit])
    return backupSettings(client)
  })
}

/** CREATE DATABASE 不能放入事务；会话锁覆盖建库、初始化和配置保存。 */
export async function createRehearsalDatabase(db: Db, revision: number): Promise<BackupSettings> {
  if (!Number.isSafeInteger(revision) || revision < 0) throw new BackupError('INVALID_CONFIG', '备份设置版本无效')
  const client = await db.connect()
  let locked = false,
    created = false,
    saving = false
  let server: Pool | undefined, shadow: Pool | undefined
  const name = `zhi_zhou_rehearsal_${randomBytes(8).toString('hex')}`
  try {
    const lock = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [BACKUP_LOCK])
    if (!lock.rows[0]?.locked) throw new BackupError('BACKUP_BUSY', '备份任务正在执行，请稍后创建演练库', 409)
    locked = true
    if ((await first<{ value: string }>(client, "SELECT value FROM backup_control.settings WHERE key='maintenance'"))?.value === 'true')
      throw new BackupError('MAINTENANCE', '恢复期间不能创建演练库', 409)
    const current = await stored(client)
    if (current.revision !== revision) throw new BackupError('REVISION_CONFLICT', '备份设置已更新，请重新加载', 409)
    if (await rehearsalConnection(client)) throw new BackupError('REHEARSAL_CONFIGURED', '已配置演练数据库，请继续使用当前连接', 409)

    const url = new URL(loadConfig().databaseUrl)
    url.pathname = '/' + name
    // URL 查询参数不能覆盖刚生成的专用数据库名。
    url.searchParams.delete('database')
    url.searchParams.delete('dbname')
    const connectionString = url.toString()
    validateUrl(connectionString)
    const secret = seal(connectionString) // 在建库前确认主密钥可用。
    server = new Pool({ connectionString: loadConfig().databaseUrl, max: 1, connectionTimeoutMillis: 5000, statement_timeout: 30000, query_timeout: 35000 })
    const privilege = await server.query('SELECT rolcreatedb OR rolsuper AS allowed FROM pg_roles WHERE rolname = current_user')
    if (!privilege.rows[0]?.allowed)
      throw new BackupError('REHEARSAL_CREATE_FORBIDDEN', '当前数据库账号没有 CREATEDB 权限，请由数据库管理员授权，或手动配置已初始化的演练库', 403)
    // 名称仅由服务端固定前缀与随机十六进制生成，不接收任意 SQL 标识符。
    await server.query(`CREATE DATABASE "${name}" TEMPLATE template0`)
    created = true
    await server.query(`REVOKE ALL ON DATABASE "${name}" FROM PUBLIC`)
    shadow = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000, statement_timeout: 5000, query_timeout: 6000 })
    const identity = await shadow.query('SELECT current_database() AS name')
    if (identity.rows[0]?.name !== name) throw new BackupError('REHEARSAL_UNSAFE', '连接未指向新建演练库，已停止初始化')
    await shadow.query(`BEGIN;
CREATE SCHEMA backup_rehearsal;
CREATE TABLE backup_rehearsal.guard (key text PRIMARY KEY, value text NOT NULL);
INSERT INTO backup_rehearsal.guard VALUES ('purpose', 'zhi-zhou-backup-rehearsal');
COMMIT;`)
    await shadow.end()
    shadow = undefined
    await verifyRehearsalConnection(client, connectionString)
    const next: Stored = {
      ...current,
      revision: current.revision + 1,
      rehearsalSource: 'custom',
      rehearsalSecret: secret,
      rehearsalLabel: connectionLabel(connectionString),
    }
    // 写入结果不确定时保留新库，避免删除可能已经生效的演练配置。
    saving = true
    await client.query(
      "INSERT INTO backup_control.settings(key,value,updated_at) VALUES('runtime',$1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=EXCLUDED.updated_at",
      [JSON.stringify(next), Date.now()],
    )
    return {
      revision: next.revision,
      hostSource: next.hostSource,
      allowedHosts: next.hostSource === 'environment' ? allowedHosts() : next.allowedHosts,
      rehearsalSource: 'custom',
      rehearsalConfigured: true,
      rehearsalLabel: next.rehearsalLabel,
      retryLimit: next.retryLimit,
      logRetentionDays: next.logRetentionDays,
    }
  } catch (error) {
    await shadow?.end().catch(() => {})
    shadow = undefined
    if (created && !saving) {
      try {
        await server!.query(`DROP DATABASE "${name}"`)
      } catch {
        throw new BackupError('REHEARSAL_CREATE_INCOMPLETE', `演练库初始化失败，未保存配置；新库 ${name} 未能清理，请联系数据库管理员处理`)
      }
    }
    if (saving) throw new BackupError('REHEARSAL_CREATE_INCOMPLETE', `演练库 ${name} 已创建，但配置保存结果未确认，请刷新检查后再操作`)
    if (error instanceof BackupError) throw error
    if ((error as { code?: string }).code === '42501')
      throw new BackupError('REHEARSAL_CREATE_FORBIDDEN', '数据库权限不足，无法创建或初始化演练库，请由数据库管理员检查权限', 403)
    throw new BackupError('REHEARSAL_CREATE_FAILED', '演练库创建失败，请检查数据库连接、建库权限及服务器存储空间；原配置未修改')
  } finally {
    await shadow?.end().catch(() => {})
    await server?.end().catch(() => {})
    if (locked) await client.query('SELECT pg_advisory_unlock($1)', [BACKUP_LOCK]).catch(() => {})
    client.release()
  }
}
