import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import type { ChapterMeta } from '@shared/types'
import { ANALYSIS_KINDS, type AnalysisReport, type AnalysisReportSummary, type AnalysisRequest } from '@shared/novel-analysis'
import { chaptersApi, newOperationId, type ApiError } from '@/lib/api'
import { novelAnalysisApi as api } from '@/lib/novel-analysis-api'
import { getStorageScope } from '@/lib/storage'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { MotionView } from '@/components/ui/motion'
import FormField from '@/components/shared/FormField'
import SearchSelect from '@/components/shared/SearchSelect'
import NovelAnalysisReport from './NovelAnalysisReport'
import { analysisPendingKey, readPendingAnalysis, savePendingAnalysis, type PendingAnalysis } from './analysis-request-state'
import { taskStatusLabel } from './labels'
import styles from './novel-analysis.module.css'

const failure = (error: unknown) => error instanceof Error ? error.message : '读取失败，请稍后重试'
type AnalysisPanelProps = { novelId: string; reportId: string; onSelectReport: (id: string) => void; active?: boolean }
export default function NovelAnalysisPanel(props: AnalysisPanelProps) {
  return <AnalysisWorkspace key={`${getStorageScope()}:${props.novelId}`} {...props} />
}
function AnalysisWorkspace({ novelId, reportId, onSelectReport, active = true }: AnalysisPanelProps) {
  const selectReport = useRef(onSelectReport)
  useEffect(() => { selectReport.current = onSelectReport }, [onSelectReport])
  const pendingKey = analysisPendingKey(novelId)
  const [pending, setPending] = useState<PendingAnalysis | null>(() => readPendingAnalysis(pendingKey))
  const [input, setInput] = useState<AnalysisRequest>(() => pending?.request || { kind: 'plot', startChapterId: '', endChapterId: '', question: '' })
  const [chapters, setChapters] = useState<ChapterMeta[]>([])
  const [reports, setReports] = useState<AnalysisReportSummary[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [offset, setOffset] = useState(0)
  const [error, setError] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [loadedKey, setLoadedKey] = useState('')
  const loadKey = `${novelId}:${offset}:${refresh}`
  const loading = !!novelId && loadedKey !== loadKey
  const [busy, setBusy] = useState(false)
  const mounted = useRef(true)
  const submitting = useRef(false)
  const formRef = useRef<HTMLFormElement>(null)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    let alive = true
    if (!novelId || !active) return
    void Promise.all([chaptersApi.list(novelId), api.list(novelId, offset)]).then(([book, history]) => {
      if (!alive) return
      setChapters(book.chapters)
      setReports(history.reports); setHasMore(history.hasMore); setError('')
      setInput(previous => previous.startChapterId ? previous : { ...previous, startChapterId: book.chapters[0]?.id || '', endChapterId: book.chapters[Math.min(2, book.chapters.length - 1)]?.id || '' })
    }).catch(e => { if (alive) setError(failure(e)) }).finally(() => { if (alive) setLoadedKey(loadKey) })
    return () => { alive = false }
  }, [novelId, offset, refresh, loadKey, active])
  const onReportChange = useCallback((next: AnalysisReport) => setReports(previous => previous.map(item => item.id === next.id && item.updatedAt <= next.updatedAt ? next : item)), [])
  function chooseReport(id: string) {
    selectReport.current(id)
  }
  async function submit() {
    if (submitting.current) return
    const operation = pending || { id: newOperationId('analysis'), request: input }
    setPending(operation); savePendingAnalysis(pendingKey, operation)
    submitting.current = true; setBusy(true); setSubmitError('')
    try {
      const result = await api.create(novelId, operation.request, operation.id)
      savePendingAnalysis(pendingKey, null)
      if (!mounted.current) return
      setPending(null); chooseReport(result.reportId); setOffset(0); setRefresh(v => v + 1)
    } catch (e) {
      if (!mounted.current) return
      // Definite precondition rejection can be edited; uncertain responses retain the exact request.
      const data = (e as ApiError).data as { code?: string } | undefined
      if ([400, 401, 403, 404, 409, 422].includes((e as ApiError).status || 0) || data?.code === 'disabled') { setPending(null); savePendingAnalysis(pendingKey, null) }
      setSubmitError(failure(e))
    } finally { submitting.current = false; if (mounted.current) setBusy(false) }
  }
  const start = chapters.findIndex(c => c.id === input.startChapterId)
  const end = chapters.findIndex(c => c.id === input.endChapterId)
  const valid = start >= 0 && end >= start && (input.kind !== 'custom' || !!input.question.trim())
  const options = chapters.map((chapter, i) => ({ value: chapter.id, label: `${i + 1}. ${chapter.title}` }))
  return <div className={styles.root}>
    {!novelId ? <p className={styles.empty}>选择作品，从一段章节开始阅读和核对。</p> : <>
      <form ref={formRef} className={styles.form} onSubmit={e => { e.preventDefault(); void submit() }}>
        <div className={styles.fields}>
          <FormField label="分析主题"><SearchSelect value={input.kind} disabled={busy || !!pending} options={Object.entries(ANALYSIS_KINDS).map(([value, label]) => ({ value, label }))}
            onChange={kind => setInput(v => ({ ...v, kind: kind as AnalysisRequest['kind'] }))} /></FormField>
          <FormField label="从哪一章"><SearchSelect value={input.startChapterId} disabled={busy || !!pending} options={options} compactThreshold={30}
            onChange={startChapterId => setInput(v => ({ ...v, startChapterId }))} placeholder="起始章节" /></FormField>
          <FormField label="到哪一章"><SearchSelect value={input.endChapterId} disabled={busy || !!pending} options={options} compactThreshold={30}
            onChange={endChapterId => setInput(v => ({ ...v, endChapterId }))} placeholder="结束章节" /></FormField>
        </div>
        <FormField label={input.kind === 'custom' ? '分析问题' : '重点关注（选填）'} hint="例如：人物之间的信任如何变化？哪些判断仍缺少依据？">
          <Textarea value={input.question} maxLength={2000} rows={2} disabled={busy || !!pending} onChange={e => setInput(v => ({ ...v, question: e.target.value }))} />
        </FormField>
        <div className={styles.actions}>
          <Button type="submit" disabled={busy || (!pending && !valid)}>{busy ? '正在提交…' : pending ? '重试并找回这次报告' : '生成分析报告'}</Button>
          <span className={styles.meta}>{valid ? `已选 ${end - start + 1} 章。` : chapters.length ? '请选择有效的起止章节。' : '本书暂无可选章节。'}分析在后台进行，离开页面不会停止。</span>
        </div>
        {pending && !busy && <p className={styles.notice}>上次提交尚未确认。重试会找回同一次请求，避免重复生成。确认后即可修改范围。</p>}
        {submitError && <p role="alert">{submitError}</p>}
      </form>
      <div className={styles.workspace}>
        <aside className={styles.history} aria-label="历史分析报告">
          <div className={styles.actions}><h2>报告记录</h2><Button variant="ghost" size="sm" disabled={loading} onClick={() => setRefresh(v => v + 1)}>刷新</Button></div>
          {error && <p role="alert">{error}</p>}
          <MotionView motionKey={offset} aria-busy={loading} className={loading ? styles.transitioning : undefined}>
            {!reports.length && <p className={styles.meta}>{loading ? '正在读取报告记录…' : error ? '报告记录未能读取。' : '还没有分析报告。'}</p>}
            {reports.map((item, i) => <Button key={item.id} variant={item.id === reportId ? 'secondary' : 'ghost'} className={styles.historyItem} style={{ '--row-index': Math.min(i, 8) } as CSSProperties}
              aria-current={item.id === reportId ? 'true' : undefined} onClick={() => chooseReport(item.id)}>
              <strong>{ANALYSIS_KINDS[item.request.kind]}</strong><span>{item.chapterCount} 章 · {item.status === 'interrupted' ? '可继续' : taskStatusLabel(item.status)}</span>
              <time>{new Date(item.createdAt).toLocaleString('zh-CN')}</time>
            </Button>)}
          </MotionView>
          <div className={styles.actions}><Button variant="ghost" size="sm" disabled={loading || offset === 0} onClick={() => setOffset(v => Math.max(0, v - 20))}>上一页</Button>
            <Button variant="ghost" size="sm" disabled={loading || !hasMore} onClick={() => setOffset(v => v + 20)}>下一页</Button></div>
        </aside>
        {reportId ? <NovelAnalysisReport key={reportId} novelId={novelId} reportId={reportId} active={active} onChange={onReportChange} onReanalyze={request => {
          if (pending) { setSubmitError('请先确认上次提交，再创建另一份报告。'); return }
          setInput(request); formRef.current?.scrollIntoView({ block: 'start' }); formRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
        }} /> : <div className={styles.empty}>生成报告或选择一份历史记录，阅读结论并逐条查看原文。</div>}
      </div>
    </>}
  </div>
}
