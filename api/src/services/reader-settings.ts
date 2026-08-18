/**
 * 阅读设置 —— LWW（最后写入胜出）合并（由 Novel-KV auth.js 内的相关函数平移）。
 */

export interface ReaderSettings {
  values: Record<string, string>
  updatedAt: Record<string, number>
}

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

export function parseSettingsState(value: string): ReaderSettings {
  try {
    const raw = JSON.parse(value || '{}')
    if (raw && raw.values) return { values: cleanReaderSettings(raw.values), updatedAt: cleanUpdatedAt(raw.updatedAt || {}) }
    return { values: cleanReaderSettings(raw || {}), updatedAt: {} }
  } catch {
    return { values: {}, updatedAt: {} }
  }
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
