import { useRef, useState } from 'react'
import { adminApi, type AdminContentRatingAiSuggestion } from '@/lib/api'
import { DialogBody, DialogFrame } from "@/components/shared/DialogFrame"
import { Button } from '@/components/ui/button'
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

export default function AiSuggestionBulkReview({ items, disabled, onCompleted, onBusy }: {
  items: AdminContentRatingAiSuggestion[]
  disabled: boolean
  onCompleted: (ids: string[]) => Promise<void>
  onBusy: (busy: boolean) => void
}) {
  const reasonInput = useRef<HTMLTextAreaElement>(null)
  const [decision, setDecision] = useState<'approve' | 'reject' | null>(null)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [failures, setFailures] = useState<string[]>([])
  function open(next: 'approve' | 'reject') {
    setDecision(next)
    setReason('')
    setMessage('')
    setFailures([])
  }
  async function submit() {
    if (!decision || saving || !items.length) return
    if (!reason.trim()) {
      setMessage('请填写本次批量审核的理由。')
      reasonInput.current?.focus({ preventScroll: true })
      reasonInput.current?.scrollIntoView({ block: 'center', behavior: 'instant' })
      return
    }
    setSaving(true)
    onBusy(true)
    setMessage('')
    setFailures([])
    const succeeded: string[] = []
    const failed: string[] = []
    try {
      // Each suggestion keeps its own transaction, revision check and audit record.
      for (const item of items) {
        try {
          await adminApi.contentRatingAi.review(item.id, { decision, expectedRevision: item.revision, reason: reason.trim() })
          succeeded.push(item.id)
        } catch (error) {
          failed.push(`${item.title || '未命名作品'}：${error instanceof Error ? error.message : '审核失败，请刷新核查后重试'}`)
        }
      }
      setFailures(failed)
      setMessage(`已完成 ${succeeded.length} 条，失败 ${failed.length} 条。`)
      await onCompleted(succeeded)
      if (!failed.length) setDecision(null)
    } finally {
      setSaving(false)
      onBusy(false)
    }
  }
  return <>
    <Button variant="secondary" size="sm" disabled={disabled || saving || !items.length} onClick={() => open('approve')}>批量批准</Button>
    <Button variant="secondary" size="sm" disabled={disabled || saving || !items.length} onClick={() => open('reject')}>批量拒绝</Button>
    {!decision && message && <span role="status" className="dialog-frame-hint">{message}</span>}
    <Dialog open={!!decision} onOpenChange={open => { if (!open && !saving) setDecision(null) }}>
      <DialogFrame className="content-ratings-dialog sm:max-w-2xl" onEscapeKeyDown={event => { if (saving) event.preventDefault() }} onInteractOutside={event => { if (saving) event.preventDefault() }}>
        <DialogHeader>
          <DialogTitle>批量{decision === 'approve' ? '批准' : '拒绝'} LLM 建议</DialogTitle>
          <DialogDescription>本次审核 {items.length} 条。批准限制级建议会修改作品分级；批准“继续未标注”仍保持未标注。拒绝建议不修改作品分级。</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <ul className="content-ratings-bulk-preview" aria-label="所选 LLM 建议">
            {items.map(item => <li key={item.id}>
              <strong>{item.title || '未命名作品'}</strong>
              <span>{item.suggestedRating === 'restricted' ? '建议限制级' : '建议继续未标注'} · 置信度 {Math.round(item.confidence * 100)}%</span>
              <p>{item.reason || '未记录 AI 理由'}</p>
            </li>)}
          </ul>
          <Label htmlFor="ai-bulk-review-reason">批量审核理由</Label>
          <Textarea ref={reasonInput} aria-invalid={!!message && !reason.trim()} id="ai-bulk-review-reason" value={reason} onChange={event => setReason(event.target.value)} maxLength={500} rows={3} disabled={saving} placeholder="说明本次人工审核的共同依据；该理由将逐条写入审核记录。" />
          {message && <p role="status" className="dialog-frame-hint">{message}</p>}
          {!!failures.length && <ul role="alert" className="content-ratings-bulk-preview">{failures.map((failure, index) => <li key={index}>{failure}</li>)}</ul>}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" disabled={saving} onClick={() => setDecision(null)}>取消</Button>
          <Button disabled={saving || !items.length} onClick={() => void submit()}>{saving ? '审核中…' : `确认${decision === 'approve' ? '批准' : '拒绝'}所选建议`}</Button>
        </DialogFooter>
      </DialogFrame>
    </Dialog>
  </>
}
