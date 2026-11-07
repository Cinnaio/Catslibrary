import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { ChevronDown, MailCheck, RefreshCw } from 'lucide-react'
import type { MailSettings as Settings, MailSettingsInput } from '@shared/mail-settings'
import { authApi } from '@/lib/api'
import { useToast } from '@/components/feedback'
import AdminStatusBadge from '@/components/admin/AdminStatusBadge'
import AdminFloatingDock from '@/components/admin/AdminFloatingDock'
import FormField from '@/components/shared/FormField'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { ErrorState, InlineError, LoadingState } from '@/components/shared/AsyncStates'
import { PanelHeading } from '@/components/shared/PanelHeading'
import styles from './mail-settings.module.css'

const draftFrom = (value: Settings): MailSettingsInput => ({ revision: value.revision, host: value.host, port: value.port,
  security: value.security, username: value.username, password: '', clearPassword: false, from: value.from, publicOrigin: value.publicOrigin })

export default function MailSettings({ active = true, onBusyChange }: { active?: boolean; onBusyChange?: (busy: boolean) => void }) {
  const titleId = useId()
  const deliveryTitleId = useId()
  const clearId = useId()
  const { toast } = useToast()
  const [status, setStatus] = useState<Settings | null>(null)
  const [draft, setDraft] = useState<MailSettingsInput | null>(null)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [testMessage, setTestMessage] = useState('')
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [readAt, setReadAt] = useState<Date | null>(null)
  const revision = useRef(0)
  const inFlight = useRef(false)
  const dirty = Boolean(status && draft && JSON.stringify(draft) !== JSON.stringify(draftFrom(status)))
  const load = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    const request = ++revision.current
    setLoading(true); setError(''); setActionError(''); setTestMessage('')
    try {
      const next = await authApi.mailSettings()
      if (request !== revision.current) return
      // 仅初读、无修改刷新及明确撤销时读取；读取期间禁用编辑。
      setStatus(next); setDraft(draftFrom(next))
      setReadAt(new Date())
    } catch (error) {
      if (request === revision.current) setError(error instanceof Error ? error.message : '邮件配置读取失败')
    } finally {
      if (request === revision.current) { inFlight.current = false; setLoading(false) }
    }
  }, [])
  useEffect(() => { void load(); return () => { revision.current++; inFlight.current = false } }, [load])
  useEffect(() => { onBusyChange?.(busy || loading) }, [busy, loading, onBusyChange])
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  function change<K extends keyof MailSettingsInput>(key: K, value: MailSettingsInput[K]) {
    setDraft(previous => previous && { ...previous, [key]: value })
    setActionError(''); setTestMessage('')
  }
  async function save(event: FormEvent) {
    event.preventDefault()
    if (!draft || inFlight.current || !dirty) return
    if(reason.trim().length<4){setActionError('请填写至少 4 字的配置修改原因');return}
    inFlight.current = true; setBusy(true); setActionError(''); setTestMessage('')
    try {
      const next = await authApi.saveMailSettings({...draft,reason:reason.trim()})
      setReason('')
      setStatus(next); setDraft(draftFrom(next)); setReadAt(new Date())
      toast('邮件配置已保存并立即生效', 'success')
    } catch (error) { setActionError(error instanceof Error ? error.message : '保存失败，草稿已保留') }
    finally { inFlight.current = false; setBusy(false) }
  }
  async function testConnection() {
    if (!status || dirty || inFlight.current) return
    inFlight.current = true; setBusy(true); setActionError(''); setTestMessage('')
    try { setTestMessage((await authApi.testMailConnection(status.revision)).message) }
    catch (error) { setActionError(error instanceof Error ? error.message : '连接测试失败') }
    finally { inFlight.current = false; setBusy(false) }
  }
  async function discard() {
    if (inFlight.current) return
    if (status) setDraft(draftFrom(status))
    setActionError(''); setTestMessage(''); await load()
  }

  const localOutbox = status?.mode === 'outbox'
  const statusLabel = error ? '保留上次配置' : !status?.ready ? '待配置' : localOutbox ? '本地邮件箱' : '配置已就绪'
  const locked = loading || busy
  return <div className={styles.workspace} aria-busy={locked}>
    <div className={styles.toolbar}>
      <div className={styles.summary}>
        {status && <AdminStatusBadge tone={error || localOutbox ? 'neutral' : status.ready ? 'success' : 'warning'}>{statusLabel}</AdminStatusBadge>}
        {status && <span>当前使用{status.source === 'local' ? '后台配置' : '服务器配置'}</span>}
      </div>
      <Button variant="secondary" disabled={locked || dirty} onClick={() => void load()}>
        {loading ? <Spinner size="sm" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}刷新状态
      </Button>
    </div>
      {!status || !draft ? (error ? <ErrorState message={error} onRetry={() => void load()} /> : <LoadingState label="正在读取邮件配置" rows={3} />) : <>
        {error && <InlineError message={`刷新失败：${error}。当前保留上次读取的配置。`} />}
        {localOutbox && <p className={styles.notice}>当前为开发邮件箱，邮件仅写入本地文件。保存 SMTP 配置后将使用实际邮件服务。</p>}
        <form className={styles.editor} onSubmit={event => void save(event)}>
          <div className={styles.layout}>
            <Card className={styles.panel} role="region" aria-labelledby={titleId}>
              <PanelHeading title="SMTP 连接" titleId={titleId} description="填写邮件服务商提供的连接与认证信息。" />
              <CardContent className={styles.body}>
                <div className={styles.serverFields}>
                <FormField label="SMTP 服务器" hint="仅填写主机名，不含协议或路径。">{({ id }) => <Input id={id} value={draft.host} onChange={e => change('host', e.target.value)} required maxLength={253} disabled={locked} autoComplete="off" placeholder="smtp.example.com" />}</FormField>
                <FormField label="端口">{({ id }) => <Input id={id} type="number" min={1} max={65535} value={draft.port || ''} onChange={e => change('port', Number(e.target.value))} required disabled={locked} />}</FormField>
                </div>
                <div className={styles.fieldPair}>
                <FormField label="加密方式" hint="TLS 常用 465，STARTTLS 常用 587。">{({ id }) => <Select value={draft.security} onValueChange={value => change('security', value as MailSettingsInput['security'])} disabled={locked}><SelectTrigger id={id}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="tls">TLS（隐式加密）</SelectItem><SelectItem value="starttls">STARTTLS</SelectItem></SelectContent></Select>}</FormField>
                <FormField label="SMTP 账号">{({ id }) => <Input id={id} value={draft.username} onChange={e => change('username', e.target.value)} maxLength={2048} disabled={locked} autoComplete="off" />}</FormField>
                </div>
                <div className={styles.passwordField}>
                  <FormField label="SMTP 密码 / 授权码" hint={status.passwordSet ? '已设置，留空保留；填写新值后替换。' : '填写邮件服务提供的密码或授权码。'}>{({ id }) => <Input id={id} type="password" value={draft.password} onChange={e => change('password', e.target.value)} maxLength={4096} disabled={locked || draft.clearPassword} autoComplete="new-password" placeholder={status.passwordSet ? '已设置 · 不回显原值' : '输入密码或授权码'} />}</FormField>
                  {status.passwordSet && <label className={styles.clearPassword} htmlFor={clearId}><Checkbox id={clearId} checked={draft.clearPassword} disabled={locked} onCheckedChange={value => { change('clearPassword', value === true); change('password', '') }} />清除已保存密码</label>}
                </div>
              </CardContent>
            </Card>
            <Card className={styles.panel} role="region" aria-labelledby={deliveryTitleId}>
              <PanelHeading title="发件与验证" titleId={deliveryTitleId} description="设置收件人看到的身份与账户邮件链接。" />
              <CardContent className={styles.body}>
                <FormField label="发件身份" hint="可填纯邮箱，或「名称 <邮箱>」；发信域名须已验证。">{({ id }) => <Input id={id} value={draft.from} onChange={e => change('from', e.target.value)} required maxLength={320} disabled={locked} placeholder="Cat’s Library <no-reply@example.com>" />}</FormField>
                <FormField label="邮件链接站点" hint="填写完整 HTTPS 站点地址，不含路径。">{({ id }) => <Input id={id} type="url" value={draft.publicOrigin} onChange={e => change('publicOrigin', e.target.value)} required maxLength={2048} disabled={locked} placeholder="https://example.com" />}</FormField>
                <section className={styles.connectionTest} aria-label="连接测试">
                  <div className={styles.testAction}>
                    <Button type="button" variant="secondary" disabled={locked || dirty || !status.ready || localOutbox} onClick={() => void testConnection()}>{busy && <Spinner size="sm" aria-hidden="true" />}测试已保存的连接</Button>
                  </div>
                  <p className={styles.notice}>{dirty ? '请先保存修改，再测试连接。' : '仅检查连接与认证，不发送邮件；实际送达以收件结果为准。'}</p>
                  {testMessage && <p className={styles.notice} role="status">{testMessage}</p>}
                </section>
                <p className={styles.purpose}><MailCheck aria-hidden="true" />用于邮箱验证与密码找回</p>
              </CardContent>
            </Card>
          </div>
          {dirty && <FormField label="配置修改原因" hint="至少 4 字；修改前后配置会脱敏记录到操作审计。">{({id})=><Input id={id} value={reason} onChange={e=>setReason(e.target.value)} required minLength={4} maxLength={300} disabled={locked}/>}</FormField>}
          {actionError && <InlineError message={actionError} />}
          {dirty && active && <AdminFloatingDock reserveSpace><span>邮件配置有未保存修改</span><Button type="button" variant="ghost" disabled={locked} onClick={() => void discard()}>撤销</Button><Button type="submit" disabled={locked}>{busy && <Spinner size="sm" aria-hidden="true" />}保存配置</Button></AdminFloatingDock>}
        </form>
        <div className={styles.footer}>
          <details className={styles.help}>
            <summary>配置与安全说明<ChevronDown aria-hidden="true" /></summary>
            <div className={styles.helpContent}>
              <p>仅超级管理员可配置。密码不会回传到浏览器，后台保存的整套配置优先于环境变量。</p>
              <p>保存后立即生效，无需重启服务。邮箱绑定与更换可在个人中心的账户安全中申请；密码重置可从登录页申请，或由管理员向已验证邮箱发送链接。</p>
              <p>迁移服务器时需单独安全迁移邮件私有配置文件，数据库备份不包含它。</p>
              <p>完成邮箱验证或密码重置后，旧登录会话会失效，需要重新登录；新邮箱确认前，原邮箱仍然有效。</p>
            </div>
          </details>
          {readAt && <p className={styles.updated} aria-live="polite">最近读取 <time dateTime={readAt.toISOString()}>{readAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time></p>}
        </div>
      </>}
  </div>
}
