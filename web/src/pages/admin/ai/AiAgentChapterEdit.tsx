import { useEffect, useRef, useState } from 'react'
import type { AgentAction, AgentChapterEditSource, AgentChapterHistory, AgentSession } from '@shared/ai-agent'
import type { ChapterMeta } from '@shared/types'
import { agentApi } from '@/lib/ai-agent-api'
import { chaptersApi, newOperationId } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { getAdminTableRowStaggerDelay } from '@/lib/admin-table-motion'
import { Button } from '@/components/ui/button'
import { Dialog, DialogTrigger } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { MotionDetails } from '@/components/ui/motion'
import FormField from '@/components/shared/FormField'
import SearchSelect from '@/components/shared/SearchSelect'
import { ReadingDialog } from '@/components/shared/ReadingDialog'
import styles from './agent-chapter-edit.module.css'

const failure = (error: unknown) => error instanceof Error ? error.message : '读取失败，请重试'
type Props = { session: AgentSession; providerPresetId: string; disabled: boolean; onCreated: (taskId: string) => void; onPrepared: (action: AgentAction) => void }

export default function AiAgentChapterEdit(props: Props) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  return <Dialog open={open} onOpenChange={value => { if (!saving) setOpen(value) }}>
    <DialogTrigger asChild><Button type="button" variant="ghost" size="sm" disabled={props.disabled || !props.session.afterChapterId}>改写原章节</Button></DialogTrigger>
    {open && <ChapterEditor key={props.session.id} {...props} onBusy={setSaving} onClose={() => setOpen(false)} />}
  </Dialog>
}

