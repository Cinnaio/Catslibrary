import { useEffect, useId, useState } from 'react'
import { AGENT_CONTINUATION_LABELS, AGENT_CONTINUATION_LIMIT, AGENT_CONTINUATION_NOTE_LIMIT,
  type AgentContinuationPreview, type AgentSession } from '@shared/ai-agent'
import { ReadingDialog } from '@/components/shared/ReadingDialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { getAdminTableRowStaggerDelay } from '@/lib/admin-table-motion'
import { agentApi } from '@/lib/ai-agent-api'
import styles from './agent-action-dialog.module.css'

export default function AiAgentContinuationDialog({ sessionId, actionId, onBack, onOpenSession }: {
  sessionId: string
  actionId: string
  onBack: () => void
  onOpenSession: (session: AgentSession) => void
}) {
  const prefix = useId()
  const [preview, setPreview] = useState<AgentContinuationPreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [retry, setRetry] = useState(0)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [note, setNote] = useState('')

  useEffect(() => {
    let current = true
    void agentApi.continuation(sessionId, actionId).then(value => {
      if (current) setPreview(value)
    }).catch(cause => {
      if (current) setError(cause instanceof Error ? cause.message : '无法读取承接事项')
    }).finally(() => {
      if (current) setLoading(false)
    })
    return () => { current = false }
  }, [sessionId, actionId, retry])

  function refresh() {
    setLoading(true)
    setError('')
    setPreview(null)
    setSelected([])
    setRetry(value => value + 1)
  }

  async function open() {
    if (!preview || saving) return
    if (preview.existingSession) {
      onOpenSession(preview.existingSession)
      return
    }
    setSaving(true)
    setError('')
    try {
      const { session } = await agentApi.continueChapter(sessionId, actionId, { expectedRevision: preview.revision, selectedIds: selected, note })
      onOpenSession(session)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '新对话创建失败，请重试')
    } finally {
      setSaving(false)
    }
  }

  return <Dialog open onOpenChange={open => { if (!open && !saving) onBack() }}>
    <ReadingDialog className={styles.dialog} title="继续下一章" bodyLabel="续写起点与承接事项"
      aria-busy={loading || saving} showCloseButton={!saving}
      onEscapeKeyDown={event => { if (saving) event.preventDefault() }}
      onPointerDownOutside={event => { if (saving) event.preventDefault() }}
      footer={<div className={styles.footer}>
        <Button variant="ghost" onClick={onBack} disabled={saving}>返回发布记录</Button>
        <Button onClick={() => void open()} disabled={!preview || saving || loading}>
          {preview?.existingSession ? '打开下一章对话' : saving ? '正在创建…' : '开启下一章对话'}
        </Button>
      </div>}>
      {loading && <p className={styles.impactNote} role="status">正在读取续写起点和承接事项…</p>}
      {error && <div className={styles.impactControls}>
        <p className={styles.error} role="alert">{error}</p>
        <Button variant="outline" size="sm" onClick={refresh} disabled={saving}>重新读取</Button>
      </div>}
      {preview && <div className={styles.continuationForm}>
        <div className={styles.target}><div><span>续写起点</span><strong>{preview.chapter.title}</strong></div></div>
        {preview.existingSession ? <p className={styles.impactNote}>这次发布已开启下一章对话。</p> : <>
          {preview.candidates.length > 0 && <fieldset className={styles.continuationChoices} disabled={saving}>
            <legend>要带进新对话的事项（选填）</legend>
            {preview.candidates.map((item, index) => {
              const id = `${prefix}-${item.id}`
              const checked = selected.includes(item.id)
              return <div key={item.id} className={styles.continuationChoice} style={{ animationDelay: `${getAdminTableRowStaggerDelay(index, preview.candidates.length)}ms` }}>
                <Checkbox id={id} checked={checked} disabled={!checked && selected.length >= AGENT_CONTINUATION_LIMIT}
                  onCheckedChange={value => setSelected(current => value === true ? [...current, item.id] : current.filter(key => key !== item.id))} />
                <label htmlFor={id}><small>{AGENT_CONTINUATION_LABELS[item.kind]}</small>{item.text}</label>
              </div>
            })}
            <p className={styles.impactNote}>已选 {selected.length} / {AGENT_CONTINUATION_LIMIT}</p>
          </fieldset>}
          <label className={styles.continuationForm} htmlFor={`${prefix}-note`}>
            补充给下一章（选填）
            <Textarea id={`${prefix}-note`} value={note} onChange={event => setNote(event.target.value)}
              rows={3} maxLength={AGENT_CONTINUATION_NOTE_LIMIT} disabled={saving} />
          </label>
        </>}
      </div>}
    </ReadingDialog>
  </Dialog>
}
