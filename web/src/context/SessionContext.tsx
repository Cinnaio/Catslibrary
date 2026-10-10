/**
 * 会话上下文 —— 登录态管理（由 theme.js hydrateAccountAvatar + 各页登录逻辑收敛）。
 * 暴露 user / loading / login / register / logout / refresh。
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { User } from '@shared/types'
import { authApi, getToken } from '../lib/api'

interface SessionContextValue {
  user: User | null
  loading: boolean
  login: (username: string, password: string, persist?: boolean) => Promise<User>
  register: (username: string, password: string) => Promise<User>
  logout: () => Promise<void>
  refresh: () => Promise<User | null>
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const revision = useRef(0)
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState<boolean>(true)

  const refresh = useCallback(async () => {
    const seq = ++revision.current
    const token = getToken()
    try {
      const { user: me } = await authApi.meCached()
      if (token && token !== getToken() && !me) return null
      if (seq !== revision.current) return null
      setUser(me)
      return me
    } catch {
      if (seq === revision.current && token === getToken()) setUser(null)
      return null
    } finally {
      if (seq === revision.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const onStorage = (event: StorageEvent) => {
      if (event.key === 'user_session_marker' || event.key === 'user_session_token' || event.key === null) { authApi.invalidate(); void refresh() }
    }
    window.addEventListener('storage', onStorage)
    const onExpired = () => { setUser(null); setLoading(false) }
    window.addEventListener('zhizhou-session-expired', onExpired)
    return () => { window.removeEventListener('storage', onStorage); window.removeEventListener('zhizhou-session-expired', onExpired) }
  }, [refresh])

  const login = useCallback(async (username: string, password: string, persist = false) => {
    const seq = ++revision.current
    const r = await authApi.login(username, password, persist)
    if (seq === revision.current) { setUser(r.user); setLoading(false) }
    return r.user
  }, [])

  const register = useCallback(async (username: string, password: string) => {
    const seq = ++revision.current
    const r = await authApi.register(username, password)
    if (seq === revision.current) { setUser(r.user); setLoading(false) }
    return r.user
  }, [])

  const logout = useCallback(async () => {
    const seq = ++revision.current
    await authApi.logout()
    if (seq === revision.current) setUser(null)
  }, [])

  const value = useMemo(
    () => ({ user, loading, login, register, logout, refresh }),
    [user, loading, login, register, logout, refresh],
  )
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used within SessionProvider')
  return ctx
}

/** Optional variant for providers that can also render in isolated tests/embeds. */
export function useOptionalSession(): SessionContextValue | null {
  return useContext(SessionContext)
}
