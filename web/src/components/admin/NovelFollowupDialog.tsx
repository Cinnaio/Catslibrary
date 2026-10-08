import type { PendingChapterCounts } from '@shared/novel-updates'
import { pendingUpdateDisplay } from '@shared/novel-updates'
import { LockKeyhole } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { url, authHeaders } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AdminDialogBody, AdminDialogContent } from './AdminDialog'
import CustomSelect from './CustomSelect'
import '@/styles/admin/pages/novel-followup.css'

interface Followup extends PendingChapterCounts {
  chapterCount?: number
  remoteChapterCount?: number
  enabled: boolean
  intervalHours: number
  nextCheckAt: number
  checkedAt: number
  result: string
  message: string
  addedCount: number
  hasConfig: boolean
  ongoing: boolean
}
async function request(novelId: string, body?: Record<string, unknown>): Promise<Followup> {
  const response = await fetch(url(body ? '/scrape' : `/scrape?action=followup&novelId=${encodeURIComponent(novelId)}`), {
    method: body ? 'POST' : 'GET',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    ...(body ? { body: JSON.stringify({ novelId, ...body }) } : {}),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || '追更请求失败')
  return data
}
function CheckTime({ value }: { value: number }) {
  if (!value) return <span>尚未安排</span>
  const time = new Date(value)
  return (
    <time dateTime={time.toISOString()}>
      <span>{time.toLocaleDateString('zh-CN')}</span>
      <span>{time.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}</span>
    </time>
  )
}

export default function NovelFollowupDialog({ novel, onClose }: { novel: { id: string; title: string }; onClose: () => void }) {
  const titleRef = useRef<HTMLHeadingElement>(null)
  const [state, setState] = useState<Followup | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [hours, setHours] = useState('6')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const refresh = useCallback(async () => {
    const data = await request(novel.id)
    setState(data)
    return data
  }, [novel.id])
  useEffect(() => {
    let active = true
    request(novel.id)
      .then((data) => {
        if (!active) return
        setState(data)
        setEnabled(data.enabled)
        setHours(String(data.intervalHours))
      })
      .catch((err) => {
        if (active) setError(err.message)
      })
    return () => {
      active = false
    }
  }, [novel.id])
  useEffect(() => {
    if (state?.result !== 'running') return
    const timer = setInterval(() => {
      void refresh().catch((err) => setError(err.message))
    }, 3000)
    return () => clearInterval(timer)
  }, [state?.result, refresh])
  async function act(save: boolean) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const response = await request(novel.id, save ? { action: 'followup-save', enabled, intervalHours: Number(hours) } : { action: 'update' })
      await refresh()
      setNotice(save ? '追更设置已保存' : response.message || '更新任务已启动，可在抓取任务中查看详情')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const pending = state ? pendingUpdateDisplay({ ...state, chapterCount: state.chapterCount || 0, remoteChapterCount: state.remoteChapterCount || 0 }) : null
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <AdminDialogContent
        className="novel-followup-dialog"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          titleRef.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle ref={titleRef} tabIndex={-1}>
            追更设置
          </DialogTitle>
          <DialogDescription className="novel-followup-dialog__book">{novel.title}</DialogDescription>
        </DialogHeader>
        <AdminDialogBody className="novel-followup-dialog__body">
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {!state && !error && <p role="status">正在读取追更设置…</p>}
          {state && (
            <>
              <div className="novel-followup-dialog__setting">
                <div>
                  <Label htmlFor="followup-enabled">自动追更</Label>
                  <p className="admin-dialog-hint">定期检查目录，有新章节时自动入库。</p>
                </div>
                <Checkbox
                  id="followup-enabled"
                  checked={enabled}
                  disabled={!state.hasConfig || !state.ongoing || busy}
                  onCheckedChange={(value) => setEnabled(value === true)}
                />
              </div>
              {!state.hasConfig && <p className="admin-dialog-hint">请先在抓取中心为这本书配置目录和正文选择器。</p>}
              {!state.ongoing && <p className="admin-dialog-hint">已完结作品暂停自动检查，仍可手动更新。</p>}
              <div className="novel-followup-dialog__frequency">
                <Label id="followup-frequency">检查频率</Label>
                <CustomSelect
                  aria-labelledby="followup-frequency"
                  value={hours}
                  onChange={setHours}
                  disabled={busy}
                  options={[1, 3, 6, 12, 24].map((h) => ({ value: String(h), label: `每 ${h} 小时` }))}
                />
                <p className="admin-dialog-hint">无新章时逐步降低频率，失败后自动重试。</p>
              </div>
              <section className="novel-followup-dialog__result" aria-label="最近检查">
                <span className="admin-dialog-section-label">最近检查</span>
                <p role="status" data-result={state.result}>
                  {state.message || '尚未检查'}
                </p>
                {pending && (
                  <div className="novel-followup-dialog__chapters">
                    {pending.total > 0 && <span>待入库 {pending.total} 章</span>}
                    {state.pendingPublicChapterCount != null && <span>目录可抓取 {state.pendingPublicChapterCount} 章</span>}
                    {pending.protectedCount > 0 && (
                      <span className="novel-update-protection">
                        <LockKeyhole aria-hidden="true" />
                        受保护 {pending.protectedCount} 章
                      </span>
                    )}
                    {pending.unknown && <span>保护状态待检查{state.pendingUnknownChapterCount ? `（${state.pendingUnknownChapterCount} 章）` : ''}</span>}
                  </div>
                )}
                {pending && pending.protectedCount > 0 && (
                  <p className="admin-dialog-hint">受保护不代表无法抓取；请确认源站账号与购买权限，权限变化后重新检查。</p>
                )}
                <dl className="novel-followup-dialog__times">
                  <div>
                    <dt>上次完成</dt>
                    <dd>{state.checkedAt ? <CheckTime value={state.checkedAt} /> : '尚未检查'}</dd>
                  </div>
                  <div>
                    <dt>下次检查</dt>
                    <dd>
                      {state.enabled && state.ongoing ? state.result === 'running' ? '更新完成后安排' : <CheckTime value={state.nextCheckAt} /> : '已暂停'}
                    </dd>
                  </div>
                </dl>
              </section>
              <p className="admin-dialog-hint">暂停追更后，正在执行的任务仍会完成。</p>
              {notice && (
                <p role="status" className="text-sm">
                  {notice}
                </p>
              )}
            </>
          )}
        </AdminDialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => void act(false)} disabled={busy || !state?.hasConfig || state.result === 'running'}>
            {state?.result === 'running' ? '更新中…' : '检查更新'}
          </Button>
          <Button onClick={() => void act(true)} disabled={busy || !state}>
            保存设置
          </Button>
        </DialogFooter>
      </AdminDialogContent>
    </Dialog>
  )
}
