import { useEffect, useState, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Download, RotateCcw, Pin, Trash2, RefreshCw, Plus } from 'lucide-react'
import type { BackupEvent, BackupOverview, BackupPage, BackupSettingsPage, BackupTarget, BackupTask, BackupVersion } from '@shared/backups'
import { backupsApi, saveBlob } from '@/lib/backups-api'
import { useConfirm, useToast } from '@/components/feedback'
import AdminPage from '@/components/admin/AdminPage'
import { AdminDataPanel, AdminPanelHeading, AdminToolbar } from '@/components/admin/AdminWorkspace'
import AdminStatusBadge from '@/components/admin/AdminStatusBadge'
import AdminRowActions from '@/components/admin/AdminRowActions'
import AdminEmptyState from '@/components/admin/AdminEmptyState'
import { LoadingState } from '@/components/admin/AsyncStates'
import { AdminDialogBody, AdminDialogContent } from '@/components/admin/AdminDialog'
import AdminFormField from '@/components/admin/AdminFormField'
import Pagination from '@/components/admin/Pagination'
import CustomSelect from '@/components/admin/CustomSelect'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import BackupSettingsForm from './backups/BackupSettingsForm'
import { TargetForm, PolicyForm } from './backups/BackupForms'
import '@/styles/admin/pages/backups.css'

const states: Record<string, string> = {
  queued: '等待执行',
  running: '执行中',
  completed: '全部完成',
  partial: '部分完成',
  failed: '失败',
  interrupted: '已中断',
  available: '已校验',
  pending: '等待传输',
  uploading: '传输中',
  deleted: '已清理',
  delete_pending: '待清理',
}
const kinds: Record<string, string> = { backup: '备份', test: '连接测试', retry: '副本重试', preview: '恢复预检', restore: '版本回滚', delete: '删除版本' }
const date = (value: number) => (value ? new Date(value).toLocaleString('zh-CN') : '—')
const size = (value: number) =>
  value >= 1073741824 ? `${(value / 1073741824).toFixed(2)} GB` : value >= 1048576 ? `${(value / 1048576).toFixed(1)} MB` : `${(value / 1024).toFixed(1)} KB`
const titles: Record<string, string> = { versions: '备份版本', targets: '存储目标', schedule: '自动备份', logs: '操作日志', settings: '备份设置' }
function Status({ state }: { state: string }) {
  return (
    <AdminStatusBadge
      tone={
        ['completed', 'available'].includes(state)
          ? 'success'
          : ['failed', 'interrupted'].includes(state)
            ? 'danger'
            : state === 'partial'
              ? 'warning'
              : 'neutral'
      }
    >
      {states[state] || state}
    </AdminStatusBadge>
  )
}

