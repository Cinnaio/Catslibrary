import { Check } from 'lucide-react'
import type { AgentAction, AgentChapterImpactFinding, AgentChapterImpactReport } from '@shared/ai-agent'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { ReadingDialog } from '@/components/shared/ReadingDialog'
import AiAgentTextComparison, { AiAgentTextComparisonToolbar } from './AiAgentTextComparison'
import AiAgentChapterImpact from './AiAgentChapterImpact'
import { useAgentTextComparisonControls } from './useAgentTextComparison'
import styles from './agent-action-dialog.module.css'

const STATUS = { pending: '待确认', executing: '正在执行', completed: '已采纳', rejected: '已放弃', failed: '未采纳' }
const LABELS: Record<AgentAction['kind'], { title: string; confirm: string; target: string }> = {
  apply_chapter_edit: { title: '原章改写', confirm: '确认写回原章节', target: '写回章节' },
  apply_rewrite: { title: '草稿改写', confirm: '确认采纳', target: '目标草稿' },
  restore_chapter: { title: '章节恢复', confirm: '确认恢复原章节', target: '恢复章节' },
  restore_draft: { title: '草稿恢复', confirm: '确认恢复草稿', target: '恢复草稿' },
  publish_draft: { title: '章节发布', confirm: '确认按此位置发布', target: '发布内容' },
  adopt_cover: { title: '封面替换', confirm: '确认设为封面', target: '封面操作' },
}

export default function AiAgentActionDialog({ action, novelTitle, coverUrl, busy, error, impact, onClose, onReject, onConfirm }: {
  action: AgentAction | null
  novelTitle: string
  coverUrl?: string
  busy: boolean
  error?: string
  impact?: {
    novelId: string
    onCheck: (action: AgentAction, count: number) => Promise<AgentChapterImpactReport>
    onDiscuss: (action: AgentAction, finding: AgentChapterImpactFinding) => void
  }
  onClose: () => void
  onReject: (action: AgentAction) => void
  onConfirm: (action: AgentAction) => void
}) {
  const comparison = useAgentTextComparisonControls()
  if (!action) return null
  const labels = LABELS[action.kind]
  const canConfirm = action.status === 'pending' || (action.status === 'executing' && action.canResume)
  const hasText = action.preview.before !== undefined || action.preview.after !== undefined
  const restoring = action.kind === 'restore_chapter' || action.kind === 'restore_draft'
  const beforeLabel = restoring ? '当前版本' : '原文'
  const afterLabel = restoring ? '恢复后' : action.preview.before === undefined ? '待发布内容' : '修改后'
  const title = (canConfirm ? '核对' : '查看') + labels.title + (canConfirm ? '' : '记录')
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose() }}>
    <ReadingDialog className={styles.dialog} data-text-preview={hasText} data-comparison={action.preview.before !== undefined && action.preview.after !== undefined}
      title={title} eyebrow={<span role="status">{STATUS[action.status]}</span>}
      bodyLabel="采纳前预览" aria-busy={busy} showCloseButton={!busy}
      toolbar={action.preview.before !== undefined && action.preview.after !== undefined && <AiAgentTextComparisonToolbar controls={comparison} hasChanges={action.preview.before !== action.preview.after} beforeLabel={beforeLabel} afterLabel={afterLabel} />}
      onEscapeKeyDown={event => { if (busy) event.preventDefault() }} onPointerDownOutside={event => { if (busy) event.preventDefault() }}
      footer={<div className={styles.footer}>
        <Button variant="ghost" disabled={busy} onClick={onClose}>返回阅读</Button>
        {canConfirm && <div className={styles.footerActions}>
          {action.status === 'pending' && <Button variant="ghost" disabled={busy} onClick={() => onReject(action)}>暂不采纳</Button>}
          <Button disabled={busy} onClick={() => onConfirm(action)}><Check size={15} aria-hidden="true" />{busy ? '正在处理…' : action.status === 'executing' ? '核对并继续采纳' : labels.confirm}</Button>
        </div>}
      </div>}>
      <section className={styles.context} aria-label="本次操作影响">
        <div className={styles.target}>
          {novelTitle && <div><span>所属作品</span><strong>{novelTitle}</strong></div>}
          <div><span>{labels.target}</span><strong>{action.preview.chapterTitle || action.title}</strong></div>
        </div>
        <p>{action.preview.description}</p>
      </section>
      {[...new Set([action.error, error].filter(Boolean))].map(message => <p className={styles.error} role="alert" key={message}>{message}</p>)}
      {coverUrl && <img className={styles.cover} src={coverUrl} alt="准备采纳的封面候选" />}
      {action.status === 'pending' && action.chapterImpactAvailable && impact &&
        <AiAgentChapterImpact key={`impact:${action.id}`} novelId={impact.novelId} disabled={busy}
          onCheck={count => impact.onCheck(action, count)} onDiscuss={finding => impact.onDiscuss(action, finding)} />}
      <AiAgentTextComparison key={action.id} before={action.preview.before} after={action.preview.after}
        controls={comparison} beforeLabel={beforeLabel} afterLabel={afterLabel} />
    </ReadingDialog>
  </Dialog>
}
