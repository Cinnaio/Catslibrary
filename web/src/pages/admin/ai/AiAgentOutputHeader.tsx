import { useState, type Ref } from 'react'
import { Link } from 'react-router-dom'
import { MoreHorizontal, X } from 'lucide-react'
import type { AgentAction, AgentArtifact } from '@shared/ai-agent'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ReadingDialog } from '@/components/shared/ReadingDialog'
import SearchSelect from '@/components/shared/SearchSelect'
import { kindLabel, taskStatusLabel } from './labels'
import styles from './agent-workspace.module.css'

const ACTION_STATUS = { pending: '待确认', executing: '正在执行', completed: '已采纳', rejected: '已放弃', failed: '未采纳' }

export default function AiAgentOutputHeader({ artifacts, artifact, actions, currentActionId, titleRef, workspaceHref, busy, onSelect, onClose, onAction, onRestore }: {
  artifacts: AgentArtifact[]
  artifact: AgentArtifact | null | undefined
  actions: AgentAction[]
  currentActionId?: string
  titleRef?: Ref<HTMLHeadingElement>
  workspaceHref: string
  busy: boolean
  onSelect: (taskId: string) => void
  onClose: () => void
  onAction: (action: AgentAction) => void
  onRestore: (action: AgentAction) => void
}) {
  const [list, setList] = useState<'pending' | 'history' | null>(null)
  const active = actions.filter(action => ['pending', 'executing'].includes(action.status))
  const history = actions.filter(action => !['pending', 'executing'].includes(action.status))
  const choices = artifact && !artifacts.some(item => item.task.id === artifact.task.id) ? [...artifacts, artifact] : artifacts
  const singleActive = active.length === 1 ? active[0] : undefined
  // A single current suggestion already exposes its saved action at the bottom of the reader.
  const showActive = active.length > 1 || (singleActive && singleActive.id !== currentActionId)
  const pendingLabel = active.every(action => action.status === 'pending') ? `${active.length} 项待确认`
    : active.every(action => action.status === 'executing') ? `${active.length} 项执行中` : `${active.length} 项待处理`
  function view(action: AgentAction) { setList(null); onAction(action) }

  return <>
    <div className={styles.outputHeader}>
      <div className={styles.outputTitle}>
        <h3 ref={titleRef} tabIndex={-1}>产出与采纳</h3>
        {showActive && <Button className={styles.outputPendingCount} variant="ghost" size="sm" onClick={() => singleActive ? view(singleActive) : setList('pending')}>{pendingLabel}</Button>}
      </div>
      <div className={styles.outputHeaderActions}>
        {choices.length > 0 && <SearchSelect compact className={styles.outputPicker} aria-label="切换产出" placeholder="切换产出"
          value={artifact?.task.id || ''} options={choices.map((item, index) => ({ value: item.task.id,
            label: `${choices.length - index} · ${kindLabel(item.task.kind)}`, sub: taskStatusLabel(item.task.status) }))}
          onChange={onSelect} searchable searchPlaceholder="搜索产出类型…" />}
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button size="icon" variant="ghost" aria-label="产出更多操作"><MoreHorizontal size={16} aria-hidden="true" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {active.length > 0 && <DropdownMenuItem onSelect={() => setList('pending')}>{pendingLabel}</DropdownMenuItem>}
            {history.length > 0 && <DropdownMenuItem onSelect={() => setList('history')}>采纳与版本记录</DropdownMenuItem>}
            <DropdownMenuItem asChild><Link to={workspaceHref}>草稿工作区</Link></DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button size="icon" variant="ghost" aria-label="收起产出，返回对话" title="收起产出" onClick={onClose}><X size={16} aria-hidden="true" /></Button>
      </div>
    </div>
    <Dialog open={!!list} onOpenChange={open => { if (!open) setList(null) }}>
      <ReadingDialog title={list === 'pending' ? '待确认与执行中的操作' : '采纳与版本记录'} bodyLabel="产出操作记录">
        <div className={styles.outputActionList}>
          {(list === 'pending' ? active : history).map(action => <section className={styles.outputActionEntry} key={action.id}>
            <div><h4>{action.title}</h4><p>{ACTION_STATUS[action.status]}</p></div>
            <p>{action.preview.description}</p>
            <div className={styles.outputActionButtons}>
              <Button size="sm" variant="outline" onClick={() => view(action)}>{action.status === 'pending' ? '核对并确认' : action.status === 'executing' ? '查看执行状态' : '查看记录'}</Button>
              {action.status === 'completed' && ['apply_rewrite', 'restore_draft', 'apply_chapter_edit', 'restore_chapter'].includes(action.kind) &&
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setList(null); onRestore(action) }}>恢复之前版本</Button>}
            </div>
          </section>)}
        </div>
      </ReadingDialog>
    </Dialog>
  </>
}
