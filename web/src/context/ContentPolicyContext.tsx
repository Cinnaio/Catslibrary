import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ContentRating } from '@shared/types'
import { contentPolicyApi, getToken, isRestrictedContentError, type ApiError } from '../lib/api'
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
  checking: boolean
  policyError: string
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
  const [settingsKnown, setSettingsKnown] = useState(false)
  const [settingsError, setSettingsError] = useState('')
  const [accessError, setAccessError] = useState('')
  const [checkedIdentity, setCheckedIdentity] = useState('')
  const settingsRef = useRef<boolean | null>(null)
  const wantsAccess = useRef(false)
  const checkRef = useRef<() => Promise<void>>(async () => {})
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

  const refreshPolicy = useCallback(async () => { await checkRef.current() }, [])

  useEffect(() => {
    revision.current++
    pending.current?.()
    pending.current = null
    setUnlockIdentity('')
    setAuthorizedIdentity('')
    setModeState('safe')
    setCheckedIdentity('')
    setAccessError('')
    persistMode('safe')
    wantsAccess.current = !!identity
    let cancelled = false
    let running = false
    let timer: number | undefined
    async function check() {
      if (running || cancelled) return
      running = true
      window.clearTimeout(timer)
      const currentRevision = revision.current
      const stale = () => cancelled || identityRef.current !== identity || revision.current !== currentRevision
      let failed = false
      try {
        try {
          const settings = await contentPolicyApi.settings()
          if (stale()) return
          settingsRef.current = settings.adultContentEnabled
          setSettingsKnown(true)
          setSettingsError('')
          setAdultContentEnabled(settings.adultContentEnabled)
          setSiteKey(settings.turnstileConfigured ? settings.turnstileSiteKey : '')
          if (!settings.adultContentEnabled) {
            setCheckedIdentity(identity)
            wantsAccess.current = false
            setAuthorizedIdentity('')
            setModeState('safe')
            setAccessError('')
            persistMode('safe')
          }
        } catch {
          if (stale()) return
          failed = true
          // 临时失败保留上次确认的配置；首次失败仍不放行。
          setSettingsError('内容模式配置暂时无法加载，请重试。')
        }
        if (!identity || settingsRef.current !== true || !wantsAccess.current) return
        try {
          // 仅恢复服务端既有授权，不使用本地 adult 偏好授予权限。
          await contentPolicyApi.refresh()
          if (stale()) return
          setAuthorizedIdentity(identity)
          setModeState('adult')
          setCheckedIdentity(identity)
          setAccessError('')
          persistMode('adult')
        } catch (error) {
          if (stale()) return
          setCheckedIdentity(identity)
          if ((error as ApiError)?.status === 401 || isRestrictedContentError(error)) {
            wantsAccess.current = false
            setAuthorizedIdentity('')
            setModeState('safe')
            setAccessError('')
            persistMode('safe')
          } else {
            failed = true
            setAccessError('访问权限验证暂时失败，正在重试。')
          }
        }
      } finally {
        running = false
        if (!cancelled) timer = window.setTimeout(() => void check(), failed ? 15000 : 60000)
      }
    }
    checkRef.current = check
    void check()
    const onRetry = () => void check()
    window.addEventListener('focus', onRetry)
    window.addEventListener('online', onRetry)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      window.removeEventListener('focus', onRetry)
      window.removeEventListener('online', onRetry)
    }
  }, [identity, persistMode])

  const checking = !!session?.loading || (!settingsKnown && !settingsError)
    || !!(identity && adultContentEnabled && checkedIdentity !== identity && !accessError)
  const policyError = accessError || settingsError

  const setMode = useCallback(async (next: ContentMode) => {
    if (next === 'adult' && (!identity || !getToken() || !adultContentEnabled || pending.current)) return
    revision.current++
    if (next === 'safe') {
      wantsAccess.current = false
      setCheckedIdentity(identity)
      setAccessError('')
      pending.current?.()
      pending.current = null
      setUnlockIdentity('')
      setAuthorizedIdentity('')
      setModeState('safe')
      persistMode('safe')
      await contentPolicyApi.lock()
      return
    }
    setCheckedIdentity(identity)
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
    wantsAccess.current = true
    setCheckedIdentity(currentIdentity)
    setAccessError('')
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
    () => ({ mode, safeMode: mode === 'safe', adultContentEnabled, checking, policyError, setMode, refreshPolicy, isAllowed }),
    [mode, adultContentEnabled, checking, policyError, setMode, refreshPolicy, isAllowed],
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
