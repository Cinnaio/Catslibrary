import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import type { MailSettingsInput } from '@shared/mail-settings'
import { PROJECT_ROOT } from '../config'
import { AccountError } from './account-security'

interface StoredMailSettings { revision: number; smtp: string; from: string; publicOrigin: string }
export const mailSettingsPath = () => path.resolve(process.env.MAIL_CONFIG_FILE || path.join(PROJECT_ROOT, 'data', 'mail-config.json'))

export function validMailOrigin(origin: string): string {
  const production = process.env.NODE_ENV?.trim().toLowerCase() === 'production'
  try {
    const url = new URL(origin)
    if (url.origin === origin.replace(/\/$/, '') && !url.username && !url.password &&
      (url.protocol === 'https:' || (!production && url.protocol === 'http:'))) return url.origin
  } catch { /* 链接只使用明确配置的网站地址。 */ }
  return ''
}
export function parseSmtp(smtp: string): URL | null {
  try {
    const url = new URL(smtp)
    if (!['smtp:', 'smtps:'].includes(url.protocol) || !url.hostname || (url.pathname && url.pathname !== '/') || url.search || url.hash) return null
    if (url.port && (!/^\d+$/.test(url.port) || Number(url.port) < 1 || Number(url.port) > 65535)) return null
    decodeURIComponent(url.username); decodeURIComponent(url.password)
    return url
  } catch { return null }
}
export function readMailSettings(): StoredMailSettings | null {
  try {
    const file = mailSettingsPath()
    const info = lstatSync(file)
    if (!info.isFile() || info.isSymbolicLink() || info.size > 32768) throw new Error()
    const raw = JSON.parse(readFileSync(file, 'utf8')) as StoredMailSettings
    if (!Number.isSafeInteger(raw.revision) || raw.revision < 1 || typeof raw.smtp !== 'string' ||
      typeof raw.from !== 'string' || typeof raw.publicOrigin !== 'string' || !parseSmtp(raw.smtp) || /[\r\n\0]/.test(raw.from)) throw new Error()
    return raw
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new AccountError('邮件配置无法读取，请检查服务器私有配置文件及访问权限', 503)
  }
}
export function effectiveMailSettings() {
  const saved = readMailSettings()
  return saved ? { ...saved, source: 'local' as const } : {
    revision: 0, source: 'environment' as const,
    smtp: process.env.SMTP_URL?.trim() || '', from: process.env.MAIL_FROM?.trim() || '',
    publicOrigin: process.env.PUBLIC_WEB_URL?.trim() || (process.env.NODE_ENV?.trim().toLowerCase() !== 'production' ? 'http://localhost:5173' : ''),
  }
}

/** 与部署配置同样保存为服务器私有文件，不能写入数据库备份、静态资源或 API 响应。 */
export function saveMailSettings(input: MailSettingsInput): void {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AccountError('邮件配置格式无效')
  const current = effectiveMailSettings()
  if (!Number.isSafeInteger(input.revision) || input.revision !== current.revision) throw new AccountError('邮件配置已更新，请撤销草稿并刷新后重试', 409)
  for (const key of ['host', 'username', 'from', 'publicOrigin'] as const) {
    if (typeof input[key] !== 'string' || input[key].length > 2048 || /[\r\n\0]/.test(input[key])) throw new AccountError('邮件配置字段无效')
  }
  const host = input.host.trim(), from = input.from.trim(), username = input.username.trim()
  if (!host || /[\s/@?#\\]/.test(host)) throw new AccountError('请输入 SMTP 主机名，不要包含协议或路径')
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) throw new AccountError('SMTP 端口必须为 1–65535')
  if (!['tls', 'starttls'].includes(input.security)) throw new AccountError('请选择 TLS 或 STARTTLS 加密')
  if (!from || from.length > 320 || !/^[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+$/.test(from.match(/^[^<>]*<([^<>]+)>$/)?.[1] || from)) throw new AccountError('请输入有效发件邮箱，可使用「名称 <邮箱>」格式')
  const publicOrigin = validMailOrigin(input.publicOrigin.trim())
  if (!publicOrigin) throw new AccountError('邮件链接站点须为完整 HTTPS 站点地址，不含路径；本地开发可使用 HTTP')
  if (input.password !== undefined && (typeof input.password !== 'string' || input.password.length > 4096 || /[\r\n\0]/.test(input.password))) throw new AccountError('SMTP 密码无效')
  if (input.clearPassword !== undefined && typeof input.clearPassword !== 'boolean') throw new AccountError('密码清除选项无效')
  if (input.clearPassword && input.password) throw new AccountError('不能同时替换和清除密码')
  const previous = parseSmtp(current.smtp)
  const password = input.clearPassword ? '' : input.password || (previous ? decodeURIComponent(previous.password) : '')
  if (!username && password) throw new AccountError('保留密码时需要填写 SMTP 账号；如无需认证，请同时清除密码')
  const url = parseSmtp(`${input.security === 'tls' ? 'smtps' : 'smtp'}://${host.toLowerCase()}:${input.port}`)
  if (!url || url.hostname !== host.toLowerCase()) throw new AccountError('SMTP 主机名无效')
  url.username = encodeURIComponent(username)
  url.password = encodeURIComponent(password)
  const next: StoredMailSettings = { revision: current.revision + 1, smtp: url.toString(), from, publicOrigin }
  const file = mailSettingsPath(), dir = path.dirname(file)
  for (const served of [path.join(PROJECT_ROOT, 'web'), process.env.WEB_DIST_DIR].filter(Boolean) as string[]) {
    const relative = path.relative(path.resolve(served), file)
    if (!relative || (!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))) throw new AccountError('邮件配置不能保存在网站静态目录', 503)
  }
  const temporary = `${file}.${randomBytes(12).toString('hex')}.tmp`
  let descriptor: number | undefined
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    descriptor = openSync(temporary, 'wx', 0o600)
    writeFileSync(descriptor, JSON.stringify(next, null, 2) + '\n', 'utf8')
    fsyncSync(descriptor)
    closeSync(descriptor); descriptor = undefined
    renameSync(temporary, file)
  } catch { throw new AccountError('邮件配置保存失败，请检查服务器目录写入权限', 503) }
  finally {
    if (descriptor !== undefined) closeSync(descriptor)
    rmSync(temporary, { force: true })
  }
}
