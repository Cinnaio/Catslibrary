import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { hasRestrictedText } from '@shared/restricted-patterns'
import type { ContentRating } from '@shared/types'
import { authApi, contentPolicyApi, getToken } from '../lib/api'
import { useOptionalSession } from './SessionContext'

export type ContentMode = 'safe' | 'adult'

const STORAGE_KEY = 'zhizhou-content-mode'

// 限制级特征正则已移到 shared/restricted-patterns.ts：它同时服务这里的兜底判定与
// 后端的存量预填，各留一份会让「预填结果」与「前台判定」出现两套口径。

export interface ContentMetadata {
  title?: string
  description?: string
  categories?: string[]
  /**
   * 内容分级字段（方案 B）。三态语义：
   *   'restricted' → 受限
   *   'general'    → 放行
   *   'unknown'    → 回落正则兜底（与 B 上线前的行为完全一致）
   * 不传（undefined，如分类名或临时对象）等价于 unknown。
   */
  contentRating?: ContentRating
}

/**
 * 判定一本书/一个标签是否属于限制级。
 *
 * 优先读事实（contentRating），只有 unknown 才去猜文本。这样 B 的上线是行为等价的：
 * 未标注期间与今天逐本一致，标注一本就把这本书从「猜」升级为「确定」。
 */
export function isRestrictedContent(metadata: ContentMetadata | string | null | undefined): boolean {
  if (!metadata) return false
  // 字符串是分类名等纯文本场景，没有字段可读，直接走正则。
  if (typeof metadata !== 'string' && metadata.contentRating === 'restricted') return true
  if (typeof metadata !== 'string' && metadata.contentRating === 'general') return false
  return hasRestrictedText(metadata)
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
