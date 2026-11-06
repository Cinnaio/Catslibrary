import { useCallback, useEffect, useState } from 'react'
import { authApi } from '@/lib/api'
import { Panel } from '@/components/ui/panel'
import { Button } from '@/components/ui/button'
import { ErrorState, LoadingState } from '@/components/shared/AsyncStates'
import { PanelHeading } from '@/components/shared/PanelHeading'
import styles from './mail-settings.module.css'

export default function MailSettings() {
  const [status, setStatus] = useState<Awaited<ReturnType<typeof authApi.mailSettings>> | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setStatus(await authApi.mailSettings()) }
    catch (error) { setError((error as Error).message || '邮件配置读取失败') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])
  return <Panel className={styles.panel}>
    <PanelHeading title="账号邮件" description="用于邮箱验证与自助找回密码。" actions={<Button variant="secondary" disabled={loading} onClick={() => void load()}>刷新状态</Button>} />
    {error && <ErrorState message={error} onRetry={() => void load()} />}
    {!status && loading && <LoadingState label="读取邮件配置" />}
    {status && <dl className={styles.details}>
      <dt>配置状态</dt><dd>{status.ready ? '已配置；尚未验证实际投递' : '未配置完整，无法发信'}</dd>
      <dt>发送方式</dt><dd>{status.mode === 'outbox' ? '开发环境本地邮件箱' : 'SMTP'}</dd>
      <dt>发件身份</dt><dd>{status.from || '未设置'}</dd>
      <dt>网站地址</dt><dd>{status.publicOrigin || '未设置'}</dd>
    </dl>}
    <p>由服务器部署环境配置发件服务及网站地址，更新后重启 API。邮箱绑定入口位于个人中心的账户安全；密码找回入口位于登录页。</p>
    <p>用户完成密码重置或邮箱验证后，旧会话会被撤销。管理员只能向用户已验证的邮箱发送重置链接。</p>
  </Panel>
}
