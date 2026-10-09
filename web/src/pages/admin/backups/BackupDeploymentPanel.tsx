import { useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { BackupDeployment, BackupSettingsPage, BackupToolName } from '@shared/backups'
import { backupsApi, saveBlob } from '@/lib/backups-api'
import AdminFormField from '@/components/admin/AdminFormField'
import AdminStatusBadge from '@/components/admin/AdminStatusBadge'
import { AdminDialogBody, AdminDialogContent } from '@/components/admin/AdminDialog'
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const tools = {
  dump: ['数据库导出工具', 'pg_dump'],
  restore: ['数据库恢复工具', 'pg_restore'],
  psql: ['数据库执行工具', 'psql'],
  transfer: ['SFTP 传输工具', 'rclone'],
} as const
type Editor = 'key' | 'dump' | 'restore' | 'transfer'
const pathsOf = (runtime?: BackupDeployment) =>
  Object.fromEntries(Object.keys(tools).map((name) => [name, runtime?.tools[name as BackupToolName].configuredPath || ''])) as Record<BackupToolName, string>

export default function BackupDeploymentPanel({
  deployment,
  disabled,
  onSaved,
}: {
  deployment: BackupSettingsPage['deployment']
  disabled: boolean
  onSaved: () => void
}) {
  const [runtime, setRuntime] = useState(deployment.runtime)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [paths, setPaths] = useState(pathsOf(runtime))
  const [masterKey, setMasterKey] = useState('')
  const [persistCurrentKey, setPersistCurrentKey] = useState(false)
  const [detected, setDetected] = useState<BackupDeployment | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const trigger = useRef<HTMLButtonElement | null>(null)
  const keyConfigured = runtime?.keyConfigured ?? deployment.encryption
  const locked = busy || disabled
  const dirty =
    Boolean(masterKey.trim()) || persistCurrentKey || Object.entries(paths).some(([name, path]) => path !== pathsOf(runtime)[name as BackupToolName])
  const activeTools: BackupToolName[] = editor === 'restore' ? ['restore', 'psql'] : editor && editor !== 'key' ? [editor] : []
  const input = () => ({
    revision: runtime?.revision || 0,
    tools: paths,
    persistCurrentKey,
    ...(masterKey.trim() ? { masterKey: masterKey.trim() } : {}),
  })
  function open(value: Editor, button: HTMLButtonElement) {
    trigger.current = button
    setPaths(pathsOf(runtime))
    setMasterKey('')
    setPersistCurrentKey(false)
    setDetected(null)
    setError('')
    setNotice('')
    setEditor(value)
  }
  function close() {
    if (busy) return
    setEditor(null)
    setMasterKey('')
    setPersistCurrentKey(false)
    setDetected(null)
    setError('')
    setNotice('')
  }
  async function run(action: 'generate' | 'detect' | 'save') {
    setBusy(true)
    setError('')
    try {
      if (action === 'generate') {
        const result = await backupsApi.generateDeploymentKey()
        setMasterKey(result.masterKey)
        saveBlob(new Blob([JSON.stringify(result, null, 2) + '\n'], { type: 'application/json' }), 'zhi-zhou-backup-master-key.json')
        setNotice('已生成并发起密钥文件下载，尚未保存。请单独保管下载文件，再点击保存配置。')
      } else if (action === 'detect') {
        setDetected((await backupsApi.detectDeployment(input())).deployment)
      } else {
        const result = await backupsApi.saveDeployment(input())
        setRuntime(result.deployment)
        setPaths(pathsOf(result.deployment))
        setEditor(null)
        setMasterKey('')
        setPersistCurrentKey(false)
        setDetected(null)
        setNotice('本地运行配置已保存，新任务立即使用。')
        onSaved()
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card className="admin-panel-card">
      <CardHeader>
        <CardTitle>本地与运行环境</CardTitle>
      </CardHeader>
      <CardContent className="backup-fields">
        <dl className="backup-environment-list">
          <div>
            <dt>本地备份目录</dt>
            <dd>{deployment.localDirectory}</dd>
          </div>
          <div>
            <dt>加密密钥标识</dt>
            <dd>{runtime?.keyId || deployment.keyId}</dd>
          </div>
        </dl>
        <div className="backup-environment-controls">
          {(['key', 'dump', 'restore', 'transfer'] as const).map((name) => {
            const ready =
              name === 'key'
                ? keyConfigured
                : name === 'restore'
                  ? runtime
                    ? runtime.tools.restore.ready && runtime.tools.psql.ready
                    : deployment.restore
                  : (runtime?.tools[name].ready ?? deployment[name])
            return (
              <button
                key={name}
                type="button"
                className="backup-environment-control"
                disabled={locked}
                aria-haspopup="dialog"
                onClick={(event) => open(name, event.currentTarget)}
              >
                <span>{name === 'key' ? '主密钥' : tools[name][0]}</span>
                <span className="backup-environment-control-status">
                  <AdminStatusBadge tone={ready ? 'success' : 'warning'}>{ready ? '已就绪' : '未配置'}</AdminStatusBadge>
                  <ChevronRight size={16} aria-hidden="true" />
                </span>
              </button>
            )
          })}
        </div>
        <p className="backup-hint">点击对应项配置主密钥或工具路径。配置保存到服务器本地文件，重启后继续生效；容器部署请持久化配置目录，密钥文件请单独保管。</p>
        {!editor && notice && (
          <p role="status" className="backup-hint">
            {notice}
          </p>
        )}
        <Dialog
          open={editor !== null}
          onOpenChange={(value) => {
            if (!value) close()
          }}
        >
          <AdminDialogContent
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              trigger.current?.focus()
            }}
            onEscapeKeyDown={(event) => {
              if (locked) event.preventDefault()
            }}
            onPointerDownOutside={(event) => {
              if (locked) event.preventDefault()
            }}
          >
            <DialogHeader>
              <DialogTitle>{editor === 'key' ? '设置主密钥' : editor ? '设置' + tools[editor][0] : '运行配置'}</DialogTitle>
              <DialogDescription>
                {editor === 'key'
                  ? '主密钥用于加密备份与连接凭据。已有密钥不能直接覆盖。'
                  : '填写运行 API 的服务器或容器中已安装工具的绝对路径；留空使用部署路径或自动检测。'}
              </DialogDescription>
            </DialogHeader>
            <AdminDialogBody className="backup-fields">
              {editor === 'key' ? (
                <>
                  <AdminFormField
                    label="备份主密钥"
                    htmlFor="backup-master-key"
                    hint={keyConfigured ? '已配置，密钥不回显。' : '输入 32 字节随机数据的 Base64，或在下方一键生成并导出。'}
                  >
                    <Input
                      id="backup-master-key"
                      type="password"
                      autoComplete="new-password"
                      spellCheck={false}
                      value={masterKey}
                      disabled={locked || keyConfigured}
                      onChange={(event) => setMasterKey(event.target.value)}
                      placeholder={keyConfigured ? '已配置 · 不回显密钥' : '输入已有主密钥'}
                    />
                  </AdminFormField>
                  {runtime?.keySource === 'environment' && (
                    <Button type="button" variant="secondary" disabled={locked} onClick={() => setPersistCurrentKey((value) => !value)}>
                      {persistCurrentKey ? '取消迁入本地' : '将现有密钥保存到本地'}
                    </Button>
                  )}
                  {persistCurrentKey && <p className="backup-hint">原样迁入当前环境中的密钥，保存后可移除对应环境变量；不会更换密钥。</p>}
                </>
              ) : (
                activeTools.map((name) => {
                  const status = (detected || runtime)?.tools[name]
                  return (
                    <AdminFormField key={name} label={tools[name][0]} htmlFor={'backup-tool-' + name} hint={'服务器上的 ' + tools[name][1] + ' 路径'}>
                      <Input
                        id={'backup-tool-' + name}
                        value={paths[name]}
                        disabled={locked}
                        placeholder={status?.effectivePath || tools[name][1]}
                        onChange={(event) => {
                          setPaths((value) => ({ ...value, [name]: event.target.value }))
                          setDetected(null)
                        }}
                      />
                      {status && (
                        <p className="backup-hint">
                          <AdminStatusBadge tone={status.ready ? 'success' : 'warning'}>{status.ready ? '已就绪' : '未检测到'}</AdminStatusBadge>{' '}
                          {status.ready
                            ? '版本 ' + status.version + ' · ' + { local: '后台配置', environment: '部署配置', automatic: '自动检测' }[status.source]
                            : status.error}
                        </p>
                      )}
                    </AdminFormField>
                  )
                })
              )}
              <div className="backup-actions">
                {editor === 'key' ? (
                  !keyConfigured && (
                    <Button type="button" variant="secondary" disabled={locked || Boolean(masterKey)} onClick={() => void run('generate')}>
                      生成并导出密钥
                    </Button>
                  )
                ) : (
                  <Button type="button" variant="secondary" disabled={locked} onClick={() => void run('detect')}>
                    检测工具
                  </Button>
                )}
              </div>
              <p className="backup-hint">保存位置：{runtime?.configFile || 'data/backup-config.json'}，不写入数据库。</p>
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
            </AdminDialogBody>
            <DialogFooter>
              <Button type="button" variant="secondary" disabled={busy} onClick={close}>
                取消
              </Button>
              <Button type="button" disabled={locked || !dirty} onClick={() => void run('save')}>
                {busy ? '处理中…' : '保存配置'}
              </Button>
            </DialogFooter>
          </AdminDialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}
