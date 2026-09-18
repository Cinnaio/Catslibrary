/**
 * 阅读设置 hook —— 由 read.js 的 reader-settings 逻辑 + 服务端 LWW 合并平移。
 * 每个设置项带 updatedAt 时间戳，本地与服务端按最后写入胜出合并。
 *
 * 阅读习惯按设备端隔离：desktop 与 mobile 使用不同的 localStorage key，
 * 同步服务端时也携带 device，避免手机调整字号覆盖电脑端的阅读布局。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReaderDevice } from '@shared/types'
import { authApi, getToken } from '../lib/api'

export const FONT_SIZES = ['0.95rem', '1.1rem', '1.25rem', '1.45rem', '1.7rem', '2rem']
export const FONT_LABELS = ['15', '18', '20', '23', '27', '32']
export const LINE_HEIGHTS = ['1.75', '1.95', '2.15']
export const PARAGRAPH_SPACINGS = ['1.0', '1.4', '1.8']
export const PAGE_WIDTHS: Record<string, string> = { narrow: '620px', standard: '680px', wide: '780px' }
export const AUTO_SCROLL_SPEEDS: Record<string, number> = { off: 0, slow: 18, medium: 32, fast: 52 }

export const READER_SETTING_KEYS = [
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
] as const

export type ReaderSettingKey = (typeof READER_SETTING_KEYS)[number]
export type ReaderSettingsMap = Record<string, string>

const LEGACY_SETTING_META_KEY = 'readerSettingsUpdatedAt'
const SCOPED_SETTING_META_PREFIX = 'readerSettingsUpdatedAt'
const DEFAULT_SETTINGS: ReaderSettingsMap = {
  fontSize: '2',
  fontFamily: 'serif',
  readerPageMode: 'scroll',
  readerTheme: 'default',
  readerLineHeight: '1.95',
  readerParagraphSpacing: '1.4',
  readerWakeLock: 'off',
  readerPageWidth: 'standard',
  readerAutoScrollSpeed: 'off',
  readerClickPaging: 'on',
}

/** 根据实际设备与阅读器断点判定同步分区。平板/触屏 Mac 也归入 mobile。 */
export function detectReaderDevice(): ReaderDevice {
  if (typeof window === 'undefined') return 'desktop'
  const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent
  const touchMac = typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
  const mobileUserAgent = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(userAgent)
  const narrowViewport = window.matchMedia?.('(max-width: 767px)').matches ?? window.innerWidth < 768
  return mobileUserAgent || touchMac || narrowViewport ? 'mobile' : 'desktop'
}

function scopedSettingKey(device: ReaderDevice, key: string): string {
  return `readerSettings:${device}:${key}`
}

function scopedMetaKey(device: ReaderDevice): string {
  return `${SCOPED_SETTING_META_PREFIX}:${device}`
}

function readStorage(key: string): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value)
  } catch {
    /* ignore unavailable storage */
  }
}

export function readLocalSettings(device: ReaderDevice = detectReaderDevice()): ReaderSettingsMap {
  const settings: ReaderSettingsMap = {}
  for (const key of READER_SETTING_KEYS) {
    settings[key] = readStorage(scopedSettingKey(device, key)) ?? readStorage(key) ?? DEFAULT_SETTINGS[key]!
  }
  return settings
}

