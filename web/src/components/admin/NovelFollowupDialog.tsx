import { useCallback, useEffect, useState } from 'react'
import { url, authHeaders } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AdminDialogBody, AdminDialogContent } from './AdminDialog'
import CustomSelect from './CustomSelect'

interface Followup {
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
const date = (value: number) => (value ? new Date(value).toLocaleString('zh-CN') : '—')

export default function NovelFollowupDialog({ novel, onClose }: { novel: { id: string; title: string }; onClose: () => void }) {
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
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <AdminDialogContent>
        <DialogHeader>
          <DialogTitle>追更设置 · {novel.title}</DialogTitle>
        </DialogHeader>
        <AdminDialogBody className="space-y-5">
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {!state && !error && <p role="status">正在读取追更设置…</p>}
          {state && (
            <>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="followup-enabled"
                  checked={enabled}
                  disabled={!state.hasConfig || !state.ongoing || busy}
                  onCheckedChange={(value) => setEnabled(value === true)}
                />
                <Label htmlFor="followup-enabled">自动追更</Label>
              </div>
              {!state.hasConfig && <p className="text-sm text-muted-foreground">请先在抓取中心为这本书配置目录和正文选择器。</p>}
              {!state.ongoing && <p className="text-sm text-muted-foreground">已完结作品暂停自动检查，仍可手动更新。</p>}
              <div className="space-y-2">
                <Label id="followup-frequency">检查频率</Label>
                <CustomSelect
                  aria-labelledby="followup-frequency"
                  value={hours}
                  onChange={setHours}
                  options={[1, 3, 6, 12, 24].map((h) => ({ value: String(h), label: `每 ${h} 小时` }))}
                />
                <p className="text-xs text-muted-foreground">连续无新章会逐步降低检查频率；更新失败会自动重试。暂停后，正在执行的任务仍会完成。</p>
              </div>
              <dl className="space-y-2 text-sm">
                <div>
                  <dt className="text-muted-foreground">最近结果</dt>
                  <dd role="status">{state.message || '尚未检查'}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">上次检查完成</dt>
                  <dd>{date(state.checkedAt)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">下次检查</dt>
                  <dd>{state.enabled && state.ongoing ? (state.result === 'running' ? '本次更新完成后安排' : date(state.nextCheckAt)) : '自动追更已暂停'}</dd>
                </div>
              </dl>
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
            {state?.result === 'running' ? '更新中…' : '立即检查并更新'}
          </Button>
          <Button onClick={() => void act(true)} disabled={busy || !state}>
            保存设置
          </Button>
        </DialogFooter>
      </AdminDialogContent>
    </Dialog>
  )
}
