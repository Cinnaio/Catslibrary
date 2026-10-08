import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import path from 'node:path'
import { PROJECT_ROOT } from '../../config'
import type { BackupPolicy, BackupTargetInput } from '@shared/backups'

export class BackupError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message)
  }
}
export const BACKUP_LOCK = 730047
export const BUSINESS_LOCK = 730048
export function backupRoot() {
  const root = path.resolve(process.env.BACKUP_ROOT || path.join(PROJECT_ROOT, 'data', 'backups'))
  for (const served of [path.join(PROJECT_ROOT, 'web'), process.env.WEB_DIST_DIR].filter(Boolean) as string[]) {
    const relative = path.relative(path.resolve(served), root)
    if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)))
      throw new BackupError('UNSAFE_DIRECTORY', '备份目录不能位于网站静态文件目录中')
  }
  return root
}
export function backupKey() {
  const raw = process.env.BACKUP_ENCRYPTION_KEY || ''
  if (!/^[A-Za-z0-9+/]{43}=$/.test(raw) || Buffer.from(raw, 'base64').length !== 32)
    throw new BackupError('KEY_UNAVAILABLE', '请在部署端配置 BACKUP_ENCRYPTION_KEY（32 字节随机密钥的 Base64）')
  return Buffer.from(raw, 'base64')
}
export function encryptionReady() {
  try {
    backupKey()
    return true
  } catch {
    return false
  }
}
export const keyId = () => process.env.BACKUP_KEY_ID || 'default'
export function purposeKey(purpose: string) {
  return createHash('sha256').update(backupKey()).update(`zhi-zhou-backups:${purpose}`).digest()
}
export function seal(value: unknown) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', purposeKey('credentials'), iv)
  cipher.setAAD(Buffer.from('backup-target-v1'))
  const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()])
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join('.')
}
export function unseal<T>(value: string): T {
  try {
    const [iv, tag, data] = value.split('.')
    if (!iv || !tag || !data) throw new Error('invalid credential')
    const decipher = createDecipheriv('aes-256-gcm', purposeKey('credentials'), Buffer.from(iv, 'base64'))
    decipher.setAAD(Buffer.from('backup-target-v1'))
    decipher.setAuthTag(Buffer.from(tag, 'base64'))
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString()) as T
  } catch {
    throw new BackupError('KEY_UNAVAILABLE', '存储凭据无法解密，请恢复原备份主密钥')
  }
}
export const defaultPolicy: BackupPolicy = {
  enabled: false,
  schedule: 'daily',
  time: '03:00',
  timezone: 'Asia/Shanghai',
  weekday: 0,
  intervalHours: 24,
  targetIds: [],
  localRetention: 7,
  nextRunAt: 0,
  revision: 0,
}
function integer(value: unknown, min: number, max: number, name: string) {
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) throw new BackupError('INVALID_CONFIG', `${name}必须为 ${min}–${max} 的整数`)
  return Number(value)
}
export function validatePolicy(body: BackupPolicy): BackupPolicy {
  if (typeof body.enabled !== 'boolean' || !['daily', 'weekly', 'interval'].includes(body.schedule) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.time))
    throw new BackupError('INVALID_CONFIG', '备份计划或时间无效')
  try {
    new Intl.DateTimeFormat('en', { timeZone: body.timezone }).format()
  } catch {
    throw new BackupError('INVALID_CONFIG', '时区无效')
  }
  if (!Array.isArray(body.targetIds) || body.targetIds.length > 20 || body.targetIds.some((id) => typeof id !== 'string'))
    throw new BackupError('INVALID_CONFIG', '请选择有效的存储目标')
  return {
    enabled: body.enabled,
    schedule: body.schedule,
    time: body.time,
    timezone: body.timezone,
    weekday: integer(body.weekday, 0, 6, '星期'),
    intervalHours: integer(body.intervalHours, 1, 720, '间隔小时'),
    targetIds: [...new Set(body.targetIds)],
    localRetention: integer(body.localRetention, 1, 365, '本地保留数量'),
    revision: integer(body.revision, 0, 2147483646, '配置版本'),
    nextRunAt: 0,
  }
}
// 按绝对分钟枚举，天然覆盖重复/缺失的 DST 时刻；每日同一当地日期只取首个匹配。
export function nextRun(policy: BackupPolicy, after: number) {
  if (!policy.enabled) return 0
  if (policy.schedule === 'interval') return after + policy.intervalHours * 3600000
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: policy.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  })
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const local = (ts: number) => Object.fromEntries(formatter.formatToParts(ts).map((p) => [p.type, p.value]))
  const start = local(after),
    today = `${start.year}-${start.month}-${start.day}`
  for (let ts = Math.floor(after / 60000) * 60000 + 60000; ts < after + 8 * 86400000; ts += 60000) {
    const p = local(ts),
      time = `${p.hour}:${p.minute}`,
      date = `${p.year}-${p.month}-${p.day}`
    if (policy.schedule === 'weekly' && p.weekday !== days[policy.weekday]) continue
    if (time >= policy.time && (date !== today || `${start.hour}:${start.minute}` < policy.time)) return ts
  }
  throw new BackupError('INVALID_CONFIG', '无法计算下次备份时间')
}
export const allowedHosts = () =>
  (process.env.BACKUP_ALLOWED_HOSTS || '')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean)
