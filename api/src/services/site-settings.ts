import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { DEFAULT_SITE_BRANDING, type SiteBranding } from '@shared/site-settings'
import { getDb, type DbClient } from '../db/pool'
import { first, run, withTx } from '../db/query'

export const BRANDING_KEY = 'site_branding'
export const TURNSTILE_KEY = 'site_turnstile'

export async function readSetting<T>(key: string, db: DbClient = getDb()): Promise<T | null> {
  const row = await first<{ value: string }>(db, 'SELECT value FROM app_settings WHERE key = $1', [key])
  if (!row) return null
  try { return JSON.parse(row.value) as T } catch { return null }
}
export async function writeSetting(key: string, value: unknown, db: DbClient = getDb()): Promise<void> {
  await run(db, `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, $3)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`, [key, JSON.stringify(value), Date.now()])
}
export async function updateSiteSettings<T>(work: (db: DbClient) => Promise<T>): Promise<T> {
  return withTx(getDb(), async query => {
    await query('SELECT pg_advisory_xact_lock($1)', [730006])
    return work({ query })
  })
}
export async function getSiteBranding(db: DbClient = getDb()): Promise<SiteBranding> {
  const saved = await readSetting<Partial<SiteBranding>>(BRANDING_KEY, db)
  return { ...DEFAULT_SITE_BRANDING, ...saved }
}
export function validateBranding(body: Record<string, unknown>): Pick<SiteBranding, 'name' | 'tagline' | 'homeTitle' | 'description'> {
  const result = {} as Pick<SiteBranding, 'name' | 'tagline' | 'homeTitle' | 'description'>
  for (const [key, max] of [['name', 32], ['tagline', 100], ['homeTitle', 100], ['description', 300]] as const) {
    const value = body[key]
    if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\u0000-\u001f\u007f]/.test(value)) {
      throw new Error(`${key} 必须为 1–${max} 字的单行文字`)
    }
    result[key] = value.trim()
  }
  return result
}
function encryptionKey(): Buffer | null {
  const value = process.env.SITE_SETTINGS_ENCRYPTION_KEY?.trim() || ''
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value)) return null
  const key = Buffer.from(value, 'base64')
  return key.length === 32 ? key : null
}
export function encryptionReady(): boolean { return Boolean(encryptionKey()) }
export function encryptSiteSecret(secret: string): string {
  const key = encryptionKey()
  if (!key) throw new Error('请先配置 SITE_SETTINGS_ENCRYPTION_KEY（32 字节随机密钥的 Base64）')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(TURNSTILE_KEY))
  const data = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join('.')
}
export function decryptSiteSecret(value: string): string {
  const key = encryptionKey()
  if (!key) return ''
  try {
    const [version, iv, tag, data] = value.split('.')
    if (version !== 'v1' || !iv || !tag || !data) return ''
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'))
    decipher.setAAD(Buffer.from(TURNSTILE_KEY))
    decipher.setAuthTag(Buffer.from(tag, 'base64'))
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8')
  } catch { return '' }
}
