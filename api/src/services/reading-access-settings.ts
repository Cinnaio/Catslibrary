import { randomUUID } from 'node:crypto'
import {
  READING_ACCESS_MAX_QUOTA, READING_ACCESS_QUOTAS, READING_ACCESS_WINDOWS,
  type ReadingAccessMode, type ReadingAccessOverrides, type ReadingAccessQuotaKey,
  type ReadingAccessSettings, type ReadingAccessSubject,
} from '@shared/reading-access'
import type { DbClient } from '../db/pool'
import { readSetting, updateSiteSettings, writeSetting } from './site-settings'
import { finishAdminOperationAudit, startAdminOperationAudit } from './admin-operation-audit'
import { requestHash } from './idempotency'

const KEY = 'reading_access_policy'
const DEFAULTS = { guest: [60, 300, 1200], account: [180, 1200, 6000], ip: [720, 4800, 24000] }
const NOVEL_LIMITS = { guest: [6, 20, 80], account: [10, 30, 120], ip: [40, 120, 480] }
const ENV_SUBJECT = { guest: 'GUEST', account: 'USER', ip: 'IP' }
const ENV_WINDOW = { 10: '10_MINUTES', 60: 'HOUR', 1440: 'DAY' }
const MINUTE_ENV = { guest: 'CHAPTER_GUEST_READ_LIMIT_PER_MINUTE', account: 'CHAPTER_READ_LIMIT_PER_MINUTE', ip: 'CHAPTER_IP_READ_LIMIT_PER_MINUTE' }
const EMPTY_OVERRIDES: ReadingAccessOverrides = { mode: null, quotas: {} }

interface StoredSettings {
  revision: string
  overrides: ReadingAccessOverrides
}

function positiveInteger(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= max
}

function parseMode(value: unknown): ReadingAccessMode | undefined {
  return value === 'observe' || value === 'enforce' ? value : undefined
}

function resolveSettings(saved: StoredSettings | null): ReadingAccessSettings {
  const overrides = saved?.overrides ?? EMPTY_OVERRIDES
  const managedByEnv: ReadingAccessSettings['managedByEnv'] = []
  const envMode = parseMode(process.env.CHAPTER_PROTECTION_MODE)
  if (envMode) managedByEnv.push('mode')
  const mode = envMode ?? parseMode(overrides.mode) ?? 'observe'

  function quota(key: ReadingAccessQuotaKey, env: string, fallback: number, maxEnv = READING_ACCESS_MAX_QUOTA) {
    const configured = Number(process.env[env])
    if (positiveInteger(configured, maxEnv)) {
      managedByEnv.push(key)
      return configured
    }
    const override = overrides.quotas?.[key]
    return positiveInteger(override, READING_ACCESS_MAX_QUOTA) ? override : fallback
  }

  const minuteQuota = (kind: ReadingAccessSubject, fallback: number) =>
    quota(`${kind}:1`, MINUTE_ENV[kind], fallback, Number.MAX_SAFE_INTEGER)
  const account = minuteQuota('account', 120)
  const minuteLimits = {
    account,
    guest: minuteQuota('guest', mode === 'enforce' ? Math.min(60, account * 2) : account * 2),
    ip: minuteQuota('ip', account * 2),
  }
  const chapterLimits = (kind: ReadingAccessSubject) => READING_ACCESS_WINDOWS.map((minutes, i) => ({
    minutes,
    chapters: quota(`${kind}:${minutes}`, `CHAPTER_${ENV_SUBJECT[kind]}_UNIQUE_${ENV_WINDOW[minutes]}`, DEFAULTS[kind][i]!),
    novels: NOVEL_LIMITS[kind][i]!,
  }))
  return {
    mode, minuteLimits,
    limits: { guest: chapterLimits('guest'), account: chapterLimits('account'), ip: chapterLimits('ip') },
    revision: saved?.revision ?? null, overrides, managedByEnv,
  }
}

export async function getReadingAccessSettings(db?: DbClient) {
  return resolveSettings(await readSetting<StoredSettings>(KEY, db))
}

export function parseReadingAccessSettings(input: unknown): { revision: string | null; overrides: ReadingAccessOverrides } | null {
  if (!input || typeof input !== 'object') return null
  const { revision, overrides } = input as { revision?: unknown; overrides?: unknown }
  if (revision !== null && (typeof revision !== 'string' || !/^[\da-f-]{36}$/.test(revision))) return null
  if (!overrides || typeof overrides !== 'object') return null
  const { mode, quotas } = overrides as { mode?: unknown; quotas?: unknown }
  if (mode !== null && !parseMode(mode)) return null
  if (!quotas || typeof quotas !== 'object' || Array.isArray(quotas)) return null
  for (const [key, value] of Object.entries(quotas)) {
    if (!READING_ACCESS_QUOTAS.includes(key as ReadingAccessQuotaKey) || !positiveInteger(value, READING_ACCESS_MAX_QUOTA)) return null
  }
  return { revision, overrides: { mode, quotas } as ReadingAccessOverrides }
}

export async function saveReadingAccessSettings(input: NonNullable<ReturnType<typeof parseReadingAccessSettings>>, actorUserId: string) {
  return updateSiteSettings(async db => {
    const current = await getReadingAccessSettings(db)
    if (current.revision !== input.revision) return { status: 'conflict' } as const
    for (const key of current.managedByEnv) {
      const changed = key === 'mode' ? input.overrides.mode !== current.overrides.mode
        : input.overrides.quotas[key] !== current.overrides.quotas[key]
      if (changed) return { status: 'managed' } as const
    }
    if (requestHash(current.overrides) === requestHash(input.overrides)) return { status: 'saved', settings: current } as const
    const saved = { revision: randomUUID(), overrides: input.overrides }
    const auditId = await startAdminOperationAudit(db, {
      operationId: saved.revision, scope: 'site-settings.reading-access',
      actorUserId, action: 'reading-access-settings-save', targetCount: 1, requestHash: requestHash(input.overrides),
    })
    await writeSetting(KEY, saved, db)
    await finishAdminOperationAudit(db, auditId, { status: 'completed', responseStatus: 200 })
    return { status: 'saved', settings: resolveSettings(saved) } as const
  })
}
