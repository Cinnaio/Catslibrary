import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { authApi, contentPolicyApi, getToken } from '../lib/api'
import { useOptionalSession } from './SessionContext'

export type ContentMode = 'safe' | 'adult'

const STORAGE_KEY = 'zhizhou-content-mode'

// 只匹配明确的限制级标记，避免把普通的悬疑、武侠或爱情作品误判为成人内容。
const RESTRICTED_PATTERNS = [
  /成人/i,
  /色情/i,
  /情色/i,
  /肉文/i,
  /肉梗/i,
  /多肉/i,
  /吃肉/i,
  /福利文/i,
  /限制级/i,
  /涉黄/i,
  /未删减/i,
  /18\s*禁/i,
  /未满\s*18/i,
  /未成年/i,
  /露骨/i,
  /性描写/i,
  /性爱/i,
  /艳情/i,
  /工口/i,
  /黄暴/i,
  /重口(?:味)?/i,
  /纯肉|肉肉|后期肉|前期.*后期.*肉/i,
  /调教|监禁|强制爱|床上|含进身体|发出禁忌|养成妹妹/i,
  /性幻想|性行为|性侵|性器|性欲|无套|双处/i,
  /乳晕|亲密行为|滚到一起|做了吗|剧情.*肉/i,
  /觊觎|阴暗.*变态|强取豪夺/i,
  /强奸|强X|轮奸|乱伦/i,
  /被操|操得|操她|操我|操死|肏她|肏我/i,
  /高\s*h|h\s*高/i,
  /b\s*d\s*s\s*m|\bsm\b/i,
  /r\s*[-_]?\s*18/i,
  /18\s*\+/i,
  /h\s*文/i,
]

export interface ContentMetadata {
  title?: string
  description?: string
  categories?: string[]
}

export function isRestrictedContent(metadata: ContentMetadata | string | null | undefined): boolean {
  if (!metadata) return false
  const text = typeof metadata === 'string'
    ? metadata
    : [metadata.title, metadata.description, ...(metadata.categories || [])].filter(Boolean).join(' ')
  return RESTRICTED_PATTERNS.some((pattern) => pattern.test(text))
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
