import { useCallback, useEffect, useState } from 'react'
import { CircleCheck, Cookie, KeyRound, Trash2, UserRound } from 'lucide-react'
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
  return (
    <Badge className={good ? 'bg-success/10 text-success' : bad ? 'bg-destructive/10 text-destructive' : 'bg-warning/10 text-warning'}>
      {STATUS_LABEL[status.status]}
    </Badge>
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

  const disabled = Boolean(busy)

  return (
    <Card className="admin-panel-card po18-account-panel">
      <AdminPanelHeading
        title={
          <span className="admin-panel-title">
            <KeyRound className="size-4" aria-hidden="true" />
            PO18.tw 原作者账号
          </span>
        }
        description="PO18.tw 详情页需要登录。账号信息仅用于服务端访问原作者目录，密码和 Cookie 会加密保存。"
        status={
          <div className="po18-account-status">
            {accountBadge(status)}
            {status?.hasPassword && <Badge variant="secondary">密码已保存</Badge>}
            {status?.hasSession && <Badge variant="secondary">Cookie 已保存</Badge>}
          </div>
        }
      />

      <CardContent className="po18-account-body">
        {/* 主路径：账号密码登录。验证码区紧随登录动作，不落到面板底部。 */}
        <section className="po18-account-section" aria-labelledby="po18-login-title">
          <div className="po18-account-section__head">
            <h4 id="po18-login-title" className="po18-account-section__title">
              <UserRound className="size-4" aria-hidden="true" />
              账号登录
            </h4>
            <p className="po18-account-section__hint">填写 PO18.tw 登录账号；密码留空表示沿用已保存的密码。</p>
          </div>

          <div className="po18-account-fields">
            <div className="grid gap-1.5">
              <Label htmlFor="po18-account-username">账号</Label>
              <Input
                id="po18-account-username"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="PO18.tw 登录账号"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="po18-account-password">密码</Label>
              <Input
                id="po18-account-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={status?.hasPassword ? '留空表示保持原密码' : 'PO18.tw 登录密码'}
              />
            </div>
          </div>

          <div className="po18-account-actions">
            <Button size="sm" disabled={disabled} onClick={() => void saveAccount()}>
              {busy === 'save' ? '保存中…' : '保存账号'}
            </Button>
            <Button variant="secondary" size="sm" disabled={disabled} onClick={() => void getCaptcha()}>
              {busy === 'captcha' ? '读取中…' : '获取验证码'}
            </Button>
            <Button variant="secondary" size="sm" disabled={disabled || !status?.hasSession} onClick={() => void testSession()}>
              {busy === 'test' ? '测试中…' : '测试会话'}
            </Button>
          </div>

          {/* 验证码挑战：紧贴触发它的按钮，出现时无需滚动到面板底部。
              结构与「代理连通性测试」的输入行一致：图片 + 输入框 + 紧邻的提交按钮。
              标签置于整行上方，既保留常驻字段标签，又不让标签高度把图片挤到错位。 */}
          {challenge && (
            <div className="po18-account-captcha" role="group" aria-label="登录验证码">
              {challenge.captchaRequired && (
                <Label htmlFor="po18-account-captcha" className="po18-account-captcha__label">
                  验证码
                </Label>
              )}
              <div className="po18-account-captcha__row">
                {challenge.imageDataUrl ? (
                  <img
                    src={challenge.imageDataUrl}
                    alt="PO18.tw 登录验证码"
                    className="po18-account-captcha__image"
                  />
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
                <Button
                  size="sm"
                  disabled={disabled || (challenge.captchaRequired && !captcha.trim())}
                  onClick={() => void login()}
                >
                  {busy === 'login' ? '登录中…' : '提交登录'}
                </Button>
              </div>
            </div>
          )}
        </section>

        {/* 备路径：Cookie 兜底。与主路径并列会让人以为是二选一，改用次级表面明确从属关系。 */}
        <section className="po18-account-section po18-account-section--fallback" aria-labelledby="po18-fallback-title">
          <div className="po18-account-section__head">
            <h4 id="po18-fallback-title" className="po18-account-section__title">
              <Cookie className="size-4" aria-hidden="true" />
              浏览器 Cookie 兜底
            </h4>
            <p className="po18-account-section__hint">验证码无法通过或自动登录不成功时，在浏览器登录 PO18.tw 后复制 Cookie 粘贴到这里。Cookie 不会回显。</p>
          </div>

          <div className="po18-account-fallback-fields">
            <div className="grid gap-1.5">
              <Label htmlFor="po18-session-cookie">会话 Cookie</Label>
              <Textarea
                id="po18-session-cookie"
                rows={3}
                value={sessionCookie}
                onChange={(e) => setSessionCookie(e.target.value)}
                placeholder={'粘贴 Cookie，例如 PHPSESSID=…; other=…'}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="po18-session-test-url">会话验证链接（可选）</Label>
              <Input
                id="po18-session-test-url"
                value={testSourceUrl}
                onChange={(e) => setTestSourceUrl(e.target.value)}
                placeholder="粘贴有权限的 POPO 目录或章节链接"
              />
              <p className="text-xs leading-5 text-muted-foreground">留空只检查站点可访问；填写链接才能验证实际抓取权限。</p>
            </div>
          </div>

          {/* 操作行独立于字段之外，避免按钮挂在某一列下方造成两列不等高。 */}
          <div className="po18-account-actions">
            <Button variant="outline" size="sm" disabled={disabled || !sessionCookie.trim()} onClick={() => void saveAccount(true)}>
              {busy === 'save' ? '保存中…' : '加密保存 Cookie'}
            </Button>
          </div>
        </section>

        {status?.lastError && (
          <p className="po18-account-error" role="alert">
            {status.lastError}
          </p>
        )}

        {/* 破坏性操作与常规操作隔离，并说明其影响范围。 */}
        <footer className="po18-account-footer">
          <Button variant="ghost" size="sm" disabled={disabled || !status?.configured} onClick={() => void clearAccount()}>
            <Trash2 className="size-3.5" aria-hidden="true" />
            清除账号
          </Button>
          <p className="po18-account-footer__note">仅支持正常登录或手动导入本人已登录会话，不绕过验证码或其他站点安全措施。晋江无需配置账号。</p>
        </footer>
      </CardContent>
    </Card>
  )
}
