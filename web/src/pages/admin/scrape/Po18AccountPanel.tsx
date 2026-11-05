import FormField from "@/components/shared/FormField"
import { useCallback, useEffect, useId, useState } from 'react'
import { Link } from 'react-router-dom'
import AdminStatusBadge from '@/components/admin/AdminStatusBadge'
import styles from './workbench.module.css'
import { ChevronDown, Trash2 } from 'lucide-react'
import { useConfirm, useToast } from '../../../components/feedback'
import { scrapeApi, type Po18AccountStatus, type Po18CaptchaResponse } from '../../../lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Spinner } from '@/components/ui/spinner'
import { InlineError } from '@/components/shared/AsyncStates'

const STATUS_LABEL: Record<Po18AccountStatus['status'], string> = {
  not_configured: '未配置',
  credentials_saved: '账号已保存',
  session_saved: '会话已保存',
  authenticated: '会话可用',
  invalid: '会话已失效',
  needs_captcha: '需要重新验证',
  error: '状态异常',
}

function getStatusDescription(status: Po18AccountStatus | null): string {
  if (!status) return '正在读取 PO18.tw 账号状态…'
  switch (status.status) {
    case 'authenticated':
      return '原作者会话可用 · 爬取时自动附加权限 Cookie 校验收费章节与限制目录'
    case 'session_saved':
      return 'Cookie 已保存；可用性与章节读取权限仍需测试。'
    case 'credentials_saved':
      return '账号密码已保存 · 尚未完成登录校验，点击右侧展开完成登录'
    case 'needs_captcha':
      return '原站要求图形验证码 · 请展开面板获取并填写验证码重新登录'
    case 'invalid':
      return '原作者会话已失效 · 请展开重新登录或重新导入有效 Cookie'
    case 'error':
      return status.lastError || '状态异常 · 无法正常连接至 PO18 服务端'
    case 'not_configured':
    default:
      return '未连接账号；受保护章节需要账号本身具备读取权限。密码与 Cookie 由服务端加密保存。'
  }
}

function AccountStatus({ status, error }: { status: Po18AccountStatus | null; error: string }) {
  if (error) return <AdminStatusBadge tone="danger">读取失败</AdminStatusBadge>
  const state = status?.status
  const tone = state === 'authenticated' ? 'success'
    : state === 'invalid' || state === 'error' ? 'danger'
    : state === 'needs_captcha' || state === 'credentials_saved' ? 'warning' : 'muted'
  return <AdminStatusBadge tone={tone}>{state ? STATUS_LABEL[state] : '读取中…'}</AdminStatusBadge>
}

