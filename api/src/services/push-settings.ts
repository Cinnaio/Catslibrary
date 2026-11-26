import { createECDH, randomBytes } from 'node:crypto'
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import * as webpush from 'web-push'
import type { PushAdminInput, PushAdminSettings } from '@shared/push-settings'
import { PROJECT_ROOT } from '../config'
import { AccountError } from './account-security'

interface StoredPushSettings {
  revision: number
  enabled: boolean
  publicKey: string
  privateKey: string
  subject: string
}
export const pushSettingsPath = () => path.resolve(process.env.WEB_PUSH_CONFIG_FILE || path.join(PROJECT_ROOT, 'data', 'web-push-config.json'))
export function validVapidKeys(publicKey: string, privateKey: string): boolean {
  try {
    if (!/^[A-Za-z0-9_-]{87}$/.test(publicKey) || !/^[A-Za-z0-9_-]{43}$/.test(privateKey)) return false
    const key = createECDH('prime256v1')
    key.setPrivateKey(Buffer.from(privateKey, 'base64url'))
    return Buffer.from(privateKey, 'base64url').toString('base64url') === privateKey && key.getPublicKey().toString('base64url') === publicKey
  } catch {
    return false
  }
}
export function validPushSubject(subject: string): boolean {
  if (!subject || subject.length > 2048 || /[\s\u0000-\u001f\u007f]/.test(subject)) return false
  try {
    const url = new URL(subject)
    return (
      !url.username &&
      !url.password &&
      !url.hash &&
      ((url.protocol === 'mailto:' && !url.search && /^[^@/?]+@[^@/?]+\.[^@/?]+$/.test(url.pathname)) || (url.protocol === 'https:' && Boolean(url.hostname)))
    )
  } catch {
    return false
  }
}
export function effectivePushSettings(): StoredPushSettings & { source: 'local' | 'environment' } {
  const file = pushSettingsPath()
  try {
    const info = lstatSync(file)
    if (!info.isFile() || info.isSymbolicLink() || info.size > 16384) throw new Error()
    const raw = JSON.parse(readFileSync(file, 'utf8')) as StoredPushSettings
    if (
      !Number.isSafeInteger(raw.revision) ||
      raw.revision < 1 ||
      typeof raw.enabled !== 'boolean' ||
      typeof raw.publicKey !== 'string' ||
      typeof raw.privateKey !== 'string' ||
      typeof raw.subject !== 'string' ||
      ((raw.publicKey || raw.privateKey) && !validVapidKeys(raw.publicKey, raw.privateKey)) ||
      (raw.subject && !validPushSubject(raw.subject)) ||
      (raw.enabled && (!raw.publicKey || !raw.subject))
    )
      throw new Error()
    return { ...raw, source: 'local' }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new AccountError('推送配置无法读取，请检查服务器私有配置文件及访问权限', 503)
  }
  return {
    revision: 0,
    source: 'environment',
    enabled: true,
    publicKey: process.env.WEB_PUSH_PUBLIC_KEY?.trim() || '',
    privateKey: process.env.WEB_PUSH_PRIVATE_KEY?.trim() || '',
    subject: process.env.WEB_PUSH_SUBJECT?.trim() || '',
  }
}
export function pushAdminSettings(): PushAdminSettings {
  const value = effectivePushSettings()
  return {
    revision: value.revision,
    source: value.source,
    enabled: value.enabled,
    subject: value.subject,
    publicKey: value.publicKey,
    privateKeySet: validVapidKeys(value.publicKey, value.privateKey),
    configured: value.enabled && validVapidKeys(value.publicKey, value.privateKey) && validPushSubject(value.subject),
  }
}
export function pushConfiguration() {
  try {
    const value = effectivePushSettings()
    const configured = value.enabled && validVapidKeys(value.publicKey, value.privateKey) && validPushSubject(value.subject)
    return { publicKey: configured ? value.publicKey : '', privateKey: configured ? value.privateKey : '', subject: value.subject, configured }
  } catch {
    return { publicKey: '', privateKey: '', subject: '', configured: false }
  }
}

/** Call under updateSiteSettings' cross-process lock. Private file follows the existing SMTP storage contract. */
export function savePushSettings(input: PushAdminInput): PushAdminSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AccountError('推送配置格式无效')
  const current = effectivePushSettings()
  if (!Number.isSafeInteger(input.revision) || input.revision !== current.revision) throw new AccountError('推送配置已更新，请撤销草稿并重新读取后再保存', 409)
  if (
    typeof input.enabled !== 'boolean' ||
    typeof input.subject !== 'string' ||
    !['keep', 'generate', 'import'].includes(input.keyAction) ||
    (input.confirmRotation !== undefined && typeof input.confirmRotation !== 'boolean')
  )
    throw new AccountError('推送配置字段无效')
  const subject = input.subject.trim()
  if ((subject || input.enabled) && !validPushSubject(subject)) throw new AccountError('请输入有效联系邮箱或 HTTPS 联系地址')
  let publicKey = current.publicKey,
    privateKey = current.privateKey
  if (input.keyAction === 'import') {
    if (typeof input.publicKey !== 'string' || typeof input.privateKey !== 'string' || !validVapidKeys(input.publicKey.trim(), input.privateKey.trim()))
      throw new AccountError('VAPID 公钥与私钥无效或不匹配，请导入同一对密钥')
    publicKey = input.publicKey.trim()
    privateKey = input.privateKey.trim()
  } else if (input.keyAction === 'generate') {
    if (current.publicKey && !input.confirmRotation) throw new AccountError('替换密钥后设备需要重新开启推送，请先确认', 409)
    ;({ publicKey, privateKey } = webpush.generateVAPIDKeys())
  } else if (input.publicKey || input.privateKey) throw new AccountError('导入密钥时请选择导入现有密钥')
  if (current.publicKey && publicKey !== current.publicKey && !input.confirmRotation) throw new AccountError('替换密钥后设备需要重新开启推送，请先确认', 409)
  if ((input.enabled || publicKey || privateKey) && !validVapidKeys(publicKey, privateKey)) throw new AccountError('请先生成或导入有效的 VAPID 密钥')
  const next: StoredPushSettings = { revision: current.revision + 1, enabled: input.enabled, subject, publicKey, privateKey }
  const file = pushSettingsPath(),
    dir = path.dirname(file)
  const temporary = `${file}.${randomBytes(12).toString('hex')}.tmp`
  let descriptor: number | undefined
  try {
    // Resolve existing parents as well, so a symlink cannot redirect the private file into served assets.
    const resolved = (target: string): string => {
      try {
        return realpathSync(target)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        const parent = path.dirname(target)
        if (parent === target) throw error
        return path.join(resolved(parent), path.basename(target))
      }
    }
    const target = resolved(file)
    for (const served of [path.join(PROJECT_ROOT, 'web'), process.env.WEB_DIST_DIR].filter(Boolean) as string[]) {
      const relative = path.relative(resolved(path.resolve(served)), target)
      if (!relative || (!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))) throw new Error()
    }
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    descriptor = openSync(temporary, 'wx', 0o600)
    writeFileSync(descriptor, JSON.stringify(next, null, 2) + '\n', 'utf8')
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = undefined
    renameSync(temporary, file)
  } catch {
    throw new AccountError('推送配置保存失败，请检查服务器私有目录及写入权限，不能存入网站静态目录', 503)
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
    rmSync(temporary, { force: true })
  }
  return pushAdminSettings()
}
