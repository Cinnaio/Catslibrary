import { useCallback, useEffect, useState } from 'react'
import { useConfirm, useToast } from '../../../components/feedback'
import { scrapeApi, type Po18AccountStatus, type Po18CaptchaResponse } from '../../../lib/api'
import AdminPanel from '@/components/admin/AdminPanel'
import { Badge } from '@/components/ui/badge'
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
      const next = await scrapeApi.po18AccountTest()
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
    <AdminPanel
      title="PO18.tw 原作者账号"
      description="PO18.tw 详情页需要登录。账号信息仅用于服务端访问原作者目录，密码和 Cookie 会加密保存。"
      className="po18-account-panel"
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">当前状态</span>
            {accountBadge(status)}
            {status?.hasPassword && <Badge variant="secondary">密码已保存</Badge>}
            {status?.hasSession && <Badge variant="secondary">Cookie 已保存</Badge>}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="po18-account-username">账号</Label>
              <Input
                id="po18-account-username"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="PO18.tw 登录账号"
              />
            </div>
            <div className="space-y-1.5">
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
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={disabled} onClick={() => void saveAccount()}>
              {busy === 'save' ? '保存中…' : '保存账号'}
            </Button>
            <Button variant="secondary" size="sm" disabled={disabled} onClick={() => void getCaptcha()}>
              {busy === 'captcha' ? '读取中…' : '获取验证码'}
            </Button>
            <Button variant="secondary" size="sm" disabled={disabled || !status?.hasSession} onClick={() => void testSession()}>
              {busy === 'test' ? '测试中…' : '测试会话'}
            </Button>
            <Button variant="ghost" size="sm" disabled={disabled || !status?.configured} onClick={() => void clearAccount()}>
              清除账号
            </Button>
          </div>
          {status?.lastError && <p className="text-sm text-destructive">{status.lastError}</p>}
        </div>

        <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
          <div>
            <p className="text-sm font-medium">浏览器 Cookie 兜底</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              如果登录页有验证码，或自动登录不成功，可以在浏览器登录 PO18.tw 后复制 Cookie 粘贴到这里。Cookie 不会回显。
            </p>
          </div>
          <Textarea
            rows={3}
            value={sessionCookie}
            onChange={(e) => setSessionCookie(e.target.value)}
            placeholder="粘贴 Cookie，例如 PHPSESSID=…; other=…"
            aria-label="PO18.tw 会话 Cookie"
          />
          <Button variant="outline" size="sm" disabled={disabled || !sessionCookie.trim()} onClick={() => void saveAccount(true)}>
            {busy === 'save' ? '保存中…' : '加密保存 Cookie'}
          </Button>
        </div>
      </div>

      {challenge && (
        <div className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-dashed border-border bg-background p-3">
          {challenge.imageDataUrl ? (
            <img src={challenge.imageDataUrl} alt="PO18.tw 登录验证码" className="h-10 min-w-24 rounded border border-border bg-white object-contain" />
          ) : (
            <span className="text-sm text-muted-foreground">当前登录页未检测到图片验证码</span>
          )}
          {challenge.captchaRequired && (
            <div className="min-w-40 flex-1 space-y-1.5">
              <Label htmlFor="po18-account-captcha">验证码</Label>
              <Input id="po18-account-captcha" value={captcha} onChange={(e) => setCaptcha(e.target.value)} placeholder="填写图片中的验证码" />
            </div>
          )}
          <Button size="sm" disabled={disabled || (challenge.captchaRequired && !captcha.trim())} onClick={() => void login()}>
            {busy === 'login' ? '登录中…' : '提交登录'}
          </Button>
        </div>
      )}

      <p className="mt-3 text-xs leading-5 text-muted-foreground">仅支持正常登录或手动导入本人已登录会话，不绕过验证码或其他站点安全措施。晋江无需配置账号。</p>
    </AdminPanel>
  )
}