function ChapterEditor({ session, providerPresetId, disabled, onCreated, onPrepared, onBusy, onClose }: Props & { onBusy: (value: boolean) => void; onClose: () => void }) {
  const [chapters, setChapters] = useState<ChapterMeta[]>([])
  const [chapterId, setChapterId] = useState(session.afterChapterId)
  const [chapter, setChapter] = useState<AgentChapterEditSource | null>(null)
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null)
  const [instruction, setInstruction] = useState('')
  const [history, setHistory] = useState<AgentChapterHistory[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const mounted = useRef(true)
  const requestId = useRef<{ fingerprint: string; id: string } | null>(null)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    let active = true
    void Promise.all([chaptersApi.list(session.novelId), agentApi.chapter(session.id, chapterId), agentApi.chapterHistory(session.id, chapterId)]).then(([list, source, versions]) => {
      if (!active) return
      const anchor = list.chapters.find(item => item.id === session.afterChapterId)
      setChapters(anchor ? list.chapters.filter(item => item.order < anchor.order || (item.order === anchor.order && item.id <= anchor.id)) : [])
      setChapter(source.chapter)
      setHistory(versions.history)
      setHasMore(versions.hasMore)
    }).catch(error => { if (active) setError(failure(error)) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [session.id, session.novelId, session.afterChapterId, chapterId, refresh])
  function clearSource() {
    setLoading(true)
    setChapter(null)
    setSelection(null)
    setHistory([])
    setHasMore(false)
    setError('')
  }
  const selectedText = chapter ? (selection ? chapter.content.slice(selection.start, selection.end) : chapter.content) : ''
  const tooLong = Array.from(selectedText).length > 6000
  const busy = saving || disabled
  const setBusy = (value: boolean) => { setSaving(value); onBusy(value) }
  async function submit() {
    if (!chapter || busy || loading || tooLong || !instruction.trim() || !selectedText) return
    const input = { chapterId: chapter.id, baseRevision: chapter.revision, startUTF16: selection?.start ?? 0,
      endUTF16: selection?.end ?? chapter.content.length, selectedText, instruction: instruction.trim(), providerPresetId }
    const fingerprint = JSON.stringify(input)
    if (requestId.current?.fingerprint !== fingerprint) requestId.current = { fingerprint, id: newOperationId('chapter-edit') }
    setBusy(true)
    setError('')
    try {
      const result = await agentApi.editChapter(session.id, { ...input, clientRequestId: requestId.current.id })
      if (mounted.current) { onCreated(result.taskId); onClose() }
    } catch (error) { if (mounted.current) setError(failure(error)) }
    finally { if (mounted.current) setBusy(false) }
  }
  async function restore(id: string) {
    setBusy(true)
    setError('')
    try {
      const result = await agentApi.prepare(session.id, 'restore_chapter', id)
      if (mounted.current) { onPrepared(result.action); onClose() }
    } catch (error) { if (mounted.current) setError(failure(error)) }
    finally { if (mounted.current) setBusy(false) }
  }
  async function moreHistory() {
    setBusy(true)
    try {
      const result = await agentApi.chapterHistory(session.id, chapterId, history.length)
      if (mounted.current) { setHistory(current => [...current, ...result.history]); setHasMore(result.hasMore) }
    } catch (error) { if (mounted.current) setError(failure(error)) }
    finally { if (mounted.current) setBusy(false) }
  }
  return <ReadingDialog title="增补或改写原章节" description="选择本次对话范围内的章节。先生成建议，核对后再确认写回原章。" bodyLabel="章节改写编辑器"
    footer={<div className={styles.actions}><Button variant="ghost" disabled={saving} onClick={onClose}>关闭</Button>
      <Button disabled={busy || loading || !chapter || !selectedText || !instruction.trim() || tooLong} onClick={() => void submit()}>{saving ? '正在处理…' : '生成章节建议'}</Button></div>}>
    <div className={styles.root} aria-busy={loading}>
      <FormField label="原章节"><SearchSelect options={chapters.map(item => ({ value: item.id, label: item.title }))} value={chapterId}
        disabled={saving} onChange={id => { if (id !== chapterId) { clearSource(); setChapterId(id) } }} placeholder="选择章节" searchable matchTriggerWidth /></FormField>
      {loading && <p className={styles.muted} role="status">正在读取章节与修改历史…</p>}
      {error && <div role="alert"><p>{error}</p><Button size="sm" variant="outline" disabled={saving} onClick={() => { clearSource(); setRefresh(value => value + 1) }}>重新读取章节</Button></div>}
      {chapter && <>
        <FormField label="原文（选中要改写的段落）"><Textarea value={chapter.content} readOnly className={styles.source} disabled={saving}
          onSelect={event => { const { selectionStart: start, selectionEnd: end } = event.currentTarget; setSelection(start === end ? null : { start, end }) }} /></FormField>
        <p className={styles.muted} role="status">{selection ? '已选中 ' + Array.from(selectedText).length + ' 字，选段之外保留原文。' : '未选段时按整章处理。'}{tooLong ? ' 本次范围超过 6000 字，请缩小选段。' : ''}</p>
        {selection && <Button variant="ghost" size="sm" disabled={saving} onClick={() => setSelection(null)}>改为整章</Button>}
        <FormField label="增补或改写要求"><Textarea value={instruction} onChange={event => setInstruction(event.target.value)} maxLength={2000} disabled={saving}
          placeholder="例如：在这段对话中补充犹豫和误会，保留事情的结果。" /></FormField>
        <MotionDetails className={styles.history}><summary>章节修改历史{history.length ? ' · ' + history.length : ''}</summary>
          <p className={styles.muted}>记录通过此功能保存的版本，删除对话后仍保留。恢复前会核对当前正文。</p>
          {!history.length && <p className={styles.muted}>尚无已保存的修改。</p>}
          {history.map((item, index) => <div className={styles.historyRow} key={item.id} style={{ animationDelay: getAdminTableRowStaggerDelay(index, history.length) + 'ms' }}>
            <span>{item.kind === 'restore_chapter' ? '恢复版本' : '保存改写'} · {formatDateTime(item.createdAt)}</span>
            <Button variant="outline" size="sm" disabled={busy || !item.canRestore} onClick={() => void restore(item.id)}>{item.canRestore ? '预览恢复' : '已有后续修改'}</Button>
          </div>)}
          {hasMore && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void moreHistory()}>加载更早版本</Button>}
        </MotionDetails>
      </>}
    </div>
  </ReadingDialog>
}
