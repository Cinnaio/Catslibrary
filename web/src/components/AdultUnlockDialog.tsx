import { useEffect, useRef, useState } from 'react'
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from './ui/alert-dialog'
import '../styles/adult-unlock-dialog.css'

interface TurnstileApi {
  render: (element: HTMLElement, options: Record<string, unknown>) => string
  remove: (id: string) => void
  reset: (id: string) => void
}
let scriptPromise: Promise<TurnstileApi> | null = null
export function loadTurnstile(): Promise<TurnstileApi> {
  const getApi = () => (window as unknown as { turnstile?: TurnstileApi }).turnstile
  if (getApi()) return Promise.resolve(getApi()!)
  if (!scriptPromise) scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    const timer = window.setTimeout(() => { script.remove(); reject(new Error('验证组件加载超时，请检查网络后重试')) }, 15000)
    script.onload = () => {
      clearTimeout(timer)
      const api = getApi()
      if (api) resolve(api)
      else reject(new Error('验证组件不可用，请稍后重试'))
    }
    script.onerror = () => { clearTimeout(timer); script.remove(); reject(new Error('无法加载人机验证，请检查网络后重试')) }
    document.head.appendChild(script)
  }).catch(error => { scriptPromise = null; throw error })
  return scriptPromise
}

export default function AdultUnlockDialog({ siteKey, onUnlock, onCancel }: {
  siteKey: string
  onUnlock: (token: string) => Promise<void>
  onCancel: () => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const widget = useRef<{ api: TurnstileApi; id: string } | null>(null)
  const [token, setToken] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!siteKey) return
    let cancelled = false
    void loadTurnstile().then(api => {
      if (cancelled || !container.current) return
      const id = api.render(container.current, {
        sitekey: siteKey, action: 'r18_unlock', theme: 'auto', size: 'flexible',
        callback: (value: string) => { if (!cancelled) { setToken(value); setError('') } },
        'expired-callback': () => { if (!cancelled) setToken('') },
        'error-callback': () => { if (!cancelled) { setToken(''); setError('验证失败，请稍后重试') } },
      })
      widget.current = { api, id }
    }).catch(err => { if (!cancelled) setError(err.message) })
    return () => { cancelled = true; if (widget.current) widget.current.api.remove(widget.current.id); widget.current = null }
  }, [siteKey])

  async function submit() {
    if (!token || !confirmed || busy) return
    setBusy(true)
    try { await onUnlock(token) } catch (err) {
      setError(err instanceof Error ? err.message : '开启失败，请重新验证')
      setToken('')
      if (widget.current) widget.current.api.reset(widget.current.id)
    } finally { setBusy(false) }
  }
  return <AlertDialog open onOpenChange={open => { if (!open) onCancel() }}>
    <AlertDialogContent className="adult-unlock-dialog">
      <AlertDialogHeader>
        <AlertDialogTitle>开启 R18 成人内容模式</AlertDialogTitle>
        <AlertDialogDescription>仅限已登录且年满 18 岁的读者。授权绑定当前登录会话，退出登录或切回安全模式后失效。</AlertDialogDescription>
      </AlertDialogHeader>
      <label className="adult-unlock-dialog__consent"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />我确认已年满 18 岁</label>
      {siteKey ? <div ref={container} data-action="r18_unlock" /> : <p role="alert" className="adult-unlock-dialog__notice">成人模式验证尚未配置，请联系管理员。</p>}
      {error && <p role="alert" className="adult-unlock-dialog__error">{error}</p>}
      <AlertDialogFooter>
        <button type="button" className="btn btn--secondary" onClick={onCancel}>取消</button>
        <button type="button" className="btn btn--primary" disabled={!token || !confirmed || busy} onClick={() => void submit()}>{busy ? '正在验证…' : '确认开启'}</button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
}
