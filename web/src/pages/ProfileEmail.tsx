import { useEffect, useRef, useState, type FormEvent } from 'react'
import { authApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import FormField from '@/components/shared/FormField'
import { InlineError } from '@/components/shared/AsyncStates'
import type { User } from '@shared/types'
import styles from './profile-security.module.css'

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
  return <section className={`profile-section ${styles.panel} ${styles.emailPanel}`} aria-label="邮箱与密码找回">
    <header className={styles.heading}>
      <h2 className="profile-section-heading">邮箱与密码找回</h2>
      <p>{user.emailVerified ? `已验证邮箱：${user.email}` : '绑定并验证邮箱后，可通过邮件找回密码。'}</p>
    </header>
    <form className={styles.form} onSubmit={event => void submit(event)}>
      <FormField label={user.emailVerified ? '更换邮箱' : '邮箱地址'} htmlFor="profile-email"
        hint={user.emailVerified ? '确认新邮箱前，当前邮箱保持有效。' : '打开验证邮件中的链接后，邮箱才会绑定。'}>
        <Input id="profile-email" type="email" value={email} autoComplete="email" placeholder="输入要绑定的邮箱地址" onChange={e => setEmail(e.target.value)} required maxLength={254} disabled={busy} />
      </FormField>
      <FormField label="当前密码" htmlFor="profile-email-password">
        <Input id="profile-email-password" type="password" autoComplete="current-password" placeholder="输入当前登录密码" value={password} onChange={e => setPassword(e.target.value)} required maxLength={512} disabled={busy} />
      </FormField>
      {(status === false || (status === null && !error) || message || error) && <div className={styles.feedback}>
        {status === null && !error && <p className={styles.notice} role="status">正在读取邮件服务状态…</p>}
        {status === false && <p className={styles.notice} role="status">邮件服务尚未配置，请联系超级管理员。</p>}
        {message && <p className={styles.result} role="status">{message}</p>}
        {error && <InlineError message={error} />}
      </div>}
      <div className={styles.actions}>
        <p>验证后需重新登录。</p>
        <Button type="submit" disabled={busy || status !== true}>
          {busy && <Spinner size="sm" aria-hidden="true" />}{busy ? '发送中…' : '发送验证邮件'}
        </Button>
      </div>
    </form>
  </section>
}