export default function BackupsTab() {
  const [params] = useSearchParams(),
    view = Object.hasOwn(titles, params.get('view') || '') ? params.get('view')! : 'versions'
  const { toast } = useToast(),
    { confirm } = useConfirm()
  const [overview, setOverview] = useState<BackupOverview | null>(null),
    [list, setList] = useState<BackupPage<BackupVersion>>({ items: [], total: 0 }),
    [logs, setLogs] = useState<BackupPage<BackupEvent>>({ items: [], total: 0 })
  const [settings, setSettings] = useState<BackupSettingsPage | null>(null)
  const [page, setPage] = useState(1),
    [level, setLevel] = useState(''),
    [reload, setReload] = useState(0),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false)
  const [targetEditor, setTargetEditor] = useState<BackupTarget | null | undefined>(undefined),
    [selectedVersion, setSelectedVersion] = useState<BackupVersion | null>(null)
  const [taskId, setTaskId] = useState(''),
    [task, setTask] = useState<BackupTask | null>(null),
    [taskLogs, setTaskLogs] = useState<BackupEvent[]>([])
  const [backupOpen, setBackupOpen] = useState(false),
    [backupTargets, setBackupTargets] = useState<string[]>([]),
    [note, setNote] = useState('')
  const [restoreTask, setRestoreTask] = useState<BackupTask | null>(null),
    [password, setPassword] = useState(''),
    [confirmVersion, setConfirmVersion] = useState('')
  const requestSequence = useRef(0)
  const refresh = () => setReload((value) => value + 1)
  useEffect(() => {
    setPage(1)
  }, [view, level])
  useEffect(() => {
    const sequence = ++requestSequence.current
    setLoading(true)
    void Promise.all([
      backupsApi.overview(),
      view === 'versions' ? backupsApi.versions(page) : Promise.resolve(null),
      view === 'logs' ? backupsApi.logs(page, '', level) : Promise.resolve(null),
      view === 'settings' ? backupsApi.settings() : Promise.resolve(null),
    ])
      .then(([data, versions, events, settingsPage]) => {
        if (sequence !== requestSequence.current) return
        setOverview(data)
        if (versions) setList(versions)
        if (events) setLogs(events)
        if (settingsPage) setSettings(settingsPage)
        setError('')
      })
      .catch((e) => {
        if (sequence === requestSequence.current) setError(e instanceof Error ? e.message : '加载失败')
      })
      .finally(() => {
        if (sequence === requestSequence.current) setLoading(false)
      })
    return () => {
      requestSequence.current++
    }
  }, [view, page, level, reload])
  useEffect(() => {
    if (!overview?.tasks.some((item) => item.state === 'queued' || item.state === 'running')) return
    const timer = setInterval(refresh, 4000)
    return () => clearInterval(timer)
  }, [overview])
  useEffect(() => {
    if (!taskId) {
      setTask(null)
      setTaskLogs([])
      return
    }
    let active = true
    const load = async () => {
      try {
        const [data, events] = await Promise.all([backupsApi.task(taskId), backupsApi.logs(1, taskId)])
        if (active) {
          setTask(data)
          setTaskLogs(events.items.reverse())
        }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : '任务读取失败')
      }
    }
    void load()
    const timer = setInterval(() => void load(), 3000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [taskId])
  async function action(work: () => Promise<unknown>, success = '操作已完成') {
    setBusy(true)
    setError('')
    try {
      await work()
      toast(success, 'success')
      refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }
  async function queued(work: () => Promise<BackupTask>) {
    await action(async () => {
      const value = await work()
      setTask(null)
      setTaskId(value.id)
      setSelectedVersion(null)
    }, '任务已进入队列')
  }
  async function remove(version: BackupVersion) {
    if (await confirm({ title: '删除备份版本', message: '将删除此版本的本地及远程副本。固定版本、保护版本和最后一个可恢复版本不能删除。', okText: '删除版本' }))
      await queued(() => backupsApi.remove(version.id))
  }
  async function archive(target: BackupTarget) {
    if (await confirm({ title: '移除存储目标', message: '停止使用此目标；已有版本的远程副本会保留。请先从自动备份计划中移除它。', okText: '移除目标' }))
      await action(() => backupsApi.archiveTarget(target.id))
  }
  const ready = Boolean(overview?.capabilities.encryption && overview.capabilities.dump && !overview.maintenance)
  const dependencies = overview
    ? [
        !overview.capabilities.encryption && '备份主密钥',
        !overview.capabilities.dump && 'pg_dump',
        !overview.capabilities.restore && 'pg_restore / psql',
        !overview.capabilities.transfer && 'rclone（远程传输）',
        !overview.capabilities.rehearsal && '隔离演练数据库（版本回滚）',
      ].filter(Boolean)
    : []
  return (
    <AdminPage
      title={titles[view]}
      description={
        view === 'versions'
          ? '保存书库与站点数据，查看副本状态并恢复指定版本。'
          : view === 'targets'
            ? '同时保留本地版本，并将加密副本发送到 SSH 服务器。'
            : view === 'schedule'
              ? '设置执行时间、备份位置与版本保留数量。'
              : view === 'settings'
                ? '管理服务器访问、恢复演练与任务保留设置。'
                : '查看备份、传输、预检与回滚的执行记录。'
      }
      className="backup-page"
      actions={
        <>
          <Button variant="secondary" disabled={busy || loading} onClick={refresh}>
            <RefreshCw size={16} />
            刷新
          </Button>
          {view === 'versions' && (
            <Button
              disabled={!ready || busy}
              onClick={() => {
                setBackupTargets(overview?.policy.targetIds || [])
                setNote('')
                setBackupOpen(true)
              }}
            >
              <Plus size={16} />
              立即备份
            </Button>
          )}
          {view === 'targets' && (
            <Button disabled={busy || overview?.maintenance} onClick={() => setTargetEditor(null)}>
              <Plus size={16} />
              添加服务器
            </Button>
          )}
        </>
      }
    >
      {error && (
        <div role="alert" className="backup-error">
          <span>{error}</span>
          <Button variant="ghost" onClick={refresh}>
            重新加载
          </Button>
        </div>
      )}
      {!overview && loading && <LoadingState label="正在读取备份配置" />}
      {overview && (
        <>
          {overview.maintenance && (
            <div className="backup-notice" role="status">
              站点正在恢复备份，业务访问暂时关闭。中断恢复请按部署文档处理，保护版本与日志会保留。
            </div>
          )}
          {!!dependencies.length && (
            <div className="backup-notice">
              <strong>部署准备</strong>
              <p>尚未就绪：{dependencies.join('、')}。配置完成后，相应操作会自动开放。</p>
              {view !== 'settings' && <Link to="/admin/backups?view=settings">前往备份设置</Link>}
            </div>
          )}
          {view === 'versions' && (
            <>
              <AdminToolbar>
                <p className="backup-hint">
                  {overview.policy.enabled ? `自动备份已启用 · 下次 ${date(overview.policy.nextRunAt)}` : '自动备份已关闭'} · 共 {list.total} 个版本
                </p>
              </AdminToolbar>
              <AdminDataPanel
                density="comfortable"
                columns={[
                  { key: 'version', label: '版本', primary: true },
                  { key: 'time', label: '备份时间', width: '12rem' },
                  { key: 'copies', label: '副本状态', width: '12rem' },
                  { key: 'size', label: '大小', width: '7rem' },
                  { key: 'actions', label: '操作', actions: true, width: '9rem' },
                ]}
                ariaLabel="备份版本"
              >
                <Table className="admin-data-table">
                  <TableHeader>
                    <TableRow>
                      {['版本', '备份时间', '副本状态', '大小', '操作'].map((text) => (
                        <TableHead key={text}>{text}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {list.items.map((version) => (
                      <TableRow key={version.id}>
                        <TableCell data-primary data-label="版本">
                          <div className="backup-cell">
                            <strong>
                              {version.note || (version.protection ? '回滚前保护备份' : version.trigger === 'scheduled' ? '自动备份' : '手动备份')}
                            </strong>
                            <span className="backup-id" title={version.id}>
                              {version.id}
                            </span>
                            {version.pinned && <span className="backup-hint">{version.protection ? '保护版本' : '固定保留'}</span>}
                          </div>
                        </TableCell>
                        <TableCell data-label="备份时间">
                          <div className="backup-cell">
                            <span>{date(version.createdAt)}</span>
                            <Status state={version.state} />
                          </div>
                        </TableCell>
                        <TableCell data-label="副本状态">
                          <div className="backup-cell">
                            {version.copies.map((copy) => (
                              <span className="backup-copy" key={copy.targetId}>
                                <span>{copy.name}</span>
                                <Status state={copy.state} />
                              </span>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell data-label="大小">{version.size ? size(version.size) : '—'}</TableCell>
                        <TableCell data-actions>
                          <AdminRowActions
                            label={version.note || '备份版本'}
                            items={[
                              {
                                label: version.pinned ? '取消固定保留' : '固定保留',
                                icon: Pin,
                                disabled: busy || version.protection,
                                onSelect: () => void action(() => backupsApi.pin(version.id, !version.pinned)),
                              },
                              {
                                label: '重试远程副本',
                                icon: RefreshCw,
                                disabled: busy || !version.digest,
                                onSelect: () => void queued(() => backupsApi.retry(version.id)),
                              },
                              {
                                label: '删除版本',
                                icon: Trash2,
                                danger: true,
                                disabled: busy || version.pinned || version.protection,
                                onSelect: () => void remove(version),
                              },
                            ]}
                          >
                            <Button variant="ghost" size="sm" onClick={() => setSelectedVersion(version)}>
                              详情
                            </Button>
                          </AdminRowActions>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {!list.items.length && <AdminEmptyState message="还没有备份版本" hint="完成部署准备后，可以立即备份或设置自动备份。" />}
              </AdminDataPanel>
              <Pagination
                page={page}
                totalPages={Math.ceil(list.total / 20)}
                onPage={setPage}
                summary={`共 ${list.total} 个版本`}
                variant="detached"
                busy={loading}
              />
            </>
          )}
          {view === 'targets' && (
            <div className="backup-targets">
              <Card className="admin-panel-card">
                <CardHeader>
                  <CardTitle>本地存储</CardTitle>
                </CardHeader>
                <CardContent className="backup-fields">
                  <p className="backup-hint">每次备份先在服务器生成加密归档。本地目录由部署配置管理，与网站静态文件隔离。</p>
                  <div className="backup-copy">
                    <span>保留最近 {overview.policy.localRetention} 个版本</span>
                    <AdminStatusBadge tone="success">始终启用</AdminStatusBadge>
                  </div>
                </CardContent>
              </Card>
              {overview.targets.map((target) => (
                <Card key={target.id} className="admin-panel-card">
                  <CardHeader>
                    <CardTitle>{target.name}</CardTitle>
                  </CardHeader>
                  <CardContent className="backup-fields">
                    <div className="backup-copy">
                      <span>
                        SFTP · {target.host}:{target.port}
                      </span>
                      <AdminStatusBadge tone={target.enabled ? 'success' : 'neutral'}>{target.enabled ? '已启用' : '已停用'}</AdminStatusBadge>
                    </div>
                    <p className="backup-hint">
                      {target.path}
                      <br />
                      保留 {target.retention} 个版本 · {target.required ? '必需副本' : '可选副本'} ·{' '}
                      {target.credentialSet ? '认证材料已设置' : '尚未设置认证材料'}
                    </p>
                    <div className="backup-actions">
                      <Button variant="secondary" onClick={() => setTargetEditor(target)}>
                        编辑
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={busy || !overview.capabilities.transfer || !target.credentialSet}
                        onClick={() => void queued(() => backupsApi.test(target.id))}
                      >
                        测试连接
                      </Button>
                      <Button variant="ghost" disabled={busy} onClick={() => void archive(target)}>
                        移除
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
              {!overview.targets.length && <p className="backup-hint">尚未添加服务器。本地备份可独立使用，远程备份需要 rclone 与专用 SSH 账号。</p>}
            </div>
          )}
          {view === 'schedule' && (
            <PolicyForm
              key={overview.policy.revision}
              policy={overview.policy}
              targets={overview.targets}
              onSaved={() => {
                toast('自动备份计划已保存', 'success')
                refresh()
              }}
            />
          )}
          {view === 'settings' && settings && (
            <BackupSettingsForm
              key={`${settings.settings.revision}:${settings.deployment.runtime?.revision || 0}`}
              page={settings}
              disabled={overview.maintenance}
              onSaved={(value) => {
                setSettings((previous) => (previous ? { ...previous, settings: value } : previous))
                toast('备份设置已保存', 'success')
                refresh()
              }}
            />
          )}
          {view === 'logs' && (
            <>
              <AdminToolbar>
                <CustomSelect
                  compact
                  aria-label="日志级别"
                  value={level}
                  options={[
                    { value: '', label: '全部日志' },
                    { value: 'info', label: '正常记录' },
                    { value: 'warning', label: '注意事项' },
                    { value: 'error', label: '错误记录' },
                  ]}
                  onChange={setLevel}
                />
                <span className="backup-hint">共 {logs.total} 条记录</span>
                <Button
                  variant="ghost"
                  onClick={() => saveBlob(new Blob([JSON.stringify(logs.items, null, 2)], { type: 'application/json' }), 'backup-logs-page.json')}
                >
                  导出本页
                </Button>
              </AdminToolbar>
              <AdminDataPanel
                columns={[
                  { key: 'event', label: '执行记录', primary: true },
                  { key: 'time', label: '时间', width: '12rem' },
                  { key: 'action', label: '任务', actions: true, width: '7rem' },
                ]}
              >
                <Table className="admin-data-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead>执行记录</TableHead>
                      <TableHead>时间</TableHead>
                      <TableHead>任务</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.items.map((event) => (
                      <TableRow key={event.id}>
                        <TableCell data-primary data-label="执行记录">
                          <div className="backup-cell">
                            <span>{event.message}</span>
                            <AdminStatusBadge tone={event.level === 'error' ? 'danger' : event.level === 'warning' ? 'warning' : 'neutral'}>
                              {event.level === 'error' ? '错误' : event.level === 'warning' ? '注意' : '记录'}
                            </AdminStatusBadge>
                          </div>
                        </TableCell>
                        <TableCell data-label="时间">{date(event.createdAt)}</TableCell>
                        <TableCell data-actions>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setTask(null)
                              setTaskId(event.taskId)
                            }}
                          >
                            查看任务
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {!logs.items.length && <AdminEmptyState message="没有匹配的操作日志" />}
              </AdminDataPanel>
              <Pagination
                page={page}
                totalPages={Math.ceil(logs.total / 20)}
                onPage={setPage}
                summary={`共 ${logs.total} 条记录`}
                variant="detached"
                busy={loading}
              />
            </>
          )}
          {!!overview.tasks.length && view !== 'logs' && (
            <Card className="admin-panel-card">
              <AdminPanelHeading title="最近任务" />
              <CardContent>
                <div className="backup-task-list">
                  {overview.tasks.slice(0, 5).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="backup-task"
                      onClick={() => {
                        setTask(null)
                        setTaskId(item.id)
                      }}
                    >
                      <span>
                        {kinds[item.kind]}
                        <small>{item.stage}</small>
                      </span>
                      <span>
                        <Status state={item.state} />
                        <small>{date(item.createdAt)}</small>
                      </span>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
      <Dialog
        open={targetEditor !== undefined}
        onOpenChange={(open) => {
          if (!open) setTargetEditor(undefined)
        }}
      >
        <AdminDialogContent>
          <DialogHeader>
            <DialogTitle>{targetEditor ? '编辑服务器' : '添加服务器'}</DialogTitle>
            <DialogDescription>通过 SFTP 保存加密副本，认证材料不会回显。</DialogDescription>
          </DialogHeader>
          <AdminDialogBody>
            {targetEditor !== undefined && (
              <TargetForm
                key={targetEditor?.id || 'new'}
                target={targetEditor}
                onCancel={() => setTargetEditor(undefined)}
                onSaved={() => {
                  setTargetEditor(undefined)
                  toast('存储目标已保存', 'success')
                  refresh()
                }}
              />
            )}
          </AdminDialogBody>
        </AdminDialogContent>
      </Dialog>
      <Dialog open={backupOpen} onOpenChange={setBackupOpen}>
        <AdminDialogContent>
          <DialogHeader>
            <DialogTitle>立即备份</DialogTitle>
            <DialogDescription>生成一个可独立恢复的全量版本。本地与所选远程位置将保存同一份加密归档。</DialogDescription>
          </DialogHeader>
          <AdminDialogBody>
            <div className="backup-fields">
              <AdminFormField label="版本备注">
                {({ id }) => <Input id={id} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="例如：升级前备份" />}
              </AdminFormField>
              <label className="backup-check">
                <input type="checkbox" checked disabled />
                本地存储
              </label>
              {overview?.targets
                .filter((target) => target.enabled)
                .map((target) => (
                  <label className="backup-check" key={target.id}>
                    <input
                      type="checkbox"
                      checked={backupTargets.includes(target.id)}
                      onChange={(e) => setBackupTargets(e.target.checked ? [...backupTargets, target.id] : backupTargets.filter((id) => id !== target.id))}
                    />
                    {target.name}
                  </label>
                ))}
              <Button
                disabled={busy}
                onClick={() =>
                  void queued(async () => {
                    const value = await backupsApi.backup(backupTargets, note)
                    setBackupOpen(false)
                    return value
                  })
                }
              >
                {busy ? '提交中…' : '开始备份'}
              </Button>
            </div>
          </AdminDialogBody>
        </AdminDialogContent>
      </Dialog>
      <Dialog
        open={Boolean(selectedVersion)}
        onOpenChange={(open) => {
          if (!open) setSelectedVersion(null)
        }}
      >
        <AdminDialogContent>
          <DialogHeader>
            <DialogTitle>备份版本详情</DialogTitle>
            <DialogDescription>检查副本、下载归档或预检恢复。</DialogDescription>
          </DialogHeader>
          <AdminDialogBody>
            {selectedVersion && (
              <div className="backup-fields">
                <p className="backup-id">{selectedVersion.id}</p>
                <Status state={selectedVersion.state} />
                <p className="backup-hint">
                  {date(selectedVersion.createdAt)} · {size(selectedVersion.size)} · 迁移版本 {selectedVersion.migrationVersion}
                </p>
                <p className="backup-id">SHA-256：{selectedVersion.digest || '尚未生成'}</p>
                {selectedVersion.copies.map((copy) => (
                  <div key={copy.targetId} className="backup-fields">
                    <div className="backup-copy">
                      <span>{copy.name}</span>
                      <Status state={copy.state} />
                    </div>
                    {copy.error && <p className="backup-error">{copy.error}</p>}
                  </div>
                ))}
                <div className="backup-actions">
                  <Button
                    variant="secondary"
                    disabled={busy || !selectedVersion.digest}
                    onClick={() => void action(() => backupsApi.download(selectedVersion.id), '归档已下载')}
                  >
                    <Download size={16} />
                    下载归档
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy || !selectedVersion.digest}
                    onClick={() =>
                      void action(
                        async () =>
                          saveBlob(
                            new Blob([JSON.stringify(await backupsApi.manifest(selectedVersion.id), null, 2)], { type: 'application/json' }),
                            `${selectedVersion.id}.manifest.json`,
                          ),
                        '恢复清单已下载',
                      )
                    }
                  >
                    下载恢复清单
                  </Button>
                </div>
                <p className="backup-hint">
                  异机灾备需要同时保存加密归档、恢复清单与单独保管的主密钥。在线回滚保留当前部署配置，数据与用户账户会恢复到该版本。
                </p>
                <Button
                  disabled={busy || !selectedVersion.digest || !overview?.capabilities.rehearsal || !overview.capabilities.restore}
                  onClick={() => void queued(() => backupsApi.preview(selectedVersion.id))}
                >
                  <RotateCcw size={16} />
                  预检恢复此版本
                </Button>
              </div>
            )}
          </AdminDialogBody>
        </AdminDialogContent>
      </Dialog>
      <Dialog
        open={Boolean(taskId)}
        onOpenChange={(open) => {
          if (!open) setTaskId('')
        }}
      >
        <AdminDialogContent>
          <DialogHeader>
            <DialogTitle>{task ? kinds[task.kind] : '任务详情'}</DialogTitle>
            <DialogDescription>查看任务阶段和执行日志。</DialogDescription>
          </DialogHeader>
          <AdminDialogBody>
            {task ? (
              <div className="backup-fields">
                <Status state={task.state} />
                <p className="backup-hint">
                  {task.actor} · {date(task.createdAt)}
                  <br />
                  {task.stage}
                </p>
                {task.error && <p className="backup-error">{task.error}</p>}
                <div className="backup-log-list">
                  {taskLogs.map((event) => (
                    <div key={event.id}>
                      <time>{date(event.createdAt)}</time>
                      <p>{event.message}</p>
                    </div>
                  ))}
                </div>
                {task.kind === 'preview' && task.state === 'completed' && task.result?.previewToken && (
                  <>
                    <p className="backup-hint">
                      演练通过。恢复后可登录管理员：{task.result.administrators?.join('、')}。有效至 {date(task.result.expiresAt || 0)}。
                    </p>
                    <Button
                      disabled={busy || (task.result.expiresAt || 0) < Date.now()}
                      onClick={() => {
                        setRestoreTask(task)
                        setPassword('')
                        setConfirmVersion('')
                        setTaskId('')
                      }}
                    >
                      确认回滚…
                    </Button>
                  </>
                )}
                {task.result?.protectionId && <p className="backup-id">保护版本：{task.result.protectionId}</p>}
              </div>
            ) : (
              <LoadingState label="正在读取任务" />
            )}
          </AdminDialogBody>
        </AdminDialogContent>
      </Dialog>
      <Dialog
        open={Boolean(restoreTask)}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setRestoreTask(null)
            setPassword('')
          }
        }}
      >
        <AdminDialogContent>
          <DialogHeader>
            <DialogTitle>回滚到指定版本</DialogTitle>
            <DialogDescription>站点将暂时进入维护模式。系统先创建保护备份，再覆盖业务数据；恢复成功后所有用户需重新登录。</DialogDescription>
          </DialogHeader>
          <AdminDialogBody>
            {restoreTask && (
              <form
                className="backup-fields"
                onSubmit={(e) => {
                  e.preventDefault()
                  void queued(async () => {
                    const value = await backupsApi.restore(restoreTask.versionId, {
                      previewTaskId: restoreTask.id,
                      previewToken: restoreTask.result?.previewToken || '',
                      password,
                      confirmVersion,
                    })
                    setRestoreTask(null)
                    setPassword('')
                    return value
                  })
                }}
              >
                <p className="backup-id">{restoreTask.versionId}</p>
                <AdminFormField label="输入完整目标版本标识">
                  {({ id }) => (
                    <Input id={id} required value={confirmVersion} disabled={busy} onChange={(e) => setConfirmVersion(e.target.value)} autoComplete="off" />
                  )}
                </AdminFormField>
                <AdminFormField label="当前管理员密码">
                  {({ id }) => (
                    <Input
                      id={id}
                      required
                      type="password"
                      value={password}
                      disabled={busy}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="current-password"
                    />
                  )}
                </AdminFormField>
                {error && (
                  <p role="alert" className="backup-error">
                    {error}
                  </p>
                )}
                <Button type="submit" variant="destructive" disabled={busy || confirmVersion !== restoreTask.versionId || !password}>
                  {busy ? '提交中…' : '创建保护备份并回滚'}
                </Button>
              </form>
            )}
          </AdminDialogBody>
        </AdminDialogContent>
      </Dialog>
    </AdminPage>
  )
}
