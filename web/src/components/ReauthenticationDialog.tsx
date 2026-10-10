import { useEffect, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './ui/dialog'
import { request, getToken } from '../lib/api'
import type { ReauthenticationRequest } from '../lib/reauthentication'

export function ReauthenticationDialog() {
  const [task, setTask] = useState<ReauthenticationRequest | null>(null)
  const active = useRef<ReauthenticationRequest | null>(null)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  function close(value = false) {
    active.current?.finish(value)
    active.current = null
    setTask(null)
    setPassword('')
    setBusy(false)
  }
  useEffect(() => {
    function show(event: Event) {
      active.current?.finish(false)
      active.current = (event as CustomEvent<ReauthenticationRequest>).detail
      setTask(active.current)
      setPassword('')
      setError('')
    }
    function cancel() {
      active.current?.finish(false)
      active.current = null
      setTask(null)
      setPassword('')
      setBusy(false)
    }
    function changed(event: StorageEvent) {
      if (event.key === 'user_session_marker' || event.key === null) cancel()
    }
    window.addEventListener('storage', changed)
    window.addEventListener('zhizhou-session-expired', cancel)
    window.addEventListener('zz-reauthenticate', show)
    return () => {
      window.removeEventListener('storage', changed)
      window.removeEventListener('zhizhou-session-expired', cancel)
      window.removeEventListener('zz-reauthenticate', show)
      active.current?.finish(false)
    }
  }, [])
  async function submit() {
    if (busy || !password) return
    const current = active.current,
      marker = getToken()
    setBusy(true)
    setError('')
    try {
      await request('POST', '/auth/reauthenticate', { password }, true)
      if (active.current === current && marker === getToken()) close(true)
      else close(false)
    } catch (reason) {
      if (active.current === current) setError((reason as Error).message)
    } finally {
      if (active.current === current) setBusy(false)
    }
  }
  return (
    <Dialog
      open={!!task}
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      <DialogContent>
        <DialogTitle>确认管理员身份</DialogTitle>
        <DialogDescription>此操作需要近期身份验证，请输入当前账号的密码。</DialogDescription>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <label>
            当前密码
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoFocus
              required
            />
          </label>
          {error && <p role="alert">{error}</p>}
          <div className="dialog-actions">
            <button type="button" className="btn btn--secondary" onClick={() => close()}>
              取消
            </button>
            <button className="btn btn--primary" disabled={busy || !password}>
              {busy ? '验证中…' : '验证并继续'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
