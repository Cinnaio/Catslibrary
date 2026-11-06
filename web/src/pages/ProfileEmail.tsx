import { useEffect, useRef, useState, type FormEvent } from 'react'
import { authApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import FormField from '@/components/shared/FormField'
import type { User } from '@shared/types'

export default function ProfileEmail({ user }: { user: User }) {
  const [email, setEmail] = useState(user.email || '')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<boolean | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  useEffect(() => {
    let active = true
    void authApi.mailStatus().then(value => { if (active) setStatus(value.ready) }).catch(() => { if (active) setError('邮件服务状态读取失败，可重新打开此分区重试。') })
    return () => { active = false }
  }, [])
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (pending.current) return
    pending.current = true; setBusy(true); setError(''); setMessage('')
    try { const result = await authApi.requestEmail(email.trim(), password); setPassword(''); setMessage(result.message) }
    catch (error) { setError((error as Error).message || '发送失败，请重试') }
    finally { pending.current = false; setBusy(false) }
  }
  return <section className="profile-section" aria-label="邮箱与密码找回">
    <h2 className="profile-section-heading">邮箱与密码找回</h2>
    <p>{user.emailVerified ? `已验证邮箱：${user.email}` : '尚未绑定已验证邮箱。绑定后可通过邮件自助找回密码。'}</p>
    <form className="profile-settings" onSubmit={event => void submit(event)}>
      <FormField label={user.emailVerified ? '更换邮箱' : '邮箱地址'} htmlFor="profile-email" hint="确认新邮箱前，当前邮箱保持有效。验证后需要重新登录。"><Input id="profile-email" type="email" value={email} autoComplete="email" onChange={e => setEmail(e.target.value)} required maxLength={254} disabled={busy} /></FormField>
      <FormField label="当前密码" htmlFor="profile-email-password"><Input id="profile-email-password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required maxLength={512} disabled={busy} /></FormField>
      {status === false && <p>邮件服务尚未配置，请联系超级管理员。</p>}
      {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
      <Button type="submit" disabled={busy || status !== true}>{busy ? '发送中…' : '发送验证邮件'}</Button>
    </form>
  </section>
}
