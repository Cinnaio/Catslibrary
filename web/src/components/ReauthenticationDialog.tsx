import { useEffect, useRef, useState } from 'react'
import { KeyRound } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogHeader, DialogFooter } from './ui/dialog'
import { Button } from './ui/button'
import { Input } from './ui/input'
import AdminFormField from './admin/AdminFormField'
import { authApi, request, getToken } from '../lib/api'
import type { ReauthenticationRequest } from '../lib/reauthentication'

export function ReauthenticationDialog() {
  const [task, setTask] = useState<ReauthenticationRequest | null>(null)
  const active = useRef<ReauthenticationRequest | null>(null)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [passkeyAvailable, setPasskeyAvailable] = useState(false)

  function close(value = false) {
    active.current?.finish(value)
    active.current = null
    setTask(null)
    setPassword('')
    setError('')
    setBusy(false)
    setPasskeyAvailable(false)
  }

  useEffect(() => {
    function show(event: Event) {
      active.current?.finish(false)
      active.current = (event as CustomEvent<ReauthenticationRequest>).detail
      setTask(active.current)
      setPassword('')
      setError('')
      setPasskeyAvailable(false)
      const current = active.current
      void authApi
        .passkeyConfig()
        .then(async (config) => {
          if (active.current !== current || !config.enabled || !config.configured) return
          const credentials = await authApi.passkeys()
          if (active.current === current) setPasskeyAvailable(credentials.passkeys.length > 0)
        })
        .catch(() => {
          // Passkey is an optional fallback; the password verifier remains available.
        })
    }
    function cancel() {
      active.current?.finish(false)
      active.current = null
      setTask(null)
      setPassword('')
      setError('')
      setBusy(false)
      setPasskeyAvailable(false)
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

  async function submitPasskey() {
    if (busy) return
    const current = active.current,
      marker = getToken()
    setBusy(true)
    setError('')
    try {
      await authApi.reauthenticateWithPasskey()
      if (active.current === current && marker === getToken()) close(true)
      else close(false)
    } catch (reason) {
      if (active.current === current) {
        const error = reason as Error
        setError(error.name === 'NotAllowedError' ? '已取消设备验证，请改用当前密码。' : error.message || 'Passkey 验证失败，请改用当前密码。')
      }
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
      <DialogContent className="admin-reauth-dialog sm:max-w-[420px] rounded-2xl p-6 gap-5 border border-border bg-card shadow-xl">
        <DialogHeader className="gap-1.5 text-left sm:text-left p-0">
          <DialogTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">确认管理员身份</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground leading-relaxed">
            此操作需要近期身份验证，请使用设备验证或输入当前账号的密码继续。
          </DialogDescription>
        </DialogHeader>

        {passkeyAvailable && (
          <div className="space-y-3" data-testid="reauth-passkey-option">
            <div className="flex items-center gap-3 text-[11px] font-medium tracking-[0.08em] text-muted-foreground/80">
              <span className="h-px flex-1 bg-border" />
              <span>设备验证</span>
              <span className="h-px flex-1 bg-border" />
            </div>
            <Button
              type="button"
              variant="secondary"
              className="w-full rounded-full border border-border/80 bg-secondary/70 py-2.5 shadow-sm hover:border-[var(--admin-accent,#D97757)] hover:bg-secondary"
              onClick={() => void submitPasskey()}
              disabled={busy}
            >
              <KeyRound size={16} aria-hidden="true" />
              {busy ? '等待设备验证…' : '使用 Passkey 验证'}
            </Button>
            <p className="text-center text-xs leading-relaxed text-muted-foreground">使用设备的生物识别、PIN 或屏幕锁定完成验证。</p>
          </div>
        )}

        <form
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
          className="space-y-4"
        >
          <AdminFormField label="当前密码" htmlFor="reauth-password">
            <Input
              id="reauth-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="请输入当前密码"
              autoFocus
              required
              disabled={busy}
              className="w-full rounded-full"
            />
          </AdminFormField>

          {error && (
            <p role="alert" className="text-xs text-destructive font-medium -mt-1">
              {error}
            </p>
          )}

          <DialogFooter className="flex items-center justify-end gap-2.5 pt-2">
            <Button type="button" variant="secondary" className="rounded-full px-5" onClick={() => close()} disabled={busy}>
              取消
            </Button>
            <Button
              type="submit"
              disabled={busy || !password.trim()}
              className="rounded-full px-5 bg-[var(--admin-accent,#D97757)] hover:bg-[#c86646] text-white shadow-sm"
            >
              {busy ? '验证中…' : '验证并继续'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
