import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

export type ContentMode = 'safe' | 'adult'

const STORAGE_KEY = 'zhizhou-content-mode'

// 只匹配明确的限制级标记，避免把普通的悬疑、武侠或爱情作品误判为成人内容。
const RESTRICTED_PATTERNS = [
  /成人/i,
  /色情/i,
  /情色/i,
  /肉文/i,
  /福利文/i,
  /限制级/i,
  /涉黄/i,
  /未删减/i,
  /露骨/i,
  /性描写/i,
  /性爱/i,
  /艳情/i,
  /工口/i,
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
  setMode: (mode: ContentMode) => void
  isAllowed: (metadata: ContentMetadata | null | undefined) => boolean
}

const ContentPolicyContext = createContext<ContentPolicyContextValue | null>(null)

export function ContentPolicyProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ContentMode>(readInitialMode)

  const setMode = useCallback((next: ContentMode) => {
    setModeState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* ignore unavailable storage */
    }
  }, [])

  const isAllowed = useCallback((metadata: ContentMetadata | null | undefined) => {
    return mode === 'adult' || !isRestrictedContent(metadata)
  }, [mode])

  const value = useMemo(
    () => ({ mode, safeMode: mode === 'safe', setMode, isAllowed }),
    [mode, setMode, isAllowed],
  )
  return <ContentPolicyContext.Provider value={value}>{children}</ContentPolicyContext.Provider>
}

export function useContentPolicy(): ContentPolicyContextValue {
  const ctx = useContext(ContentPolicyContext)
  if (!ctx) throw new Error('useContentPolicy must be used within ContentPolicyProvider')
  return ctx
}
