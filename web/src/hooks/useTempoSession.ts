import { useEffect, useReducer } from 'react'
import { tempoReducer } from '../lib/tempo'

export function useTempoSession() {
  const [session, dispatch] = useReducer(tempoReducer, null)
  const running = session?.status === 'running'

  useEffect(() => {
    if (!running) return
    const pause = () => dispatch({ type: 'pause', now: performance.now(), reason: 'background' })
    const visibility = () => { if (document.hidden) pause() }
    const timer = window.setInterval(() => {
      if (document.hidden) pause()
      else dispatch({ type: 'tick', now: performance.now() })
    }, 100)
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('pagehide', pause)
    visibility()
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', visibility)
      window.removeEventListener('pagehide', pause)
    }
  }, [running])

  return { session, dispatch }
}
