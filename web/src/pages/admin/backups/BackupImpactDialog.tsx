import { useEffect, useState } from 'react'
import type { BackupImpactReport, BackupImpactSummary, BackupTask } from '@shared/backups'
import { BACKUP_IMPACT_GROUPS } from '@shared/backups'
import { backupsApi } from '@/lib/backups-api'
import { useToast } from '@/components/feedback'
import { AdminDialogBody, AdminDialogContent } from '@/components/admin/AdminDialog'
import AdminStatusBadge from '@/components/admin/AdminStatusBadge'
import CustomSelect from '@/components/admin/CustomSelect'
import Pagination from '@/components/admin/Pagination'
import { LoadingState } from '@/components/admin/AsyncStates'
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

const labels = { novels: '小说', chapters: '章节', users: '用户', settings: '配置', assets: '图片资源', other: '其他业务记录' }
const changes = { add: '回滚将新增', modify: '回滚将修改', remove: '回滚将移除' }
const date = (value: number) => new Date(value).toLocaleString('zh-CN')
const bytes = (value: number) => (value >= 1048576 ? `${(value / 1048576).toFixed(1)} MB` : `${(value / 1024).toFixed(1)} KB`)

export function BackupImpactSummaryView({ summary }: { summary: BackupImpactSummary }) {
  return (
    <div className="backup-impact-summary" aria-label="回滚影响摘要">
      {BACKUP_IMPACT_GROUPS.map((key) => {
        const counts = summary.groups[key]
        return (
          <div key={key} className="backup-impact-counts">
            <strong>{labels[key]}</strong>
            <p className="backup-hint">
              新增 {counts.added} · 修改 {counts.modified} · 移除 {counts.removed}
            </p>
            <p className="backup-id">
              当前 {counts.current} → 恢复后 {counts.restored}
              {key === 'assets' ? ` · ${bytes(counts.currentBytes)} → ${bytes(counts.restoredBytes)}` : ''}
            </p>
          </div>
        )
      })}
    </div>
  )
}
export default function BackupImpactDialog({
  task,
  onClose,
  onContinue,
  onRepreview,
}: {
  task: BackupTask
  onClose: () => void
  onContinue: (report: BackupImpactReport) => void
  onRepreview: () => Promise<void>
}) {
  const { toast } = useToast()
  const [report, setReport] = useState<BackupImpactReport | null>(null)
  const [group, setGroup] = useState(''),
    [change, setChange] = useState(''),
    [page, setPage] = useState(1)
  const [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [checking, setChecking] = useState(false)
  const [stale, setStale] = useState(false)
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    let active = true
    void backupsApi
      .impact(task.id, page, group, change)
      .then((value) => {
        if (active) {
          setReport(value)
          setError('')
        }
      })
      .catch((cause) => {
        if (!active) return
        const message = cause instanceof Error ? cause.message : '回滚影响报告读取失败'
        setError(message)
        toast(message, 'error')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [task.id, page, group, change, toast])
  async function proceed() {
    if (!report) return
    setChecking(true)
    setError('')
    try {
      const result = await backupsApi.checkImpact(task.id, task.versionId)
      if (!result.fresh) {
        setStale(true)
        setError(result.message)
        toast(result.message, 'error')
        return
      }
      onContinue(report)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '无法确认报告有效性，请重新预检'
      setError(message)
      setStale(true)
      toast(message, 'error')
    } finally {
      setChecking(false)
    }
  }
  const expired = Boolean(report && report.expiresAt <= now)
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !checking) onClose()
      }}
    >
      <AdminDialogContent
        variant="editor"
        className="backup-impact-dialog"
        onEscapeKeyDown={(event) => {
          if (checking) event.preventDefault()
        }}
        onPointerDownOutside={(event) => {
          if (checking) event.preventDefault()
        }}
      >
        <DialogHeader>
          <DialogTitle>回滚影响预览</DialogTitle>
          <DialogDescription>比较当前线上数据与所选备份，以下变化描述回滚后的结果。</DialogDescription>
        </DialogHeader>
        <AdminDialogBody className="backup-fields">
          {report && (
            <>
              <p className="backup-id">
                目标版本：{report.versionId}
                <br />
                线上快照：{date(report.snapshotAt)} · 有效至 {date(report.expiresAt)}
              </p>
              <BackupImpactSummaryView summary={report.summary} />
              <div className="backup-impact-preserved">
                <strong>回滚后保留</strong>
                {report.preserved.map((item) => (
                  <p className="backup-hint" key={item}>
                    {item}
                  </p>
                ))}
              </div>
              <details className="backup-hint">
                <summary>比较范围与恢复行为</summary>
                {report.notes.map((item) => (
                  <p key={item}>{item}</p>
                ))}
              </details>
              {!!report.summary.schemaChanges.length && (
                <details className="backup-hint">
                  <summary>数据表结构变化（{report.summary.schemaChanges.length}）</summary>
                  {report.summary.schemaChanges.map((item) => (
                    <p key={item.table}>
                      {changes[item.change]}数据表：{item.table}
                    </p>
                  ))}
                </details>
              )}
            </>
          )}
          <div className="backup-actions">
            <CustomSelect
              aria-label="差异类型"
              value={group}
              disabled={checking}
              options={[{ value: '', label: '全部数据' }, ...BACKUP_IMPACT_GROUPS.map((value) => ({ value, label: labels[value] }))]}
              onChange={(value) => {
                if (value === group) return
                setLoading(true)
                setGroup(value)
                setPage(1)
              }}
            />
            <CustomSelect
              aria-label="变化方向"
              value={change}
              disabled={checking}
              options={[
                { value: '', label: '全部变化' },
                { value: 'add', label: '回滚将新增' },
                { value: 'modify', label: '回滚将修改' },
                { value: 'remove', label: '回滚将移除' },
              ]}
              onChange={(value) => {
                if (value === change) return
                setLoading(true)
                setChange(value)
                setPage(1)
              }}
            />
          </div>
          {loading ? (
            <LoadingState label="正在读取回滚影响" />
          ) : (
            report && (
              <>
                <div className="backup-impact-items">
                  {report.items.items.map((item) => (
                    <div key={item.sequence} className="backup-impact-item">
                      <div className="backup-copy">
                        <strong>{item.name}</strong>
                        <AdminStatusBadge tone={item.change === 'remove' ? 'danger' : item.change === 'add' ? 'success' : 'warning'}>
                          {changes[item.change]}
                          {item.quantity > 1 ? ` ${item.quantity} 条` : ''}
                        </AdminStatusBadge>
                      </div>
                      <p className="backup-id">
                        {labels[item.group]} · {item.relatedName ? `${item.relatedName} · ` : ''}
                        {item.table}
                      </p>
                      {!!item.changedFields.length && <p className="backup-hint">变化项：{item.changedFields.join('、')}</p>}
                      {item.currentValue !== undefined && (
                        <div className="backup-impact-values">
                          <p className="backup-hint">当前：{item.currentValue}</p>
                          <p className="backup-hint">恢复后：{item.restoredValue}</p>
                        </div>
                      )}
                    </div>
                  ))}
                  {!report.items.total && <p className="backup-hint">当前筛选条件下没有变化记录。</p>}
                </div>
                <Pagination
                  page={page}
                  totalPages={Math.ceil(report.items.total / 20)}
                  onPage={(value) => {
                    setLoading(true)
                    setPage(value)
                  }}
                  summary={`共 ${report.items.total} 条变化记录`}
                  variant="detached"
                  busy={checking}
                />
              </>
            )
          )}
          {expired && (
            <p role="alert" className="backup-error">
              报告已过期，请重新预检。
            </p>
          )}
          {error && (
            <p role="alert" className="backup-error">
              {error}
            </p>
          )}
          <p className="backup-hint">继续前会检查报告是否仍有效；执行恢复前会在停写状态下再次检查，业务变化时必须重新预检。</p>
        </AdminDialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" disabled={checking} onClick={onClose}>
            关闭
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={checking}
            onClick={() => {
              setChecking(true)
              void onRepreview().finally(() => setChecking(false))
            }}
          >
            重新预检
          </Button>
          <Button type="button" disabled={!report || loading || checking || stale || expired || Boolean(error)} onClick={() => void proceed()}>
            {checking ? '正在核对业务数据…' : '继续确认回滚'}
          </Button>
        </DialogFooter>
      </AdminDialogContent>
    </Dialog>
  )
}