export default function Po18AccountPanel({ active }: { active: boolean }) {
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const [status, setStatus] = useState<Po18AccountStatus | null>(null)
  const [statusError, setStatusError] = useState('')
  const [actionError, setActionError] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [sessionCookie, setSessionCookie] = useState('')
  const [testSourceUrl, setTestSourceUrl] = useState('')
  const [captcha, setCaptcha] = useState('')
  const [challenge, setChallenge] = useState<Po18CaptchaResponse | null>(null)
  const [busy, setBusy] = useState<'load' | 'save' | 'captcha' | 'login' | 'test' | 'clear' | ''>('')

  const loadStatus = useCallback(async () => {
    setBusy('load')
    setStatusError('')
    try {
      const next = await scrapeApi.po18Account()
      setStatus(next)
      setStatusError('')
      if (next.username) setUsername(next.username)
    } catch (err) {
      setStatusError((err as Error).message || 'PO18.tw 账号状态读取失败')
      toast((err as Error).message || 'PO18.tw 账号状态读取失败', 'error')
    } finally {
      setBusy('')
    }
  }, [toast])

  useEffect(() => {
    if (!active) return
    const timer = window.setTimeout(() => void loadStatus(), 0)
    return () => window.clearTimeout(timer)
  }, [active, loadStatus])

  async function saveAccount(withSession = false) {
    if (!username.trim()) {
      toast('请填写 PO18.tw 账号', 'error')
      return
    }
    if (!(withSession ? sessionCookie.trim() : password.trim()) && !status?.configured) {
      toast('请填写密码，或粘贴已经登录的 Cookie', 'error')
      return
    }
    setActionError('')
    setBusy('save')
    try {
      const next = await scrapeApi.po18AccountSave({
        username: username.trim(),
        ...(password.trim() ? { password: password.trim() } : {}),
        ...(withSession && sessionCookie.trim() ? { sessionCookie: sessionCookie.trim() } : {}),
      })
      setStatus(next)
      setStatusError('')
      setPassword('')
      if (withSession) setSessionCookie('')
      toast(withSession ? 'PO18.tw Cookie 已加密保存' : 'PO18.tw 账号已加密保存', 'success')
    } catch (err) {
      setActionError((err as Error).message || 'PO18.tw 账号保存失败')
      toast((err as Error).message || 'PO18.tw 账号保存失败', 'error')
    } finally {
      setBusy('')
    }
  }

  async function getCaptcha() {
    setActionError('')
    setBusy('captcha')
    try {
      const next = await scrapeApi.po18AccountCaptcha()
      setChallenge(next)
      setCaptcha('')
      toast(next.captchaRequired ? '验证码已获取，请填写后登录' : '登录页已获取，可以直接尝试登录', 'success')
    } catch (err) {
      setActionError((err as Error).message || 'PO18.tw 验证码获取失败')
      toast((err as Error).message || 'PO18.tw 验证码获取失败', 'error')
    } finally {
      setBusy('')
    }
  }

  async function login() {
    if (!challenge) {
      toast('请先获取验证码', 'error')
      return
    }
    setActionError('')
    setBusy('login')
    try {
      const next = await scrapeApi.po18AccountLogin(challenge.challengeId, captcha.trim())
      setStatus(next)
      setStatusError('')
      setChallenge(null)
      setCaptcha('')
      toast(next.message || 'PO18.tw 登录成功', 'success')
    } catch (err) {
      setActionError((err as Error).message || 'PO18.tw 登录失败')
      toast((err as Error).message || 'PO18.tw 登录失败', 'error')
    } finally {
      setBusy('')
    }
  }

  async function testSession() {
    setActionError('')
    setBusy('test')
    try {
      const next = await scrapeApi.po18AccountTest(testSourceUrl.trim() || undefined)
      setStatus(next)
      setStatusError('')
      toast(next.message || 'PO18.tw 会话可用', 'success')
    } catch (err) {
      setActionError((err as Error).message || 'PO18.tw 会话测试失败')
      toast((err as Error).message || 'PO18.tw 会话测试失败', 'error')
      await loadStatus()
    } finally {
      setBusy('')
    }
  }

  async function clearAccount() {
    const ok = await confirm({
      title: '清除 PO18.tw 账号',
      message: '将删除服务端保存的 PO18.tw 账号、密码和 Cookie。确定继续吗？',
      okText: '清除',
      danger: true,
    })
    if (!ok) return
    setActionError('')
    setBusy('clear')
    try {
      await scrapeApi.po18AccountClear()
      setStatus(null)
      setUsername('')
      setPassword('')
      setSessionCookie('')
      setTestSourceUrl('')
      setChallenge(null)
      toast('PO18.tw 账号已清除', 'success')
      await loadStatus()
    } catch (err) {
      setActionError((err as Error).message || 'PO18.tw 账号清除失败')
      toast((err as Error).message || 'PO18.tw 账号清除失败', 'error')
    } finally {
      setBusy('')
    }
  }

  const [collapsed, setCollapsed] = useState(true)
  const connectionId = useId()
  const disabled = Boolean(busy)

  useEffect(() => {
    if (status && ['invalid', 'needs_captcha', 'credentials_saved', 'error'].includes(status.status)) {
      setCollapsed(false)
    }
  }, [status?.status])

  return (
    <section className={styles.connection} aria-label="PO18 源站连接">
      <div className={styles.connectionHead}>
        <div className={styles.connectionSummary}>
          <span className={styles.connectionTitle}>PO18 连接</span>
          <AccountStatus status={status} error={statusError} />
          {status?.username && <span className={styles.connectionUser} title={status.username}>@{status.username}</span>}
        </div>
        <div className={styles.connectionActions}>
          {statusError && <Button variant="ghost" disabled={disabled} onClick={() => void loadStatus()}>重新读取</Button>}
          <Button variant="ghost" disabled={disabled && !collapsed} aria-expanded={!collapsed} aria-controls={connectionId} onClick={() => setCollapsed((value) => !value)}>
            {collapsed ? '管理连接' : '收起连接'}
            <ChevronDown className={`${styles.chevron} ${collapsed ? '' : styles.chevronOpen}`} aria-hidden="true" />
          </Button>
        </div>
      </div>
      {!collapsed && <div id={connectionId} className={styles.connectionBody}>
        <div className={styles.connectionIntro}>
          <p className={styles.hint}>{statusError || getStatusDescription(status)}</p>
          <Button variant="ghost" asChild><Link to="/admin/scrape?view=proxy">代理设置</Link></Button>
        </div>
        {actionError && <InlineError message={actionError} />}
        {!actionError && status?.lastError && <InlineError message={status.lastError} />}
        <section className={styles.connectionSection} aria-labelledby="po18-login-title">
          <div className={styles.sectionIntro}><h3 id="po18-login-title">账号登录</h3><p className={styles.hint}>先保存账号，再获取验证码并登录。密码留空时保留已保存的密码。</p></div>
          <div className={styles.connectionFields}>
            <FormField label="账号" htmlFor="po18-account-username"><Input id="po18-account-username" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="PO18.tw 登录账号" disabled={disabled} /></FormField>
            <FormField label="密码" htmlFor="po18-account-password"><Input id="po18-account-password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={status?.hasPassword ? '留空表示保持原密码' : 'PO18.tw 登录密码'} disabled={disabled} /></FormField>
          </div>
          <div className={styles.connectionActions}>
            <Button disabled={disabled} onClick={() => void saveAccount()}>{busy === 'save' && <Spinner size="sm" aria-hidden="true" />}{busy === 'save' ? '保存中…' : '保存账号'}</Button>
            <Button variant="outline" disabled={disabled} aria-expanded={Boolean(challenge)} aria-controls="po18-account-challenge" onClick={() => void getCaptcha()}>{busy === 'captcha' && <Spinner size="sm" aria-hidden="true" />}{busy === 'captcha' ? '正在获取…' : challenge ? '刷新验证码' : '获取验证码'}</Button>
            {status?.hasPassword && <span className={styles.hint}>密码已加密保存</span>}
          </div>
          {challenge && <div id="po18-account-challenge" className={styles.captcha} role="group" aria-label="登录验证码">
            {challenge.imageDataUrl && <img src={challenge.imageDataUrl} alt="PO18.tw 登录验证码" />}
            {challenge.captchaRequired ? <FormField label="验证码" htmlFor="po18-account-captcha"><Input id="po18-account-captcha" value={captcha} onChange={(event) => setCaptcha(event.target.value)} placeholder="填写图片中的字符" autoComplete="off" disabled={disabled} /></FormField> : <p className={styles.hint}>无需图片验证码，可以直接提交登录。</p>}
            <Button disabled={disabled || (challenge.captchaRequired && !captcha.trim())} onClick={() => void login()}>{busy === 'login' && <Spinner size="sm" aria-hidden="true" />}{busy === 'login' ? '登录中…' : '提交登录'}</Button>
          </div>}
        </section>
        <details className={styles.connectionAlternative}>
          <summary><span>导入浏览器 Cookie</span><span className={styles.foldAside}>自动登录不成功时使用</span></summary>
          <div className={styles.alternativeBody}>
            <p className={styles.hint}>在浏览器登录 PO18.tw 后复制 Cookie。保存后不会回显，账号沿用上方填写的值。</p>
            <FormField label="会话 Cookie" htmlFor="po18-session-cookie"><Textarea id="po18-session-cookie" rows={3} value={sessionCookie} onChange={(event) => setSessionCookie(event.target.value)} placeholder="粘贴浏览器中已登录的 Cookie" disabled={disabled} /></FormField>
            <div className={styles.connectionActions}><Button variant="outline" disabled={disabled || !sessionCookie.trim()} onClick={() => void saveAccount(true)}>{busy === 'save' ? '保存中…' : '加密保存 Cookie'}</Button>{status?.hasSession && <span className={styles.hint}>Cookie 已保存，仍需校验实际读取权限</span>}</div>
          </div>
        </details>
        <section className={styles.connectionSection} aria-labelledby="po18-test-title">
          <div className={styles.sectionIntro}><h3 id="po18-test-title">会话校验</h3><p className={styles.hint}>填写链接可验证对应章节的读取权限；留空只检查站点可访问。</p></div>
          <FormField label="会话验证链接（可选）" htmlFor="po18-session-test-url"><div className={styles.controls}><Input id="po18-session-test-url" type="url" value={testSourceUrl} onChange={(event) => setTestSourceUrl(event.target.value)} placeholder="粘贴有权限的目录或章节链接" disabled={disabled} /><Button variant="outline" disabled={disabled || !status?.hasSession} onClick={() => void testSession()}>{busy === 'test' && <Spinner size="sm" aria-hidden="true" />}{busy === 'test' ? '测试中…' : '测试会话'}</Button></div></FormField>
        </section>
        <footer className={styles.connectionFooter}>
          <p className={styles.hint}>密码与 Cookie 由服务端加密存储；受保护内容仍需账号具备读取权限。</p>
          <Button variant="ghost" disabled={disabled || !status?.configured} onClick={() => void clearAccount()}><Trash2 aria-hidden="true" />{busy === 'clear' ? '清除中…' : '清除账号'}</Button>
        </footer>
      </div>}
    </section>
  )
}
