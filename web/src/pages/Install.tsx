/**
 * Install 页 —— 首个管理员创建（bootstrap）。独立顶层路由，无 Layout。
 * 挂载时查 bootstrap 状态：若已有管理员则跳 /auth；创建成功后跳 /admin。
 */
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { authApi } from '../lib/api'
import { useSession } from '../context/SessionContext'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function Install() {
  const navigate = useNavigate()
  const { refresh } = useSession()

  const [checking, setChecking] = useState(true)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    void authApi
      .bootstrapStatus()
      .then((r) => {
        if (alive && !r.needsBootstrap) navigate('/auth', { replace: true })
      })
      .catch(() => {
        /* 探测失败：留在本页，提交时再报错 */
      })
      .finally(() => {
        if (alive) setChecking(false)
      })
    return () => {
      alive = false
    }
  }, [navigate])

  async function submit() {
    setBusy(true)
    setMsg('')
    try {
      const name = username.trim()
      if (name.length < 2) {
        setMsg('请输入至少 2 个字符的账号')
        return
      }
      if (password.length < 8) {
        setMsg('密码至少 8 位')
        return
      }
      if (password !== confirm) {
        setMsg('两次输入的密码不一致')
        return
      }
      await authApi.bootstrapAdmin(name, password)
      await refresh()
      navigate('/admin', { replace: true })
    } catch (err) {
      setMsg((err as Error).message || '创建管理员失败')
    } finally {
      setBusy(false)
    }
  }

  if (checking) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background">
        <div className="size-8 animate-spin rounded-full border-2 border-border border-t-primary" />
      </div>
    )
  }

  return (
    <main className="auth-page">
      <div className="auth-shell">
        <Card className="w-full max-w-sm">
          <CardContent className="flex flex-col gap-5 p-6">
            <div className="flex flex-col items-center gap-2 text-center">
              <span className="text-3xl">📚</span>
              <h1 className="text-xl font-semibold">知舟 · 首次安装</h1>
              <p className="text-sm text-muted-foreground">创建站长管理员账号，设置完成后即可登录管理后台。</p>
            </div>

            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label>账号</Label>
                <Input
                  autoComplete="username"
                  placeholder="管理员账号"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>密码</Label>
                <Input
                  type="password"
                  autoComplete="new-password"
                  placeholder="至少 8 位"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>确认密码</Label>
                <Input
                  type="password"
                  autoComplete="new-password"
                  placeholder="再次输入密码"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void submit()
                  }}
                />
              </div>
            </div>

            {msg && <p className="text-sm text-destructive">{msg}</p>}

            <div className="flex flex-col gap-2">
              <Button disabled={busy} onClick={() => void submit()}>
                {busy ? '创建中…' : '创建管理员'}
              </Button>
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
