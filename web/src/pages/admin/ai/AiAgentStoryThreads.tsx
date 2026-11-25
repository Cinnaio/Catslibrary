import { useDeferredValue, useEffect, useRef, useState } from 'react'
import type { AgentChapterPlan, AgentStoryThreadDisposition, AgentStoryThreadState } from '@shared/ai-agent'
import { Link } from 'react-router-dom'
import { agentApi } from '@/lib/ai-agent-api'
import { ReadingDialog } from '@/components/shared/ReadingDialog'
import FormField from '@/components/shared/FormField'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { SearchField } from '@/components/shared/SearchField'
import { MotionDetails } from '@/components/ui/motion'
import { Textarea } from '@/components/ui/textarea'
import { getAdminTableRowStaggerDelay } from '@/lib/admin-table-motion'
import styles from './agent-chapter-plan.module.css'

const labels: Record<AgentStoryThreadDisposition, string> = { advance: '本章推进', later: '安排到后面', hold: '暂时搁置', resolved: '已回收' }
type Edit = Parameters<typeof agentApi.saveStoryThread>[1] & { title: string }
export default function AiAgentStoryThreads({ sessionId, novelId, afterChapterId = '', plan, disabled, onBack, onBusyChange, onApplied, onDiscuss }: {
  sessionId: string; novelId: string; afterChapterId?: string; plan: AgentChapterPlan | null; disabled: boolean
  onBack: () => void; onBusyChange: (busy: boolean) => void; onApplied: (plan: AgentChapterPlan) => void; onDiscuss: (prompt: string) => Promise<void>
}) {
  const [state, setState] = useState<AgentStoryThreadState | null>(null)
  const [selected, setSelected] = useState<string[]>(plan?.storyThreads?.map(item => item.id) || [])
  const [edit, setEdit] = useState<Edit | null>(null)
  const [remove, setRemove] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const term = useDeferredValue(query.trim())
  const alive = useRef(true)
  const locked = useRef(false)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => {
    let current = true
    void agentApi.storyThreads(sessionId).then(value => { if (current) setState(value) })
      .catch(cause => { if (current) setError(cause instanceof Error ? cause.message : '读取线索失败') })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [sessionId])
  async function write(action: () => Promise<void>) {
    if (locked.current || disabled) return
    locked.current = true; setBusy(true); onBusyChange(true); setError('')
    try { await action() } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : '操作失败，请重试') }
    finally { locked.current = false; if (alive.current) setBusy(false); onBusyChange(false) }
  }
  const blocked = disabled || busy || loading
  const validSelection = selected.every(id => state?.plans.some(item => item.id === id && !item.stale && item.disposition !== 'resolved'))
  const candidates = state?.candidates.filter(item => (!term || (item.title + item.summary).includes(term)) && !state.plans.some(saved => saved.sourceRevision === state.sourceRevision && saved.thread.id === item.id)) || []
  return <ReadingDialog title="线索安排" description="从当前起点的星图中选择线索。安排只代表创作意图，回收状态由你确认，不会改写故事事实。"
    showCloseButton={!busy && !edit} onEscapeKeyDown={event => { if (busy || edit) event.preventDefault() }}
    onPointerDownOutside={event => { if (busy || edit) event.preventDefault() }}
    footer={<div className={styles.actions}>
      <Button variant="ghost" disabled={busy || !!edit} onClick={onBack}>返回章节计划</Button>
      {!edit && <Button variant="ghost" disabled={blocked || !selected.length} onClick={() => setSelected([])}>清空本章选择</Button>}
      {!edit && <Button disabled={blocked || !plan || !state || !validSelection} onClick={() => void write(async () => {
        const result = await agentApi.applyStoryThreads(sessionId, selected, selected.map(id => state!.plans.find(item => item.id === id)!.revision), plan!.revision)
        if (alive.current) onApplied(result.plan)
      })}>保存本章线索选择（{selected.length}/6）</Button>}
    </div>}>
    <div className={styles.content} aria-busy={loading || busy}>
      {loading && <p role="status">正在读取线索…</p>}
      {error && <p role="alert">{error}</p>}
      <div className={styles.actions}>
        <Button variant="ghost" disabled={blocked} onClick={() => void write(async () => { const next = await agentApi.storyThreads(sessionId); if (alive.current) setState(next) })}>重新读取</Button>
        <Button asChild variant="outline"><Link target="_blank" rel="noreferrer" to={'/admin/ai?sub=graph&novel=' + encodeURIComponent(novelId) + (afterChapterId ? '&afterChapterId=' + encodeURIComponent(afterChapterId) : '')}>打开故事星图</Link></Button>
      </div>
      {!plan && <p className={styles.note}>可以先整理线索；建立章节计划后再选入本章。</p>}
      {edit && <section className={styles.fields} aria-label="编辑线索安排">
        <h3>{edit.title}</h3>
        <div className={styles.actions}>{(Object.keys(labels) as AgentStoryThreadDisposition[]).map(value => <Button key={value} variant="outline" disabled={blocked} aria-pressed={edit.disposition === value} onClick={() => setEdit({ ...edit, disposition: value })}>{labels[value]}</Button>)}</div>
        <FormField label="安排说明"><Textarea rows={3} maxLength={1200} disabled={blocked} value={edit.note} onChange={event => setEdit({ ...edit, note: event.target.value })} /></FormField>
        <div className={styles.actions}><Button variant="ghost" disabled={busy} onClick={() => setEdit(null)}>取消</Button>
          <Button disabled={blocked} onClick={() => void write(async () => { const next = await agentApi.saveStoryThread(sessionId, edit); if (alive.current) { setState(next); setEdit(null); if (edit.disposition === 'resolved') setSelected(ids => ids.filter(id => id !== edit.id)) } })}>{edit.disposition === 'resolved' ? '确认已回收' : '保存安排'}</Button></div>
      </section>}
      <ol className={styles.outlineList}>{state?.plans.map((item, index) => <li key={item.id} style={{ animationDelay: getAdminTableRowStaggerDelay(index, state.plans.length) + 'ms' }}>
        <label className={styles.threadChoice}><Checkbox checked={selected.includes(item.id)} disabled={blocked || (!selected.includes(item.id) && (item.stale || item.disposition === 'resolved' || selected.length >= 6))} onCheckedChange={checked => setSelected(ids => checked === true ? [...ids, item.id] : ids.filter(id => id !== item.id))} />{item.thread.title} · {labels[item.disposition]}</label>
        <p>{item.note || item.thread.summary}</p>
        {item.stale && <p className={styles.note}>来源与当前起点的星图不同。保留旧安排供核对，请从有效星图重新加入后再用于本章。</p>}
        <MotionDetails><summary>报告依据（请回读原文核对）</summary>{item.thread.evidence.map((evidence, i) => <blockquote key={i}>{evidence.quote}{evidence.chapterIds.map(id => <p key={id}><Link to={'/read/' + encodeURIComponent(novelId) + '/' + encodeURIComponent(id)}>回读来源章节</Link></p>)}</blockquote>)}</MotionDetails>
        <div className={styles.actions}>
          <Button variant="ghost" disabled={blocked || !!edit} onClick={() => setEdit({ id: item.id, title: item.thread.title, expectedRevision: item.revision, disposition: item.disposition, note: item.note })}>调整安排</Button>
          <Button variant="ghost" disabled={blocked || !!edit} onClick={() => void write(() => onDiscuss('请只核对线索「' + item.thread.title + '」的进展：先查阅线索安排，再查阅本会话实际草稿或已发布正文，逐项引用依据，区分已推进、尚未处理与无法确认。只报告核对结果，不修改大纲或计划，是否回收由我决定。'))}>请助手核对进展</Button>
          <Button variant="ghost" disabled={blocked || !!edit} onClick={() => setRemove(item.id)}>移除安排</Button>
          {remove === item.id && <><span>确认移除这条安排？已提交计划快照仍保留。</span><Button variant="ghost" disabled={blocked} onClick={() => setRemove(null)}>取消</Button><Button disabled={blocked} onClick={() => void write(async () => { await agentApi.removeStoryThread(sessionId, item.id, item.revision); const next = await agentApi.storyThreads(sessionId); if (alive.current) { setState(next); setSelected(ids => ids.filter(id => id !== item.id)); setRemove(null) } })}>确认移除</Button></>}
        </div>
      </li>)}</ol>
      <section className={styles.fields}>
        <h3>从星图加入</h3>
        {state && state.graphStatus !== 'ready' && <p className={styles.note}>当前起点没有有效星图。请先在故事星图中选择相同阅读范围并生成，再回来读取。</p>}
        <SearchField label="查找星图线索" maxLength={100} placeholder="查找线索名称或内容" value={query} onChange={event => setQuery(event.target.value)} />
        <ol className={styles.outlineList} aria-busy={query.trim() !== term}>{candidates.map((item, index) => <li key={item.id} style={{ animationDelay: getAdminTableRowStaggerDelay(index, candidates.length) + 'ms' }}>
          <h4>{item.title}</h4><p>{item.summary}</p><Button variant="outline" disabled={blocked || !!edit} onClick={() => setEdit({ threadId: item.id, title: item.title, sourceRevision: state!.sourceRevision, expectedRevision: 0, disposition: 'advance', note: '' })}>安排这条线索</Button>
        </li>)}</ol>
        {state?.graphStatus === 'ready' && !candidates.length && <p className={styles.note}>没有尚未加入的匹配线索。</p>}
      </section>
    </div>
  </ReadingDialog>
}
