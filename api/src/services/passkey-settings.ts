import type { PasskeyAdminSettings, PasskeyPublicSettings, PasskeySettings } from '@shared/site-settings'
import { getDb, type DbClient } from '../db/pool'
import { loadConfig } from '../config'
import { readSetting, writeSetting } from './site-settings'

export const PASSKEY_KEY = 'site_passkey'
export const DEFAULT_PASSKEY_SETTINGS: PasskeySettings = {
  enabled: false,
  registrationEnabled: true,
  rpName: '知舟',
}

export interface PasskeyRuntimeConfig {
  rpId: string
  origins: string[]
  configured: boolean
  sources: { rpId: 'environment' | 'default'; origins: 'environment' | 'default' }
}

export function getPasskeyRuntimeConfig(): PasskeyRuntimeConfig {
  const config = loadConfig()
  return {
    rpId: config.passkeyRpId,
    origins: config.passkeyOrigins,
    configured: Boolean(config.passkeyRpId && config.passkeyOrigins.length),
    sources: {
      rpId: process.env.PASSKEY_RP_ID?.trim() ? 'environment' : 'default',
      origins: process.env.PASSKEY_ORIGINS?.trim() ? 'environment' : 'default',
    },
  }
}

export async function getPasskeySettings(db: DbClient = getDb()): Promise<PasskeySettings> {
  const saved = await readSetting<Partial<PasskeySettings>>(PASSKEY_KEY, db)
  return {
    ...DEFAULT_PASSKEY_SETTINGS,
    ...saved,
    enabled: saved?.enabled === true,
    registrationEnabled: saved?.registrationEnabled !== false,
    rpName: cleanRpName(saved?.rpName || DEFAULT_PASSKEY_SETTINGS.rpName),
  }
}

export async function getPasskeyAdminSettings(db: DbClient = getDb()): Promise<PasskeyAdminSettings> {
  const settings = await getPasskeySettings(db)
  const runtime = getPasskeyRuntimeConfig()
  return {
    ...settings,
    rpId: runtime.rpId,
    origins: runtime.origins,
    configured: runtime.configured,
    userVerification: 'required',
    sources: runtime.sources,
  }
}

export async function getPasskeyPublicSettings(db: DbClient = getDb()): Promise<PasskeyPublicSettings> {
  const settings = await getPasskeySettings(db)
  return { enabled: settings.enabled, registrationEnabled: settings.registrationEnabled, rpName: settings.rpName }
}

export function validatePasskeySettings(body: Record<string, unknown>): PasskeySettings {
  if (typeof body.enabled !== 'boolean') throw new Error('enabled 必须是布尔值')
  if (typeof body.registrationEnabled !== 'boolean') throw new Error('registrationEnabled 必须是布尔值')
  if (typeof body.rpName !== 'string') throw new Error('rpName 必须是文字')
  const rpName = cleanRpName(body.rpName)
  if (!rpName) throw new Error('Passkey 显示名称不能为空')
  if (rpName.length > 64) throw new Error('Passkey 显示名称不能超过 64 个字符')
  if (/[\u0000-\u001f\u007f]/.test(rpName)) throw new Error('Passkey 显示名称不能包含控制字符')
  return { enabled: body.enabled, registrationEnabled: body.registrationEnabled, rpName }
}

export async function savePasskeySettings(value: PasskeySettings, db: DbClient = getDb()): Promise<void> {
  await writeSetting(PASSKEY_KEY, value, db)
}

export function cleanRpName(value: string): string {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim()
}