function readLocalMeta(device: ReaderDevice): Record<string, number> {
  try {
    const raw = readStorage(scopedMetaKey(device)) ?? readStorage(LEGACY_SETTING_META_KEY) ?? '{}'
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function writeLocalMeta(meta: Record<string, number>, device: ReaderDevice): void {
  const serialized = JSON.stringify(meta)
  writeStorage(scopedMetaKey(device), serialized)
  // 桌面端继续镜像旧 key，让旧版本页面在同一浏览器中平滑过渡。
  if (device === 'desktop') writeStorage(LEGACY_SETTING_META_KEY, serialized)
}

function mergeSettings(
  local: ReaderSettingsMap,
  localTimes: Record<string, number>,
  remote: ReaderSettingsMap,
  remoteTimes: Record<string, number>,
): { settings: ReaderSettingsMap; updatedAt: Record<string, number> } {
  const settings: ReaderSettingsMap = { ...remote }
  const updatedAt: Record<string, number> = { ...remoteTimes }
  for (const key of READER_SETTING_KEYS) {
    const lt = Number(localTimes[key]) || 0
    const rt = Number(remoteTimes[key]) || 0
    if (local[key] !== undefined && lt > rt) {
      settings[key] = local[key]
      updatedAt[key] = lt
    }
  }
  return { settings, updatedAt }
}

function newerThanRemote(merged: Record<string, number>, remote: Record<string, number>): boolean {
  return READER_SETTING_KEYS.some((key) => (Number(merged[key]) || 0) > (Number(remote[key]) || 0))
}

export interface ReaderSettingsController {
  settings: ReaderSettingsMap
  ready: boolean
  device: ReaderDevice
  /** 更新某项设置并持久化 + 防抖同步服务端。 */
  set: (key: ReaderSettingKey, value: string) => void
  fontSize: number
  pageMode: boolean
}

export function useReaderSettings(): ReaderSettingsController {
  const [device] = useState<ReaderDevice>(() => detectReaderDevice())
  const [settings, setSettings] = useState<ReaderSettingsMap>(() => readLocalSettings(device))
  const [ready, setReady] = useState(false)
  const applyingRef = useRef(false)
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  // 初始化：当前设备的本地设置 + 当前设备的服务端设置 LWW 合并
  useEffect(() => {
    if (!getToken()) {
      setReady(true)
      return
    }
    let cancelled = false
    void authApi
      .readerSettings(device)
      .then((data) => {
        if (cancelled) return
        const remote = data.settings || {}
        const remoteTimes = data.updatedAt || {}
        const local = readLocalSettings(device)
        const localTimes = readLocalMeta(device)
        const merged = mergeSettings(local, localTimes, remote, remoteTimes)
        writeLocalMeta(merged.updatedAt, device)
        // 应用合并结果到当前设备的本地存储
        for (const key of READER_SETTING_KEYS) {
          if (merged.settings[key] !== undefined) persistSetting(device, key, merged.settings[key])
        }
        setSettings((prev) => ({ ...prev, ...merged.settings }))
        if (newerThanRemote(merged.updatedAt, remoteTimes)) {
          void authApi
            .updateReaderSettings({ values: merged.settings, updatedAt: merged.updatedAt }, device)
            .then((r) => {
              writeLocalMeta(r.updatedAt || merged.updatedAt, device)
              setSettings((prev) => ({ ...prev, ...(r.settings || {}) }))
            })
            .catch(() => {})
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [device])

  const persist = useCallback(
    (next: ReaderSettingsMap) => {
      for (const key of READER_SETTING_KEYS) {
        if (next[key] !== undefined) persistSetting(device, key, next[key])
      }
    },
    [device],
  )

  const pushToServer = useCallback(() => {
    if (!getToken()) return
    const local = readLocalSettings(device)
    const meta = readLocalMeta(device)
    void authApi
      .updateReaderSettings({ values: local, updatedAt: meta }, device)
      .then((r) => {
        writeLocalMeta(r.updatedAt || meta, device)
        setSettings((prev) => ({ ...prev, ...(r.settings || {}) }))
      })
      .catch(() => {})
  }, [device])

  const set = useCallback(
    (key: ReaderSettingKey, value: string) => {
      if (applyingRef.current) return
      const next = { ...settingsRef.current, [key]: value }
      setSettings(next)
      persist(next)
      // touch meta（应用同步来的设置时不动本地时间戳，避免覆盖服务端）
      const meta = readLocalMeta(device)
      meta[key] = Date.now()
      writeLocalMeta(meta, device)
      if (syncTimer.current) clearTimeout(syncTimer.current)
      syncTimer.current = setTimeout(pushToServer, 700)
    },
    [device, persist, pushToServer],
  )

  useEffect(() => {
    return () => {
      if (syncTimer.current) clearTimeout(syncTimer.current)
    }
  }, [])

  const fontSize = Math.min(Math.max(Number.parseInt(settings.fontSize ?? '2', 10) || 2, 0), FONT_SIZES.length - 1)
  const pageMode = settings.readerPageMode === 'page'

  return { settings, ready, device, set, fontSize, pageMode }
}

function persistSetting(device: ReaderDevice, key: string, value: string): void {
  writeStorage(scopedSettingKey(device, key), value)
  // 只让 desktop 镜像旧版 key，避免移动端继续把值写回未分端的存储空间。
  if (device === 'desktop') writeStorage(key, value)
}
