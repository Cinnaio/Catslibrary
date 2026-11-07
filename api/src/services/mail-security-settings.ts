import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import type { MailSecuritySettings, MailSecuritySettingsInput, MailSecretSource } from '@shared/mail-security-settings'
import { PROJECT_ROOT } from '../config'
import { AccountError } from './account-security'
import { effectiveMailSettings, validMailOrigin } from './mail-settings'

interface StoredSettings {
  revision: number
  queueEncryptionKey: string
  webhookSecret: string
}
export const mailSecuritySettingsPath = () =>
  path.resolve(process.env.MAIL_SECURITY_CONFIG_FILE || path.join(PROJECT_ROOT, 'data', 'mail-security-config.json'))

export function parseQueueEncryptionKey(raw: string): Buffer | null {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(raw)) return null
  const key = Buffer.from(raw, 'base64')
  return key.length === 32 && key.toString('base64') === raw ? key : null
}
export function validWebhookSecret(raw: string): boolean {
  if (!/^whsec_[A-Za-z0-9+/]+={0,2}$/.test(raw) || raw.length > 1024) return false
  const encoded = raw.slice(6),
    decoded = Buffer.from(encoded, 'base64')
  return decoded.length >= 16 && decoded.toString('base64') === encoded
}

function assertPrivatePath(file: string) {
  for (const served of [path.join(PROJECT_ROOT, 'web'), process.env.WEB_DIST_DIR].filter(Boolean) as string[]) {
    let root = path.resolve(served)
    try {
      root = realpathSync(root)
    } catch {
      /* The static directory may not exist yet. */
    }
    const relative = path.relative(root, file)
    if (!relative || (!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))) throw new AccountError('邮件安全配置不能保存在网站静态目录', 503)
  }
}
function readSettings(): StoredSettings | null {
  try {
    const file = mailSecuritySettingsPath()
    assertPrivatePath(file)
    const info = lstatSync(file)
    if (!info.isFile() || info.isSymbolicLink() || info.size > 8192) throw new Error()
    assertPrivatePath(realpathSync(file))
    const raw = JSON.parse(readFileSync(file, 'utf8')) as StoredSettings
    if (
      !Number.isSafeInteger(raw.revision) ||
      raw.revision < 1 ||
      typeof raw.queueEncryptionKey !== 'string' ||
      typeof raw.webhookSecret !== 'string' ||
      (raw.queueEncryptionKey && !parseQueueEncryptionKey(raw.queueEncryptionKey)) ||
      (raw.webhookSecret && !validWebhookSecret(raw.webhookSecret))
    )
      throw new Error()
    return raw
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new AccountError('邮件安全配置无法读取，请检查服务器私有配置文件及访问权限', 503)
  }
}

/** Read on every use so all processes sharing this private file see the same key. */
export function effectiveMailSecuritySettings() {
  const saved = readSettings()
  const queueEncryptionKey = saved?.queueEncryptionKey || process.env.MAIL_QUEUE_ENCRYPTION_KEY || process.env.SITE_SETTINGS_ENCRYPTION_KEY || ''
  const webhookSecret = saved?.webhookSecret || process.env.RESEND_WEBHOOK_SECRET || ''
  const queueSource: MailSecretSource = saved?.queueEncryptionKey
    ? 'local'
    : process.env.MAIL_QUEUE_ENCRYPTION_KEY
      ? 'environment'
      : process.env.SITE_SETTINGS_ENCRYPTION_KEY
        ? 'site'
        : 'none'
  const webhookSource: MailSecretSource = saved?.webhookSecret ? 'local' : process.env.RESEND_WEBHOOK_SECRET ? 'environment' : 'none'
  return { revision: saved?.revision || 0, queueEncryptionKey, webhookSecret, queueSource, webhookSource }
}

export function adminMailSecuritySettings(retainedPayload: boolean): MailSecuritySettings {
  const config = effectiveMailSecuritySettings()
  const encryptionReady = Boolean(parseQueueEncryptionKey(config.queueEncryptionKey))
  const webhookReady = validWebhookSecret(config.webhookSecret)
  const origin = validMailOrigin(effectiveMailSettings().publicOrigin)
  return {
    revision: config.revision,
    encryptionReady,
    queueSource: config.queueSource,
    queueCanInitialize: !config.queueEncryptionKey && !retainedPayload,
    queueIssue: config.queueEncryptionKey && !encryptionReady ? 'invalid' : !encryptionReady && retainedPayload ? 'retained-payload' : null,
    webhookReady,
    webhookSource: config.webhookSource,
    webhookInvalid: Boolean(config.webhookSecret) && !webhookReady,
    webhookUrl: origin ? `${origin}/api/security/resend-webhook` : '',
  }
}

/** Caller holds the account/security locks and records a durable, redacted audit. */
export function saveMailSecuritySettings(input: MailSecuritySettingsInput, retainedPayload: boolean) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AccountError('邮件安全配置格式无效')
  const current = effectiveMailSecuritySettings(),
    saved = readSettings()
  if (!Number.isSafeInteger(input.revision) || input.revision !== current.revision) throw new AccountError('邮件安全配置已更新，请撤销草稿并刷新后重试', 409)
  if (typeof input.generateQueueKey !== 'boolean' || typeof input.queueEncryptionKey !== 'string' || typeof input.webhookSecret !== 'string')
    throw new AccountError('邮件安全配置字段无效')
  const suppliedKey = input.queueEncryptionKey.trim(),
    webhookSecret = input.webhookSecret.trim()
  const initializing = input.generateQueueKey || Boolean(suppliedKey)
  if (input.generateQueueKey && suppliedKey) throw new AccountError('生成密钥与填写已有密钥只能选择一种')
  if (initializing && current.queueEncryptionKey) throw new AccountError('已有队列加密密钥，不能在页面中替换，请保留原密钥', 409)
  if (initializing && retainedPayload) throw new AccountError('队列中仍有加密正文，请在服务器恢复原密钥，不能生成新密钥', 409)
  if (suppliedKey && !parseQueueEncryptionKey(suppliedKey)) throw new AccountError('队列密钥必须为 32 字节随机密钥的标准 Base64')
  if (webhookSecret && !validWebhookSecret(webhookSecret)) throw new AccountError('回调签名密钥格式无效，请填写 Resend 提供的 whsec_ 密钥')
  if (!initializing && !webhookSecret) throw new AccountError('没有需要保存的邮件安全配置')
  const next: StoredSettings = {
    revision: current.revision + 1,
    queueEncryptionKey: initializing ? suppliedKey || randomBytes(32).toString('base64') : saved?.queueEncryptionKey || '',
    webhookSecret: webhookSecret || saved?.webhookSecret || '',
  }
  const file = mailSecuritySettingsPath(),
    dir = path.dirname(file)
  assertPrivatePath(file)
  const temporary = `${file}.${randomBytes(12).toString('hex')}.tmp`
  let descriptor: number | undefined
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    assertPrivatePath(path.join(realpathSync(dir), path.basename(file)))
    descriptor = openSync(temporary, 'wx', 0o600)
    writeFileSync(descriptor, JSON.stringify(next, null, 2) + '\n', 'utf8')
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = undefined
    renameSync(temporary, file)
  } catch {
    throw new AccountError('邮件安全配置保存失败，请检查服务器私有目录及写入权限', 503)
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
    rmSync(temporary, { force: true })
  }
}
