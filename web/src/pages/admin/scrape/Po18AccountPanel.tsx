import FormField from "@/components/shared/FormField"
import { useCallback, useEffect, useState } from 'react'
import { ArrowRight, Check, ChevronDown, CircleCheck, KeyRound, LockKeyhole, RefreshCw, ShieldAlert, ShieldCheck, Trash2 } from 'lucide-react'
import { useConfirm, useToast } from '../../../components/feedback'
import { scrapeApi, type Po18AccountStatus, type Po18CaptchaResponse } from '../../../lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

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
      return '已保存浏览器 Cookie 会话 · 可直接进行限制目录与原作者页面抓取'
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
      return '未连接原作者账号 · 当前仅能抓取公开预览章节；配置后可解锁完整原作者内容'
  }
}

function AccountClaudeBadge({ status }: { status: Po18AccountStatus | null }) {
  if (!status) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
        <span className="size-1.5 rounded-full bg-muted-foreground/50 animate-pulse" />
        读取中…
      </span>
    )
  }
  const isHealthy = status.status === 'authenticated' || status.status === 'session_saved'
  const isWarning = status.status === 'needs_captcha' || status.status === 'credentials_saved'
  const isDanger = status.status === 'invalid' || status.status === 'error'

  if (isHealthy) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400 border border-emerald-200/80 dark:border-emerald-800/60 shadow-2xs">
        <span className="relative flex size-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full size-2 bg-emerald-500" />
        </span>
        {STATUS_LABEL[status.status]}
      </span>
    )
  }

  if (isWarning) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-400 border border-amber-200/80 dark:border-amber-800/60 shadow-2xs">
        <span className="size-2 rounded-full bg-amber-500" />
        {STATUS_LABEL[status.status]}
      </span>
    )
  }

  if (isDanger) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-400 border border-rose-200/80 dark:border-rose-800/60 shadow-2xs">
        <span className="size-2 rounded-full bg-rose-500" />
        {STATUS_LABEL[status.status]}
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-400 border border-stone-200 dark:border-stone-700">
      <span className="size-2 rounded-full bg-stone-400" />
      {STATUS_LABEL[status.status]}
    </span>
  )
}

