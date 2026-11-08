import { useEffect, useReducer } from 'react'
import { edgeReducer } from '../lib/edge'

/** 100ms 一次推进；切后台或休眠由 reducer 自己转成暂停，这里不额外判断。 */
export function useEdgeSession(enabled = true) {
  const [state, dispatch] = useReducer(edgeReducer, null)
  const session = enabled ? state : null
  const active = !!session && session.status !== 'finished' && session.status !== 'paused'

  // Losing access discards the session without recording a result.
  useEffect(() => {
    if (!enabled) dispatch({ type: 'discard' })
  }, [enabled])

  useEffect(() => {
    if (!active) return
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
  }, [active])

  return { session, dispatch }
}
