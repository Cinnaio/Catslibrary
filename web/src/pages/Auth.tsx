import '@/styles/identity-layout.css'
import '@/styles/site-branding.css'
import '@/styles/input-fields.css'
import styles from './auth.module.css'
/**
 * Auth 页 —— 登录 / 注册 / 找回密码。
 * 首个管理员引导已拆到独立 /install 页：本页探测到 needsBootstrap 时跳转过去。
 *
 * 独立阅读氛围双栏：auth-page--reader 限定页面外观，不改变安装向导。
 */
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type MouseEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { AlertCircle, ArrowLeft, Eye, EyeOff, KeyRound, LoaderCircle, MailCheck } from 'lucide-react'
import { authApi, getToken } from '../lib/api'
import { useSession } from '../context/SessionContext'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useSiteBranding } from '../lib/site-branding'
import { useStateChangeMotion } from '../hooks/useStateChangeMotion'
import { ThemeMenu } from '../components/ThemeMenu'

type Mode = 'login' | 'register' | 'forgot'
type AuthLocationState = { mode?: Mode; from?: string }

function getPhoneOrientation(): 'portrait' | 'landscape' | undefined {
  const shortEdge = Math.min(window.screen.width, window.screen.height)
  if (shortEdge <= 0 || shortEdge > 700 || !window.matchMedia?.('(pointer: coarse)').matches) return undefined
  // Use the screen rather than the viewport, which can shrink when the keyboard opens.
  const orientation = window.screen.orientation?.type
  if (orientation) return orientation.startsWith('landscape') ? 'landscape' : 'portrait'
  if (typeof window.orientation === 'number') return Math.abs(window.orientation) === 90 ? 'landscape' : 'portrait'
  return window.screen.width > window.screen.height ? 'landscape' : 'portrait'
}

function subscribePhoneOrientation(listener: () => void) {
  const orientation = window.screen.orientation
  const pointer = window.matchMedia?.('(pointer: coarse)')
  window.addEventListener('resize', listener)
  window.addEventListener('orientationchange', listener)
  orientation?.addEventListener('change', listener)
  pointer?.addEventListener('change', listener)
  return () => {
    window.removeEventListener('resize', listener)
    window.removeEventListener('orientationchange', listener)
    orientation?.removeEventListener('change', listener)
    pointer?.removeEventListener('change', listener)
  }
}

