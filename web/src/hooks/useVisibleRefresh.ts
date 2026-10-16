import { useEffect } from 'react'

/** Revalidate server-owned visibility when returning to a page and once a minute while it is visible. */
export function useVisibleRefresh(refresh: () => Promise<unknown>, enabled = true) {
  useEffect(() => {
    if (!enabled) return
    let busy = false
    let disposed = false
    const check = () => {
      if (disposed || busy || document.visibilityState === 'hidden') return
      busy = true
      void refresh().catch(() => {}).finally(() => { busy = false })
    }
    window.addEventListener('focus', check)
    window.addEventListener('online', check)
    document.addEventListener('visibilitychange', check)
    const timer = setInterval(check, 60000)
    return () => {
      disposed = true
      clearInterval(timer)
      window.removeEventListener('focus', check)
      window.removeEventListener('online', check)
      document.removeEventListener('visibilitychange', check)
    }
  }, [refresh, enabled])
}
