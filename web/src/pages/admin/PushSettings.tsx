import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import type { PushAdminInput, PushAdminSettings } from '@shared/push-settings'
import { request } from '@/lib/api'
import { useConfirm, useToast } from '@/components/feedback'
import AdminFloatingDock from '@/components/admin/AdminFloatingDock'
import FormField from '@/components/shared/FormField'
import { ErrorState, InlineError, LoadingState } from '@/components/shared/AsyncStates'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import styles from './mail-settings.module.css'

const draftFrom = (value: PushAdminSettings): PushAdminInput => ({
  revision: value.revision,
  enabled: value.enabled,
  subject: value.subject,
  keyAction: value.privateKeySet ? 'keep' : 'generate',
  publicKey: '',
  privateKey: '',
})

export default function PushSettings({ active = true, onBusyChange }: { active?: boolean; onBusyChange?: (busy: boolean) => void }) {
  const { toast } = useToast(),
    { confirm } = useConfirm()
  const [saved, setSaved] = useState<PushAdminSettings | null>(null)
  const [draft, setDraft] = useState<PushAdminInput | null>(null)
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState(''),
    [saveError, setSaveError] = useState('')
  const lifecycle = useRef({ generation: 0, inFlight: false })
  const dirty = Boolean(saved && draft && (JSON.stringify(draft) !== JSON.stringify(draftFrom(saved)) || draft.keyAction !== 'keep'))
  const load = useCallback(async () => {
    if (lifecycle.current.inFlight) return
    lifecycle.current.inFlight = true
    const current = ++lifecycle.current.generation
    setLoading(true)
    setLoadError('')
    setSaveError('')
    try {
      const value = await request<PushAdminSettings>('GET', '/admin/site-settings/push', null, true)
      if (current === lifecycle.current.generation) {
        setSaved(value)
        setDraft(draftFrom(value))
      }
    } catch (error) {
      if (current === lifecycle.current.generation) setLoadError(error instanceof Error ? error.message : '推送配置读取失败')
    } finally {
      if (current === lifecycle.current.generation) {
        setLoading(false)
        lifecycle.current.inFlight = false
      }
    }
  }, [])
  useEffect(() => {
    const state = lifecycle.current
    let active = true
    queueMicrotask(() => {
      if (active) void load()
    })
    return () => {
      active = false
      state.generation++
      state.inFlight = false
    }
  }, [load])
  useEffect(() => {
    onBusyChange?.(busy || loading)
  }, [busy, loading, onBusyChange])
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  const locked = loading || busy
  function change<K extends keyof PushAdminInput>(key: K, value: PushAdminInput[K]) {
    setDraft((previous) => previous && { ...previous, [key]: value })
    setSaveError('')
  }
  async function save(event: FormEvent) {
    event.preventDefault()
    if (!draft || !saved || lifecycle.current.inFlight) return
    lifecycle.current.inFlight = true
    setBusy(true)
    setSaveError('')
    const current = lifecycle.current.generation
    try {
      const rotating = Boolean(
        saved.publicKey && (draft.keyAction === 'generate' || (draft.keyAction === 'import' && draft.publicKey?.trim() !== saved.publicKey)),
      )
      if (
        rotating &&
        !(await confirm({
          title: '替换推送密钥',
          message: '替换后，已订阅的设备将停止接收推送，需要在消息中心重新开启。站内消息和阅读提醒不受影响。',
          okText: '确认替换并保存',
        }))
      )
        return
      if (current !== lifecycle.current.generation) return
      const contact = draft.subject.trim()
      const value = await request<PushAdminSettings>(
        'PUT',
        '/admin/site-settings/push',
        {
          ...draft,
          subject: contact.includes('@') && !contact.includes(':') ? `mailto:${contact}` : contact,
          ...(draft.keyAction !== 'import' ? { publicKey: undefined, privateKey: undefined } : {}),
          confirmRotation: rotating,
        },
        true,
      )
      if (current !== lifecycle.current.generation) return
      setSaved(value)
      setDraft(draftFrom(value))
      toast(value.configured ? '推送配置已保存并立即生效' : '推送已暂停，站内消息仍然可用', 'success')
    } catch (error) {
      if (current === lifecycle.current.generation) setSaveError(error instanceof Error ? error.message : '保存失败，草稿已保留')
    } finally {
      if (current === lifecycle.current.generation) {
        lifecycle.current.inFlight = false
        setBusy(false)
      }
    }
  }
  async function reload() {
    if (locked) return
    if (dirty && !(await confirm({ title: '重新读取推送配置', message: '当前未保存的修改将被撤销。', okText: '撤销并重新读取' }))) return
    await load()
  }
  return (
    <div className={styles.workspace} aria-busy={locked}>
      <div className={styles.toolbar}>
        <div className={styles.summary} role="status">
          <span>{saved ? (saved.configured ? '推送配置已就绪' : saved.enabled ? '待配置' : '已暂停推送') : '正在读取配置'}</span>
          {saved && <span>{saved.source === 'local' ? '后台配置' : '环境变量 / 尚未保存'}</span>}
        </div>
        <Button type="button" variant="outline" disabled={locked} onClick={() => void reload()}>
          重新读取
        </Button>
      </div>
      {loadError && <ErrorState message={loadError} onRetry={() => void reload()} />}
      {!draft || !saved ? (
        !loadError && <LoadingState label="正在读取推送配置…" />
      ) : (
        <form onSubmit={(event) => void save(event)} className={styles.editor}>
          <Card>
            <CardHeader>
              <CardTitle>网页与主屏幕推送</CardTitle>
            </CardHeader>
            <CardContent className={styles.editor}>
              <FormField label="启用站点推送" hint="暂停时保留密钥与订阅，站内消息照常保存。">
                {({ id }) => <Checkbox id={id} checked={draft.enabled} disabled={locked} onCheckedChange={(value) => change('enabled', value === true)} />}
              </FormField>
              <FormField label="联系邮箱或地址" hint="填写维护者邮箱（例如 admin@example.com）或 HTTPS 联系页面。">
                {({ id }) => (
                  <Input
                    id={id}
                    value={draft.subject}
                    disabled={locked}
                    required={draft.enabled}
                    maxLength={2048}
                    onChange={(e) => change('subject', e.target.value)}
                  />
                )}
              </FormField>
              <FormField
                label="VAPID 密钥"
                hint={saved.privateKeySet ? '已保存私钥，仅修改联系地址时保留现有密钥即可。' : '选择自动生成后保存，服务器会生成并保管密钥。'}
              >
                {({ id }) => (
                  <Select
                    value={draft.keyAction}
                    disabled={locked}
                    onValueChange={(value) =>
                      setDraft((previous) => previous && { ...previous, keyAction: value as PushAdminInput['keyAction'], publicKey: '', privateKey: '' })
                    }
                  >
                    <SelectTrigger id={id}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="keep">保留现有密钥</SelectItem>
                      <SelectItem value="generate">自动生成新密钥</SelectItem>
                      <SelectItem value="import">导入现有密钥</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </FormField>
              {draft.keyAction === 'import' && (
                <>
                  <FormField label="导入公钥">
                    {({ id }) => (
                      <Input
                        id={id}
                        value={draft.publicKey}
                        disabled={locked}
                        required
                        maxLength={87}
                        spellCheck={false}
                        autoComplete="off"
                        onChange={(e) => change('publicKey', e.target.value)}
                      />
                    )}
                  </FormField>
                  <FormField label="导入私钥" hint="私钥只用于本次保存，保存成功后清空，不会回显。">
                    {({ id }) => (
                      <Input
                        id={id}
                        type="password"
                        value={draft.privateKey}
                        disabled={locked}
                        required
                        maxLength={43}
                        autoComplete="new-password"
                        onChange={(e) => change('privateKey', e.target.value)}
                      />
                    )}
                  </FormField>
                </>
              )}
              {saved.publicKey && <FormField label="当前公钥">{({ id }) => <Input id={id} value={saved.publicKey} readOnly spellCheck={false} />}</FormField>}
              {saved.publicKey && draft.keyAction !== 'keep' && <p className={styles.notice}>更换密钥后，已有设备需要在消息中心重新开启推送。</p>}
              <p className={styles.notice}>仅超级管理员可配置。私钥由服务器保管；后台保存的配置优先于环境变量，保存后无需重启。</p>
              {saveError && <InlineError message={saveError} />}
            </CardContent>
          </Card>
          <p className={styles.notice}>保存后，前往消息中心的通知设置开启当前设备推送，再发送测试通知。</p>
          <div>
            <Button asChild variant="outline">
              <Link to="/messages?settings=1">打开消息中心</Link>
            </Button>
          </div>
          <AdminFloatingDock open={dirty && active} reserveSpace>
            <span>推送配置有未保存修改</span>
            <Button type="button" variant="ghost" disabled={locked} onClick={() => void reload()}>
              撤销
            </Button>
            <Button type="submit" disabled={locked}>
              {busy ? '正在保存…' : draft.keyAction === 'generate' ? '生成并保存' : '保存配置'}
            </Button>
          </AdminFloatingDock>
        </form>
      )}
    </div>
  )
}
