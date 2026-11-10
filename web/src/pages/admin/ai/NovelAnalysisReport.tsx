import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ANALYSIS_KINDS, type AnalysisReport, type AnalysisRequest, type AnalysisSource } from '@shared/novel-analysis'
import { novelAnalysisApi as api } from '@/lib/novel-analysis-api'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Dialog } from '@/components/ui/dialog'
import { MotionDetails } from '@/components/ui/motion'
import FormField from '@/components/shared/FormField'
import { ReadingDialog, ReadingDialogText } from '@/components/shared/ReadingDialog'
import NovelAnalysisMarkdown from './NovelAnalysisMarkdown'
import { taskStatusLabel } from './labels'
import { analysisPendingKey, readAnalysisDraft, saveAnalysisDraft } from './analysis-request-state'
import styles from './novel-analysis.module.css'

const failure = (error: unknown) => error instanceof Error ? error.message : '操作失败，请稍后重试'
const running = (report: AnalysisReport) => ['queued', 'running'].includes(report.status)

export default function NovelAnalysisReport({ novelId, reportId, onChange, onReanalyze }: {
  novelId: string; reportId: string; onChange: (report: AnalysisReport) => void; onReanalyze: (request: AnalysisRequest) => void
}) {
  const scopeKey = analysisPendingKey(novelId)
  const draftKey = scopeKey ? `${scopeKey}:draft:${reportId}` : ''
  const [savedDraft] = useState(() => readAnalysisDraft(draftKey))
  const [report, setReport] = useState<AnalysisReport | null>(null)
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [editing, setEditing] = useState(!!savedDraft)
  const [draft, setDraft] = useState(savedDraft?.content || '')
  const [baseRevision, setBaseRevision] = useState(savedDraft?.revision || 0)
  const [sourceId, setSourceId] = useState('')
  const [source, setSource] = useState<AnalysisSource | null>(null)
  const [sourceError, setSourceError] = useState('')
  const [sourceRefresh, setSourceRefresh] = useState(0)
  const mounted = useRef(true)
  const mutation = useRef(false)
  const loadVersion = useRef(0)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const receive = useCallback((next: AnalysisReport) => {
    if (!mounted.current) return
    setReport(previous => previous && previous.updatedAt > next.updatedAt ? previous : next)
    onChange(next)
  }, [onChange])
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const version = ++loadVersion.current
    async function load() {
      try {
        const next = await api.read(novelId, reportId)
        if (!alive || version !== loadVersion.current) return
        receive(next)
        setLoadError('')
        if (running(next)) timer = setTimeout(() => void load(), 2500)
      } catch (e) { if (alive && version === loadVersion.current) setLoadError(failure(e)) }
    }
    void load()
    return () => { alive = false; clearTimeout(timer) }
  }, [novelId, reportId, refresh, receive])
  useEffect(() => {
    let alive = true
    if (sourceId) void api.source(novelId, reportId, sourceId).then(next => { if (alive) setSource(next) })
      .catch(e => { if (alive) setSourceError(failure(e)) })
    return () => { alive = false }
  }, [novelId, reportId, sourceId, sourceRefresh])
  function selectSource(id: string) { setSource(null); setSourceError(''); setSourceId(id) }
  async function act(action: () => Promise<unknown>, after?: () => void) {
    if (mutation.current) return
    mutation.current = true; setBusy(true); setError('')
    ++loadVersion.current
    try { await action(); if (mounted.current) after?.() }
    catch (e) { if (mounted.current) setError(failure(e)) }
    finally {
      mutation.current = false
      if (mounted.current) { setBusy(false); setRefresh(v => v + 1) }
    }
  }
  const markdown = (text: string) => <NovelAnalysisMarkdown content={text} sources={report?.sources || []} onSource={selectSource} />
  return <article className={styles.report} aria-label="分析报告">
    {(error || loadError) && <div className={styles.notice} role="alert">{error || loadError} <Button variant="ghost" size="sm" disabled={busy} onClick={() => setRefresh(v => v + 1)}>重新读取</Button></div>}
    {!report && !loadError && <p role="status">正在读取报告…</p>}
    {report && <>
      <header className={styles.reportHeader}>
        <div><p className={styles.meta}>{report.chapterCount} 章 · {new Date(report.createdAt).toLocaleString('zh-CN')} · {report.edited ? '已人工修订' : '模型生成'}</p>
          <h2>{ANALYSIS_KINDS[report.request.kind]}</h2>
          <p className={styles.meta}>{report.sources[0]?.chapterTitle} — {report.sources.at(-1)?.chapterTitle}</p>
        </div>
        <Button variant="outline" size="sm" disabled={editing || busy} onClick={() => onReanalyze(report.request)}>按此范围新建报告</Button>
      </header>
      {report.request.question && <p className={styles.question}>{report.request.question}</p>}
      {report.sourceChanged && <p className={styles.notice}>正文或章节顺序已变化。这份报告仍对应生成时的原文；需要反映修改时，请新建报告。</p>}
      {!report.content && <div className={styles.progress}>
        <p role="status">{report.step || (report.status === 'interrupted' ? '任务记录已移除，可继续已保存的阅读记录' : taskStatusLabel(report.status))}</p>
        <progress max={Math.max(1, report.total)} value={report.processed} aria-label="已保存的阅读段数" />
        <span className={styles.meta}>已保存 {report.processed} / {report.total} 段阅读记录{report.processed === report.total && running(report) ? '，正在整理报告' : ''}</span>
        {report.error && <p role="alert">{report.error}</p>}
        <div className={styles.actions}>{running(report)
          ? <Button variant="outline" disabled={busy} onClick={() => void act(() => api.stop(novelId, reportId))}>停止分析</Button>
          : <Button disabled={busy || report.sourceChanged} onClick={() => void act(() => api.resume(novelId, reportId))}>继续分析</Button>}
        </div>
      </div>}
      {report.content && <>
        <div className={styles.actions}>
          {!editing && <Button variant="outline" size="sm" disabled={busy} onClick={() => { setDraft(report.content); setBaseRevision(report.revision); setEditing(true); saveAnalysisDraft(draftKey, { content: report.content, revision: report.revision }) }}>修订报告</Button>}
          {editing && <>
            <Button disabled={busy || !draft.trim()} onClick={() => void act(async () => { await api.edit(novelId, reportId, draft, baseRevision); saveAnalysisDraft(draftKey, null) }, () => setEditing(false))}>保存修订</Button>
            <Button variant="ghost" disabled={busy} onClick={() => { setEditing(false); saveAnalysisDraft(draftKey, null) }}>取消修订</Button>
          </>}
          <span className={styles.meta}>点击来源编号核对原文；引文可定位，分析判断仍需核对。</span>
        </div>
        {editing ? <FormField label="修订报告（Markdown）" hint="保留模型原稿；未保存的修订暂存在本次浏览器会话中，切换报告后可继续。">
          <Textarea className={styles.editor} value={draft} onChange={e => { setDraft(e.target.value); saveAnalysisDraft(draftKey, { content: e.target.value, revision: baseRevision }) }} maxLength={50000} disabled={busy} />
        </FormField> : markdown(report.content)}
        {editing && baseRevision !== report.revision && <div className={styles.notice}>
          <p>保存的报告已更新。请先对照最新内容，再继续修订；你的输入仍保留在上方。</p>
          <MotionDetails><summary>对照最新保存版本</summary>{markdown(report.content)}</MotionDetails>
          <Button variant="outline" disabled={busy} onClick={() => { setBaseRevision(report.revision); setError(''); saveAnalysisDraft(draftKey, { content: draft, revision: report.revision }) }}>已核对，继续修订当前版本</Button>
        </div>}
        {report.edited && <MotionDetails className={styles.details}><summary>查看模型原稿</summary>{markdown(report.originalContent)}</MotionDetails>}
      </>}
      {report.notes.length > 0 && <MotionDetails className={styles.details}><summary>分段阅读记录 · {report.notes.length} 组</summary>
        {report.notes.map(note => <section key={note.sourceIds.join(',')}><h3>{note.sourceIds.map(id => report.sources.find(s => s.id === id)?.chapterTitle || id).join('、')}</h3>{markdown(note.content)}</section>)}
      </MotionDetails>}
      <MotionDetails className={styles.details}><summary>全部原文来源 · {report.sources.length} 段</summary>
        <div className={styles.sources}>{report.sources.map(item => <Button key={item.id} variant="ghost" onClick={() => selectSource(item.id)}>
          {item.id} · {item.chapterTitle} · 第 {item.part} 段
        </Button>)}</div>
        <p className={styles.meta}>模型撰写时额外回读 {report.checkedSourceIds.length} 段。回读次数不表示内容已经人工确认。</p>
      </MotionDetails>
    </>}
    <Dialog open={!!sourceId} onOpenChange={open => { if (!open) setSourceId('') }}>
      <ReadingDialog title={source ? source.chapterTitle : '原文依据'} description={source ? `${source.id} · 第 ${source.part} 段 · 生成时的正文快照` : '正在读取本报告保存的来源'}
        footer={source && <Button asChild variant="outline"><Link target="_blank" rel="noopener noreferrer" to={`/read/${encodeURIComponent(novelId)}/${encodeURIComponent(source.chapterId)}`}>打开当前章节</Link></Button>}>
        {sourceError ? <p role="alert">{sourceError} <Button variant="ghost" onClick={() => { setSourceError(''); setSourceRefresh(v => v + 1) }}>重试</Button></p>
          : source ? <ReadingDialogText>{source.text || '本段没有正文。'}</ReadingDialogText> : <p role="status">正在读取原文…</p>}
      </ReadingDialog>
    </Dialog>
  </article>
}
