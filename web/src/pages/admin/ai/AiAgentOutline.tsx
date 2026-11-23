import { useEffect, useRef, useState } from 'react'
import { AGENT_OUTLINE_LIMITS, AGENT_OUTLINE_MAX, AGENT_OUTLINE_MIN,
  type AgentChapterPlan, type AgentOutline, type AgentOutlineChapter } from '@shared/ai-agent'
import FormField from '@/components/shared/FormField'
import { ReadingDialog } from '@/components/shared/ReadingDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { getAdminTableRowStaggerDelay } from '@/lib/admin-table-motion'
import { agentApi } from '@/lib/ai-agent-api'
import styles from './agent-chapter-plan.module.css'

const fields = { title: '标题', goal: '本章目标', beats: '情节步骤' } as const
const keys = Object.keys(fields) as Array<keyof AgentOutlineChapter>
const blank = (): AgentOutlineChapter => ({ title: '', goal: '', beats: '' })

export default function AiAgentOutline({ sessionId, currentPlan, disabled, onBack, onBusyChange, onApplied }: {
  sessionId: string
  currentPlan: AgentChapterPlan | null
  disabled: boolean
  onBack: () => void
  onBusyChange: (busy: boolean) => void
  onApplied: (plan: AgentChapterPlan) => void
}) {
  const [outline, setOutline] = useState<AgentOutline | null>(null)
  const [draft, setDraft] = useState<AgentOutline | null>(null)
  const [chosen, setChosen] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const alive = useRef(true)
  const locked = useRef(false)

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])
  useEffect(() => {
    let current = true
    void agentApi.outline(sessionId).then(result => {
      if (current) setOutline(result.outline)
    }).catch(cause => {
      if (current) setError(cause instanceof Error ? cause.message : '无法读取大纲')
    }).finally(() => {
      if (current) setLoading(false)
    })
    return () => { current = false }
  }, [retry, sessionId])

  function refresh() {
    setError('')
    setLoading(true)
    setChosen(null)
    setRetry(value => value + 1)
  }

  function edit(chapters: AgentOutlineChapter[]) {
    setDraft({ chapters, revision: draft?.revision ?? outline?.revision ?? 0 })
  }

  async function write(operation: () => Promise<void>) {
    if (locked.current || loading) return
    locked.current = true
    setBusy(true)
    onBusyChange(true)
    setError('')
    try {
      await operation()
    } catch (cause) {
      if (alive.current) setError(cause instanceof Error ? cause.message : '操作失败，请重试')
    } finally {
      locked.current = false
      if (alive.current) setBusy(false)
      onBusyChange(false)
    }
  }

  const planSelection = chosen === null ? undefined : outline?.chapters[chosen]
  const valid = draft?.chapters.every(chapter => keys.every(key => chapter[key].trim() && chapter[key].length <= AGENT_OUTLINE_LIMITS[key]))
  const blocked = busy || loading
  const stale = draft != null && draft.revision !== (outline?.revision ?? 0)

  return <ReadingDialog title="多章大纲" description="按顺序安排接下来 3 至 5 章。设为章节计划后，可以继续核对和编辑。"
    aria-busy={loading || busy} showCloseButton={!busy && !draft}
    onEscapeKeyDown={event => { if (busy || draft) event.preventDefault() }}
    onPointerDownOutside={event => { if (busy || draft) event.preventDefault() }}
    footer={<div className={styles.actions}>
      <Button variant="ghost" onClick={onBack} disabled={busy || !!draft}>返回章节计划</Button>
      {draft ? <>
        <Button variant="ghost" disabled={busy} onClick={() => { setDraft(null); setError('') }}>放弃编辑</Button>
        <Button disabled={blocked || !valid || stale} onClick={() => void write(async () => {
          const result = await agentApi.saveOutline(sessionId, draft.chapters, draft.revision)
          if (alive.current) { setOutline(result.outline); setDraft(null) }
        })}>保存大纲</Button>
      </> : planSelection && outline && chosen !== null ? <>
        <Button variant="ghost" disabled={busy} onClick={() => setChosen(null)}>取消选择</Button>
        <Button disabled={blocked || disabled} onClick={() => void write(async () => {
          const { plan } = await agentApi.applyOutlineChapter(sessionId, chosen, outline.revision, currentPlan?.revision ?? 0)
          if (alive.current) onApplied(plan)
        })}>确认设为章节计划</Button>
      </> : <Button variant="outline" disabled={blocked || (!!error && !outline)} onClick={() =>
        edit(outline?.chapters ?? Array.from({ length: AGENT_OUTLINE_MIN }, blank))
      }>{outline ? '编辑大纲' : '新建大纲'}</Button>}
    </div>}>
    <div className={styles.content}>
      {loading && <p role="status">正在读取作品大纲…</p>}
      {error && <div role="alert"><p>{error}</p><Button variant="ghost" size="sm" disabled={busy || loading} onClick={refresh}>重新读取大纲</Button></div>}
      {stale && <p role="status">大纲已经更新，编辑内容仍保留。放弃编辑后可查看新版本。</p>}
      {planSelection && <p className={styles.note} role="status">将使用「{planSelection.title}」{currentPlan ? '替换当前章节计划' : '建立当前章节计划'}。写作仍需返回计划确认。</p>}
      {draft ? <>
        {draft.chapters.map((chapter, index) => <fieldset className={styles.outlineChapter} key={index}>
          <legend>大纲第 {index + 1} 章</legend>
          {keys.map(key => <FormField key={key} label={fields[key]}>
            {key === 'title' ? <Input value={chapter[key]} maxLength={AGENT_OUTLINE_LIMITS[key]} disabled={blocked}
              onChange={event => edit(draft.chapters.map((item, i) => i === index ? { ...item, [key]: event.target.value } : item))} />
              : <Textarea rows={key === 'goal' ? 2 : 4} value={chapter[key]} maxLength={AGENT_OUTLINE_LIMITS[key]} disabled={blocked}
                onChange={event => edit(draft.chapters.map((item, i) => i === index ? { ...item, [key]: event.target.value } : item))} />}
          </FormField>)}
          {draft.chapters.length > AGENT_OUTLINE_MIN && <Button variant="ghost" size="sm" disabled={blocked}
            onClick={() => edit(draft.chapters.filter((_, i) => i !== index))}>移除这一章</Button>}
        </fieldset>)}
        {draft.chapters.length < AGENT_OUTLINE_MAX && <Button variant="outline" disabled={blocked}
          onClick={() => edit([...draft.chapters, blank()])}>添加一章</Button>}
      </> : outline ? <>
        <p className={styles.note}>本书大纲 · 第 {outline.revision} 版</p>
        <ol className={styles.outlineList}>{outline.chapters.map((chapter, index) => <li key={index}
          style={{ animationDelay: getAdminTableRowStaggerDelay(index, outline.chapters.length) + 'ms' }}>
          <h3>{chapter.title}</h3><p>{chapter.goal}</p><p>{chapter.beats}</p>
          <Button variant="outline" size="sm" disabled={blocked || disabled} aria-pressed={chosen === index}
            onClick={() => setChosen(index)}>选作章节计划</Button>
        </li>)}</ol>
      </> : !loading && !error && <p>这本书还没有保存的大纲。</p>}
    </div>
  </ReadingDialog>
}
