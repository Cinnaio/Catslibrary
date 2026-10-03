/**
 * 会话上下文 —— 登录态管理（由 theme.js hydrateAccountAvatar + 各页登录逻辑收敛）。
 * 暴露 user / loading / login / register / logout / refresh。
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
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
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState<boolean>(true)

  const refresh = useCallback(async () => {
    const token = getToken()
    if (!token) {
      setUser(null)
      setLoading(false)
      return null
    }
    try {
      const { user: me } = await authApi.meCached()
      if (token !== getToken()) return null
      setUser(me)
      return me
    } catch {
      if (token === getToken()) setUser(null)
      return null
    } finally {
      if (token === getToken()) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const onStorage = (event: StorageEvent) => {
      if (event.key === 'user_session_token' || event.key === null) void refresh()
    }
    window.addEventListener('storage', onStorage)
    const onExpired = () => { setUser(null); setLoading(false) }
    window.addEventListener('zhizhou-session-expired', onExpired)
    return () => { window.removeEventListener('storage', onStorage); window.removeEventListener('zhizhou-session-expired', onExpired) }
  }, [refresh])

  const login = useCallback(async (username: string, password: string, persist = false) => {
    const r = await authApi.login(username, password, persist)
    setUser(r.user)
    return r.user
  }, [])

  const register = useCallback(async (username: string, password: string) => {
    const r = await authApi.register(username, password)
    setUser(r.user)
    return r.user
  }, [])

  const logout = useCallback(async () => {
    await authApi.logout()
    setUser(null)
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
