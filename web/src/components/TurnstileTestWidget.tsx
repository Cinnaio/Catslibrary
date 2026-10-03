import { useEffect, useRef } from 'react'
import { loadTurnstile } from './AdultUnlockDialog'

/** Uses the same action as the real adult flow, but test endpoint never creates a grant. */
export default function TurnstileTestWidget({ siteKey, onToken, onError }: {
  siteKey: string; onToken: (token: string) => void; onError: (message: string) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let active = true
    let remove: (() => void) | undefined
    void loadTurnstile().then(api => {
      if (!active || !container.current) return
      const id = api.render(container.current, {
        sitekey: siteKey, action: 'r18_unlock', theme: 'auto', size: container.current.clientWidth < 300 ? 'compact' : 'flexible',
        callback: (token: string) => { if (active) onToken(token) },
        'expired-callback': () => { if (active) onToken('') },
        'error-callback': () => { if (active) { onToken(''); onError('验证组件失败，请重新开始验证') } },
      })
      remove = () => api.remove(id)
    }).catch(error => { if (active) onError(error instanceof Error ? error.message : '验证组件无法加载') })
    return () => { active = false; remove?.() }
  }, [siteKey, onToken, onError])
  return <div ref={container} className="site-settings__widget" />
}