export default function Auth() {
  const branding = useSiteBranding()
  const navigate = useNavigate()
  const location = useLocation()
  const { user, login, refresh } = useSession()
  const phoneOrientation = useSyncExternalStore(subscribePhoneOrientation, getPhoneOrientation, () => undefined)

  const routeState = location.state as AuthLocationState | null
  const requestedMode = new URLSearchParams(location.search).get('mode')
  const mode: Mode = requestedMode === 'forgot-password' ? 'forgot'
    : requestedMode === 'register' ? 'register' : requestedMode === 'login' ? 'login'
    : routeState?.mode === 'register' ? 'register' : 'login'
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [invite, setInvite] = useState('')
  const [remember, setRemember] = useState(true)
  const [msg, setMsg] = useState('')
  const [registerMode, setRegisterMode] = useState<'invite' | 'open' | 'closed'>('invite')
  const [busy, setBusy] = useState(false)
  const [passkeyBusy, setPasskeyBusy] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [passkeyAvailable, setPasskeyAvailable] = useState(false)
  const [identifier, setIdentifier] = useState('')
  const [recoveryMessage, setRecoveryMessage] = useState('')
  const [recoveryError, setRecoveryError] = useState('')
  const recoveryPending = useRef(false)
  const recoveryInput = useRef<HTMLInputElement>(null)
  const loginInput = useRef<HTMLInputElement>(null)
  const recoveryReturnButton = useRef<HTMLButtonElement>(null)
  const previousMode = useRef(mode)
  useDocumentTitle(mode === 'login' ? '登录' : mode === 'register' ? '注册' : '找回密码')

  const isLogin = mode === 'login'
  const isRecovery = mode === 'forgot'
  const { root: modeMotionRef, prepare: prepareModeMotion } = useStateChangeMotion(mode, '.auth-panel__title, .auth-fields, .auth-actions')
  /** 注册关闭时整表单不可用：此前仍可填写并提交，用户填完只等到服务端报错。 */
  const registerClosed = mode === 'register' && registerMode === 'closed'
  const fieldsDisabled = busy || registerClosed
  const showInvite = mode === 'register' && registerMode === 'invite'

  useEffect(() => {
    const previous = previousMode.current
    previousMode.current = mode
    if (mode === 'forgot') {
      if (recoveryMessage) recoveryReturnButton.current?.focus({ preventScroll: true })
      else recoveryInput.current?.focus({ preventScroll: true })
    } else if (previous === 'forgot') loginInput.current?.focus({ preventScroll: true })
  }, [mode, recoveryMessage])

  /** 登录/注册成功后的回跳目标：优先来源页（谁带进 /auth 的 from），否则回首页。 */
  function next(): string {
    const from = (location.state as { from?: string } | null)?.from
    if (from) return from
    // 兼容旧入口（曾由 RequireAuth 写入 sessionStorage 的 auth_next）
    const legacy = sessionStorage.getItem('auth_next')
    if (legacy) return legacy
    return '/'
  }

  function finish() {
    sessionStorage.removeItem('auth_next')
    navigate(next(), { replace: true })
  }

  // 已登录访问 /auth：回到来源页，而不是固定甩到 /profile
  const from = (location.state as { from?: string } | null)?.from
  useEffect(() => {
    if (getToken() && user) {
      navigate(from || '/', { replace: true })
      return
    }
    void authApi
      .bootstrapStatus()
      .then((r) => {
        if (r.needsBootstrap) navigate('/install', { replace: true })
      })
      .catch((err) => {
        // 数据库尚未配置：后端对所有业务请求返回 503 { needsSetup: true }
        if ((err as { data?: { needsSetup?: boolean } }).data?.needsSetup) {
          navigate('/install', { replace: true })
        }
      })
  }, [user, navigate, from])

  useEffect(() => {
    if (!isLogin) { setPasskeyAvailable(false); return }
    void authApi.passkeyConfig().then(value => setPasskeyAvailable(value.enabled && value.configured)).catch(() => setPasskeyAvailable(false))
  }, [isLogin])

  // 注册模式仅在切到注册 Tab 时需要，与 bootstrap 探测分离，避免切换 Tab 重复请求
  useEffect(() => {
    if (mode !== 'register') return
    void authApi
      .registerStatus()
      .then((r) => setRegisterMode(r.mode as 'invite' | 'open' | 'closed'))
      .catch(() => {})
  }, [mode])

  async function doLogin() {
    setBusy(true)
    setMsg('')
    try {
      await login(username.trim(), password, remember)
      finish()
    } catch (err) {
      setMsg((err as Error).message || '登录失败')
    } finally {
      setBusy(false)
    }
  }

  async function doRegister() {
    setBusy(true)
    setMsg('')
    try {
      await authApi.register(username.trim(), password, invite.trim())
      await refresh()
      finish()
    } catch (err) {
      setMsg((err as Error).message || '注册失败')
    } finally {
      setBusy(false)
    }
  }

  async function doPasskeyLogin() {
    setBusy(true)
    setPasskeyBusy(true)
    setMsg('')
    try {
      await authApi.passkeyLogin(username.trim(), remember)
      await refresh()
      finish()
    } catch (err) {
      const error = err as Error & { name?: string }
      setMsg(error.name === 'NotAllowedError' ? '已取消 Passkey 验证，请改用密码登录。' : error.message || 'Passkey 登录失败，请改用密码登录。')
    } finally {
      setPasskeyBusy(false)
      setBusy(false)
    }
  }

  function switchMode(event: MouseEvent<HTMLButtonElement>, target: Mode) {
    if (busy) return
    prepareModeMotion(event)
    setMsg('')
    setShowPassword(false)
    if (target === 'forgot' && !identifier) setIdentifier(username.trim())
    const params = new URLSearchParams(location.search)
    if (target === 'login') params.delete('mode')
    else params.set('mode', target === 'forgot' ? 'forgot-password' : 'register')
    navigate({ pathname: '/auth', search: params.toString() ? `?${params}` : '' }, { state: { ...routeState, mode: target } })
  }

  async function recoverPassword(event: FormEvent) {
    event.preventDefault()
    if (recoveryPending.current || busy || !identifier.trim() || recoveryMessage) return
    recoveryPending.current = true; setBusy(true); setRecoveryError('')
    try {
      const result = await authApi.forgotPassword(identifier.trim())
      setRecoveryMessage(result.message)
    } catch (error) { setRecoveryError((error as Error).message || '请求失败，请稍后重试') }
    finally { recoveryPending.current = false; setBusy(false) }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (busy || isRecovery) return
    void (isLogin ? doLogin() : doRegister())
  }

  return (
    <main className={`${styles.page} auth-page auth-page--reader`} data-phone-orientation={phoneOrientation}>
      <aside className={styles.visual} aria-label="自己的阅读空间">
        <div className={styles.visualCopy}>
          <p className={styles.visualHeading}>留一点时间，<br />读自己的故事。</p>
          <p className={styles.visualDescription}>收藏喜欢的书，接着上次读。</p>
        </div>
        <p className={styles.visualSignature}>{branding.name} · 自己的阅读空间</p>
      </aside>
      <div className="auth-shell">
          <div className={styles.toolbar}>
            <Link to="/" className={styles.backLink}><ArrowLeft size={16} aria-hidden="true" />返回书库</Link>
            <ThemeMenu className={styles.themeButton} />
          </div>
          <div className={styles.formViewport}>
          <section ref={modeMotionRef} className="auth-panel" aria-labelledby="auth-title">
            <div className="auth-panel__head">
              <div className="auth-panel__brand">
                <img src={branding.logoUrl} alt="" className="auth-panel__mark site-logo" aria-hidden="true" />
                <span>{branding.name}</span>
              </div>
              <h1 id="auth-title" className="auth-panel__title">{isRecovery ? '找回密码' : isLogin ? '欢迎回来' : '创建你的阅读空间'}</h1>
              <p className={styles.subtitle}>{isRecovery ? '输入用户名或已验证邮箱，申请密码重置。' : isLogin ? '登录后，同步你的书架与阅读进度。' : '创建账号，把喜欢的故事收进书架。'}</p>
            </div>

            <form className="auth-form" onSubmit={onSubmit} noValidate hidden={isRecovery}>
              <div className="auth-fields">
                <div className="auth-field">
                  <Label htmlFor="auth-username">账号</Label>
                  <div className={`${styles.inputFrame} ${styles.compactInputFrame}`}>
                    <Input
                      id="auth-username"
                      ref={loginInput}
                      autoComplete={isLogin ? 'username webauthn' : 'username'}
                      required
                      placeholder={isLogin ? '输入用户名或已验证邮箱' : '输入你的账号'}
                      disabled={fieldsDisabled}
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      aria-describedby={msg ? 'auth-message' : undefined}
                    />
                  </div>
                </div>

                <div className="auth-field">
                  <div className={styles.passwordHeading}>
                    <Label htmlFor="auth-password">密码</Label>
                    {isLogin && <button type="button" className={`auth-switch__link ${styles.forgotLink}`} onClick={event => switchMode(event, 'forgot')} disabled={busy}>忘记密码</button>}
                  </div>
                  <div className={`auth-password ${styles.inputFrame} ${styles.compactInputFrame}`}>
                    <Input
                      id="auth-password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete={isLogin ? 'current-password' : 'new-password'}
                      required
                      placeholder={isLogin ? '输入你的密码' : '设置登录密码'}
                      disabled={fieldsDisabled}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      aria-describedby={msg ? 'auth-message' : undefined}
                      className="auth-password__input"
                    />
                    {/* 让用户能核对自己输入的长密码，而不是重打一遍。 */}
                    <button
                      type="button"
                      className="auth-password__toggle"
                      onClick={() => setShowPassword((v) => !v)}
                      disabled={fieldsDisabled}
                      aria-label={showPassword ? '隐藏密码' : '显示密码'}
                      aria-pressed={showPassword}
                      title={showPassword ? '隐藏密码' : '显示密码'}
                    >
                      {showPassword ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
                    </button>
                  </div>
                </div>

                {isLogin && (
                  <label className="auth-remember">
                    <input
                      type="checkbox"
                      className="size-4 rounded border-input accent-[var(--accent)]"
                      checked={remember}
                      disabled={fieldsDisabled}
                      onChange={(e) => setRemember(e.target.checked)}
                    />
                    <span>保持登录</span>
                  </label>
                )}

                {showInvite && (
                  <div className="auth-field">
                    <Label htmlFor="auth-invite">邀请码</Label>
                    <div className={styles.inputFrame}>
                      <Input
                        id="auth-invite"
                        autoComplete="off"
                        required
                        disabled={fieldsDisabled}
                        placeholder="注册时填写"
                        value={invite}
                        onChange={(e) => setInvite(e.target.value)}
                      />
                    </div>
                  </div>
                )}
              </div>

              {msg && (
                <p id="auth-message" className="auth-alert" role="alert" title={msg}>
                  <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
                  <span>{msg}</span>
                </p>
              )}

              {registerClosed && (
                <p className="auth-alert auth-alert--muted" role="status">
                  <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
                  <span>本实例已关闭注册，请联系管理员开通账号。</span>
                </p>
              )}

              <div className="auth-actions">
                <Button type="submit" disabled={fieldsDisabled}>
                  {busy && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
                  {busy ? '处理中…' : isLogin ? '进入阅读空间' : '创建账号'}
                </Button>

                {isLogin && passkeyAvailable && (
                  <Button type="button" variant="secondary" disabled={fieldsDisabled} onClick={() => void doPasskeyLogin()}>
                    <KeyRound className="size-4" aria-hidden="true" />
                    {passkeyBusy ? '等待设备验证…' : '通行密钥登录'}
                  </Button>
                )}

                <p className="auth-switch">
                  <span>{isLogin ? '没有账号？' : '已有账号？'}</span>
                  <button type="button" className="auth-switch__link" onClick={event => switchMode(event, isLogin ? 'register' : 'login')} disabled={busy}>
                    {isLogin ? '去注册' : '去登录'}
                  </button>
                </p>
              </div>
            </form>

            {isRecovery && <form className="auth-form" onSubmit={event => void recoverPassword(event)}>
              {recoveryMessage ? <div className={styles.recoveryResult} role="status">
                <MailCheck size={22} aria-hidden="true" />
                <p>{recoveryMessage}</p>
              </div> : <>
                <div className="auth-fields">
                  <div className="auth-field">
                    <Label htmlFor="auth-recovery-identifier">用户名或邮箱</Label>
                    <div className={styles.inputFrame}>
                      <Input id="auth-recovery-identifier" ref={recoveryInput} autoComplete="username" required maxLength={254}
                        placeholder="输入用户名或已验证邮箱" disabled={busy} value={identifier}
                        onChange={event => setIdentifier(event.target.value)}
                        aria-describedby={`auth-recovery-hint${recoveryError ? ' auth-recovery-error' : ''}`} />
                    </div>
                    <p id="auth-recovery-hint" className={styles.fieldHint}>尚未绑定邮箱的账号，请联系站点管理员。</p>
                  </div>
                </div>
                {recoveryError && <p id="auth-recovery-error" className="auth-alert" role="alert" title={recoveryError}>
                  <AlertCircle className="size-4 shrink-0" aria-hidden="true" /><span>{recoveryError}</span>
                </p>}
              </>}
              <div className="auth-actions">
                {!recoveryMessage && <Button type="submit" disabled={busy}>
                  {busy && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
                  {busy ? '正在申请…' : '发送重置邮件'}
                </Button>}
                <Button ref={recoveryReturnButton} type="button" variant={recoveryMessage ? 'default' : 'secondary'} onClick={event => switchMode(event, 'login')} disabled={busy}>
                  <ArrowLeft className="size-4" aria-hidden="true" />返回登录
                </Button>
                {recoveryMessage && <p className="auth-switch"><button type="button" className="auth-switch__link" onClick={() => { setRecoveryMessage(''); setRecoveryError('') }}>重新填写</button></p>}
              </div>
            </form>}

          </section>
          </div>
      </div>
    </main>
  )
}
