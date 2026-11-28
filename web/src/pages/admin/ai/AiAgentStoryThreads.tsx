import { useDeferredValue, useEffect, useRef, useState } from 'react'
import type { AgentChapterPlan, AgentStoryThreadDisposition, AgentStoryThreadState } from '@shared/ai-agent'
import { Link } from 'react-router-dom'
import { agentApi } from '@/lib/ai-agent-api'
import { ReadingDialog } from '@/components/shared/ReadingDialog'
import FormField from '@/components/shared/FormField'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { SearchField } from '@/components/shared/SearchField'
import SearchSelect from '@/components/shared/SearchSelect'
import { MotionDetails } from '@/components/ui/motion'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { getAdminTableRowStaggerDelay } from '@/lib/admin-table-motion'
import styles from './agent-chapter-plan.module.css'

const labels: Record<AgentStoryThreadDisposition, string> = { advance: '本章推进', later: '安排到后面', hold: '暂时搁置', partial: '部分回收', resolved: '已回收' }
type Edit = Parameters<typeof agentApi.saveStoryThread>[1] & { title: string; targetPosition?: string; recordPosition?: string; recordQuote?: string; recordNote?: string }
type Props = {
  sessionId: string; novelId: string; afterChapterId?: string; plan: AgentChapterPlan | null; disabled: boolean
  onBack: () => void; onBusyChange: (busy: boolean) => void; onApplied: (plan: AgentChapterPlan) => void; onDiscuss: (prompt: string) => Promise<void>
}
export default function AiAgentStoryThreads(props: Props) {
  return <StoryThreads key={props.sessionId} {...props} />
}
function StoryThreads({ sessionId, novelId, afterChapterId = '', plan, disabled, onBack, onBusyChange, onApplied, onDiscuss }: Props) {
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
    finally { locked.current = false; if (alive.current) { setBusy(false); onBusyChange(false) } }
  }
  async function saveEdit() {
    if (!edit) return
    await write(async () => {
      const { title: _title, targetPosition, recordPosition, recordQuote, recordNote, ...value } = edit
      if (state?.trackingAvailable) {
        const position = (targetPosition || '').trim()
        if (position && (!/^\d+$/.test(position) || Number(position) < 1 || Number(position) > 100000)) throw new Error('计划目录位置须为 1 至 100000 的整数，或留空')
        value.targetChapterNumber = position ? Number(position) : null
        value.targetStage = edit.targetStage || ''
        if (recordPosition || recordQuote || recordNote) {
          if (!/^\d+$/.test(recordPosition || '') || Number(recordPosition) < 1 || Number(recordPosition) > 100000 || !recordQuote?.trim() || !recordNote?.trim())
            throw new Error('请完整填写推进记录的目录位置、原文摘录和进展说明')
          value.progressRecord = { chapterNumber: Number(recordPosition), quote: recordQuote, note: recordNote }
        }
      }
      const next = await agentApi.saveStoryThread(sessionId, value)
      if (alive.current) {
        setState(next); setEdit(null)
        if (edit.disposition === 'resolved') setSelected(ids => ids.filter(id => id !== edit.id))
      }
    })
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
        <Button variant="ghost" disabled={blocked || !!edit} onClick={() => void write(async () => { const next = await agentApi.storyThreads(sessionId); if (alive.current) setState(next) })}>重新读取</Button>
        <Button asChild variant="outline"><Link target="_blank" rel="noreferrer" to={'/admin/ai?sub=graph&novel=' + encodeURIComponent(novelId) + (afterChapterId ? '&afterChapterId=' + encodeURIComponent(afterChapterId) : '')}>打开故事星图</Link></Button>
      </div>
      {state?.trackingAvailable && <p className={styles.note}>
        {state.currentChapterNumber ? `当前准备写目录第 ${state.currentChapterNumber} 章。` : '当前起点已变化，请重新选择创作起点。'}
        {' '}提醒按目录顺序计算；剧情阶段由你判断，部分回收的线索仍可继续推进。
      </p>}
      {!plan && <p className={styles.note}>可以先整理线索；建立章节计划后再选入本章。</p>}
      {edit && <section className={styles.fields} aria-label="编辑线索安排">
        <h3>{edit.title}</h3>
        <div className={styles.actions}>{(Object.keys(labels) as AgentStoryThreadDisposition[]).filter(value => value !== 'partial' || state?.trackingAvailable || edit.disposition === 'partial').map(value => <Button key={value} variant="outline" disabled={blocked} aria-pressed={edit.disposition === value} onClick={() => setEdit({ ...edit, disposition: value })}>{labels[value]}</Button>)}</div>
        <FormField label="安排说明"><Textarea rows={3} maxLength={1200} disabled={blocked} value={edit.note} onChange={event => setEdit({ ...edit, note: event.target.value })} /></FormField>
        {state?.trackingAvailable && <>
          {edit.id && state.plans.find(item => item.id === edit.id)?.stale && <FormField label="更新线索来源" hint="起点变化后，可核对当前星图中的对应线索，保存时保留原有计划和推进记录。">
            <SearchSelect searchable disabled={blocked || state.graphStatus !== 'ready'} value={edit.refreshSource ? edit.threadId || '' : ''}
              options={[{ value: '', label: '保留原来源，暂不更新' }, ...state.candidates.map(item => ({ value: item.id, label: item.title, sub: item.summary }))]}
              onChange={threadId => setEdit({ ...edit, refreshSource: !!threadId, threadId, sourceRevision: state.sourceRevision })} />
          </FormField>}
          {edit.refreshSource && state.candidates.find(item => item.id === edit.threadId)?.evidence.map((evidence, i) => <blockquote key={i}>
            {evidence.quote}{evidence.chapterIds.map(id => <p key={id}><Link to={'/read/' + encodeURIComponent(novelId) + '/' + encodeURIComponent(id)}>回读新来源章节</Link></p>)}
          </blockquote>)}
          <FormField label="计划目录位置" hint="选填，填写目录中的第几章，也可以填写尚未创作的位置；目录调整后请核对。">
            <Input inputMode="numeric" maxLength={6} disabled={blocked} value={edit.targetPosition || ''} onChange={event => setEdit({ ...edit, targetPosition: event.target.value })} />
          </FormField>
          <FormField label="计划剧情阶段" hint="例如：门派身份揭晓时。阶段说明不会自动触发提醒。">
            <Input maxLength={200} disabled={blocked} value={edit.targetStage || ''} onChange={event => setEdit({ ...edit, targetStage: event.target.value })} />
          </FormField>
          <MotionDetails>
            <summary>记录一次实际推进</summary>
            <div className={styles.fields}>
              <p className={styles.note}>保存本次进展与章节原文。部分回收／已回收由上方处理方式确定；原文匹配只核对出处，回收判断由你确认。</p>
              <FormField label="推进发生的目录位置" hint="填写本书目录中的第几章，可使用当前起点以前的章节或本对话已发布的章节。">
                <Input inputMode="numeric" maxLength={6} disabled={blocked} value={edit.recordPosition || ''} onChange={event => setEdit({ ...edit, recordPosition: event.target.value })} />
              </FormField>
              <FormField label="原文摘录" hint="从章节中复制连续的一段，最多 500 字。">
                <Textarea rows={3} maxLength={500} disabled={blocked} value={edit.recordQuote || ''} onChange={event => setEdit({ ...edit, recordQuote: event.target.value })} />
              </FormField>
              <FormField label="这次推进了什么" hint="说明揭示了什么、还有什么未揭晓，最多 1200 字。">
                <Textarea rows={3} maxLength={1200} disabled={blocked} value={edit.recordNote || ''} onChange={event => setEdit({ ...edit, recordNote: event.target.value })} />
              </FormField>
            </div>
          </MotionDetails>
        </>}
        <div className={styles.actions}><Button variant="ghost" disabled={busy} onClick={() => setEdit(null)}>取消</Button>
          <Button disabled={blocked} onClick={() => void saveEdit()}>{edit.disposition === 'resolved' ? '确认已回收' : '保存安排'}</Button></div>
      </section>}
      <ol className={styles.outlineList}>{state?.plans.map((item, index) => <li key={item.id} style={{ animationDelay: getAdminTableRowStaggerDelay(index, state.plans.length) + 'ms' }}>
        <label className={styles.threadChoice}><Checkbox checked={selected.includes(item.id)} disabled={blocked || (!selected.includes(item.id) && (item.stale || item.disposition === 'resolved' || selected.length >= 6))} onCheckedChange={checked => setSelected(ids => checked === true ? [...ids, item.id] : ids.filter(id => id !== item.id))} />{item.thread.title} · {labels[item.disposition]}</label>
        <p>{item.note || item.thread.summary}</p>
        {(item.targetChapterNumber || item.targetStage) && <p className={styles.note}>计划：{item.targetChapterNumber ? `目录第 ${item.targetChapterNumber} 章` : ''}{item.targetChapterNumber && item.targetStage ? ' · ' : ''}{item.targetStage}</p>}
        {item.reminder && <p className={styles.reminder}>{item.reminder === 'due' ? '已到计划处理位置' : '已过计划处理位置'}，请核对进展或调整计划。</p>}
        {!!item.progress?.length && <MotionDetails><summary>推进记录（{item.progress.length}）</summary>
          <ol className={styles.outlineList}>{item.progress.map(record => <li key={record.id}>
            <p>{record.kind === 'advance' ? '已推进' : labels[record.kind]} · 记录时目录第 {record.chapterNumber} 章《{record.chapterTitle}》</p>
            <p>{record.note}</p><blockquote>{record.quote}</blockquote>
            {record.sourceChanged && <p className={styles.reminder}>来源正文或目录信息已变化，以上是保存时的摘录，请重新核对。</p>}
            <Link to={'/read/' + encodeURIComponent(novelId) + '/' + encodeURIComponent(record.chapterId)}>回读推进章节</Link>
          </li>)}</ol>
        </MotionDetails>}
        {!!item.hiddenProgressCount && <p className={styles.note}>另有 {item.hiddenProgressCount} 条记录超出当前对话范围或原章节已删除。</p>}
        {item.stale && <p className={styles.note}>来源与当前起点的星图不同。可在「调整安排」中核对并更新来源，保留计划和推进记录后再用于本章。</p>}
        <MotionDetails><summary>报告依据（请回读原文核对）</summary>{item.thread.evidence.map((evidence, i) => <blockquote key={i}>{evidence.quote}{evidence.chapterIds.map(id => <p key={id}><Link to={'/read/' + encodeURIComponent(novelId) + '/' + encodeURIComponent(id)}>回读来源章节</Link></p>)}</blockquote>)}</MotionDetails>
        <div className={styles.actions}>
          <Button variant="ghost" disabled={blocked || !!edit} onClick={() => setEdit({ id: item.id, title: item.thread.title, expectedRevision: item.revision, disposition: item.disposition, note: item.note, targetPosition: item.targetChapterNumber ? String(item.targetChapterNumber) : '', targetStage: item.targetStage || '' })}>调整安排</Button>
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
