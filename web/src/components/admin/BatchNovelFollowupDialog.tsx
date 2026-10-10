import { useRef, useState } from 'react'
import { FOLLOWUP_INTERVAL_HOURS, MAX_BATCH_FOLLOWUPS, type BatchFollowupMode, type BatchFollowupResult } from '@shared/novel-followup'
import { url, authHeaders } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AdminDialogBody, AdminDialogContent } from './AdminDialog'
import CustomSelect from './CustomSelect'
import '@/styles/admin/pages/novel-followup.css'

export default function BatchNovelFollowupDialog({ novels, onClose }: { novels: Array<{ id: string; title: string }>; onClose: () => void }) {
  const titleRef = useRef<HTMLHeadingElement>(null)
  const [mode, setMode] = useState<BatchFollowupMode>('enable')
  const [hours, setHours] = useState('6')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<BatchFollowupResult | null>(null)
  const tooMany = novels.length > MAX_BATCH_FOLLOWUPS
  async function save() {
    if (busy || tooMany || result) return
    setBusy(true)
    setError('')
    try {
      const response = await fetch(url('/scrape'), {
        method: 'POST',
        credentials: 'include',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          action: 'followup-batch-save',
          novelIds: novels.map((novel) => novel.id),
          mode,
          ...(mode !== 'pause' ? { intervalHours: Number(hours) } : {}),
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '批量追更设置失败')
      setResult(data)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <AdminDialogContent
        className="novel-followup-dialog batch-followup-dialog"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          titleRef.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle ref={titleRef} tabIndex={-1}>
            批量追更设置
          </DialogTitle>
          <DialogDescription>将设置应用到选中的 {novels.length} 本作品。</DialogDescription>
        </DialogHeader>
        <AdminDialogBody className="novel-followup-dialog__body">
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {tooMany && (
            <p role="alert" className="admin-dialog-hint">
              单次最多设置 {MAX_BATCH_FOLLOWUPS} 本，请减少选择后重试。
            </p>
          )}
          <div className="novel-followup-dialog__frequency">
            <Label id="batch-followup-mode">追更操作</Label>
            <CustomSelect
              aria-labelledby="batch-followup-mode"
              disabled={busy}
              value={mode}
              onChange={(value) => {
                setMode(value as BatchFollowupMode)
                setResult(null)
                setError('')
              }}
              options={[
                { value: 'enable', label: '开启自动追更' },
                { value: 'pause', label: '暂停自动追更' },
                { value: 'frequency', label: '只调整检查频率' },
              ]}
            />
            <p className="admin-dialog-hint">
              {mode === 'pause'
                ? '保留原有检查频率，正在执行的任务仍会完成。'
                : mode === 'frequency'
                  ? '保持各作品的追更开关，只修改频率；已开启的作品会重新安排下次检查。'
                  : '仅对已配置有效爬虫的连载作品生效，其他作品将跳过。'}
            </p>
          </div>
          {mode !== 'pause' && (
            <div className="novel-followup-dialog__frequency">
              <Label id="batch-followup-frequency">检查频率</Label>
              <CustomSelect
                aria-labelledby="batch-followup-frequency"
                disabled={busy}
                value={hours}
                onChange={(value) => {
                  setHours(value)
                  setResult(null)
                  setError('')
                }}
                options={FOLLOWUP_INTERVAL_HOURS.map((h) => ({ value: String(h), label: `每 ${h} 小时` }))}
              />
              <p className="admin-dialog-hint">下次检查从保存时重新安排；无新章时逐步降频，失败后自动重试。</p>
            </div>
          )}
          <details className="batch-followup-dialog__selection">
            <summary>查看所选作品 · {novels.length} 本</summary>
            <ul>
              {novels.map((novel) => (
                <li key={novel.id}>{novel.title}</li>
              ))}
            </ul>
          </details>
          {result && (
            <section className="novel-followup-dialog__result" aria-label="设置结果">
              <p role="status">
                已设置 {result.saved} 本，跳过 {result.skipped} 本。
              </p>
              {result.results.some((item) => item.status === 'skipped') && (
                <ul className="batch-followup-dialog__skipped">
                  {result.results
                    .filter((item) => item.status === 'skipped')
                    .map((item) => (
                      <li key={item.novelId}>
                        <span>{novels.find((novel) => novel.id === item.novelId)?.title || item.title}</span>
                        <span className="admin-dialog-hint">{item.reason}</span>
                      </li>
                    ))}
                </ul>
              )}
              {result.saved > 0 && <p className="admin-dialog-hint">设置已保存，可在每本作品的「追更设置」中查看。</p>}
            </section>
          )}
        </AdminDialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {result ? '关闭' : '取消'}
          </Button>
          <Button onClick={() => void save()} disabled={busy || tooMany || novels.length === 0 || Boolean(result)}>
            {busy ? '正在保存…' : result ? '已应用' : '应用设置'}
          </Button>
        </DialogFooter>
      </AdminDialogContent>
    </Dialog>
  )
}
