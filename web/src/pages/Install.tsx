import '@/styles/site-branding.css'
/**
 * Install 页 —— 首次安装向导（独立顶层路由，无 Layout）。
 * 三步：① 数据库连接（needsSetup 时）→ ② 可选配置（AI/代理/CORS，可跳过）
 * → ③ 创建首个管理员。挂载时探测 /api/setup/status 决定起始步骤；
 * 安装已完成（有管理员）则跳 /auth。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, CircleAlert } from 'lucide-react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { authApi, setupApi, type SetupDatabaseFields } from '../lib/api'
import { useSession } from '../context/SessionContext'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { Button } from '@/components/ui/button'
import FormField from '@/components/shared/FormField'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { DEFAULT_SITE_BRANDING } from '@shared/site-settings'
import styles from './install.module.css'

type Step = 'database' | 'options' | 'admin'

const STEPS = {
  database: {
    label: '数据库',
    title: '连接数据库',
    description: '填写 PostgreSQL 连接信息。连接成功后，安装向导会初始化数据表。',
    action: '测试并保存',
    pending: '测试连接中…',
  },
  options: {
    label: '可选配置',
    title: '配置 AI 与网络',
    description: '可以先跳过，安装后仍可通过环境变量调整这些设置。',
    action: '保存并继续',
    pending: '保存中…',
  },
  admin: {
    label: '管理员',
    title: '创建管理员',
    description: '设置首个站长账号，创建成功后会进入管理后台。',
    action: '创建管理员',
    pending: '创建中…',
  },
}

export default function Install() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { refresh } = useSession()
  useDocumentTitle('安装向导')

  const requestedPreview = import.meta.env.DEV ? searchParams.get('preview') : null
  const previewStep = requestedPreview === 'options' || requestedPreview === 'admin' ? requestedPreview : null
  const [checkingStatus, setCheckingStatus] = useState(true)
  const [installStep, setInstallStep] = useState<Step>('database')
  const step = previewStep ?? installStep
  const checking = !previewStep && checkingStatus
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const stepHeading = useRef<HTMLHeadingElement>(null)
  const previousStep = useRef<Step | null>(null)

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
    PROXY_BYPASS: '',
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
        setInstallStep(r.needsSetup ? 'database' : 'admin')
      } catch {
        if (alive && !alive()) return
        setMsg('无法连接服务器，请确认 API 已启动后重试')
      }
    },
    [navigate],
  )

  useEffect(() => {
    if (previewStep) return
    let alive = true
    void probeStatus(() => alive).finally(() => {
      if (alive) setCheckingStatus(false)
    })
    return () => {
      alive = false
    }
  }, [previewStep, probeStatus])

  useEffect(() => {
    if (checking) return
    if (previousStep.current !== null && previousStep.current !== step) stepHeading.current?.focus()
    previousStep.current = step
  }, [checking, step])

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
      setInstallStep('options')
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
      setInstallStep('admin')
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

  const currentStep = STEPS[step]

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <Button asChild variant="ghost" className={styles.back}>
          <Link to={previewStep ? '/install' : '/'}>
            <ArrowLeft aria-hidden="true" />
            {previewStep ? '返回安装' : '返回首页'}
          </Link>
        </Button>

        <div className={styles.wizard}>
          <header className={styles.rail}>
            <div className={styles.identity}>
              <div className={styles.brand}>
                <img src={DEFAULT_SITE_BRANDING.logoUrl} width={34} height={34} alt="" className="site-logo" />
                <span>{DEFAULT_SITE_BRANDING.name}</span>
              </div>
              <h1>首次安装</h1>
            </div>

            <ol className={styles.steps} role="list" aria-label="安装步骤">
              {Object.entries(STEPS).map(([id, info], index) => (
                <li key={id} className={styles.step} aria-current={!checking && id === step ? 'step' : undefined}>
                  <span className={styles.stepNumber} aria-hidden="true">{index + 1}</span>
                  <span>{info.label}</span>
                </li>
              ))}
            </ol>
          </header>

          <div className={styles.content}>
            {checking ? (
              <div className={styles.loading} role="status">
                <Spinner size="sm" aria-hidden="true" />
                正在检查安装状态…
              </div>
            ) : (
              <>
                <header className={styles.heading}>
                  {previewStep && <span className={styles.previewNote}>开发预览 · 仅展示表单</span>}
                  <h2 id="install-step-heading" ref={stepHeading} tabIndex={-1}>{currentStep.title}</h2>
                  <p>{currentStep.description}</p>
                </header>

                <form
                  className={styles.form}
                  aria-labelledby="install-step-heading"
                  onSubmit={(event) => {
                    event.preventDefault()
                    if (previewStep || busy) return
                    if (step === 'database') void submitDatabase()
                    else if (step === 'options') void submitOptions(false)
                    else void submitAdmin()
                  }}
                >
                  {step === 'database' && (
                    <div className={styles.fields}>
                      <div className={styles.addressFields}>
                        <FormField htmlFor="db-host" label="主机">
                          <Input placeholder="localhost" value={db.host} onChange={(e) => setDbField('host', e.target.value)} />
                        </FormField>
                        <FormField htmlFor="db-port" label="端口">
                          <Input inputMode="numeric" placeholder="5432" value={db.port} onChange={(e) => setDbField('port', e.target.value)} />
                        </FormField>
                      </div>

                      <div className={styles.fieldColumns}>
                        <FormField htmlFor="db-user" label="用户名">
                          <Input autoComplete="off" value={db.user} onChange={(e) => setDbField('user', e.target.value)} />
                        </FormField>
                        <FormField htmlFor="db-pass" label="密码">
                          <Input
                            type="password"
                            autoComplete="new-password"
                            value={db.password}
                            onChange={(e) => setDbField('password', e.target.value)}
                          />
                        </FormField>
                      </div>

                      <FormField htmlFor="db-name" label="数据库名">
                        <Input placeholder="zhi_zhou" value={db.database} onChange={(e) => setDbField('database', e.target.value)} />
                      </FormField>

                      <div className={styles.sslRow}>
                        <div>
                          <Label htmlFor="db-ssl">启用 SSL</Label>
                          <p id="db-ssl-hint">数据库要求加密连接时开启。</p>
                        </div>
                        <Switch
                          id="db-ssl"
                          aria-describedby="db-ssl-hint"
                          checked={db.ssl}
                          onCheckedChange={(checked) => setDbField('ssl', checked)}
                        />
                      </div>
                    </div>
                  )}

                  {step === 'options' && (
                    <div className={styles.groups}>
                      <section className={styles.fields} aria-labelledby="install-ai-heading">
                        <h3 id="install-ai-heading">AI 文本服务</h3>
                        <FormField htmlFor="ai-base" label="Base URL">
                          <Input
                            placeholder="https://api.example.com/v1"
                            value={opts.AI_TEXT_BASE_URL}
                            onChange={(e) => setOpts((prev) => ({ ...prev, AI_TEXT_BASE_URL: e.target.value }))}
                          />
                        </FormField>
                        <div className={styles.fieldColumns}>
                          <FormField htmlFor="ai-key" label="API Key">
                            <Input
                              type="password"
                              autoComplete="off"
                              value={opts.AI_TEXT_API_KEY}
                              onChange={(e) => setOpts((prev) => ({ ...prev, AI_TEXT_API_KEY: e.target.value }))}
                            />
                          </FormField>
                          <FormField htmlFor="ai-model" label="模型">
                            <Input
                              placeholder="deepseek-v4-flash"
                              value={opts.AI_TEXT_MODEL}
                              onChange={(e) => setOpts((prev) => ({ ...prev, AI_TEXT_MODEL: e.target.value }))}
                            />
                          </FormField>
                        </div>
                      </section>

                      <section className={styles.fields} aria-labelledby="install-network-heading">
                        <h3 id="install-network-heading">网络设置</h3>
                        <FormField htmlFor="proxy-base" label="出站代理地址">
                          <Input
                            placeholder="http://127.0.0.1:7890"
                            value={opts.PROXY_BASE}
                            onChange={(e) => setOpts((prev) => ({ ...prev, PROXY_BASE: e.target.value }))}
                          />
                        </FormField>
                        <div className={styles.fieldColumns}>
                          <FormField htmlFor="proxy-bypass" label="跳过代理（逗号分隔）">
                            <Input
                              placeholder="localhost,127.0.0.1,::1"
                              value={opts.PROXY_BYPASS}
                              onChange={(e) => setOpts((prev) => ({ ...prev, PROXY_BYPASS: e.target.value }))}
                            />
                          </FormField>
                          <FormField htmlFor="cors" label="CORS 来源（逗号分隔）">
                            <Input
                              placeholder="https://read.example.com"
                              value={opts.CORS_ORIGINS}
                              onChange={(e) => setOpts((prev) => ({ ...prev, CORS_ORIGINS: e.target.value }))}
                            />
                          </FormField>
                        </div>
                      </section>
                    </div>
                  )}

                  {step === 'admin' && (
                    <div className={styles.fields}>
                      <FormField htmlFor="admin-user" label="账号" hint="3–32 位小写字母、数字、下划线或短横线。">
                        <Input autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
                      </FormField>

                      <div className={styles.fieldColumns}>
                        <FormField htmlFor="admin-pass" label="密码" hint="至少 8 位。">
                          <Input
                            type="password"
                            autoComplete="new-password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                          />
                        </FormField>
                        <FormField htmlFor="admin-confirm" label="确认密码">
                          <Input
                            type="password"
                            autoComplete="new-password"
                            value={confirm}
                            onChange={(e) => setConfirm(e.target.value)}
                          />
                        </FormField>
                      </div>
                    </div>
                  )}

                  {!previewStep && msg && (
                    <div role="alert" className={styles.error}>
                      <CircleAlert size={17} aria-hidden="true" />
                      <span>{msg}</span>
                    </div>
                  )}

                  <div className={styles.actions}>
                    {step === 'options' && (
                      <Button type="button" variant="ghost" disabled={!!previewStep || busy} onClick={() => void submitOptions(true)}>
                        跳过此步
                      </Button>
                    )}
                    <Button type="submit" className={styles.primaryAction} disabled={!!previewStep || busy} aria-busy={busy}>
                      {busy && <Spinner size="sm" aria-hidden="true" />}
                      {busy ? currentStep.pending : currentStep.action}
                    </Button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
