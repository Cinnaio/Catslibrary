import { Pool } from 'pg'
import { isIP } from 'node:net'
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
