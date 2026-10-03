import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ContentRating } from '@shared/types'
import { contentPolicyApi, getToken } from '../lib/api'
import { useOptionalSession } from './SessionContext'
import AdultUnlockDialog from '../components/AdultUnlockDialog'

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

interface ContentPolicyContextValue {
  mode: ContentMode
  safeMode: boolean
  adultContentEnabled: boolean
  setMode: (mode: ContentMode) => Promise<void>
  refreshPolicy: () => Promise<void>
  isAllowed: (metadata: ContentMetadata | null | undefined) => boolean
}

const ContentPolicyContext = createContext<ContentPolicyContextValue | null>(null)

export function ContentPolicyProvider({ children }: { children: ReactNode }) {
  const session = useOptionalSession()
  const user = session?.user ?? null
  const identity = user && !session?.loading && getToken() ? `${user.id}:${getToken()}` : ''
  const identityRef = useRef(identity)
  useLayoutEffect(() => { identityRef.current = identity }, [identity])
  const [authorizedIdentity, setAuthorizedIdentity] = useState('')
  const [modeState, setModeState] = useState<ContentMode>('safe')
  const [adultContentEnabled, setAdultContentEnabled] = useState(false)
  const [siteKey, setSiteKey] = useState('')
  const [unlockIdentity, setUnlockIdentity] = useState('')
  const pending = useRef<(() => void) | null>(null)
  const revision = useRef(0)
  const mode: ContentMode = identity && authorizedIdentity === identity && adultContentEnabled ? modeState : 'safe'

  const persistMode = useCallback((next: ContentMode) => {
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* ignore unavailable storage */
    }
  }, [])

  const refreshPolicy = useCallback(async () => {
    try {
      const settings = await contentPolicyApi.settings()
      setAdultContentEnabled(settings.adultContentEnabled)
      setSiteKey(settings.turnstileConfigured ? settings.turnstileSiteKey : '')
    } catch {
      // 配置不可达时保持安全模式，避免意外展示限制级内容。
      setAdultContentEnabled(false)
    }
  }, [])

  useEffect(() => {
    void refreshPolicy()
  }, [refreshPolicy])

  useEffect(() => {
    revision.current++
    pending.current?.()
    pending.current = null
    setUnlockIdentity('')
    setAuthorizedIdentity('')
    setModeState('safe')
    persistMode('safe')
    if (!identity || !getToken() || !adultContentEnabled) return
    let cancelled = false
    const currentRevision = revision.current
    // 只恢复该会话既有授权，绝不通过账号 adult 偏好自动申请新权限。
    void contentPolicyApi.refresh().then(() => {
      if (!cancelled && identityRef.current === identity && revision.current === currentRevision) {
        setAuthorizedIdentity(identity)
        setModeState('adult')
        persistMode('adult')
      }
    }).catch(() => {})
    return () => { cancelled = true }
  }, [identity, adultContentEnabled, persistMode])

  useEffect(() => {
    if (mode !== 'adult') return
    let cancelled = false
    async function revalidate() {
      const currentRevision = revision.current
      try { await contentPolicyApi.refresh() } catch {
        if (!cancelled && identityRef.current === identity && currentRevision === revision.current) {
          setAuthorizedIdentity('')
          setModeState('safe')
          persistMode('safe')
        }
      }
      void refreshPolicy()
    }
    const timer = window.setInterval(() => void revalidate(), 60000)
    const onFocus = () => void revalidate()
    window.addEventListener('focus', onFocus)
    return () => { cancelled = true; clearInterval(timer); window.removeEventListener('focus', onFocus) }
  }, [mode, identity, persistMode, refreshPolicy])

  const setMode = useCallback(async (next: ContentMode) => {
    revision.current++
    if (next === 'safe') {
      pending.current?.()
      pending.current = null
      setUnlockIdentity('')
      setAuthorizedIdentity('')
      setModeState('safe')
      persistMode('safe')
      await contentPolicyApi.lock()
      return
    }
    if (!identity || !getToken() || !adultContentEnabled) return
    if (pending.current) return
    await new Promise<void>(resolve => { pending.current = resolve; setUnlockIdentity(identity) })
  }, [adultContentEnabled, identity, persistMode])

  function cancelUnlock() {
    revision.current++
    setUnlockIdentity('')
    pending.current?.()
    pending.current = null
  }

  async function unlock(token: string) {
    const currentIdentity = unlockIdentity
    const currentRevision = revision.current
    if (!currentIdentity || identityRef.current !== currentIdentity) return
    await contentPolicyApi.unlock(token)
    if (identityRef.current !== currentIdentity) return
    if (revision.current !== currentRevision) {
      await contentPolicyApi.lock()
      return
    }
    setAuthorizedIdentity(currentIdentity)
    setModeState('adult')
    persistMode('adult')
    setUnlockIdentity('')
    pending.current?.()
    pending.current = null
  }

  const isAllowed = useCallback((metadata: ContentMetadata | null | undefined) => {
    return mode === 'adult' || !isRestrictedContent(metadata)
  }, [mode])

  const value = useMemo(
    () => ({ mode, safeMode: mode === 'safe', adultContentEnabled, setMode, refreshPolicy, isAllowed }),
    [mode, adultContentEnabled, setMode, refreshPolicy, isAllowed],
  )
  return <ContentPolicyContext.Provider value={value}>{children}
    {unlockIdentity && unlockIdentity === identity && <AdultUnlockDialog key={unlockIdentity} siteKey={siteKey} onUnlock={unlock} onCancel={cancelUnlock} />}
  </ContentPolicyContext.Provider>
}

export function useContentPolicy(): ContentPolicyContextValue {
  const ctx = useContext(ContentPolicyContext)
  if (!ctx) throw new Error('useContentPolicy must be used within ContentPolicyProvider')
  return ctx
}
