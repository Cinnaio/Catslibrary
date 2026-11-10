import { useEffect, useRef, useState } from 'react'
import type { AgentMemory, AgentMemoryPage, AgentMemorySource } from '@shared/ai-agent'
import { agentApi } from '@/lib/ai-agent-api'
import { getAdminTableRowStaggerDelay } from '@/lib/admin-table-motion'
import { Button } from '@/components/ui/button'
import { Dialog, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { MotionDetails } from '@/components/ui/motion'
import FormField from '@/components/shared/FormField'
import { ReadingDialog } from '@/components/shared/ReadingDialog'
import styles from './agent-memory.module.css'

const statusLabel = { pending: '待确认', active: '已记住', superseded: '已被替换', archived: '已移除' }
const summaryLabels = { decisions: '已选方案', rejected: '已否定方案', openQuestions: '待确认问题', nextSteps: '接下来', references: '来源与产出' }
const failure = (error: unknown) => (error instanceof Error ? error.message : '操作失败，请重试')

export default function AiAgentMemory({
  sessionId,
  disabled,
  pendingCount,
  onChanged,
}: {
  sessionId: string
  disabled: boolean
  pendingCount: number
  onChanged: () => void
}) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!saving) setOpen(value)
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant={pendingCount > 0 ? 'secondary' : 'ghost'} className={styles.trigger}>
          作品记忆{pendingCount > 0 ? ` · ${pendingCount} 待确认` : ''}
        </Button>
      </DialogTrigger>
      {open && (
        <MemoryManager key={sessionId} sessionId={sessionId} disabled={disabled} onChanged={onChanged} onSaving={setSaving} onClose={() => setOpen(false)} />
      )}
    </Dialog>
  )
}

