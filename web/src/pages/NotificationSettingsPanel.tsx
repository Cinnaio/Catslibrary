import NotificationBooks from './NotificationBooks'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { NotificationConfiguration, NotificationSettings } from '@shared/notifications'
import { API_BASE } from '../lib/api'
import { clearBrowserPush, enablePush, notificationsApi, pushSupport } from '../lib/notifications'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import styles from './messages.module.css'

export default function NotificationSettingsPanel({ userId }: { userId: string }) {
  const [config, setConfig] = useState<NotificationConfiguration | null>(null),
    [form, setForm] = useState<NotificationSettings | null>(null)
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('')
  const [device, setDevice] = useState(() => (localStorage.getItem('library_push_owner') === userId ? localStorage.getItem('library_push_device') || '' : ''))
  const alive = useRef(true),
    pending = useRef(false)
  const reload = useCallback(async () => {
    const result = await notificationsApi.settings()
    if (alive.current) {
      setConfig(result)
      setForm(result.settings)
      setError('')
    }
  }, [])
  useEffect(() => {
    alive.current = true
    void reload().catch((e) => {
      if (alive.current) setError((e as Error).message)
    })
    return () => {
      alive.current = false
    }
  }, [reload])
  async function action(work: () => Promise<void>) {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await work()
    } catch (e) {
      if (alive.current) setError((e as Error).message)
    } finally {
      pending.current = false
      if (alive.current) setBusy(false)
    }
  }
  const reason = pushSupport()
  const sameOrigin = new URL(API_BASE, location.origin).origin === location.origin
  function change<K extends keyof NotificationSettings>(key: K, value: NotificationSettings[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f))
  }
  const currentDevice = config?.devices.find((d) => d.id === device && d.current)
  return (
    <div className={styles.settings}>
      {error && (
        <p role="alert">
          {error}{' '}
          <Button variant="link" disabled={busy} onClick={() => void action(reload)}>
            重新载入设置
          </Button>
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {!form || !config ? (
        <p>正在读取通知设置…</p>
      ) : (
        <>
          <section>
            <h2>通知偏好</h2>
            <p>这些开关控制推送，消息仍会保存在消息中心。</p>
            <fieldset disabled={busy} className={styles.fields}>
              <legend className={styles.srOnly}>通知种类与隐私</legend>
              <label>
                <input type="checkbox" checked={form.replies} onChange={(e) => change('replies', e.target.checked)} />
                评论回复
              </label>
              <label>
                <input type="checkbox" checked={form.tasks} onChange={(e) => change('tasks', e.target.checked)} />
                AI 任务完成或失败
              </label>
              <label>
                <input type="checkbox" checked={form.preview} onChange={(e) => change('preview', e.target.checked)} />
                锁屏显示消息类型和书名
              </label>
              <label>
                <input type="checkbox" checked={form.quietEnabled} onChange={(e) => change('quietEnabled', e.target.checked)} />
                启用免打扰
              </label>
              {form.quietEnabled && (
                <div className={styles.times}>
                  <label>
                    开始
                    <Input type="time" value={form.quietStart} onChange={(e) => change('quietStart', e.target.value)} />
                  </label>
                  <label>
                    结束
                    <Input type="time" value={form.quietEnd} onChange={(e) => change('quietEnd', e.target.value)} />
                  </label>
                  <label>
                    时区
                    <Input value={form.timeZone} onChange={(e) => change('timeZone', e.target.value)} placeholder="Asia/Shanghai" />
                  </label>
                  <Button variant="ghost" onClick={() => change('timeZone', Intl.DateTimeFormat().resolvedOptions().timeZone)}>
                    使用本机时区
                  </Button>
                </div>
              )}
            </fieldset>
            <Button
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  const result = await notificationsApi.save(form)
                  if (alive.current) {
                    setForm(result.settings)
                    setMessage('通知设置已保存')
                  }
                })
              }
            >
              保存设置
            </Button>
          </section>
          <NotificationBooks />
          <section>
            <h2>当前设备推送</h2>
            <p>iPhone / iPad 请先将网站添加到主屏幕，再从主屏幕打开并开启。通知点开后会回到网页版。</p>
            {reason && <p>{reason}</p>}
            {!sameOrigin && <p>请从与 API 相同的站点打开网页版，再开启推送。</p>}
            {!config.pushConfigured && <p>站点尚未启用推送服务，消息中心可以正常使用。</p>}
            <div className={styles.toolbar}>
              <Button
                disabled={busy || !!reason || !sameOrigin || !config.pushConfigured}
                onClick={() =>
                  void action(async () => {
                    const id = await enablePush(config.publicKey, userId, () => alive.current)
                    if (alive.current) {
                      setDevice(id)
                      const next = await notificationsApi.settings()
                      if (alive.current) {
                        setConfig(next)
                        setMessage('当前设备已开启推送')
                      }
                    }
                  })
                }
              >
                {currentDevice ? '重新连接推送' : '开启推送'}
              </Button>
              <Button
                variant="secondary"
                disabled={busy || !currentDevice}
                onClick={() =>
                  void action(async () => {
                    await notificationsApi.test(device)
                    if (alive.current) setMessage('测试通知已排队，请稍候查看通知中心。')
                  })
                }
              >
                发送测试通知
              </Button>
              <Button
                variant="ghost"
                disabled={busy || (!device && !currentDevice)}
                onClick={() =>
                  void action(async () => {
                    if (device) await notificationsApi.remove(device)
                    await clearBrowserPush()
                    if (alive.current) {
                      setDevice('')
                      setConfig((c) => (c ? { ...c, devices: c.devices.filter((d) => d.id !== device) } : c))
                      setMessage('当前设备推送已关闭')
                    }
                  })
                }
              >
                关闭当前设备推送
              </Button>
            </div>
          </section>
          <section>
            <h2>接收设备</h2>
            <ul className={styles.devices}>
              {config.devices.map((d) => (
                <li key={d.id}>
                  <span>
                    {d.name}
                    {d.id === device ? ' · 当前浏览器' : ''}
                    <small>{new Date(d.createdAt).toLocaleDateString()}</small>
                  </span>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        await notificationsApi.remove(d.id)
                        if (d.id === device) {
                          await clearBrowserPush()
                          if (alive.current) setDevice('')
                        }
                        if (alive.current) setConfig((c) => (c ? { ...c, devices: c.devices.filter((row) => row.id !== d.id) } : c))
                      })
                    }
                  >
                    移除
                  </Button>
                </li>
              ))}
            </ul>
            {!config.devices.length && <p>还没有接收推送的设备。</p>}
            <p>退出账号会解绑该登录会话的推送；重新登录后可在此开启。免打扰结束后会发送仍未读的新消息，测试通知不受免打扰影响。</p>
          </section>
        </>
      )}
    </div>
  )
}