export default function Po18AccountPanel({ active }: { active: boolean }) {
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const [status, setStatus] = useState<Po18AccountStatus | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [sessionCookie, setSessionCookie] = useState('')
  const [testSourceUrl, setTestSourceUrl] = useState('')
  const [captcha, setCaptcha] = useState('')
  const [challenge, setChallenge] = useState<Po18CaptchaResponse | null>(null)
  const [busy, setBusy] = useState<'load' | 'save' | 'captcha' | 'login' | 'test' | 'clear' | ''>('')

  const loadStatus = useCallback(async () => {
    setBusy('load')
    try {
      const next = await scrapeApi.po18Account()
      setStatus(next)
      if (next.username) setUsername(next.username)
    } catch (err) {
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
    if (!password.trim() && !sessionCookie.trim() && !status?.configured) {
      toast('请填写密码，或粘贴已经登录的 Cookie', 'error')
      return
    }
    setBusy('save')
    try {
      const next = await scrapeApi.po18AccountSave({
        username: username.trim(),
        ...(password.trim() ? { password: password.trim() } : {}),
        ...(withSession && sessionCookie.trim() ? { sessionCookie: sessionCookie.trim() } : {}),
      })
      setStatus(next)
      setPassword('')
      if (withSession) setSessionCookie('')
      toast(withSession ? 'PO18.tw Cookie 已加密保存' : 'PO18.tw 账号已加密保存', 'success')
    } catch (err) {
      toast((err as Error).message || 'PO18.tw 账号保存失败', 'error')
    } finally {
      setBusy('')
    }
  }

  async function getCaptcha() {
    setBusy('captcha')
    try {
      const next = await scrapeApi.po18AccountCaptcha()
      setChallenge(next)
      setCaptcha('')
      toast(next.captchaRequired ? '验证码已获取，请填写后登录' : '登录页已获取，可以直接尝试登录', 'success')
    } catch (err) {
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
    setBusy('login')
    try {
      const next = await scrapeApi.po18AccountLogin(challenge.challengeId, captcha.trim())
      setStatus(next)
      setChallenge(null)
      setCaptcha('')
      toast(next.message || 'PO18.tw 登录成功', 'success')
    } catch (err) {
      toast((err as Error).message || 'PO18.tw 登录失败', 'error')
    } finally {
      setBusy('')
    }
  }

  async function testSession() {
    setBusy('test')
    try {
      const next = await scrapeApi.po18AccountTest(testSourceUrl.trim() || undefined)
      setStatus(next)
      toast(next.message || 'PO18.tw 会话可用', 'success')
    } catch (err) {
      toast((err as Error).message || 'PO18.tw 会话测试失败', 'error')
      void loadStatus()
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
      void loadStatus()
    } catch (err) {
      toast((err as Error).message || 'PO18.tw 账号清除失败', 'error')
    } finally {
      setBusy('')
    }
  }

  const [collapsed, setCollapsed] = useState(true)
  const disabled = Boolean(busy)

  const isHealthy = status?.status === 'authenticated' || status?.status === 'session_saved'
  const isWarning = status?.status === 'needs_captcha' || status?.status === 'credentials_saved'
  const isDanger = status?.status === 'invalid' || status?.status === 'error'

  return (
    <div className={`scrape-intake scrape-account-card ${collapsed ? 'is-collapsed' : 'is-expanded'}`}>
      <div className="scrape-intake-card__head">
        <div className="scrape-intake-card__title-group">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h2 className="scrape-intake-card__title">
              PO18 原作者凭据
            </h2>
            <AccountClaudeBadge status={status} />
            {status?.username && (
              <span className="text-xs px-2 py-0.5 rounded-full font-mono bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 border border-stone-200/80 dark:border-stone-700/80">
                @{status.username}
              </span>
            )}
            <div className="hidden md:flex items-center gap-2 text-xs text-muted-foreground ml-1">
              {status?.hasPassword && (
                <span className="inline-flex items-center gap-0.5 text-stone-500 dark:text-stone-400">
                  <Check className="size-3 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                  密码已存
                </span>
              )}
              {status?.hasSession && (
                <span className="inline-flex items-center gap-0.5 text-stone-500 dark:text-stone-400">
                  <Check className="size-3 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                  Cookie 活跃
                </span>
              )}
            </div>
          </div>
          <p className="scrape-intake-card__subtitle">
            用于同步原作者私密章节与付费目录校验，密码与 Cookie 均由服务端加密存储。
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {status?.hasSession && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 rounded-lg text-xs font-medium px-3 border-[#dedcd5] hover:border-[#d97757]/50 hover:bg-[#faf6f0] dark:border-[#38352f] dark:hover:bg-[#25231f] transition-all"
              disabled={disabled}
              onClick={() => void testSession()}
            >
              <RefreshCw className={`size-3.5 mr-1.5 ${busy === 'test' ? 'animate-spin text-[#D97757]' : 'text-muted-foreground'}`} aria-hidden="true" />
              {busy === 'test' ? '测试中…' : '测试会话'}
            </Button>
          )}

          <Button
            variant="outline"
            size="sm"
            className="h-8 rounded-lg text-xs font-medium px-3 border-[#dedcd5] hover:border-[#d97757]/50 hover:bg-[#faf6f0] dark:border-[#38352f] dark:hover:bg-[#25231f] transition-all"
            onClick={() => setCollapsed(!collapsed)}
          >
            <span>{collapsed ? '配置凭据' : '收起配置'}</span>
            <ChevronDown className={`size-3.5 ml-1.5 transition-transform duration-200 ${collapsed ? '' : 'rotate-180'}`} aria-hidden="true" />
          </Button>
        </div>
      </div>

      {!collapsed && (
        <div className="po18-account-expand-wrapper animate-in fade-in-50 duration-200">
          <div className="po18-claude-expand-content pt-4 border-t border-border/70 mt-2">
            {/* 主路径：账号密码登录 */}
          <section className="po18-account-section" aria-labelledby="po18-login-title">
            <div className="po18-account-section__head">
              <h4 id="po18-login-title" className="po18-account-section__title">
                账号登录
              </h4>
              <p className="po18-account-section__hint">
                连接你的 PO18.tw 账号，供服务端访问原作者目录。密码留空时，沿用已加密保存的密码。
              </p>
            </div>

            <div className="po18-account-login-form">
              <div className="po18-account-fields">
                <FormField label="账号" htmlFor="po18-account-username">
                  <Input
                    id="po18-account-username"
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="PO18.tw 登录账号"
                    className="po18-claude-input"
                  />
                </FormField>
                <FormField label="密码" htmlFor="po18-account-password">
                  <Input
                    id="po18-account-password"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={status?.hasPassword ? '留空表示保持原密码' : 'PO18.tw 登录密码'}
                    className="po18-claude-input"
                  />
                </FormField>
              </div>

              <div className="po18-account-actions">
                <Button
                  size="sm"
                  disabled={disabled}
                  className="po18-claude-primary-btn"
                  onClick={() => void saveAccount()}
                >
                  {busy === 'save' ? '保存中…' : '保存账号'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="po18-claude-secondary-btn"
                  disabled={disabled}
                  aria-expanded={Boolean(challenge)}
                  aria-controls="po18-account-challenge"
                  onClick={() => void getCaptcha()}
                >
                  {busy === 'captcha' ? '读取中…' : '获取验证码'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="po18-claude-ghost-btn"
                  disabled={disabled || !status?.hasSession}
                  onClick={() => void testSession()}
                >
                  {busy === 'test' ? '测试中…' : '测试会话'}
                  <ArrowRight className="size-3.5 ml-1" aria-hidden="true" />
                </Button>
              </div>

              {/* 验证码挑战 */}
              {challenge && (
                <div id="po18-account-challenge" className="po18-account-captcha p-3 rounded-xl bg-stone-50 dark:bg-stone-900 border border-border" role="group" aria-label="登录验证码">
                  {challenge.captchaRequired && (
                    <Label htmlFor="po18-account-captcha" className="po18-account-captcha__label text-xs font-medium text-foreground">
                      验证码
                    </Label>
                  )}
                  <div className="po18-account-captcha__row">
                    {challenge.imageDataUrl ? (
                      <img src={challenge.imageDataUrl} alt="PO18.tw 登录验证码" className="po18-account-captcha__image rounded-lg shadow-xs" />
                    ) : (
                      <span className="po18-account-captcha__note">
                        <CircleCheck className="size-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
                        未检测到图片验证码，可直接尝试登录。
                      </span>
                    )}
                    {challenge.captchaRequired && (
                      <Input
                        id="po18-account-captcha"
                        value={captcha}
                        onChange={(e) => setCaptcha(e.target.value)}
                        placeholder="填写图片中的字符"
                        autoComplete="off"
                        className="po18-claude-input po18-account-captcha__input"
                      />
                    )}
                    <Button
                      size="sm"
                      className="po18-claude-primary-btn"
                      disabled={disabled || (challenge.captchaRequired && !captcha.trim())}
                      onClick={() => void login()}
                    >
                      {busy === 'login' ? '登录中…' : '提交登录'}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* 导入浏览器 Cookie 备用路径 */}
          <details className="po18-account-fallback" open>
            <summary className="po18-account-fallback__summary">
              <LockKeyhole className="size-4 text-[#D97757]" aria-hidden="true" />
              <span className="po18-account-section__title">导入浏览器 Cookie</span>
              <span className="po18-account-fallback__aside">自动登录不成功时使用</span>
              <ChevronDown className="po18-account-fallback__chevron" aria-hidden="true" />
            </summary>
            <div className="po18-account-fallback__content">
              <p className="po18-account-section__hint">
                验证码无法通过或自动登录不成功时，在浏览器登录 PO18.tw 后复制 Cookie 粘贴到这里。Cookie 保存后不会回显；密码和 Cookie 均由服务端加密存储。
              </p>
              <div className="po18-account-fallback-fields">
                <FormField label="会话 Cookie" htmlFor="po18-session-cookie">
                  <Textarea
                    id="po18-session-cookie"
                    rows={3}
                    value={sessionCookie}
                    onChange={(e) => setSessionCookie(e.target.value)}
                    placeholder={'粘贴 Cookie，例如 PHPSESSID=…; other=…'}
                    className="po18-claude-textarea font-mono text-xs"
                  />
                </FormField>
                <FormField label="会话验证链接（可选）" htmlFor="po18-session-test-url">
                  <Input
                    id="po18-session-test-url"
                    aria-describedby="po18-session-test-hint"
                    value={testSourceUrl}
                    onChange={(e) => setTestSourceUrl(e.target.value)}
                    placeholder="粘贴有权限的 POPO 目录或章节链接"
                    className="po18-claude-input"
                  />
                  <p id="po18-session-test-hint" className="form-field__hint">
                    留空只检查站点可访问；填写链接才能验证实际抓取权限。
                  </p>
                </FormField>
              </div>

              <div className="po18-account-actions">
                <Button
                  variant="outline"
                  size="sm"
                  className="po18-claude-secondary-btn"
                  disabled={disabled || !sessionCookie.trim()}
                  onClick={() => void saveAccount(true)}
                >
                  {busy === 'save' ? '保存中…' : '加密保存 Cookie'}
                </Button>
                <span className="po18-account-actions__hint">导入后，使用上方“测试会话”检查可用性。</span>
              </div>
            </div>
          </details>

          {status?.lastError && (
            <p className="po18-account-error rounded-xl" role="alert">
              {status.lastError}
            </p>
          )}

          {/* 底部保护与清除 */}
          <footer className="po18-account-footer">
            <p className="po18-account-footer__note">
              仅支持正常登录或手动导入本人已登录会话，不绕过验证码或其他站点安全措施。晋江无需配置账号。
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="po18-claude-clear-btn"
              disabled={disabled || !status?.configured}
              onClick={() => void clearAccount()}
            >
              <Trash2 className="size-3.5 mr-1" aria-hidden="true" />
              清除账号
            </Button>
          </footer>
        </div>
      </div>
      )}
    </div>
  )
}

