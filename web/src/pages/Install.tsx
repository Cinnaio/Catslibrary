/**
 * Install 页 —— 首次安装向导（独立顶层路由，无 Layout）。
 * 三步：① 数据库连接（needsSetup 时）→ ② 可选配置（AI/代理/CORS，可跳过）
 * → ③ 创建首个管理员。挂载时探测 /api/setup/status 决定起始步骤；
 * 安装已完成（有管理员）则跳 /auth。
 */
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { authApi, setupApi, type SetupDatabaseFields } from '../lib/api'
import { useSession } from '../context/SessionContext'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

type Step = 'database' | 'options' | 'admin'

const STEPS: Array<{ id: Step; label: string }> = [
  { id: 'database', label: '数据库' },
  { id: 'options', label: '可选配置' },
  { id: 'admin', label: '管理员' },
]

export default function Install() {
  const navigate = useNavigate()
  const { refresh } = useSession()

  const [checking, setChecking] = useState(true)
  const [step, setStep] = useState<Step>('database')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  // 步骤①：数据库分字段
  const [db, setDb] = useState<SetupDatabaseFields>({
    host: 'localhost',
    port: '5432',
    user: '',
    password: '',
    database: 'zhi_zhou',
    ssl: false,
  })

  // 步骤②：可选项
  const [opts, setOpts] = useState({
    AI_TEXT_BASE_URL: '',
    AI_TEXT_API_KEY: '',
    AI_TEXT_MODEL: '',
    PROXY_BASE: '',
    CORS_ORIGINS: '',
  })

  // 步骤③：管理员
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')

  const probeStatus = useCallback(
    async (alive?: () => boolean) => {
      try {
        const r = await setupApi.status()
        if (alive && !alive()) return
        if (!r.needsSetup && !r.needsBootstrap) {
          navigate('/auth', { replace: true })
          return
        }
        setMsg('')
        setStep(r.needsSetup ? 'database' : 'admin')
      } catch {
        if (alive && !alive()) return
        setMsg('无法连接服务器，请确认 API 已启动后重试')
      }
    },
    [navigate],
  )

  useEffect(() => {
    let alive = true
    void probeStatus(() => alive).finally(() => {
      if (alive) setChecking(false)
    })
    return () => {
      alive = false
    }
  }, [probeStatus])

  function setDbField<K extends keyof SetupDatabaseFields>(key: K, value: SetupDatabaseFields[K]) {
    setDb((prev) => ({ ...prev, [key]: value }))
  }

  async function submitDatabase() {
    setBusy(true)
    setMsg('')
    try {
      if (!db.host.trim()) {
        setMsg('请输入数据库主机')
        return
      }
      if (!db.user.trim()) {
        setMsg('请输入数据库用户名')
        return
      }
      if (!db.database.trim()) {
        setMsg('请输入数据库名')
        return
      }
      await setupApi.database({ ...db, host: db.host.trim(), user: db.user.trim(), database: db.database.trim() })
      setStep('options')
    } catch (err) {
      // 409「数据库已配置」：多为 env 已预设或另一端已完成本步 —— 重新探测并自动前进
      if ((err as { status?: number }).status === 409) {
        await probeStatus()
        return
      }
      setMsg((err as Error).message || '数据库配置失败')
    } finally {
      setBusy(false)
    }
  }

  async function submitOptions(skip: boolean) {
    setBusy(true)
    setMsg('')
    try {
      if (!skip) {
        const patch = Object.fromEntries(Object.entries(opts).filter(([, v]) => v.trim()))
        if (Object.keys(patch).length > 0) await setupApi.options(patch)
      }
      setStep('admin')
    } catch (err) {
      setMsg((err as Error).message || '保存可选配置失败')
    } finally {
      setBusy(false)
    }
  }

  async function submitAdmin() {
    setBusy(true)
    setMsg('')
    try {
      const name = username.trim()
      if (!/^[a-z0-9_-]{3,32}$/.test(name)) {
        setMsg('账号需为 3-32 位小写字母、数字、下划线或短横线')
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

  const stepIndex = STEPS.findIndex((s) => s.id === step)

  return (
    <main className="auth-page">
      <div className="auth-shell">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col gap-5 p-6">
            <div className="flex flex-col items-center gap-2 text-center">
              <span className="text-3xl">📚</span>
              <h1 className="text-xl font-semibold">知舟 · 首次安装</h1>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                {STEPS.map((s, i) => (
                  <span key={s.id} className="flex items-center gap-1.5">
                    {i > 0 && <span aria-hidden>→</span>}
                    <span className={i === stepIndex ? 'font-semibold text-primary' : i < stepIndex ? 'text-primary/60' : ''}>
                      {i + 1}. {s.label}
                    </span>
                  </span>
                ))}
              </div>
            </div>

            {step === 'database' && (
              <form
                className="flex flex-col gap-5"
                onSubmit={(e) => {
                  e.preventDefault()
                  void submitDatabase()
                }}
              >
                <p className="text-sm text-muted-foreground">
                  填写 PostgreSQL 连接信息。保存后会自动测试连接并初始化数据表。
                </p>
                <div className="flex flex-col gap-4">
                  <div className="grid grid-cols-[1fr_110px] gap-3">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="db-host">主机</Label>
                      <Input id="db-host" placeholder="localhost" value={db.host} onChange={(e) => setDbField('host', e.target.value)} />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="db-port">端口</Label>
                      <Input id="db-port" inputMode="numeric" placeholder="5432" value={db.port} onChange={(e) => setDbField('port', e.target.value)} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="db-user">用户名</Label>
                      <Input id="db-user" autoComplete="off" value={db.user} onChange={(e) => setDbField('user', e.target.value)} />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="db-pass">密码</Label>
                      <Input id="db-pass" type="password" autoComplete="new-password" value={db.password} onChange={(e) => setDbField('password', e.target.value)} />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="db-name">数据库名</Label>
                    <Input id="db-name" placeholder="zhi_zhou" value={db.database} onChange={(e) => setDbField('database', e.target.value)} />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="db-ssl" className="cursor-pointer">
                      启用 SSL
                    </Label>
                    <Switch id="db-ssl" checked={db.ssl} onCheckedChange={(v) => setDbField('ssl', v)} />
                  </div>
                </div>
                {msg && (
                  <p role="alert" className="text-sm text-destructive">
                    {msg}
                  </p>
                )}
                <Button type="submit" disabled={busy}>
                  {busy ? '测试连接中…' : '测试并保存'}
                </Button>
              </form>
            )}

            {step === 'options' && (
              <form
                className="flex flex-col gap-5"
                onSubmit={(e) => {
                  e.preventDefault()
                  void submitOptions(false)
                }}
              >
                <p className="text-sm text-muted-foreground">
                  可选配置，均可留空跳过，安装后也能经环境变量调整。
                </p>
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="ai-base">AI 文本 Base URL</Label>
                    <Input id="ai-base" placeholder="https://api.example.com/v1" value={opts.AI_TEXT_BASE_URL} onChange={(e) => setOpts((p) => ({ ...p, AI_TEXT_BASE_URL: e.target.value }))} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="ai-key">AI API Key</Label>
                      <Input id="ai-key" type="password" autoComplete="off" value={opts.AI_TEXT_API_KEY} onChange={(e) => setOpts((p) => ({ ...p, AI_TEXT_API_KEY: e.target.value }))} />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="ai-model">AI 模型</Label>
                      <Input id="ai-model" placeholder="deepseek-v4-flash" value={opts.AI_TEXT_MODEL} onChange={(e) => setOpts((p) => ({ ...p, AI_TEXT_MODEL: e.target.value }))} />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="proxy-base">抓取代理 Base</Label>
                    <Input id="proxy-base" placeholder="http://127.0.0.1:7890" value={opts.PROXY_BASE} onChange={(e) => setOpts((p) => ({ ...p, PROXY_BASE: e.target.value }))} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="cors">CORS 来源（逗号分隔）</Label>
                    <Input id="cors" placeholder="https://read.example.com" value={opts.CORS_ORIGINS} onChange={(e) => setOpts((p) => ({ ...p, CORS_ORIGINS: e.target.value }))} />
                  </div>
                </div>
                {msg && (
                  <p role="alert" className="text-sm text-destructive">
                    {msg}
                  </p>
                )}
                <div className="flex flex-col gap-2">
                  <Button type="submit" disabled={busy}>
                    {busy ? '保存中…' : '保存并继续'}
                  </Button>
                  <Button type="button" variant="ghost" disabled={busy} onClick={() => void submitOptions(true)}>
                    跳过此步
                  </Button>
                </div>
              </form>
            )}

            {step === 'admin' && (
              <form
                className="flex flex-col gap-5"
                onSubmit={(e) => {
                  e.preventDefault()
                  void submitAdmin()
                }}
              >
                <p className="text-sm text-muted-foreground">创建站长管理员账号，完成后即可登录管理后台。</p>
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="admin-user">账号</Label>
                    <Input id="admin-user" autoComplete="username" placeholder="3-32 位小写字母/数字/_/-" value={username} onChange={(e) => setUsername(e.target.value)} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="admin-pass">密码</Label>
                    <Input id="admin-pass" type="password" autoComplete="new-password" placeholder="至少 8 位" value={password} onChange={(e) => setPassword(e.target.value)} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="admin-confirm">确认密码</Label>
                    <Input
                      id="admin-confirm"
                      type="password"
                      autoComplete="new-password"
                      placeholder="再次输入密码"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                    />
                  </div>
                </div>
                {msg && (
                  <p role="alert" className="text-sm text-destructive">
                    {msg}
                  </p>
                )}
                <Button type="submit" disabled={busy}>
                  {busy ? '创建中…' : '创建管理员'}
                </Button>
              </form>
            )}

            <div className="text-center">
              <Link to="/" className="text-xs text-muted-foreground underline-offset-4 hover:underline">
                返回首页
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
