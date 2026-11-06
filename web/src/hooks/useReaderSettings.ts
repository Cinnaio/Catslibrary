/**
 * 阅读设置 hook —— 由 read.js 的 reader-settings 逻辑 + 服务端 LWW 合并平移。
 * 每个设置项带 updatedAt 时间戳，本地与服务端按最后写入胜出合并。
 *
 * 阅读习惯按账号与设备端隔离：desktop 与 mobile 使用不同的 localStorage key，
 * 同步服务端时也携带 device，避免手机调整字号覆盖电脑端的阅读布局。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReaderDevice } from '@shared/types'
import { authApi, getToken } from '../lib/api'
import { getStorageScope } from '../lib/storage'
import { useOptionalSession } from '../context/SessionContext'

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
  'readerIllustrations',
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
  readerIllustrations: 'on',
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

function scopedSettingKey(device: ReaderDevice, key: string, scope: string): string {
  return `readerSettings:${device}:${key}:${scope}`
}

function scopedMetaKey(device: ReaderDevice, scope: string): string {
  return `${SCOPED_SETTING_META_PREFIX}:${device}:${scope}`
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

export function readLocalSettings(device: ReaderDevice = detectReaderDevice(), scope = getStorageScope()): ReaderSettingsMap {
  const settings: ReaderSettingsMap = {}
  for (const key of READER_SETTING_KEYS) {
    // 无归属的旧设置仅供访客显示，不能认领为任意登录账号的较新修改。
    const legacy = scope === 'guest' ? readStorage(`readerSettings:${device}:${key}`) ?? readStorage(key) : null
    settings[key] = readStorage(scopedSettingKey(device, key, scope)) ?? legacy ?? DEFAULT_SETTINGS[key]!
  }
  return settings
}

function readLocalMeta(device: ReaderDevice, scope: string): Record<string, number> {
  try {
    const legacy = scope === 'guest' ? readStorage(`${SCOPED_SETTING_META_PREFIX}:${device}`) ?? readStorage(LEGACY_SETTING_META_KEY) : null
    const raw = readStorage(scopedMetaKey(device, scope)) ?? legacy ?? '{}'
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function writeLocalMeta(meta: Record<string, number>, device: ReaderDevice, scope: string): void {
  writeStorage(scopedMetaKey(device, scope), JSON.stringify(meta))
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
  const session = useOptionalSession()
  const sessionLoading = session?.loading ?? false
  const scope = getStorageScope()
  const token = getToken()
  const identity = `${scope}:${token}`
  const [device] = useState<ReaderDevice>(() => detectReaderDevice())
  const [state, setState] = useState(() => ({ identity, settings: readLocalSettings(device, scope), ready: false }))
  const settings = state.identity === identity ? state.settings : readLocalSettings(device, scope)
  const ready = state.identity === identity && state.ready && !sessionLoading
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const revision = useRef(0)

  const applyRemote = useCallback((remote: ReaderSettingsMap, remoteTimes: Record<string, number>) => {
    const merged = mergeSettings(readLocalSettings(device, scope), readLocalMeta(device, scope), remote, remoteTimes)
    for (const key of READER_SETTING_KEYS) {
      if (merged.settings[key] !== undefined) writeStorage(scopedSettingKey(device, key, scope), merged.settings[key])
    }
    writeLocalMeta(merged.updatedAt, device, scope)
    setState({ identity, settings: readLocalSettings(device, scope), ready: true })
    return merged
  }, [device, identity, scope])

  // 账号变化或卸载时同时作废响应和防抖任务；响应不能覆盖期间产生的较新本地修改。
  useEffect(() => {
    const current = ++revision.current
    const valid = () => current === revision.current && token === getToken() && scope === getStorageScope()
    const canSync = !sessionLoading && scope.startsWith('user:') && !!token
    setState({ identity, settings: readLocalSettings(device, scope), ready: !sessionLoading && scope !== 'pending' && !canSync })
    if (canSync) {
      void authApi.readerSettings(device).then(async (data) => {
        if (!valid()) return
        const merged = applyRemote(data.settings || {}, data.updatedAt || {})
        if (newerThanRemote(merged.updatedAt, data.updatedAt || {})) {
          const result = await authApi.updateReaderSettings({ values: merged.settings, updatedAt: merged.updatedAt }, device)
          if (valid()) applyRemote(result.settings || {}, result.updatedAt || merged.updatedAt)
        }
      }).catch(() => {}).finally(() => {
        if (valid()) setState((previous) => ({ ...previous, ready: true }))
      })
    }
    return () => {
      revision.current++
      if (syncTimer.current) clearTimeout(syncTimer.current)
    }
  }, [applyRemote, device, identity, scope, sessionLoading, token])

  const set = useCallback(
    (key: ReaderSettingKey, value: string) => {
      const current = revision.current
      const valid = () => current === revision.current && token === getToken() && scope === getStorageScope()
      if (!valid() || sessionLoading || scope === 'pending') return
      writeStorage(scopedSettingKey(device, key, scope), value)
      const meta = readLocalMeta(device, scope)
      meta[key] = Math.max(Date.now(), (Number(meta[key]) || 0) + 1)
      writeLocalMeta(meta, device, scope)
      setState({ identity, settings: readLocalSettings(device, scope), ready: true })
      if (syncTimer.current) clearTimeout(syncTimer.current)
      if (!token || !scope.startsWith('user:')) return
      syncTimer.current = setTimeout(() => {
        if (!valid()) return
        const local = readLocalSettings(device, scope)
        const updatedAt = readLocalMeta(device, scope)
        void authApi.updateReaderSettings({ values: local, updatedAt }, device).then((result) => {
          if (valid()) applyRemote(result.settings || {}, result.updatedAt || updatedAt)
        }).catch(() => {})
      }, 700)
    },
    [applyRemote, device, identity, scope, sessionLoading, token],
  )

  const parsedFontSize = Number.parseInt(settings.fontSize ?? '2', 10)
  const fontSize = Math.min(Math.max(Number.isFinite(parsedFontSize) ? parsedFontSize : 2, 0), FONT_SIZES.length - 1)
  const pageMode = settings.readerPageMode === 'page'

  return { settings, ready, device, set, fontSize, pageMode }
}
