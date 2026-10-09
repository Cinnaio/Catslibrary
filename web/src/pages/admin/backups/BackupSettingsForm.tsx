import { useState, type FormEvent } from 'react'
import type { BackupSettings, BackupSettingsInput, BackupSettingsPage } from '@shared/backups'
import { useToast } from '@/components/feedback'
import { backupsApi } from '@/lib/backups-api'
import AdminFormField from '@/components/admin/AdminFormField'
import BackupDeploymentPanel from './BackupDeploymentPanel'
import CustomSelect from '@/components/admin/CustomSelect'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'

export default function BackupSettingsForm({
  page,
  disabled,
  onSaved,
}: {
  page: BackupSettingsPage
  disabled: boolean
  onSaved: (value: BackupSettings) => void
}) {
  const { toast } = useToast()
  const { settings: initialSettings, deployment } = page
  const [settings, setSettings] = useState(initialSettings)
  const [encryptionReady, setEncryptionReady] = useState(deployment.encryption)
  const [draft, setDraft] = useState<BackupSettingsInput>({
    revision: settings.revision,
    hostSource: settings.hostSource,
    allowedHosts: settings.allowedHosts,
    rehearsalSource: settings.rehearsalSource,
    retryLimit: settings.retryLimit,
    logRetentionDays: settings.logRetentionDays,
  })
  const [hosts, setHosts] = useState(settings.allowedHosts.join('\n'))
  const [connection, setConnection] = useState('')
  const [notice, setNotice] = useState('')
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const policyDirty =
    draft.hostSource !== settings.hostSource ||
    draft.rehearsalSource !== settings.rehearsalSource ||
    draft.retryLimit !== settings.retryLimit ||
    draft.logRetentionDays !== settings.logRetentionDays ||
    (draft.hostSource === 'custom' && hosts !== settings.allowedHosts.join('\n')) ||
    (draft.rehearsalSource === 'custom' && Boolean(connection))
  const dirty = policyDirty
  const locked = busy || disabled
  function reset() {
    setDraft({
      revision: settings.revision,
      hostSource: settings.hostSource,
      allowedHosts: settings.allowedHosts,
      rehearsalSource: settings.rehearsalSource,
      retryLimit: settings.retryLimit,
      logRetentionDays: settings.logRetentionDays,
    })
    setHosts(settings.allowedHosts.join('\n'))
    setConnection('')
    setError('')
    setNotice('')
  }
  async function createRehearsal() {
    setBusy(true)
    setCreating(true)
    setError('')
    setNotice('')
    try {
      const { settings: value } = await backupsApi.createRehearsal(settings.revision)
      setSettings(value)
      setDraft((previous) => ({ ...previous, revision: value.revision, rehearsalSource: 'custom' }))
      setConnection('')
      setNotice('演练库已创建并保存，可用于恢复预检。')
      toast('演练库已创建并保存，可用于恢复预检。', 'success')
      // 存在其他草稿时不触发父级刷新，避免表单按 revision 重建并丢失输入。
      if (!policyDirty) onSaved(value)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '演练库创建失败'
      setError(message)
      toast(message, 'error')
    } finally {
      setBusy(false)
      setCreating(false)
    }
  }
  async function save(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const value = await backupsApi.saveSettings({
        ...draft,
        allowedHosts: hosts
          .split(/[\n,，]/)
          .map((host) => host.trim())
          .filter(Boolean),
        ...(draft.rehearsalSource === 'custom' && connection ? { rehearsalUrl: connection } : {}),
      })
      setConnection('')
      toast('备份设置已保存', 'success')
      onSaved(value)
    } catch (error) {
      const message = error instanceof Error ? error.message : '保存失败'
      setError(message)
      toast(message, 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="backup-settings-layout" onSubmit={(event) => void save(event)}>
      <Card className="admin-panel-card">
        <CardHeader>
          <CardTitle>服务器访问</CardTitle>
        </CardHeader>
        <CardContent className="backup-fields">
          <AdminFormField label="允许列表来源">
            {({ labelId }) => (
              <CustomSelect
                aria-labelledby={labelId}
                disabled={locked}
                value={draft.hostSource}
                options={[
                  { value: 'environment', label: '使用部署配置' },
                  { value: 'custom', label: '在后台配置' },
                ]}
                onChange={(value) => setDraft((previous) => ({ ...previous, hostSource: value as BackupSettings['hostSource'] }))}
              />
            )}
          </AdminFormField>
          <AdminFormField
            label="允许连接的服务器"
            htmlFor="backup-allowed-hosts"
            hint="每行一个主机名或 IP，也可用逗号分隔。填写主机即可，不包含协议、端口或通配符。"
          >
            <Textarea
              id="backup-allowed-hosts"
              rows={5}
              value={draft.hostSource === 'environment' ? deployment.environmentAllowedHosts.join('\n') : hosts}
              disabled={locked || draft.hostSource === 'environment'}
              onChange={(event) => setHosts(event.target.value)}
              placeholder="backup.example.com"
            />
          </AdminFormField>
          <p className="backup-hint">移除主机后，该服务器的传输和远程取回将停止。本地副本不受影响。回环与云元数据地址始终禁止访问。</p>
        </CardContent>
      </Card>
      <Card className="admin-panel-card">
        <CardHeader>
          <CardTitle>恢复演练</CardTitle>
        </CardHeader>
        <CardContent className="backup-fields">
          {!settings.rehearsalConfigured && (
            <>
              <div className="backup-actions">
                <Button type="button" variant="secondary" disabled={locked || !encryptionReady || Boolean(connection)} onClick={() => void createRehearsal()}>
                  {creating ? '正在创建演练库…' : '一键创建演练库'}
                </Button>
              </div>
              <p className="backup-hint">
                在当前 PostgreSQL 实例新建专用空库，自动初始化并保存连接。需要当前数据库账号具有 CREATEDB 权限；已有连接可在下方手动配置。
                {!encryptionReady && '请先配置备份主密钥。'}
                {connection && '若要自动创建，请先清空手动填写的连接地址。'}
              </p>
            </>
          )}
          <AdminFormField label="演练数据库来源" hint="切回部署配置或关闭在线回滚并保存后，会清除已保存的后台连接凭据。">
            {({ labelId }) => (
              <CustomSelect
                aria-labelledby={labelId}
                disabled={locked}
                value={draft.rehearsalSource}
                options={[
                  { value: 'environment', label: '使用部署配置' },
                  { value: 'custom', label: '在后台配置' },
                  { value: 'disabled', label: '关闭在线回滚' },
                ]}
                onChange={(value) => setDraft((previous) => ({ ...previous, rehearsalSource: value as BackupSettings['rehearsalSource'] }))}
              />
            )}
          </AdminFormField>
          {draft.rehearsalSource === 'custom' && (
            <AdminFormField
              label="演练数据库连接地址"
              htmlFor="backup-rehearsal-url"
              hint={
                settings.rehearsalSource === 'custom' && settings.rehearsalConfigured
                  ? '已保存的连接凭据不会回显。留空保留原值；填写新值将替换原连接。'
                  : '填写 PostgreSQL 连接地址。凭据加密保存，保存前验证连接与保护标记。'
              }
            >
              <Input
                id="backup-rehearsal-url"
                type="password"
                autoComplete="new-password"
                spellCheck={false}
                value={connection}
                disabled={locked}
                placeholder="postgresql://用户:密码@主机:5432/演练库"
                onChange={(event) => setConnection(event.target.value)}
              />
            </AdminFormField>
          )}
          <p className="backup-hint">
            当前连接：{settings.rehearsalConfigured ? settings.rehearsalLabel : '未配置'}。演练库必须与业务库不同名，且只能用于备份恢复测试。
          </p>
          <details className="backup-hint">
            <summary>演练库初始化说明</summary>
            <p>先创建独立数据库，再在该库执行以下 SQL 建立保护标记。保存只验证连接与标记；恢复预检会重建该库的 public 数据。</p>
            <pre className="backup-setup-code">{`CREATE SCHEMA backup_rehearsal;\nCREATE TABLE backup_rehearsal.guard (\n  key text PRIMARY KEY, value text NOT NULL\n);\nINSERT INTO backup_rehearsal.guard VALUES\n  ('purpose', 'zhi-zhou-backup-rehearsal');`}</pre>
          </details>
        </CardContent>
      </Card>
      <Card className="admin-panel-card">
        <CardHeader>
          <CardTitle>任务与日志</CardTitle>
        </CardHeader>
        <CardContent className="backup-fields">
          <AdminFormField
            label="远程失败自动重试次数"
            htmlFor="backup-retry-limit"
            hint="0 表示关闭，最多 3 次，分别等待 1、5、15 分钟。仅网络类失败自动重试。"
          >
            <Input
              id="backup-retry-limit"
              type="number"
              min={0}
              max={3}
              value={draft.retryLimit}
              disabled={locked}
              onChange={(event) => setDraft((previous) => ({ ...previous, retryLimit: Number(event.target.value) }))}
            />
          </AdminFormField>
          <AdminFormField
            label="常规日志保留天数"
            htmlFor="backup-log-retention"
            hint="7–3650 天。缩短期限后，过期常规日志会在后续任务清理时删除；恢复与预检日志持续保留。"
          >
            <Input
              id="backup-log-retention"
              type="number"
              min={7}
              max={3650}
              value={draft.logRetentionDays}
              disabled={locked}
              onChange={(event) => setDraft((previous) => ({ ...previous, logRetentionDays: Number(event.target.value) }))}
            />
          </AdminFormField>
        </CardContent>
      </Card>
      <BackupDeploymentPanel
        deployment={deployment}
        disabled={locked}
        onSaved={(value) => {
          setEncryptionReady(value.keyConfigured)
          if (!policyDirty) onSaved(settings)
        }}
      />
      <div className="backup-settings-footer">
        {notice && (
          <p role="status" className="backup-hint">
            {notice}
          </p>
        )}
        {error && (
          <p role="alert" className="backup-error">
            {error}
          </p>
        )}
        <div className="backup-save">
          <span className="backup-hint">{disabled ? '恢复期间暂时不能修改设置' : dirty ? '有未保存的修改' : '设置已保存；新任务使用当前配置'}</span>
          <Button type="button" variant="secondary" disabled={locked || !dirty} onClick={reset}>
            撤销修改
          </Button>
          <Button type="submit" disabled={locked || !dirty}>
            {busy ? '验证并保存中…' : '保存设置'}
          </Button>
        </div>
      </div>
    </form>
  )
}
