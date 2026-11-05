import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { adminApi } from '@/lib/api'
import { useContentPolicy } from '@/context/ContentPolicyContext'
import { useConfirm, useToast } from '@/components/feedback'
import AdminStatusBadge from '@/components/admin/AdminStatusBadge'
import { ErrorState, InlineError, LoadingState } from '@/components/shared/AsyncStates'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import styles from './content-policy.module.css'

type PolicySettings = Awaited<ReturnType<typeof adminApi.contentPolicy.settings>>
type SavePhase = 'idle' | 'confirming' | 'saving'

export default function ContentPolicyTab() {
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const { refreshPolicy } = useContentPolicy()
  const [settings, setSettings] = useState<PolicySettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [saved, setSaved] = useState(false)
  const [phase, setPhase] = useState<SavePhase>('idle')
  const revision = useRef(0)
  const mounted = useRef(true)
  const mutationLock = useRef(false)
  const busy = phase !== 'idle'

  const load = useCallback(async () => {
    const request = ++revision.current
    setLoading(true)
    setLoadError('')
    setSaveError('')
    setSaved(false)
    try {
      const value = await adminApi.contentPolicy.settings()
      if (revision.current === request) setSettings(value)
    } catch (error) {
      if (revision.current === request) setLoadError((error as Error).message || '设置读取失败')
    } finally {
      if (revision.current === request) setLoading(false)
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    void load()
    return () => { mounted.current = false; revision.current++ }
  }, [load])

  async function updateAdultContent(enabled: boolean) {
    if (!settings || loading || loadError || mutationLock.current) return
    mutationLock.current = true
    setSaveError('')
    setSaved(false)
    try {
      if (!enabled) {
        setPhase('confirming')
        const confirmed = await confirm({
          title: '关闭成人内容模式',
          message: '关闭后，限制级内容将不再向读者开放。',
          items: ['前台的成人模式切换入口会隐藏', '已选择成人模式的读者将在下次配置刷新时回到安全模式'],
          okText: '关闭模式',
          danger: true,
        })
        if (!confirmed || !mounted.current) return
      }
      setPhase('saving')
      const value = await adminApi.contentPolicy.update(enabled)
      if (mounted.current) {
        // 更新接口只回传访问开关，保留最近读取的验证配置状态。
        setSettings(previous => previous ? { ...previous, adultContentEnabled: value.adultContentEnabled } : previous)
        setSaved(true)
      }
      toast(value.adultContentEnabled ? '成人内容模式已启用' : '成人内容模式已关闭', 'success')
      try {
        await refreshPolicy()
      } catch {
        if (mounted.current) setSaveError('设置已保存，当前阅读模式同步失败，请刷新页面重试。')
      }
    } catch (error) {
      const message = (error as Error).message || '保存失败，请重试。'
      if (mounted.current) setSaveError(message)
      toast(message, 'error')
    } finally {
      mutationLock.current = false
      if (mounted.current) setPhase('idle')
    }
  }

  const enabled = settings?.adultContentEnabled
  const configured = settings?.turnstileConfigured
  const effect = !enabled
    ? '已关闭成人模式入口，限制级作品不再向读者展示。'
    : configured === false
      ? '已允许切换；验证尚未配置，新的解锁请求暂无法通过。'
      : configured === true
        ? '已允许切换；读者仍需完成解锁验证才能查看限制级内容。'
        : '已允许切换；解锁验证的配置状态暂未确认，请查看安全验证配置。'

  return (
      <Card className={styles.panel} aria-labelledby="content-policy-title">
        <CardHeader>
          <CardTitle id="content-policy-title" role="heading" aria-level={2}>限制级内容访问</CardTitle>
          <CardAction>
            <Button variant="secondary" size="sm" onClick={() => void load()} disabled={loading || busy}>
              {loading ? '刷新中…' : '刷新'}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className={styles.content}>
          {!settings ? (
            loading ? <LoadingState label="正在读取内容安全设置…" rows={2} /> : <ErrorState message={`内容安全设置读取失败：${loadError}`} onRetry={() => void load()} />
          ) : <>
            {loadError && <InlineError message={`刷新失败：${loadError}。当前保留上次读取的设置，请重试后再修改。`} onRetry={() => void load()} />}
            <label className={styles.access} htmlFor="adult-content-enabled">
              <span className={styles.copy}>
                <span id="content-policy-access-label" className={styles.label}>允许读者切换成人内容模式</span>
                <span id="content-policy-hint" className={styles.hint}>未解锁的读者使用安全模式，限制级内容需自行确认并通过验证后查看。</span>
              </span>
              <Switch id="adult-content-enabled" checked={settings.adultContentEnabled} disabled={loading || busy || Boolean(loadError)}
                aria-labelledby="content-policy-access-label"
                aria-describedby="content-policy-hint content-policy-effect" onCheckedChange={value => void updateAdultContent(value)} />
            </label>
            <p id="content-policy-effect" className={styles.effect} role="status">{loading ? '正在更新设置，当前显示上次读取的状态…' : effect}</p>
            <div className={styles.verification}>
              <div className={styles.copy}>
                <div className={styles.verificationHeading}>
                  <h3>解锁验证</h3>
                  <AdminStatusBadge tone={configured === true ? 'success' : configured === false && enabled ? 'warning' : 'subtle'}>
                    {configured === true ? '已配置' : configured === false ? '未配置' : '状态未确认'}
                  </AdminStatusBadge>
                </div>
                <p className={styles.hint}>Cloudflare Turnstile · {configured === true ? '可前往安全验证检查已保存配置。' : configured === false ? '完成配置后，读者才能提交新的解锁验证。' : '请前往安全验证查看配置状态。'}</p>
              </div>
              <Button variant="outline" size="sm" asChild><Link to="/admin/site-settings?view=security">{configured === false ? '配置验证' : '查看配置'}</Link></Button>
            </div>
            {saveError && <InlineError message={saveError} />}
            <p className={styles.saveStatus} role="status">
              {phase === 'confirming' ? '等待关闭确认…' : phase === 'saving' ? '正在保存并同步阅读模式…' : saved ? '已保存' : '修改后立即保存'}
            </p>
          </>}
        </CardContent>
      </Card>
  )
}