export function validateTarget(body: BackupTargetInput, hosts = allowedHosts()) {
  if (!body || !['sftp', 'webdav', 's3'].includes(body.type) || typeof body.name !== 'string' || !body.name.trim() || body.name.length > 80)
    throw new BackupError('INVALID_CONFIG', '存储类型或名称无效')
  if (typeof body.host !== 'string' || /[\r\n\0]/.test(body.host)) throw new BackupError('INVALID_CONFIG', '服务器地址无效')
  let hostname = body.host.toLowerCase()
  if (body.type !== 'sftp') {
    let url: URL
    try {
      url = new URL(body.host)
    } catch {
      throw new BackupError('INVALID_CONFIG', '请输入 HTTPS 服务地址')
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
      throw new BackupError('INVALID_CONFIG', '服务地址必须使用 HTTPS，不能内嵌凭据或查询参数')
    hostname = url.hostname.toLowerCase()
  } else if (!/^[a-zA-Z0-9.:-]+$/.test(hostname)) throw new BackupError('INVALID_CONFIG', 'SFTP 主机名无效')
  if (!hosts.includes(hostname)) throw new BackupError('HOST_NOT_ALLOWED', '请先在备份设置的服务器允许列表中添加该主机')
  for (const field of ['path', 'username', 'bucket', 'region'] as const)
    if (typeof body[field] !== 'string' || /[\r\n\0]/.test(body[field]) || body[field].length > 1024) throw new BackupError('INVALID_CONFIG', '存储字段无效')
  if (body.path.split('/').includes('..') || body.path.includes('\\') || (body.type === 'sftp' && !body.path.startsWith('/')))
    throw new BackupError('INVALID_CONFIG', '目录不能包含上级路径，SFTP 请填写绝对路径')
  if (body.type === 'sftp' && (!body.username || !/^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp\d+) [A-Za-z0-9+/]+={0,3}$/.test(body.hostKey)))
    throw new BackupError('INVALID_CONFIG', 'SFTP 必须填写用户名及完整服务器公钥（算法 + Base64），不能只填指纹')
  if (body.type === 's3' && !/^[a-zA-Z0-9][a-zA-Z0-9.-]{1,62}$/.test(body.bucket)) throw new BackupError('INVALID_CONFIG', 'S3 bucket 无效')
  if (typeof body.enabled !== 'boolean' || typeof body.required !== 'boolean') throw new BackupError('INVALID_CONFIG', '存储启用状态无效')
  return {
    name: body.name.trim(),
    type: body.type,
    enabled: body.enabled,
    required: body.required,
    host: body.host.trim(),
    port: integer(body.port, 1, 65535, '端口'),
    path: body.path,
    username: body.username,
    hostKey: body.hostKey || '',
    bucket: body.bucket,
    region: body.region,
    retention: integer(body.retention, 1, 365, '保留数量'),
  }
}
