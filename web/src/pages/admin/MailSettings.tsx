import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { ChevronDown, KeyRound, MailCheck, RefreshCw } from 'lucide-react'
import { authApi } from '@/lib/api'
import AdminStatusBadge from '@/components/admin/AdminStatusBadge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { ErrorState, InlineError, LoadingState } from '@/components/shared/AsyncStates'
import { PanelHeading } from '@/components/shared/PanelHeading'
import styles from './mail-settings.module.css'

export default function MailSettings() {
  const titleId = useId()
  const [status, setStatus] = useState<Awaited<ReturnType<typeof authApi.mailSettings>> | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [readAt, setReadAt] = useState<Date | null>(null)
  const revision = useRef(0)
  const inFlight = useRef(false)
  const load = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    const request = ++revision.current
    setLoading(true)
    setError('')
    try {
      const next = await authApi.mailSettings()
      if (request !== revision.current) return
      setStatus(next)
      setReadAt(new Date())
    } catch (error) {
      if (request === revision.current) setError(error instanceof Error ? error.message : '邮件配置读取失败')
    } finally {
      if (request === revision.current) {
        inFlight.current = false
        setLoading(false)
      }
    }
  }, [])
  useEffect(() => {
    void load()
    return () => { revision.current++; inFlight.current = false }
  }, [load])

  const localOutbox = status?.mode === 'outbox'
  const sender = status?.from.trim().match(/^(.*?)\s*<([^<>]+)>$/)
  const senderName = sender?.[1]?.trim().replace(/^"(.*)"$/, '$1')
  const senderAddress = sender?.[2] || status?.from || '未设置'
  const statusLabel = error ? '保留上次配置' : !status?.ready ? '待配置' : localOutbox ? '本地邮件箱' : '配置已就绪'

  return (
    <Card className={styles.panel} role="region" aria-labelledby={titleId}>
      <PanelHeading
        title="发信服务"
        titleId={titleId}
        status={status && <AdminStatusBadge tone={error || localOutbox ? 'neutral' : status.ready ? 'success' : 'warning'}>{statusLabel}</AdminStatusBadge>}
        actions={
          <Button variant="secondary" disabled={loading} onClick={() => void load()}>
            {loading ? <Spinner size="sm" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
            {loading ? '正在读取' : '刷新状态'}
          </Button>
        }
      />
      <CardContent className={styles.body} aria-busy={loading}>
        {!status ? (
          error
            ? <ErrorState message={error} onRetry={() => void load()} />
            : <LoadingState label="正在读取邮件配置" rows={3} />
        ) : <>
          {error && <InlineError message={`刷新失败：${error}。以下保留上次读取的配置。`} onRetry={() => void load()} />}
          <div className={styles.layout}>
            <div className={styles.configuration}>
              <dl className={styles.details}>
                <div className={styles.sender}>
                  <dt>发件身份</dt>
                  <dd>
                    {senderName && <span className={styles.senderName}>{senderName}</span>}
                    <span className={styles.senderAddress}>{senderAddress}</span>
                  </dd>
                </div>
                <div>
                  <dt>发送方式</dt>
                  <dd>{localOutbox ? '本地邮件箱' : 'SMTP 邮件服务'}</dd>
                </div>
                <div>
                  <dt>邮件链接站点</dt>
                  <dd>{status.publicOrigin || '未设置'}</dd>
                </div>
              </dl>
              {(!status.ready || localOutbox) && <p className={styles.notice}>
                {!status.ready ? '配置尚未完整，暂时无法发送账户邮件。' : '开发模式：邮件仅写入本地文件，不会发送到收件邮箱。'}
              </p>}
            </div>
            <section className={styles.usage} aria-label="邮件用途">
              <h4>用于账户安全</h4>
              <ul className={styles.purposes}>
                <li>
                  <MailCheck aria-hidden="true" />
                  <div><h5>邮箱验证</h5><p>在个人中心的账户安全中，绑定或更换邮箱。</p></div>
                </li>
                <li>
                  <KeyRound aria-hidden="true" />
                  <div><h5>密码找回</h5><p>从登录页申请重置，或由管理员向已验证邮箱发送链接。</p></div>
                </li>
              </ul>
            </section>
          </div>
          <div className={styles.footer}>
            <details className={styles.help}>
              <summary>配置与安全说明<ChevronDown aria-hidden="true" /></summary>
              <div className={styles.helpContent}>
                <p>发信服务、发件身份和链接站点由服务器管理；修改后重启服务，再刷新此页。</p>
                <p>这里展示配置是否齐全，不检测实际收件情况。邮件是否送达，以收件结果为准。</p>
                <p>完成邮箱验证或密码重置后，旧登录会话会失效，需要重新登录；新邮箱确认前，原邮箱仍然有效。</p>
              </div>
            </details>
            {readAt && <p className={styles.updated} aria-live="polite">
              最近读取 <time dateTime={readAt.toISOString()}>{readAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
            </p>}
          </div>
        </>}
      </CardContent>
    </Card>
  )
}
