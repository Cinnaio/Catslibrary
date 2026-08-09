/**
 * Auth 页 —— 登录 / 注册（shadcn 版）。
 * 首个管理员引导已拆到独立 /install 页：本页探测到 needsBootstrap 时跳转过去。
 */
import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { authApi, getToken } from '../lib/api'
import { useSession } from '../context/SessionContext'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Mode = 'login' | 'register'

export default function Auth() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, login, register, refresh } = useSession()

  const [mode, setMode] = useState<Mode>(() => {
    const state = (location.state as { mode?: Mode } | null)?.mode
    return state === 'register' ? 'register' : 'login'
  })
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [invite, setInvite] = useState('')
  const [msg, setMsg] = useState('')
  const [registerMode, setRegisterMode] = useState<'invite' | 'open' | 'closed'>('invite')
  const [busy, setBusy] = useState(false)

  function next(): string {
    const state = (location.state as { next?: string } | null)?.next
    return state || sessionStorage.getItem('auth_next') || '/profile'
  }

  function finish() {
    sessionStorage.removeItem('auth_next')
    navigate(next(), { replace: true })
  }

  useEffect(() => {
    if (getToken() && user) {
      navigate('/profile', { replace: true })
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
  }, [user, navigate])

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
      await login(username.trim(), password, false)
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

  const showInvite = mode === 'register' && registerMode === 'invite'
  const isLogin = mode === 'login'

  return (
    <main className="auth-page auth-page--with-header">
      <div className="auth-shell">
        <Card className="w-full max-w-sm">
          <CardContent className="flex flex-col gap-5 p-6">
            <div className="flex flex-col items-center gap-2 text-center">
              <span className="text-3xl">📚</span>
              <h1 className="text-xl font-semibold">知舟</h1>
              <p className="text-sm text-muted-foreground">
                {isLogin ? '请登录后继续阅读' : '创建账号后继续阅读'}
              </p>
            </div>

            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label>账号</Label>
                <Input
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>密码</Label>
                <Input
                  type="password"
                  autoComplete={isLogin ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && isLogin) void doLogin()
                  }}
                />
              </div>
              {showInvite && (
                <div className="flex flex-col gap-1.5">
                  <Label>邀请码</Label>
                  <Input
                    autoComplete="off"
                    placeholder="注册时填写"
                    value={invite}
                    onChange={(e) => setInvite(e.target.value)}
                  />
                </div>
              )}
            </div>

            {msg && <p className="text-sm text-destructive">{msg}</p>}
            {registerMode === 'closed' && mode === 'register' && (
              <p className="text-sm text-muted-foreground">注册已关闭，请联系管理员</p>
            )}

            <div className="flex flex-col gap-2">
              <Button disabled={busy} onClick={() => void (isLogin ? doLogin() : doRegister())}>
                {busy ? '处理中…' : isLogin ? '登录' : '创建账号'}
              </Button>
              <div className="flex items-center justify-center gap-1 text-sm">
                <span className="text-muted-foreground">{isLogin ? '没有账号？' : '已有账号？'}</span>
                <Button
                  variant="link"
                  className="px-0"
                  onClick={() => {
                    setMsg('')
                    setMode((m) => (m === 'login' ? 'register' : 'login'))
                  }}
                >
                  {isLogin ? '去注册' : '去登录'}
                </Button>
              </div>
              <div className="text-center">
                <Link to="/" className="text-xs text-muted-foreground underline-offset-4 hover:underline">
                  返回首页
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
