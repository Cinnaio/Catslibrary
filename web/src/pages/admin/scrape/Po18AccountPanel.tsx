import AdminFormField from '@/components/admin/AdminFormField'
import AdminStatusBadge from '@/components/admin/AdminStatusBadge'
import { useCallback, useEffect, useState } from 'react'
import { ArrowRight, Check, ChevronDown, CircleCheck, LockKeyhole, Trash2 } from 'lucide-react'
import { useConfirm, useToast } from '../../../components/feedback'
import { scrapeApi, type Po18AccountStatus, type Po18CaptchaResponse } from '../../../lib/api'
import { AdminPanelHeading } from '@/components/admin/AdminWorkspace'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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

function accountBadge(status: Po18AccountStatus | null) {
  if (!status) return <Badge variant="secondary">读取中…</Badge>
  const good = status.status === 'authenticated' || status.status === 'session_saved'
  const bad = status.status === 'invalid' || status.status === 'error'
  return <AdminStatusBadge tone={good ? 'success' : bad ? 'danger' : 'warning'}>{STATUS_LABEL[status.status]}</AdminStatusBadge>
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

  const disabled = Boolean(busy)

  return (
    <Card className="admin-panel-card po18-account-panel">
      <AdminPanelHeading
        title="PO18.tw 原作者账号"
        status={
          <div className="po18-account-status">
            {accountBadge(status)}
            <div className="po18-account-saved">
              {status?.hasPassword && (
                <span>
                  <Check aria-hidden="true" />
                  密码已保存
                </span>
              )}
              {status?.hasSession && (
                <span>
                  <Check aria-hidden="true" />
                  Cookie 已保存
                </span>
              )}
            </div>
          </div>
        }
      />

      <CardContent className="po18-account-body">
        {/* 主路径：账号密码登录。验证码区紧随登录动作，不落到面板底部。 */}
        <section className="po18-account-section" aria-labelledby="po18-login-title">
          <div className="po18-account-section__head">
            <h4 id="po18-login-title" className="po18-account-section__title">
              账号登录
            </h4>
            <p className="po18-account-section__hint">连接你的 PO18.tw 账号，供服务端访问原作者目录。密码留空时，沿用已保存的密码。</p>
          </div>

          <div className="po18-account-login-form">
            <div className="po18-account-fields">
              <AdminFormField label="账号" htmlFor="po18-account-username">
                <Input
                  id="po18-account-username"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="PO18.tw 登录账号"
                />
              </AdminFormField>
              <AdminFormField label="密码" htmlFor="po18-account-password">
                <Input
                  id="po18-account-password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={status?.hasPassword ? '留空表示保持原密码' : 'PO18.tw 登录密码'}
                />
              </AdminFormField>
            </div>

            <div className="po18-account-actions">
              <Button size="sm" disabled={disabled} onClick={() => void saveAccount()}>
                {busy === 'save' ? '保存中…' : '保存账号'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={disabled}
                aria-expanded={Boolean(challenge)}
                aria-controls="po18-account-challenge"
                onClick={() => void getCaptcha()}
              >
                {busy === 'captcha' ? '读取中…' : '获取验证码'}
              </Button>
              <Button variant="ghost" size="sm" disabled={disabled || !status?.hasSession} onClick={() => void testSession()}>
                {busy === 'test' ? '测试中…' : '测试会话'}
                <ArrowRight className="size-3.5" aria-hidden="true" />
              </Button>
            </div>

            {/* 验证码挑战：紧贴触发它的按钮，出现时无需滚动到面板底部。
              图片、输入框和提交按钮保持同行，避免验证码出现后需要跳离当前操作。
              标签置于整行上方，既保留常驻字段标签，又不让标签高度把图片挤到错位。 */}
            {challenge && (
              <div id="po18-account-challenge" className="po18-account-captcha" role="group" aria-label="登录验证码">
                {challenge.captchaRequired && (
                  <Label htmlFor="po18-account-captcha" className="po18-account-captcha__label">
                    验证码
                  </Label>
                )}
                <div className="po18-account-captcha__row">
                  {challenge.imageDataUrl ? (
                    <img src={challenge.imageDataUrl} alt="PO18.tw 登录验证码" className="po18-account-captcha__image" />
                  ) : (
                    <span className="po18-account-captcha__note">
                      <CircleCheck className="size-3.5 shrink-0" aria-hidden="true" />
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
                      className="po18-account-captcha__input"
                    />
                  )}
                  <Button size="sm" disabled={disabled || (challenge.captchaRequired && !captcha.trim())} onClick={() => void login()}>
                    {busy === 'login' ? '登录中…' : '提交登录'}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* 默认展开以保留现有字段的可发现性；收起时仍保留输入与验证链接。 */}
        <details className="po18-account-fallback" open>
          <summary className="po18-account-fallback__summary">
            <LockKeyhole className="size-4" aria-hidden="true" />
            <span className="po18-account-section__title">导入浏览器 Cookie</span>
            <span className="po18-account-fallback__aside">自动登录不成功时使用</span>
            <ChevronDown className="po18-account-fallback__chevron" aria-hidden="true" />
          </summary>
          <div className="po18-account-fallback__content">
            <p className="po18-account-section__hint">
              验证码无法通过或自动登录不成功时，在浏览器登录 PO18.tw 后复制 Cookie 粘贴到这里。Cookie 保存后不会回显；密码和 Cookie 均由服务端加密存储。
            </p>
            <div className="po18-account-fallback-fields">
              <AdminFormField label="会话 Cookie" htmlFor="po18-session-cookie">
                <Textarea
                  id="po18-session-cookie"
                  rows={3}
                  value={sessionCookie}
                  onChange={(e) => setSessionCookie(e.target.value)}
                  placeholder={'粘贴 Cookie，例如 PHPSESSID=…; other=…'}
                />
              </AdminFormField>
              <AdminFormField label="会话验证链接（可选）" htmlFor="po18-session-test-url">
                <Input
                  id="po18-session-test-url"
                  aria-describedby="po18-session-test-hint"
                  value={testSourceUrl}
                  onChange={(e) => setTestSourceUrl(e.target.value)}
                  placeholder="粘贴有权限的 POPO 目录或章节链接"
                />
                <p id="po18-session-test-hint" className="admin-form-field__hint">
                  留空只检查站点可访问；填写链接才能验证实际抓取权限。
                </p>
              </AdminFormField>
            </div>

            {/* 操作行独立于字段之外，避免按钮挂在某一列下方造成两列不等高。 */}
            <div className="po18-account-actions">
              <Button variant="outline" size="sm" disabled={disabled || !sessionCookie.trim()} onClick={() => void saveAccount(true)}>
                {busy === 'save' ? '保存中…' : '加密保存 Cookie'}
              </Button>
              <span className="po18-account-actions__hint">导入后，使用上方“测试会话”检查可用性。</span>
            </div>
          </div>
        </details>

        {status?.lastError && (
          <p className="po18-account-error" role="alert">
            {status.lastError}
          </p>
        )}

        {/* 破坏性操作与常规操作隔离，并说明其影响范围。 */}
        <footer className="po18-account-footer">
          <p className="po18-account-footer__note">仅支持正常登录或手动导入本人已登录会话，不绕过验证码或其他站点安全措施。晋江无需配置账号。</p>
          <Button variant="ghost" size="sm" disabled={disabled || !status?.configured} onClick={() => void clearAccount()}>
            <Trash2 className="size-3.5" aria-hidden="true" />
            清除账号
          </Button>
        </footer>
      </CardContent>
    </Card>
  )
}
