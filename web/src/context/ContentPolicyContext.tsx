import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ContentRating } from '@shared/types'
import { authApi, contentPolicyApi, getToken } from '../lib/api'
import { useOptionalSession } from './SessionContext'

export type ContentMode = 'safe' | 'adult'

const STORAGE_KEY = 'zhizhou-content-mode'

// 写入侧用 shared/restricted-* 为作品标注分级；读取侧只读字段。

export interface ContentMetadata {
  title?: string
  description?: string
  categories?: string[]
  /**
   * 内容分级字段。**读取侧的唯一判据**：
   *   'restricted' → 受限（即 R18）
   *   'general'    → 放行
   *   'unknown'    → 尚未判定；不视为 R18，故放行
   */
  contentRating?: ContentRating
}

/**
 * 判定一本作品是否属于限制级 —— **只读字段，不再猜文本**。
 *
 * 「R18 ≡ restricted」：只有显式标为 restricted 的书才算限制级。
 *
 * 为什么读取侧不再回落正则：写入侧（创建/更新/预填/标签判定）已把「成人标签 OR
 * 文本特征」的规则结果落成 `contentRating` 字段；读取侧再猜一次就是第二套口径，
 * 会出现「字段说 unknown、文本说命中」的自相矛盾。判定依据只有一个：字段。
 *
 * `unknown` 是未完成的标注，不等于已证实安全。当前策略将它放行；自动规则会尽量
 * 收敛存量和新书，剩余作品仍需人工复核。
 *
 * 因而本函数等价于 `contentRating !== 'restricted'` 的反面。
 */
export function isRestrictedContent(metadata: ContentMetadata | null | undefined): boolean {
  if (!metadata) return false
  return metadata.contentRating === 'restricted'
}

function readInitialMode(): ContentMode {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'adult' ? 'adult' : 'safe'
  } catch {
    return 'safe'
  }
}

interface ContentPolicyContextValue {
  mode: ContentMode
  safeMode: boolean
  adultContentEnabled: boolean
  setMode: (mode: ContentMode) => void
  refreshPolicy: () => Promise<void>
  isAllowed: (metadata: ContentMetadata | null | undefined) => boolean
}

const ContentPolicyContext = createContext<ContentPolicyContextValue | null>(null)

export function ContentPolicyProvider({ children }: { children: ReactNode }) {
  const session = useOptionalSession()
  const user = session?.user ?? null
  const [mode, setModeState] = useState<ContentMode>(readInitialMode)
  const [adultContentEnabled, setAdultContentEnabled] = useState(false)

  const refreshPolicy = useCallback(async () => {
    try {
      const { adultContentEnabled: enabled } = await contentPolicyApi.settings()
      setAdultContentEnabled(enabled)
    } catch {
      // 配置不可达时保持安全模式，避免意外展示限制级内容。
      setAdultContentEnabled(false)
    }
  }, [])

  useEffect(() => {
    void refreshPolicy()
  }, [refreshPolicy])

  useEffect(() => {
    if (!user || !getToken()) return
    let cancelled = false
    void authApi.readerSettings().then((data) => {
      if (cancelled) return
      const remoteMode = data.settings?.contentMode
      if (remoteMode === 'safe' || remoteMode === 'adult') {
        setModeState(remoteMode)
        localStorage.setItem(STORAGE_KEY, remoteMode)
        return
      }
      void authApi.updateReaderSettings({
        values: { contentMode: readInitialMode() },
        updatedAt: { contentMode: Date.now() },
      }).catch(() => {})
    }).catch(() => {})
    return () => {
      cancelled = true
    }
  }, [user, adultContentEnabled])

  useEffect(() => {
    if (!adultContentEnabled && mode === 'adult') {
      setModeState('safe')
      try {
        localStorage.setItem(STORAGE_KEY, 'safe')
      } catch {
        /* ignore unavailable storage */
      }
    }
  }, [adultContentEnabled, mode])

  const setMode = useCallback((next: ContentMode) => {
    const resolvedMode = adultContentEnabled ? next : 'safe'
    setModeState(resolvedMode)
    try {
      localStorage.setItem(STORAGE_KEY, resolvedMode)
    } catch {
      /* ignore unavailable storage */
    }
    if (user && getToken()) {
      void authApi.updateReaderSettings({
        values: { contentMode: resolvedMode },
        updatedAt: { contentMode: Date.now() },
      }).catch(() => {})
    }
  }, [adultContentEnabled, user])

  const isAllowed = useCallback((metadata: ContentMetadata | null | undefined) => {
    return (adultContentEnabled && mode === 'adult') || !isRestrictedContent(metadata)
  }, [adultContentEnabled, mode])

  const value = useMemo(
    () => ({ mode, safeMode: mode === 'safe', adultContentEnabled, setMode, refreshPolicy, isAllowed }),
    [mode, adultContentEnabled, setMode, refreshPolicy, isAllowed],
  )
  return <ContentPolicyContext.Provider value={value}>{children}</ContentPolicyContext.Provider>
}

export function useContentPolicy(): ContentPolicyContextValue {
  const ctx = useContext(ContentPolicyContext)
  if (!ctx) throw new Error('useContentPolicy must be used within ContentPolicyProvider')
  return ctx
}
