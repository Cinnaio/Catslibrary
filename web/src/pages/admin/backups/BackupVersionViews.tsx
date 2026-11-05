import type { BackupTask, BackupVersion } from '@shared/backups'
import { Download, RefreshCw, RotateCcw } from 'lucide-react'
import AdminStatusBadge from '@/components/admin/AdminStatusBadge'
import { ErrorState } from '@/components/shared/AsyncStates'
import { ReadingDialog } from '@/components/shared/ReadingDialog'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import styles from './backup-versions.module.css'

export const states: Record<string, string> = {
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
export const taskLabels: Record<string, string> = {
  backup: '备份',
  test: '连接测试',
  retry: '副本重试',
  preview: '恢复预检',
  restore: '版本回滚',
  delete: '删除版本',
}
export const date = (value: number) => (value ? new Date(value).toLocaleString('zh-CN') : '—')
export const size = (value: number) =>
  value >= 1073741824 ? `${(value / 1073741824).toFixed(2)} GB` : value >= 1048576 ? `${(value / 1048576).toFixed(1)} MB` : `${(value / 1024).toFixed(1)} KB`
export const versionLabel = (version: BackupVersion) =>
  version.note || (version.protection ? '回滚前保护备份' : version.trigger === 'scheduled' ? '自动备份' : '手动备份')
export function BackupStatus({ state }: { state: string }) {
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

export function BackupCopySummary({ version }: { version: BackupVersion }) {
  const local = version.copies.find((copy) => copy.targetId === 'local')
  const remote = version.copies.filter((copy) => copy.targetId !== 'local')
  const failures = remote.filter((copy) => copy.state === 'failed')
  return (
    <div className={styles.copySummary}>
      <span>本地{local?.state === 'available' ? '已校验' : local ? states[local.state] || local.state : '未记录'}</span>
      <span className={styles.muted}>
        {remote.length ? `远程已校验 ${remote.filter((copy) => copy.state === 'available').length}/${remote.length}` : '未选择远程副本'}
      </span>
      {failures.length > 0 && <span className={styles.failure}>传输失败：{failures.map((copy) => copy.name).join('、')}</span>}
    </div>
  )
}

export function BackupTaskPanel({ tasks, onOpen }: { tasks: BackupTask[]; onOpen: (id: string) => void }) {
  const active = tasks.filter((task) => task.state === 'queued' || task.state === 'running')
  const finished = tasks.filter((task) => task.state !== 'queued' && task.state !== 'running').slice(0, 3)
  if (!tasks.length) return null
  return (
    <section className={styles.tasks} aria-label="当前备份任务">
      <div className={styles.sectionHead}>
        <h2>当前任务</h2>
        <span className={styles.muted}>{active.length ? `${active.length} 项执行中或等待执行` : '本次观察到的任务结果'}</span>
      </div>
      {[...active, ...finished].map((task) => (
        <div key={task.id} className={styles.task}>
          <div className={styles.taskLead}>
            <strong>{taskLabels[task.kind] || '任务'}</strong>
            <BackupStatus state={task.state} />
          </div>
          <div className={styles.taskCopy}>
            <p>{task.stage || (task.state === 'queued' ? '等待执行' : '未记录执行阶段')}</p>
            {task.error && <p className={styles.failure}>{task.error}</p>}
            <span className={styles.muted}>
              {date(task.createdAt)}
              {task.versionId ? ` · ${task.versionId}` : ''}
            </span>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={() => onOpen(task.id)} aria-label={`查看${taskLabels[task.kind] || '任务'}任务`}>
            查看任务
          </Button>
        </div>
      ))}
    </section>
  )
}

export function BackupVersionDialog({
  open,
  version,
  busy,
  refreshing,
  error,
  canPreview,
  onClose,
  onRefresh,
  onDownload,
  onManifest,
  onPreview,
}: {
  open: boolean
  version: BackupVersion | null
  busy: boolean
  refreshing: boolean
  error: string
  canPreview: boolean
  onClose: () => void
  onRefresh: () => void
  onDownload: (version: BackupVersion) => void
  onManifest: (version: BackupVersion) => void
  onPreview: (version: BackupVersion) => void
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value && !busy) onClose()
      }}
    >
      <ReadingDialog
        title={version ? versionLabel(version) : '备份版本详情'}
        eyebrow="备份版本详情"
        description={
          version
            ? `${date(version.createdAt)} · ${version.protection ? '回滚前保护备份' : version.trigger === 'scheduled' ? '自动备份' : '手动备份'}`
            : '查看副本与恢复准备情况'
        }
        bodyLabel="备份副本与版本信息"
        showCloseButton={!busy}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault()
        }}
        onInteractOutside={(event) => {
          if (busy) event.preventDefault()
        }}
        footer={
          <div className={styles.detailFooter}>
            <p className={styles.muted}>恢复前需要完成隔离预检和影响核对，预检不会回滚线上数据。</p>
            <div className={styles.actions}>
              <Button variant="secondary" onClick={onRefresh} disabled={busy || refreshing}>
                <RefreshCw className={refreshing ? 'animate-spin' : ''} />
                {refreshing ? '刷新中…' : '刷新详情'}
              </Button>
              <Button disabled={!version?.digest || !canPreview || busy || refreshing || !!error} onClick={() => version && onPreview(version)}>
                <RotateCcw />
                预检恢复此版本
              </Button>
            </div>
          </div>
        }
      >
        {error && (
          <p role="alert" className={styles.failure}>
            详情同步失败，当前保留上次记录：{error}
          </p>
        )}
        {!version ? (
          <ErrorState message="该版本已移出当前页，请返回列表重新定位。" onRetry={onRefresh} />
        ) : (
          <>
            <div className={styles.sectionHead}>
              <BackupStatus state={version.state} />
              <span className={styles.muted}>
                {version.size ? size(version.size) : '归档大小未记录'}
                {version.pinned ? ` · ${version.protection ? '保护版本' : '固定保留'}` : ''}
              </span>
            </div>
            <section className={styles.detailSection} aria-label="副本状态">
              <h3>副本状态</h3>
              {version.copies.length ? (
                version.copies.map((copy) => (
                  <div key={copy.targetId} className={styles.copy}>
                    <div className={styles.sectionHead}>
                      <strong>{copy.name}</strong>
                      <BackupStatus state={copy.state} />
                    </div>
                    {copy.verifiedAt > 0 && <span className={styles.muted}>最近校验：{date(copy.verifiedAt)}</span>}
                    {copy.error && <p className={styles.failure}>{copy.error}</p>}
                  </div>
                ))
              ) : (
                <p className={styles.muted}>尚未记录副本。</p>
              )}
            </section>
            <section className={styles.detailSection}>
              <h3>下载与异机恢复</h3>
              <p className={styles.muted}>异机恢复需要加密归档、恢复清单及单独保管的主密钥。在线回滚保留当前部署配置，业务数据与用户账户恢复到目标版本。</p>
              <div className={styles.actions}>
                <Button variant="secondary" disabled={busy || !version.digest} onClick={() => onDownload(version)}>
                  <Download />
                  下载归档
                </Button>
                <Button variant="ghost" disabled={busy || !version.digest} onClick={() => onManifest(version)}>
                  下载恢复清单
                </Button>
              </div>
            </section>
            <details className={styles.metadata}>
              <summary>版本与校验信息</summary>
              <dl>
                <div>
                  <dt>版本标识</dt>
                  <dd>{version.id}</dd>
                </div>
                <div>
                  <dt>数据快照</dt>
                  <dd>{date(version.snapshotAt)}</dd>
                </div>
                <div>
                  <dt>迁移版本</dt>
                  <dd>{version.migrationVersion}</dd>
                </div>
                <div>
                  <dt>SHA-256</dt>
                  <dd>{version.digest || '尚未生成'}</dd>
                </div>
              </dl>
            </details>
          </>
        )}
      </ReadingDialog>
    </Dialog>
  )
}
