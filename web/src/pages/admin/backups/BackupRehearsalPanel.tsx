import { useEffect, useState, useRef } from 'react'
import { ChevronRight } from 'lucide-react'
import type { BackupRehearsalInfo, BackupSettings } from '@shared/backups'
import { backupsApi } from '@/lib/backups-api'
import { useConfirm, useToast } from '@/components/feedback'
import AdminStatusBadge from '@/components/admin/AdminStatusBadge'
import { AdminDialogBody, AdminDialogContent } from '@/components/admin/AdminDialog'
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

const sourceLabels = { environment: '部署配置', custom: '后台配置', disabled: '已停用' }
const previewLabels = { queued: '等待执行', running: '执行中', completed: '通过', partial: '部分完成', failed: '失败', interrupted: '已中断' }
const date = (value: number) => new Date(value).toLocaleString('zh-CN')

export default function BackupRehearsalPanel({
  settings,
  disabled,
  onBusyChange,
  onRemoved,
}: {
  settings: BackupSettings
  disabled: boolean
  onBusyChange: (busy: boolean) => void
  onRemoved: (settings: BackupSettings) => void
}) {
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const [info, setInfo] = useState<BackupRehearsalInfo | null>(null)
  const [error, setError] = useState('')
  const requestSequence = useRef(0)
  const [pending, setPending] = useState<'check' | 'remove' | null>(null)
  useEffect(() => {
    const sequence = ++requestSequence.current
    if (!open || !settings.rehearsalConfigured) return
    let active = true
    void backupsApi
      .rehearsalInfo()
      .then((value) => {
        if (active && sequence === requestSequence.current) {
          setInfo(value)
          setError('')
        }
      })
      .catch((cause) => {
        if (!active || sequence !== requestSequence.current) return
        const message = cause instanceof Error ? cause.message : '演练库信息读取失败'
        setError(message)
        toast(message, 'error')
      })
    return () => {
      active = false
    }
  }, [open, settings.revision, settings.rehearsalConfigured, toast])
  const current = info?.revision === settings.revision ? info : null
  async function check() {
    const sequence = ++requestSequence.current
    setPending('check')
    onBusyChange(true)
    setError('')
    try {
      const value = await backupsApi.checkRehearsal(settings.revision)
      if (sequence === requestSequence.current) setInfo(value)
      toast(value.error || '演练库连接与保护标记检查通过', value.error ? 'error' : 'success')
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '演练库检查失败'
      setError(message)
      toast(message, 'error')
    } finally {
      setPending(null)
      onBusyChange(false)
    }
  }
  async function remove() {
    setPending('remove')
    onBusyChange(true)
    try {
      if (
        !(await confirm({
          title: '移除演练库连接配置',
          message: '将关闭在线回滚并移除后台保存的连接凭据，演练数据库及其中的数据会保留。部署端连接地址仍保留，之后可手动重新启用。',
          okText: '移除配置',
        }))
      )
        return
      setError('')
      const { settings: value } = await backupsApi.removeRehearsal(settings.revision)
      toast('演练库连接配置已移除，数据库已保留', 'success')
      setOpen(false)
      onRemoved(value)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '移除演练库连接失败'
      setError(message)
      toast(message, 'error')
    } finally {
      setPending(null)
      onBusyChange(false)
    }
  }
  if (!settings.rehearsalConfigured) return null
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="backup-environment-control"
        aria-haspopup="dialog"
        disabled={Boolean(pending)}
        onClick={() => {
          setInfo(null)
          setError('')
          setOpen(true)
        }}
      >
        <span>演练库信息</span>
        <span className="backup-environment-control-status">
          <AdminStatusBadge tone="neutral">{sourceLabels[settings.rehearsalSource]}</AdminStatusBadge>
          <ChevronRight size={16} aria-hidden="true" />
        </span>
      </button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!pending) setOpen(value)
        }}
      >
        <AdminDialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            trigger.current?.focus()
          }}
          onEscapeKeyDown={(event) => {
            if (pending) event.preventDefault()
          }}
          onPointerDownOutside={(event) => {
            if (pending) event.preventDefault()
          }}
        >
          <DialogHeader>
            <DialogTitle>演练库信息</DialogTitle>
            <DialogDescription>查看当前演练库信息，检查连接或移除连接配置。</DialogDescription>
          </DialogHeader>
          <AdminDialogBody className="backup-fields">
            <dl className="backup-environment-list" aria-label="演练库信息">
              <div>
                <dt>配置来源</dt>
                <dd>{sourceLabels[settings.rehearsalSource]}</dd>
              </div>
              <div>
                <dt>主机</dt>
                <dd>{current?.host || '—'}</dd>
              </div>
              <div>
                <dt>端口</dt>
                <dd>{current?.port || '—'}</dd>
              </div>
              <div>
                <dt>数据库</dt>
                <dd>{current?.database || '—'}</dd>
              </div>
              <div>
                <dt>连接状态（上次检查）</dt>
                <dd>
                  <AdminStatusBadge
                    tone={current?.connectionStatus === 'connected' ? 'success' : current?.connectionStatus === 'unavailable' ? 'danger' : 'neutral'}
                  >
                    {current?.connectionStatus === 'connected' ? '可连接' : current?.connectionStatus === 'unavailable' ? '连接失败' : '未检查'}
                  </AdminStatusBadge>
                </dd>
              </div>
              <div>
                <dt>保护标记（上次检查）</dt>
                <dd>
                  <AdminStatusBadge tone={current?.guardStatus === 'valid' ? 'success' : current?.guardStatus === 'invalid' ? 'danger' : 'neutral'}>
                    {current?.guardStatus === 'valid' ? '有效' : current?.guardStatus === 'invalid' ? '无效或无法读取' : '未检查'}
                  </AdminStatusBadge>
                </dd>
              </div>
              <div>
                <dt>检查时间</dt>
                <dd>{current?.checkedAt ? date(current.checkedAt) : '尚未检查'}</dd>
              </div>
              <div>
                <dt>最近恢复预检</dt>
                <dd>
                  {current?.lastPreview
                    ? `${previewLabels[current.lastPreview.state]} · ${date(current.lastPreview.finishedAt || current.lastPreview.createdAt)}`
                    : '暂无当前演练库的预检记录'}
                </dd>
              </div>
            </dl>
            {(error || current?.error) && (
              <p role="alert" className="backup-error">
                {error || current?.error}
              </p>
            )}
            <div className="backup-actions">
              <Button type="button" variant="ghost" disabled={disabled || Boolean(pending)} onClick={() => void remove()}>
                {pending === 'remove' ? '正在移除配置…' : '移除连接配置'}
              </Button>
            </div>
            <p className="backup-hint">连接检查只读取数据库身份和保护标记，不执行恢复。检查状态以显示时间为准；移除配置会保留数据库。</p>
          </AdminDialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" disabled={Boolean(pending)} onClick={() => setOpen(false)}>
              关闭
            </Button>
            <Button type="button" disabled={disabled || Boolean(pending)} onClick={() => void check()}>
              {pending === 'check' ? '正在检查连接…' : '检查连接'}
            </Button>
          </DialogFooter>
        </AdminDialogContent>
      </Dialog>
    </>
  )
}
