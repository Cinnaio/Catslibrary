import { useState, type FormEvent } from 'react'
import type { BackupPolicy, BackupTarget, BackupTargetInput } from '@shared/backups'
import { useToast } from '@/components/feedback'
import { backupsApi } from '@/lib/backups-api'
import AdminFormField from '@/components/admin/AdminFormField'
import AdminStatusBadge from '@/components/admin/AdminStatusBadge'
import CustomSelect from '@/components/admin/CustomSelect'
import CustomTimePicker from '@/components/admin/CustomTimePicker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'

const blank: BackupTargetInput = {
  name: '',
  type: 'sftp',
  enabled: true,
  required: true,
  host: '',
  port: 22,
  path: '/backups/zhi-zhou',
  username: '',
  hostKey: '',
  bucket: '',
  region: '',
  retention: 30,
}
export function TargetForm({ target, onSaved, onCancel }: { target: BackupTarget | null; onSaved: () => void; onCancel: () => void }) {
  const { toast } = useToast()
  const [draft, setDraft] = useState<BackupTargetInput>(target ? { ...target } : blank)
  const [auth, setAuth] = useState<'password' | 'key'>('password'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  async function save(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await backupsApi.saveTarget(draft)
      toast('存储目标已保存', 'success')
      onSaved()
    } catch (e) {
      const message = e instanceof Error ? e.message : '保存失败'
      setError(message)
      toast(message, 'error')
    } finally {
      setBusy(false)
    }
  }
  const change = (key: keyof BackupTargetInput, value: string | number | boolean) => setDraft((previous) => ({ ...previous, [key]: value }))
  return (
    <form onSubmit={(event) => void save(event)} className="backup-fields">
      <div className="backup-field-pair">
        <AdminFormField label="目标名称">
          {({ id }) => <Input id={id} required maxLength={80} value={draft.name} disabled={busy} onChange={(e) => change('name', e.target.value)} />}
        </AdminFormField>
        <AdminFormField label="保留版本数量">
          {({ id }) => (
            <Input
              id={id}
              type="number"
              min={1}
              max={365}
              required
              value={draft.retention}
              disabled={busy}
              onChange={(e) => change('retention', Number(e.target.value))}
            />
          )}
        </AdminFormField>
      </div>
      <div className="backup-field-pair">
        <AdminFormField label="服务器主机" hint="填写域名或 IP，需在「备份设置」的服务器允许列表中。">
          {({ id }) => (
            <Input id={id} required value={draft.host} disabled={busy} onChange={(e) => change('host', e.target.value)} placeholder="backup.example.com" />
          )}
        </AdminFormField>
        <AdminFormField label="SSH 端口">
          {({ id }) => (
            <Input
              id={id}
              required
              type="number"
              min={1}
              max={65535}
              value={draft.port}
              disabled={busy}
              onChange={(e) => change('port', Number(e.target.value))}
            />
          )}
        </AdminFormField>
      </div>
      <AdminFormField label="远程备份目录" hint="使用绝对路径，建议为备份账号设置独立目录。">
        {({ id }) => <Input id={id} required value={draft.path} disabled={busy} onChange={(e) => change('path', e.target.value)} />}
      </AdminFormField>
      <AdminFormField label="用户名">
        {({ id }) => <Input id={id} required autoComplete="off" value={draft.username} disabled={busy} onChange={(e) => change('username', e.target.value)} />}
      </AdminFormField>
      <AdminFormField label="认证方式">
        {({ labelId }) => (
          <CustomSelect
            aria-labelledby={labelId}
            disabled={busy}
            value={auth}
            options={[
              { value: 'password', label: '密码' },
              { value: 'key', label: 'SSH 私钥' },
            ]}
            onChange={(value) => {
              setAuth(value as typeof auth)
              setDraft((previous) => ({ ...previous, password: '', privateKey: '' }))
            }}
          />
        )}
      </AdminFormField>
      {auth === 'password' ? (
        <AdminFormField label="登录密码" hint={target?.credentialSet ? '已设置；留空保留原认证材料。' : '保存后不会回显原值。'}>
          {({ id }) => (
            <Input
              id={id}
              type="password"
              autoComplete="new-password"
              value={draft.password || ''}
              disabled={busy}
              onChange={(e) => change('password', e.target.value)}
              placeholder={target?.credentialSet ? '已设置 · 留空保留' : '输入密码'}
            />
          )}
        </AdminFormField>
      ) : (
        <AdminFormField label="SSH 私钥" hint="填写未设置口令的专用私钥；留空保留已有认证材料。">
          {({ id }) => (
            <Textarea
              id={id}
              rows={5}
              autoComplete="off"
              value={draft.privateKey || ''}
              disabled={busy}
              onChange={(e) => change('privateKey', e.target.value)}
            />
          )}
        </AdminFormField>
      )}
      <AdminFormField label="服务器公钥" hint="从可信渠道获取完整公钥，例如 ssh-ed25519 AAAA…；保存后严格校验服务器身份。">
        {({ id }) => (
          <Textarea
            id={id}
            required
            rows={2}
            value={draft.hostKey}
            disabled={busy}
            onChange={(e) => change('hostKey', e.target.value)}
            placeholder="ssh-ed25519 AAAAC3…"
          />
        )}
      </AdminFormField>
      <label className="backup-check">
        <input type="checkbox" checked={draft.enabled} disabled={busy} onChange={(e) => change('enabled', e.target.checked)} />
        启用此目标
      </label>
      <label className="backup-check">
        <input type="checkbox" checked={draft.required} disabled={busy} onChange={(e) => change('required', e.target.checked)} />
        作为必需副本，传输完成前保留本地版本
      </label>
      {error && (
        <p role="alert" className="backup-error">
          {error}
        </p>
      )}
      <div className="backup-save">
        <Button type="button" variant="secondary" disabled={busy} onClick={onCancel}>
          取消
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? '保存中…' : '保存目标'}
        </Button>
      </div>
    </form>
  )
}
export function PolicyForm({ policy, targets, onSaved }: { policy: BackupPolicy; targets: BackupTarget[]; onSaved: () => void }) {
  const { toast } = useToast()
  const [draft, setDraft] = useState(policy),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const dirty = JSON.stringify(draft) !== JSON.stringify(policy)
  const change = (key: keyof BackupPolicy, value: unknown) => setDraft((previous) => ({ ...previous, [key]: value }))
  async function save(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await backupsApi.savePolicy(draft)
      toast('自动备份计划已保存', 'success')
      onSaved()
    } catch (e) {
      const message = e instanceof Error ? e.message : '保存失败'
      setError(message)
      toast(message, 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={(event) => void save(event)} className="backup-settings-layout">
      <Card className="admin-panel-card backup-schedule-card">
        <CardHeader className="backup-panel-header">
          <div>
            <CardTitle>备份执行策略</CardTitle>
            <p className="backup-panel-subtitle">设置自动执行频次、触发时点与本地安全保留数量</p>
          </div>
        </CardHeader>
        <CardContent className="backup-fields">
          <label className={`backup-schedule-toggle ${draft.enabled ? 'backup-schedule-toggle--active' : ''}`}>
            <input
              type="checkbox"
              checked={draft.enabled}
              disabled={busy}
              onChange={(e) => change('enabled', e.target.checked)}
            />
            <div className="backup-schedule-toggle__info">
              <span className="backup-schedule-toggle__title">自动执行备份</span>
              <span className="backup-schedule-toggle__desc">
                {draft.enabled ? '后台按预定周期自动执行备份并完成多副本同步' : '已暂停自动备份，仅支持手动备份'}
              </span>
            </div>
            <AdminStatusBadge tone={draft.enabled ? 'success' : 'neutral'}>
              {draft.enabled ? '已激活' : '已暂停'}
            </AdminStatusBadge>
          </label>

          <AdminFormField label="执行频率">
            {({ labelId }) => (
              <CustomSelect
                aria-labelledby={labelId}
                disabled={busy}
                value={draft.schedule}
                options={[
                  { value: 'daily', label: '每天' },
                  { value: 'weekly', label: '每周' },
                  { value: 'interval', label: '固定间隔' },
                ]}
                onChange={(value) => change('schedule', value)}
              />
            )}
          </AdminFormField>

          {draft.schedule === 'interval' ? (
            <AdminFormField label="间隔小时">
              {({ id }) => (
                <Input
                  id={id}
                  required
                  type="number"
                  min={1}
                  max={720}
                  value={draft.intervalHours}
                  disabled={busy}
                  onChange={(e) => change('intervalHours', Number(e.target.value))}
                />
              )}
            </AdminFormField>
          ) : (
            <>
              <div className="backup-field-pair">
                <AdminFormField label="执行时间">
                  {({ id, labelId }) => (
                    <CustomTimePicker
                      id={id}
                      aria-labelledby={labelId}
                      value={draft.time}
                      disabled={busy}
                      onChange={(value) => change('time', value)}
                    />
                  )}
                </AdminFormField>
                <AdminFormField label="时区">
                  {({ id }) => (
                    <Input
                      id={id}
                      required
                      value={draft.timezone}
                      disabled={busy}
                      onChange={(e) => change('timezone', e.target.value)}
                      placeholder="Asia/Shanghai"
                    />
                  )}
                </AdminFormField>
              </div>
              {draft.schedule === 'weekly' && (
                <AdminFormField label="执行日">
                  {({ labelId }) => (
                    <CustomSelect
                      aria-labelledby={labelId}
                      value={String(draft.weekday)}
                      disabled={busy}
                      options={['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'].map((label, value) => ({
                        label,
                        value: String(value),
                      }))}
                      onChange={(value) => change('weekday', Number(value))}
                    />
                  )}
                </AdminFormField>
              )}
            </>
          )}

          <AdminFormField label="本地保留版本数量" hint="固定版本和回滚前保护版本不会自动清理。">
            {({ id }) => (
              <Input
                id={id}
                required
                type="number"
                min={1}
                max={365}
                value={draft.localRetention}
                disabled={busy}
                onChange={(e) => change('localRetention', Number(e.target.value))}
              />
            )}
          </AdminFormField>
        </CardContent>
      </Card>

      <Card className="admin-panel-card backup-locations-card">
        <CardHeader className="backup-panel-header">
          <div>
            <CardTitle>多副本分发位置</CardTitle>
            <p className="backup-panel-subtitle">每次备份优先生成加密本地归档，并分发至所选远程目标</p>
          </div>
        </CardHeader>
        <CardContent className="backup-fields">
          <div className="backup-location-list">
            <div className="backup-location-item backup-location-item--locked">
              <div className="backup-location-item__main">
                <div className="backup-location-item__check">
                  <input type="checkbox" checked disabled />
                </div>
                <div className="backup-location-item__info">
                  <span className="backup-location-item__name">本地存储</span>
                  <span className="backup-location-item__desc">服务器内部加密目录 · 核心基准</span>
                </div>
              </div>
              <AdminStatusBadge tone="success">始终保留</AdminStatusBadge>
            </div>

            {targets
              .filter((target) => target.enabled)
              .map((target) => {
                const isChecked = draft.targetIds.includes(target.id)
                return (
                  <label
                    key={target.id}
                    className={`backup-location-item ${isChecked ? 'backup-location-item--selected' : ''}`}
                  >
                    <div className="backup-location-item__main">
                      <div className="backup-location-item__check">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          disabled={busy}
                          onChange={(e) =>
                            change(
                              'targetIds',
                              e.target.checked
                                ? [...draft.targetIds, target.id]
                                : draft.targetIds.filter((id) => id !== target.id),
                            )
                          }
                        />
                      </div>
                      <div className="backup-location-item__info">
                        <span className="backup-location-item__name">{target.name}</span>
                        <span className="backup-location-item__desc">
                          SFTP · {target.host}:{target.port}
                        </span>
                      </div>
                    </div>
                    {target.required ? (
                      <AdminStatusBadge tone="warning">必需副本</AdminStatusBadge>
                    ) : (
                      <AdminStatusBadge tone="neutral">可选副本</AdminStatusBadge>
                    )}
                  </label>
                )
              })}

            {!targets.some((target) => target.enabled) && (
              <p className="backup-hint">当前尚无启用的服务器目标，系统将自动使用本地加密备份。</p>
            )}
          </div>

          <div className="backup-schedule-status">
            <span className="backup-schedule-status__label">计划运行概况</span>
            <span className="backup-schedule-status__value">
              {policy.enabled ? '已激活' : '已停用'} · 下次运行：
              {policy.nextRunAt ? new Date(policy.nextRunAt).toLocaleString('zh-CN') : '未设定'}
            </span>
          </div>
        </CardContent>
      </Card>

      <div className="backup-settings-footer">
        {error && (
          <p role="alert" className="backup-error">
            {error}
          </p>
        )}
        <div className="backup-save">
          <span className="backup-hint">{dirty ? '有未保存的计划修改' : '已与当前配置同步'}</span>
          <Button type="button" variant="secondary" disabled={!dirty || busy} onClick={() => setDraft(policy)}>
            撤销
          </Button>
          <Button type="submit" disabled={!dirty || busy}>
            {busy ? '保存中…' : '保存计划'}
          </Button>
        </div>
      </div>
    </form>
  )
}
