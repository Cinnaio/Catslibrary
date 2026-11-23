import { useEffect, useRef, useState } from 'react'
import { AGENT_CHAPTER_PLAN_LIMITS, type AgentChapterPlan, type AgentChapterPlanInput } from '@shared/ai-agent'
import { agentApi } from '@/lib/ai-agent-api'
import { Button } from '@/components/ui/button'
import { Dialog, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import FormField from '@/components/shared/FormField'
import { ReadingDialog } from '@/components/shared/ReadingDialog'
import styles from './agent-chapter-plan.module.css'
import AiAgentPlanBranches from './AiAgentPlanBranches'
import AiAgentOutline from './AiAgentOutline'
import { chapterPlanLabels as labels, chapterPlanFields as fields } from './agent-chapter-plan-fields'

const empty: AgentChapterPlanInput = { title: '', goal: '', beats: '', characters: '', ending: '', constraints: '', targetWords: 2000 }

export default function AiAgentChapterPlan({ sessionId, plan, branchesAvailable = false, outlineAvailable = false, disabled, onChanged, onStart, onDiscuss }: {
  sessionId: string
  plan: AgentChapterPlan | null
  branchesAvailable?: boolean
  outlineAvailable?: boolean
  disabled: boolean
  onChanged: () => void
  onStart: (plan: AgentChapterPlan) => Promise<void>
  onDiscuss: (prompt: string) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [showBranches, setShowBranches] = useState(false)
  const [showOutline, setShowOutline] = useState(false)
  const [editing, setEditing] = useState<{ input: AgentChapterPlanInput; revision: number } | null>(null)
  const [saved, setSaved] = useState<AgentChapterPlan | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const locked = useRef(false)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const current = saved && (!plan || saved.revision > plan.revision) ? saved : plan
  const input = editing?.input ?? current ?? empty
  const showEditor = !!editing || !current
  const valid = input.title.trim() && input.goal.trim() && input.beats.trim() && Number.isSafeInteger(input.targetWords) && input.targetWords >= 300 && input.targetWords <= 30000
  const blocked = disabled || busy
  function change<K extends keyof AgentChapterPlanInput>(key: K, value: AgentChapterPlanInput[K]) {
    setEditing({ input: { ...input, [key]: value }, revision: editing?.revision ?? current?.revision ?? 0 })
  }
  async function save() {
    if (locked.current || blocked || !valid) return
    locked.current = true
    setBusy(true)
    setError('')
    try {
      const result = await agentApi.saveChapterPlan(sessionId, input, editing?.revision ?? current?.revision ?? 0)
      if (!alive.current) return
      setSaved(result.plan)
      setEditing(null)
      onChanged()
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : '计划保存失败，请重试')
    } finally {
      locked.current = false
      if (alive.current) setBusy(false)
    }
  }
  async function discuss() {
    if (locked.current || blocked || editing) return
    locked.current = true
    setBusy(true)
    setError('')
    try {
      await onDiscuss(current ? '请查阅当前章节计划，结合已有讨论进一步完善，保存新的计划卡，暂不生成正文。' : '请结合当前作品和我们的讨论，整理一张章节计划卡，包含章节目标、情节步骤、人物变化、结尾悬念和约束。先规划，暂不生成正文。')
      if (alive.current) setOpen(false)
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : '未能提交计划请求，请重试')
    } finally {
      locked.current = false
      if (alive.current) setBusy(false)
    }
  }
  async function start() {
    if (!current || showEditor || locked.current || blocked) return
    locked.current = true
    setBusy(true)
    setError('')
    try {
      await onStart(current)
      if (alive.current) setOpen(false)
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : '未能提交写作，请重试')
    } finally {
      locked.current = false
      if (alive.current) setBusy(false)
    }
  }
  return <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value) }}>
    <DialogTrigger asChild><Button type="button" size="sm" variant="ghost">章节计划{current ? ' · 第 ' + current.revision + ' 版' : ''}</Button></DialogTrigger>
    {open && showOutline ? <AiAgentOutline sessionId={sessionId} currentPlan={current} disabled={disabled} onBack={() => setShowOutline(false)}
      onBusyChange={setBusy} onApplied={next => { setSaved(next); setShowOutline(false); setError(''); onChanged() }} />
      : open && showBranches ? <AiAgentPlanBranches sessionId={sessionId} disabled={disabled} onBusyChange={setBusy}
      onBack={() => setShowBranches(false)} onChanged={next => { setSaved(next); onChanged() }}
      onSelected={() => { setEditing(null); setError(''); setShowBranches(false) }} /> : open && <ReadingDialog title="章节计划" description="每段对话保留一张当前计划。请助手拟定或完善计划会调用文本模型；确认计划并写作会生成一章草稿，正文仍需另行采纳。"
      footer={<div className={styles.actions}>
        <Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>关闭</Button>
        {showEditor ? <>
          {editing && <Button variant="ghost" disabled={busy} onClick={() => { setEditing(null); setError('') }}>放弃编辑</Button>}
          <Button disabled={blocked || !valid} onClick={() => void save()}>{busy ? '正在保存…' : '保存计划'}</Button>
        </> : <>
          {branchesAvailable && <Button variant="outline" disabled={blocked} onClick={() => setShowBranches(true)}>分支对比</Button>}
          <Button variant="ghost" disabled={blocked} onClick={() => setEditing({ input: current!, revision: current!.revision })}>编辑计划</Button>
          <Button disabled={blocked} onClick={() => void start()}>确认计划并写作</Button>
        </>}
      </div>}>
      <div className={styles.content}>
        <div className={styles.discussion}>
          <p>{current ? '第 ' + current.revision + ' 版 · 可继续讨论，修改不会影响已提交任务。' : '先和助手讨论计划，也可以直接填写。'}</p>
          <Button variant="outline" size="sm" disabled={blocked || !!editing} onClick={() => void discuss()}>{current ? '请助手完善计划' : '请助手拟定计划'}</Button>
          {outlineAvailable && !editing && <Button variant="outline" size="sm" disabled={busy} onClick={() => setShowOutline(true)}>多章大纲</Button>}
        </div>
        {current?.sourceBranch && <p className={styles.note}>当前走向来自分支「{current.sourceBranch.name}」。核对后仍需确认写作。</p>}
        {error && <div role="alert"><p>{error}</p><Button variant="ghost" size="sm" disabled={busy} onClick={() => { setEditing(null); setSaved(null); setError(''); onChanged() }}>放弃编辑并刷新计划</Button></div>}
        {showEditor ? <div className={styles.fields}>
          {fields.map(key => <FormField key={key} label={labels[key] + (['title', 'goal', 'beats'].includes(key) ? '（必填）' : '')}>
            {key === 'title' ? <Input value={input[key]} maxLength={AGENT_CHAPTER_PLAN_LIMITS[key]} disabled={blocked} onChange={e => change(key, e.target.value)} />
              : <Textarea value={input[key]} rows={key === 'beats' ? 6 : 3} maxLength={AGENT_CHAPTER_PLAN_LIMITS[key]} disabled={blocked} onChange={e => change(key, e.target.value)} />}
          </FormField>)}
          <FormField label="目标字数" hint="300–30000 字，作为约数要求传给生成任务。"><Input type="number" min={300} max={30000} step={100} value={input.targetWords} disabled={blocked} onChange={e => change('targetWords', Number(e.target.value))} /></FormField>
          <p className={styles.note}>先保存这版计划，再核对并确认写作。</p>
        </div> : <dl className={styles.reading}>
          {fields.map(key => <div key={key}><dt>{labels[key]}</dt><dd>{current![key] || '尚未决定'}</dd></div>)}
          <div><dt>目标篇幅</dt><dd>约 {current!.targetWords} 字</dd></div>
        </dl>}
      </div>
    </ReadingDialog>}
  </Dialog>
}
