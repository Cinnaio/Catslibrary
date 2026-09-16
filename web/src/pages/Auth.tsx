/**
 * Auth 页 —— 登录 / 注册（shadcn 版）。
 * 首个管理员引导已拆到独立 /install 页：本页探测到 needsBootstrap 时跳转过去。
 *
 * 布局说明：与 AdminGate、Install 同属公开站点居中页家族，共用 auth-page /
 * auth-shell 画布。卡片内用一套 .auth-* 类建立节奏，避免依赖成串的 Tailwind
 * 工具类拼出结构（此前每个字段都是 flex flex-col gap-1.5 的重复字面量）。
 */
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { AlertCircle, Eye, EyeOff, LoaderCircle, LogIn, UserPlus } from 'lucide-react'
import { authApi, getToken } from '../lib/api'
import { useSession } from '../context/SessionContext'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Mode = 'login' | 'register'

export default function Auth() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, login, refresh } = useSession()

  const [mode, setMode] = useState<Mode>(() => {
    const state = (location.state as { mode?: Mode } | null)?.mode
    return state === 'register' ? 'register' : 'login'
  })
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [invite, setInvite] = useState('')
  const [remember, setRemember] = useState(true)
  const [msg, setMsg] = useState('')
  const [registerMode, setRegisterMode] = useState<'invite' | 'open' | 'closed'>('invite')
  const [busy, setBusy] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  useDocumentTitle(mode === 'login' ? '登录' : '注册')

  const isLogin = mode === 'login'
  /** 注册关闭时整表单不可用：此前仍可填写并提交，用户填完只等到服务端报错。 */
  const registerClosed = !isLogin && registerMode === 'closed'
  const fieldsDisabled = busy || registerClosed
  const showInvite = !isLogin && registerMode === 'invite'

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

  function switchMode() {
    setMsg('')
    setShowPassword(false)
    setMode((m) => (m === 'login' ? 'register' : 'login'))
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    void (isLogin ? doLogin() : doRegister())
  }

  return (
    <main className="auth-page auth-page--with-header">
      <div className="auth-shell">
        <Card className="w-full max-w-sm">
          <CardContent className="auth-panel">
            <div className="auth-panel__head">
              <img src="/images/logo.png" alt="" className="auth-panel__mark" aria-hidden="true" />
              <h1 className="auth-panel__title">知舟</h1>
              <p className="auth-panel__lede">{isLogin ? '请登录后继续阅读' : '创建账号后继续阅读'}</p>
            </div>

            <form className="auth-form" onSubmit={onSubmit} noValidate>
              <div className="auth-fields">
                <div className="auth-field">
                  <Label htmlFor="auth-username">账号</Label>
                  <Input
                    id="auth-username"
                    autoComplete="username"
                    required
                    disabled={fieldsDisabled}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    aria-describedby={msg ? 'auth-message' : undefined}
                  />
                </div>

                <div className="auth-field">
                  <Label htmlFor="auth-password">密码</Label>
                  <div className="auth-password">
                    <Input
                      id="auth-password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete={isLogin ? 'current-password' : 'new-password'}
                      required
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
                )}
              </div>

              {msg && (
                <p id="auth-message" className="auth-alert" role="alert">
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
                  {busy ? (
                    <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                  ) : isLogin ? (
                    <LogIn className="size-4" aria-hidden="true" />
                  ) : (
                    <UserPlus className="size-4" aria-hidden="true" />
                  )}
                  {busy ? '处理中…' : isLogin ? '登录' : '创建账号'}
                </Button>

                <p className="auth-switch">
                  <span>{isLogin ? '没有账号？' : '已有账号？'}</span>
                  <button type="button" className="auth-switch__link" onClick={switchMode}>
                    {isLogin ? '去注册' : '去登录'}
                  </button>
                </p>
              </div>
            </form>

            <p className="auth-panel__foot">
              <Link to="/" className="auth-panel__foot-link">
                返回首页
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
