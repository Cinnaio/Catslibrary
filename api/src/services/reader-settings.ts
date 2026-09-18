/**
 * 阅读设置 —— LWW（最后写入胜出）合并（由 Novel-KV auth.js 内的相关函数平移）。
 */

import type { ReaderDevice } from '@shared/types'

export interface ReaderSettings {
  values: Record<string, string>
  updatedAt: Record<string, number>
}

export interface ReaderSettingsDocument {
  version: 2
  devices: Record<ReaderDevice, ReaderSettings>
  shared: ReaderSettings
}

const EMPTY_READER_SETTINGS: ReaderSettings = { values: {}, updatedAt: {} }

const SETTING_KEYS = [
  'fontSize',
  'fontFamily',
  'readerPageMode',
  'readerTheme',
  'readerLineHeight',
  'readerParagraphSpacing',
  'readerWakeLock',
  'readerPageWidth',
  'readerAutoScrollSpeed',
  'readerClickPaging',
  'contentMode',
] as const

const SHARED_SETTING_KEYS = ['contentMode'] as const
const DEVICE_SETTING_KEYS = SETTING_KEYS.filter((key) => !SHARED_SETTING_KEYS.includes(key as (typeof SHARED_SETTING_KEYS)[number]))

const ALLOWED_VALUES: Record<(typeof SETTING_KEYS)[number], string[]> = {
  fontSize: ['0', '1', '2', '3', '4', '5'],
  fontFamily: ['serif', 'sans'],
  readerPageMode: ['scroll', 'page'],
  readerTheme: ['default', 'eye', 'paper'],
  readerLineHeight: ['1.75', '1.95', '2.15'],
  readerParagraphSpacing: ['1.0', '1.4', '1.8'],
  readerWakeLock: ['on', 'off'],
  readerPageWidth: ['narrow', 'standard', 'wide'],
  readerAutoScrollSpeed: ['off', 'slow', 'medium', 'fast'],
  readerClickPaging: ['on', 'off'],
  contentMode: ['safe', 'adult'],
}

export function parseSettingsDocument(value: string): ReaderSettingsDocument {
  const emptyDocument = (): ReaderSettingsDocument => ({
    version: 2,
    devices: { desktop: { ...EMPTY_READER_SETTINGS }, mobile: { ...EMPTY_READER_SETTINGS } },
    shared: { ...EMPTY_READER_SETTINGS },
  })

  try {
    const raw = JSON.parse(value || '{}')
    if (isRecord(raw) && raw.version === 2 && isRecord(raw.devices)) {
      return {
        version: 2,
        devices: {
          desktop: cleanSettingsState(raw.devices.desktop, DEVICE_SETTING_KEYS),
          mobile: cleanSettingsState(raw.devices.mobile, DEVICE_SETTING_KEYS),
        },
        shared: cleanSettingsState(raw.shared, SHARED_SETTING_KEYS),
      }
    }

    // 兼容旧版扁平结构：历史设置被视为 desktop 配置，contentMode 提升为账号级共享设置。
    const legacyValues = isRecord(raw) && isRecord(raw.values) ? raw.values : raw
    const legacyUpdatedAt = isRecord(raw) && isRecord(raw.updatedAt) ? raw.updatedAt : {}
    const legacy = cleanSettingsState({ values: legacyValues, updatedAt: legacyUpdatedAt }, SETTING_KEYS)
    const document = emptyDocument()
    document.devices.desktop = pickSettings(legacy, DEVICE_SETTING_KEYS)
    document.shared = pickSettings(legacy, SHARED_SETTING_KEYS)
    return document
  } catch {
    return emptyDocument()
  }
}

/** 保留旧版服务调用方的扁平读取语义；新路由使用 parseSettingsDocument。 */
export function parseSettingsState(value: string): ReaderSettings {
  return flattenReaderSettings(parseSettingsDocument(value), 'desktop')
}

export function mergeReaderSettings(current: ReaderSettings, incoming: ReaderSettings): ReaderSettings {
  const values: Record<string, string> = { ...current.values }
  const updatedAt: Record<string, number> = { ...current.updatedAt }
  for (const key of Object.keys(incoming.values)) {
    const value = incoming.values[key]
    if (value === undefined) continue
    const nextTime = Number(incoming.updatedAt?.[key]) || 0
    const prevTime = Number(updatedAt[key]) || 0
    if (nextTime >= prevTime) {
      values[key] = value
      updatedAt[key] = nextTime
    }
  }
  return { values, updatedAt }
}

export function normalizeReaderDevice(value: unknown): ReaderDevice {
  return value === 'mobile' ? 'mobile' : 'desktop'
}

export function mergeReaderSettingsDocument(current: ReaderSettingsDocument, device: ReaderDevice, incoming: ReaderSettings): ReaderSettingsDocument {
  return {
    version: 2,
    devices: {
      desktop: device === 'desktop' ? mergeReaderSettings(current.devices.desktop, pickSettings(incoming, DEVICE_SETTING_KEYS)) : current.devices.desktop,
      mobile: device === 'mobile' ? mergeReaderSettings(current.devices.mobile, pickSettings(incoming, DEVICE_SETTING_KEYS)) : current.devices.mobile,
    },
    shared: mergeReaderSettings(current.shared, pickSettings(incoming, SHARED_SETTING_KEYS)),
  }
}

export function flattenReaderSettings(document: ReaderSettingsDocument, device: ReaderDevice): ReaderSettings {
  const deviceSettings = document.devices[device] || EMPTY_READER_SETTINGS
  return {
    values: { ...deviceSettings.values, ...document.shared.values },
    updatedAt: { ...deviceSettings.updatedAt, ...document.shared.updatedAt },
  }
}

export function cleanReaderSettings(input: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of SETTING_KEYS) {
    const value = String(input?.[key] ?? '')
    if (ALLOWED_VALUES[key].includes(value)) out[key] = value
  }
  return out
}

export function cleanUpdatedAt(input: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const key of SETTING_KEYS) {
    if (input?.[key] !== undefined) out[key] = Math.max(0, Math.floor(Number(input[key]) || 0))
  }
  return out
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function cleanSettingsState(value: unknown, keys: readonly string[]): ReaderSettings {
  const raw = isRecord(value) ? value : {}
  const values = isRecord(raw.values) ? raw.values : raw
  const updatedAt = isRecord(raw.updatedAt) ? raw.updatedAt : {}
  return {
    values: cleanSettingsByKeys(values, keys),
    updatedAt: cleanUpdatedAtByKeys(updatedAt, keys),
  }
}

function cleanSettingsByKeys(input: Record<string, unknown>, keys: readonly string[]): Record<string, string> {
  const allowed = cleanReaderSettings(input)
  return Object.fromEntries(keys.flatMap((key) => (allowed[key] === undefined ? [] : [[key, allowed[key]]])))
}

function cleanUpdatedAtByKeys(input: Record<string, unknown>, keys: readonly string[]): Record<string, number> {
  const cleaned = cleanUpdatedAt(input)
  return Object.fromEntries(keys.flatMap((key) => (cleaned[key] === undefined ? [] : [[key, cleaned[key]]])))
}

function pickSettings(settings: ReaderSettings, keys: readonly string[]): ReaderSettings {
  return {
    values: Object.fromEntries(keys.flatMap((key) => (settings.values[key] === undefined ? [] : [[key, settings.values[key]]]))),
    updatedAt: Object.fromEntries(keys.flatMap((key) => (settings.updatedAt[key] === undefined ? [] : [[key, settings.updatedAt[key]]]))),
  }
}
