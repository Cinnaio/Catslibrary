import { useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { authApi } from '@/lib/api'
import { useSession } from '@/context/SessionContext'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Panel } from '@/components/ui/panel'
import FormField from '@/components/shared/FormField'
import styles from './account-email.module.css'

/** 链接令牌只从 fragment 读取，显式确认才消费；读取后立即清理地址栏。 */
export default function AccountEmail() {
  const location = useLocation()
  const kind = location.pathname === '/verify-email' ? 'verify' : location.pathname === '/reset-password' ? 'reset' : 'forgot'
  const title = kind === 'verify' ? '验证邮箱' : kind === 'reset' ? '设置新密码' : '找回密码'
  useDocumentTitle(title)
  const { refresh } = useSession()
  const [token] = useState(() => new URLSearchParams(location.hash.slice(1)).get('token') || '')
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  useLayoutEffect(() => {
    if (location.hash) window.history.replaceState(window.history.state, '', location.pathname)
  }, [location.hash, location.pathname])
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (pending.current) return
    if (kind === 'reset' && password !== confirmation) { setError('两次输入的新密码不一致'); return }
    pending.current = true; setBusy(true); setError('')
    try {
      if (kind === 'forgot') {
        const result = await authApi.forgotPassword(identifier.trim())
        setMessage(result.message)
      } else {
        if (kind === 'verify') await authApi.verifyEmail(token)
        else await authApi.resetPassword(token, password)
        setPassword(''); setConfirmation('')
        setMessage(kind === 'verify' ? '邮箱已验证，旧登录会话已撤销，请重新登录。' : '密码已更新，旧登录会话已撤销，请使用新密码登录。')
        await refresh().catch(() => {})
      }
      setDone(true)
    } catch (error) { setError((error as Error).message || '操作失败，请稍后重试') }
    finally { pending.current = false; setBusy(false) }
  }
  return <main className={styles.page}>
    <Panel className={styles.panel}>
      <h1>{title}</h1>
      <p>{kind === 'forgot' ? '输入用户名或已验证邮箱。尚未绑定邮箱的账号请联系站点管理员。' : '请确认这是你本人发起的操作。链接仅可使用一次，打开页面不会自动修改账号。'}</p>
      {done ? <p role="status">{message}</p> : kind !== 'forgot' && !token ? <p role="alert">链接缺少有效令牌，请重新申请邮件。</p> : <form onSubmit={event => void submit(event)} className={styles.form}>
        {kind === 'forgot' && <FormField label="用户名或邮箱" htmlFor="recovery-identifier"><Input id="recovery-identifier" value={identifier} onChange={e => setIdentifier(e.target.value)} autoComplete="username" required maxLength={254} disabled={busy} /></FormField>}
        {kind === 'reset' && <>
          <FormField label="新密码" htmlFor="recovery-password" hint="8–512 位"><Input id="recovery-password" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" required minLength={8} maxLength={512} disabled={busy} /></FormField>
          <FormField label="确认新密码" htmlFor="recovery-confirm"><Input id="recovery-confirm" type="password" value={confirmation} onChange={e => setConfirmation(e.target.value)} autoComplete="new-password" required minLength={8} maxLength={512} disabled={busy} /></FormField>
        </>}
        {error && <p role="alert">{error}</p>}
        <Button type="submit" disabled={busy}>{busy ? '处理中…' : kind === 'forgot' ? '发送重置邮件' : kind === 'verify' ? '确认验证邮箱' : '保存新密码'}</Button>
      </form>}
      <Button variant="ghost" asChild><Link to="/auth">返回登录</Link></Button>
    </Panel>
  </main>
}