function MemoryManager({
  sessionId,
  disabled,
  onChanged,
  onSaving,
  onClose,
}: {
  sessionId: string
  disabled: boolean
  onChanged: () => void
  onSaving: (saving: boolean) => void
  onClose: () => void
}) {
  const [page, setPage] = useState<AgentMemoryPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState<{ memory?: AgentMemory; title: string; content: string } | null>(null)
  const [sources, setSources] = useState<Record<string, AgentMemorySource | null>>({})
  const alive = useRef(true)
  const locked = useRef(false)
  const generation = useRef(0)
  const blocked = disabled || loading || saving

  async function load(more = false) {
    const request = ++generation.current
    setLoading(true)
    setError('')
    try {
      const value = await agentApi.memories(sessionId, more ? page?.memories.length || 0 : 0)
      if (!alive.current || generation.current !== request) return
      setPage((old) =>
        more && old
          ? { ...value, memories: [...old.memories, ...value.memories.filter((item) => !old.memories.some((previous) => previous.id === item.id))] }
          : value,
      )
    } catch (e) {
      if (alive.current && generation.current === request) setError(failure(e))
    } finally {
      if (alive.current && generation.current === request) setLoading(false)
    }
  }
  useEffect(() => {
    alive.current = true
    const request = ++generation.current
    void agentApi
      .memories(sessionId)
      .then((value) => {
        if (alive.current && generation.current === request) setPage(value)
      })
      .catch((e: unknown) => {
        if (alive.current && generation.current === request) setError(failure(e))
      })
      .finally(() => {
        if (alive.current && generation.current === request) setLoading(false)
      })
    return () => {
      alive.current = false
    }
  }, [sessionId])

  async function mutate(action: () => Promise<unknown>) {
    if (locked.current || blocked) return
    locked.current = true
    setSaving(true)
    onSaving(true)
    setError('')
    try {
      await action()
      if (!alive.current) return
      setDraft(null)
      onChanged()
      await load()
    } catch (e) {
      if (alive.current) setError(failure(e))
    } finally {
      locked.current = false
      if (alive.current) {
        setSaving(false)
        onSaving(false)
      }
    }
  }
  async function showSource(memory: AgentMemory) {
    if (locked.current || loading) return
    locked.current = true
    setLoading(true)
    setError('')
    try {
      const value = await agentApi.memorySource(sessionId, memory.id)
      if (alive.current) setSources((old) => ({ ...old, [memory.id]: value.source }))
    } catch (e) {
      if (alive.current) setError(failure(e))
    } finally {
      locked.current = false
      if (alive.current) setLoading(false)
    }
  }
  const change = (memory: AgentMemory, operation: 'confirm' | 'archive') =>
    mutate(() => agentApi.changeMemory(sessionId, memory.id, operation, memory.revision))

  function row(memory: AgentMemory, index: number, items: AgentMemory[]) {
    const target = page?.memories.find((item) => item.id === memory.supersedesId)
    const editable = memory.status === 'active' || memory.status === 'pending'
    return (
      <article
        key={memory.id}
        className={styles.item}
        style={{ animationDelay: `${getAdminTableRowStaggerDelay(index, items.length)}ms` }}
        aria-label={memory.title}
      >
        <div className={styles.heading}>
          <h3>{memory.title}</h3>
          <span>{statusLabel[memory.status]}</span>
        </div>
        <p className={styles.content}>{memory.content}</p>
        {memory.status === 'pending' && memory.supersedesId && (
          <div className={styles.previous}>
            <p>确认后将替换：{target?.title || '旧约定'}</p>
            {target && <p className={styles.content}>{target.content}</p>}
            {target?.status !== 'active' && <p>旧约定已变化，请放弃这条提议后重新提出。</p>}
          </div>
        )}
        <div className={styles.actions}>
          {memory.status === 'pending' && (
            <Button disabled={blocked || !!draft || (!!memory.supersedesId && target?.status !== 'active')} onClick={() => void change(memory, 'confirm')}>
              {memory.supersedesId ? '确认替换' : '确认记住'}
            </Button>
          )}
          {editable && (
            <Button variant="outline" disabled={blocked || !!draft} onClick={() => setDraft({ memory, title: memory.title, content: memory.content })}>
              编辑
            </Button>
          )}
          {editable && (
            <Button variant="ghost" disabled={blocked || !!draft} onClick={() => void change(memory, 'archive')}>
              {memory.status === 'pending' ? '放弃' : '移除'}
            </Button>
          )}
          {memory.sourceEventId ? (
            <Button variant="ghost" disabled={loading || saving} onClick={() => void showSource(memory)}>
              查看来源
            </Button>
          ) : (
            <span className={styles.muted}>{memory.sessionId ? '手动保存' : '来源会话已移除'}</span>
          )}
        </div>
        {memory.id in sources && <blockquote className={styles.content}>{sources[memory.id]?.content || '来源消息已不可用'}</blockquote>}
      </article>
    )
  }

  const current = page?.memories.filter((memory) => ['pending', 'active'].includes(memory.status)) || []
  const history = page?.memories.filter((memory) => !['pending', 'active'].includes(memory.status)) || []
  return (
    <ReadingDialog
      title="作品记忆"
      description="同一账号、同一本书的对话共用这些约定；确认后从下一轮回复开始使用。"
      bodyLabel="作品记忆与对话摘要"
      footer={
        <Button variant="outline" disabled={saving} onClick={onClose}>
          关闭
        </Button>
      }
    >
      <div className={styles.root}>
        <p className={styles.muted}>
          最多保留 24 条生效约定和 24 条待确认提议。移除后不再作为长期约定使用，历史记录仍可查看。正式故事档案与本次会话设置单独管理。
        </p>
        <div className={styles.actions}>
          <Button disabled={blocked || !page || !!draft} onClick={() => setDraft({ title: '', content: '' })}>
            添加约定
          </Button>
          <Button variant="ghost" disabled={loading || saving} onClick={() => void load()}>
            刷新
          </Button>
        </div>
        {disabled && <p className={styles.muted}>请等待或停止当前回复后再调整记忆。</p>}
        {error && (
          <p className={styles.error} role="alert">
            {error}。请刷新核对当前状态，编辑内容会保留。
          </p>
        )}
        {loading && <p role="status">正在读取…</p>}
        {draft && (
          <form
            className={styles.editor}
            onSubmit={(event) => {
              event.preventDefault()
              event.stopPropagation()
              void mutate(() =>
                draft.memory
                  ? agentApi.changeMemory(sessionId, draft.memory.id, 'edit', draft.memory.revision, draft.title, draft.content)
                  : agentApi.createMemory(sessionId, draft.title, draft.content),
              )
            }}
          >
            <h3>{draft.memory ? '编辑约定' : '添加约定'}</h3>
            <FormField label="记忆标题" hint="最多 100 字">
              <Input required maxLength={100} value={draft.title} disabled={saving} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
            </FormField>
            <FormField label="记忆内容" hint="写下希望这本书后续对话遵循的具体约定，最多 1000 字。">
              <Textarea
                required
                maxLength={1000}
                rows={5}
                value={draft.content}
                disabled={saving}
                onChange={(event) => setDraft({ ...draft, content: event.target.value })}
              />
            </FormField>
            <div className={styles.actions}>
              <Button type="submit" disabled={blocked || !draft.title.trim() || !draft.content.trim()}>
                {saving ? '正在保存…' : draft.memory?.status === 'pending' ? '保存提议' : '保存并记住'}
              </Button>
              <Button type="button" variant="ghost" disabled={saving} onClick={() => setDraft(null)}>
                取消编辑
              </Button>
            </div>
          </form>
        )}
        {page && current.length === 0 && <p className={styles.muted}>还没有作品记忆。可以手动添加，也可以在聊天中明确提出“请记住”。</p>}
        {current.map(row)}
        {!!history.length && (
          <MotionDetails>
            <summary>历史约定 · {history.length}</summary>
            <div className={styles.history}>{history.map(row)}</div>
          </MotionDetails>
        )}
        {page?.hasMore && (
          <Button variant="outline" disabled={loading || saving} onClick={() => void load(true)}>
            加载更多历史
          </Button>
        )}
        <MotionDetails>
          <summary>本次对话摘要</summary>
          {page?.summary ? (
            <div className={styles.summary}>
              <p className={styles.muted}>早前消息的自动整理，可能有遗漏。仅用于这次对话，原始消息仍保留。</p>
              <p className={styles.content}>{page.summary.content.goal}</p>
              {Object.entries(summaryLabels).map(([key, label]) => {
                const items = page.summary!.content[key as keyof typeof summaryLabels]
                return (
                  items.length > 0 && (
                    <section key={key}>
                      <h3>{label}</h3>
                      <ul>
                        {items.map((item, index) => (
                          <li key={index}>{item}</li>
                        ))}
                      </ul>
                    </section>
                  )
                )
              })}
            </div>
          ) : (
            <p className={styles.muted}>{page ? '对话较短时直接使用原始消息，尚未生成摘要。' : '读取成功后可查看摘要。'}</p>
          )}
        </MotionDetails>
      </div>
    </ReadingDialog>
  )
}
