import { useState } from 'react'
import type { AgentRecovery, AgentTask } from '@shared/ai-agent'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { ReadingDialog } from '@/components/shared/ReadingDialog'
import styles from './agent-workspace.module.css'

const stages = { context: '读取会话', summary: '整理摘要', model: '模型回复', retrieval: '查阅资料', generation: '提交操作', save: '保存结果' }

export default function AiAgentRecovery({
  task,
  recovery,
  busy,
  onResume,
  onRefresh,
  onOutputs,
  hasOutputs,
  error,
}: {
  task: AgentTask
  recovery?: AgentRecovery | null
  busy: boolean
  error: string
  onResume: () => Promise<boolean>
  onRefresh: () => void
  onOutputs: () => void
  hasOutputs: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className={styles.recovery}>
      <p role="status">{task.status === 'cancelled' ? '本轮已停止' : `${recovery ? stages[recovery.phase] : '本轮处理'}未完成`}</p>
      {task.error && <p className={styles.error}>{task.error}</p>}
      <p className={styles.muted}>{recovery?.message || '已保存的对话和产出仍可查看。'}</p>
      <div className={styles.recoveryActions}>
        <Button variant="ghost" size="sm" disabled={busy} onClick={onRefresh}>
          核对最新状态
        </Button>
        {hasOutputs && (
          <Button variant="ghost" size="sm" onClick={onOutputs}>
            查看已有产出
          </Button>
        )}
        {recovery?.canResume && (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => setOpen(true)}>
            继续整理回复
          </Button>
        )}
      </div>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value)
        }}
      >
        <ReadingDialog
          title="继续整理回复"
          description="使用已保存的对话、资料和产出，重新调用文本模型继续回答。"
          footer={
            <div className={styles.dialogActions}>
              <Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
                取消
              </Button>
              <Button
                disabled={busy}
                onClick={() =>
                  void onResume().then((ok) => {
                    if (ok) setOpen(false)
                  })
                }
              >
                {busy ? '正在提交…' : '确认继续整理'}
              </Button>
            </div>
          }
        >
          <p>这会产生新的模型用量。已有草稿、封面和分析任务保留，正在运行的任务仍在产出区查看。</p>
          <p>本次只继续查阅和答复。需要重新生成内容时，请另外发送明确要求。</p>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
        </ReadingDialog>
      </Dialog>
    </div>
  )
}
