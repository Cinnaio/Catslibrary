import { MotionDetails } from '@/components/ui/motion'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { MailSecuritySettings as Settings, MailSecuritySettingsInput, MailSecretSource } from '@shared/mail-security-settings'
import { request } from '@/lib/api'
import AdminStatusBadge from '@/components/admin/AdminStatusBadge'
import FormField from '@/components/shared/FormField'
import { ErrorState, InlineError, LoadingState } from '@/components/shared/AsyncStates'
import { PanelHeading } from '@/components/shared/PanelHeading'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import styles from './security-center.module.css'

type SaveOperation = { title: string; description: string; run: (reason: string) => Promise<unknown> }
const sources: Record<MailSecretSource, string> = { local: '后台配置', environment: '服务器环境变量', site: '站点加密密钥', none: '尚未配置' }

export default function MailSecuritySettings({
  blocked,
  refreshToken,
  onBusyChange,
  onDirtyChange,
  onConfirm,
}: {
  blocked: boolean
  refreshToken: number
  onBusyChange: (busy: boolean) => void
  onDirtyChange: (dirty: boolean) => void
  onConfirm: (operation: SaveOperation) => void
}) {
  const [status, setStatus] = useState<Settings | null>(null)
  const [queueKey, setQueueKey] = useState('')
  const [webhookSecret, setWebhookSecret] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const revision = useRef(0)
  const dirty = Boolean(queueKey || webhookSecret)
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  const load = useCallback(async () => {
    if (dirtyRef.current) return
    const id = ++revision.current
    setLoading(true)
    setError('')
    try {
      const next = await request<Settings>('GET', '/admin/security/mail-settings', null, true)
      if (id === revision.current) setStatus(next)
    } catch (error) {
      if (id === revision.current) setError(error instanceof Error ? error.message : '邮件安全配置读取失败')
    } finally {
      if (id === revision.current) setLoading(false)
    }
  }, [])
  useEffect(() => {
    void load()
    return () => {
      revision.current++
    }
  }, [load, refreshToken])
  useEffect(() => {
    onBusyChange(loading)
  }, [loading, onBusyChange])
  useEffect(() => {
    onDirtyChange(dirty)
  }, [dirty, onDirtyChange])
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  const locked = blocked || loading
  const keyInvalid = Boolean(queueKey.trim()) && !/^[A-Za-z0-9+/]{43}=$/.test(queueKey.trim())
  const webhookInvalid = Boolean(webhookSecret.trim()) && !/^whsec_[A-Za-z0-9+/]+={0,2}$/.test(webhookSecret.trim())
  function save(generateQueueKey: boolean) {
    if (!status || locked) return
    const input: Omit<MailSecuritySettingsInput, 'reason'> = {
      revision: status.revision,
      generateQueueKey,
      queueEncryptionKey: queueKey.trim(),
      webhookSecret: webhookSecret.trim(),
    }
    onConfirm({
      title: generateQueueKey ? '生成并启用队列加密' : '保存邮件安全配置',
      description: generateQueueKey
        ? '服务器将生成并持久保存随机密钥，立即用于新邮件入队。密钥不会回传浏览器；迁移服务器时须单独迁移私有配置文件。'
        : '保存后立即生效。替换回调签名密钥时，须与 Resend 控制台保持一致；留空保留原值，已有队列密钥不能通过页面替换。',
      run: async (reason) => {
        const next = await request<Settings>('PUT', '/admin/security/mail-settings', { ...input, reason }, true)
        revision.current++
        setStatus(next)
        setQueueKey('')
        setWebhookSecret('')
        setError('')
      },
    })
  }
  function discard() {
    if (locked) return
    setQueueKey('')
    setWebhookSecret('')
    dirtyRef.current = false
    void load()
  }
  if (!status) return error ? <ErrorState message={error} onRetry={() => void load()} /> : <LoadingState label="读取队列加密与回调配置" rows={2} />
  return (
    <div className={styles.workspace} aria-busy={loading}>
      {error && <InlineError message={`刷新失败：${error}。已保留上次配置。`} onRetry={() => void load()} />}
      <div className={styles.columns}>
        <Card role="region" aria-label="队列加密配置">
          <PanelHeading
            title="队列加密"
            description="保护待发邮件中的收件地址和验证链接。"
            status={<AdminStatusBadge tone={status.encryptionReady ? 'neutral' : 'warning'}>{status.encryptionReady ? '已配置' : '待配置'}</AdminStatusBadge>}
          />
          <CardContent className={styles.panelBody}>
            <p className={styles.hint}>配置来源：{sources[status.queueSource]}</p>
            {status.queueCanInitialize ? (
              <>
                <div>
                  <Button variant="secondary" disabled={locked || dirty} onClick={() => save(true)}>
                    生成并启用加密密钥
                  </Button>
                </div>
                <MotionDetails className={styles.disclosure}>
                  <summary>
                    使用已有密钥
                    <ChevronDown size={14} aria-hidden="true" />
                  </summary>
                  <div className={styles.disclosureBody}>
                    <FormField
                      label="队列加密密钥"
                      hint="填写 32 字节随机密钥的 Base64。首次配置可直接使用上方生成按钮。"
                      error={keyInvalid ? '请填写 32 字节密钥的 Base64（44 个字符，以 = 结尾）' : undefined}
                    >
                      {({ id }) => (
                        <Input
                          id={id}
                          type="password"
                          value={queueKey}
                          disabled={locked}
                          onChange={(e) => setQueueKey(e.target.value)}
                          autoComplete="new-password"
                          maxLength={100}
                        />
                      )}
                    </FormField>
                  </div>
                </MotionDetails>
              </>
            ) : (
              <p className={styles.hint}>
                {status.queueIssue === 'invalid'
                  ? '服务器密钥格式无效。请修正原环境变量；页面不会覆盖它，避免已有邮件无法解密。'
                  : status.queueIssue === 'retained-payload'
                    ? '队列仍有加密正文，请在服务器恢复原密钥后重试。不能用新密钥解密已有邮件。'
                    : '已生效的密钥不回显、不在页面中替换，保存回调配置不会改变它。'}
              </p>
            )}
          </CardContent>
        </Card>
        <Card role="region" aria-label="投递回调配置">
          <PanelHeading
            title="Resend 投递回调"
            description="关联投递、退信和投诉；SMTP 发信无需配置。"
            status={<AdminStatusBadge tone={status.webhookReady ? 'neutral' : 'warning'}>{status.webhookReady ? '签名已配置' : '尚未配置'}</AdminStatusBadge>}
          />
          <CardContent className={styles.panelBody}>
            <p className={styles.hint}>配置来源：{sources[status.webhookSource]}</p>
            <FormField
              label="回调签名密钥"
              hint="从 Resend Webhook 设置复制 Signing Secret，留空保留原值。"
              error={webhookInvalid ? '请填写以 whsec_ 开头的回调签名密钥' : undefined}
            >
              {({ id }) => (
                <Input
                  id={id}
                  type="password"
                  value={webhookSecret}
                  onChange={(e) => setWebhookSecret(e.target.value)}
                  disabled={locked}
                  autoComplete="new-password"
                  maxLength={1024}
                  placeholder={status.webhookReady ? '已设置 · 不回显原值' : 'whsec_…'}
                />
              )}
            </FormField>
            {status.webhookInvalid && <p className={styles.hint}>当前签名密钥格式无效，请填写服务商提供的完整密钥。</p>}
            <FormField
              label="回调地址"
              hint={
                status.webhookUrl
                  ? '在 Resend 控制台添加此 HTTPS 地址，并在防护策略选择 Resend API；保存密钥不代表回调已连通。'
                  : '请先在上方保存邮件链接站点，再获取完整回调地址。'
              }
            >
              {({ id }) => <Input id={id} readOnly value={status.webhookUrl} onFocus={(e) => e.target.select()} />}
            </FormField>
          </CardContent>
        </Card>
      </div>
      {dirty && (
        <div className={styles.sectionActions}>
          <Button variant="ghost" disabled={locked} onClick={discard}>
            撤销安全配置修改
          </Button>
          <Button disabled={locked || keyInvalid || webhookInvalid || (!queueKey.trim() && !webhookSecret.trim())} onClick={() => save(false)}>
            保存安全配置
          </Button>
        </div>
      )}
    </div>
  )
}
