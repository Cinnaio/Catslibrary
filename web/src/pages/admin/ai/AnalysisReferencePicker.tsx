import { useCallback, useEffect, useRef, useState } from 'react'
import { ANALYSIS_KINDS, type AnalysisKind, type AnalysisReferenceSelection } from '@shared/novel-analysis'
import { request } from '@/lib/api'
import { Button } from '@/components/ui/button'
import styles from './analysis-reference-picker.module.css'

type Choice = { id: string; kind: AnalysisKind; revision: number; edited: boolean; usable: boolean; reason: string;
  question?: string; createdAt?: number;
  startChapter?: { id: string; title: string }; endChapter?: { id: string; title: string } }
type Page = { reports: Choice[]; nextOffset: number | null; defaults?: AnalysisReferenceSelection[]; limited?: boolean }

export default function AnalysisReferencePicker({ novelId, afterChapterId, active, value, onChange, disabled, onOpenAnalysis }: {
  novelId: string; afterChapterId: string; active: boolean; value?: AnalysisReferenceSelection[];
  onChange: (value: AnalysisReferenceSelection[]) => void; disabled: boolean; onOpenAnalysis: () => void;
}) {
  const [reports, setReports] = useState<Choice[]>([])
  const [nextOffset, setNextOffset] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [limited, setLimited] = useState(false)
  const latest = useRef({ value, onChange })
  useEffect(() => { latest.current = { value, onChange } }, [value, onChange])
  const sequence = useRef({ value: 0 })

  const fetchPage = useCallback((offset: number) => request<Page>('GET', `/ai/writing/analysis-references/${encodeURIComponent(novelId)}?afterChapterId=${encodeURIComponent(afterChapterId)}&offset=${offset}`, null, true), [novelId, afterChapterId])

  useEffect(() => {
    if (!active || !novelId) return
    const guard = sequence.current
    const current = ++guard.value
    void Promise.resolve().then(async () => {
      if (guard.value !== current) return
      setLoading(true); setError('')
      const page = await fetchPage(0)
      if (guard.value !== current) return
      setReports(previous => [...page.reports, ...previous.filter(report =>
        latest.current.value?.some(item => item.reportId === report.id) && !page.reports.some(item => item.id === report.id))])
      setNextOffset(page.nextOffset); setLimited(!!page.limited)
      if (latest.current.value === undefined) latest.current.onChange(page.defaults || [])
    }).catch(e => { if (guard.value === current) setError(e instanceof Error ? e.message : '参考报告加载失败') })
      .finally(() => { if (guard.value === current) setLoading(false) })
    return () => { guard.value++ }
  }, [novelId, afterChapterId, active, reload, fetchPage])

  async function loadMore() {
    if (nextOffset === null || loading) return
    const guard = sequence.current
    const current = ++guard.value
    setLoading(true); setError('')
    try {
      const page = await fetchPage(nextOffset)
      if (guard.value !== current) return
      setReports(previous => [...previous.map(report => page.reports.find(item => item.id === report.id) || report),
        ...page.reports.filter(report => !previous.some(old => old.id === report.id))])
      setNextOffset(page.nextOffset)
    } catch (e) { if (guard.value === current) setError(e instanceof Error ? e.message : '参考报告加载失败') }
    finally { if (guard.value === current) setLoading(false) }
  }

  const selected = value || []
  return <section className={styles.root} aria-label="本次分析参考" aria-busy={loading}>
    <div className={styles.heading}><span>小说分析参考</span><span>{value === undefined ? '自动选择' : `已选 ${selected.length} / 5`}</span></div>
    <p className={styles.hint}>用于情节推荐、大纲和正文。仅可参考当前起点以内、正文未变化的完整报告；可取消全部选择，直接基于正文创作。</p>
    {loading && <p role="status" className={styles.hint}>正在核对报告…</p>}
    {error && <div role="alert" className={styles.error}>{error}<Button variant="ghost" size="sm" onClick={() => setReload(n => n + 1)}>重新加载参考</Button></div>}
    {!loading && !error && !reports.length && <p className={styles.hint}>暂无分析报告，仍可使用正文创作。</p>}
    <div className={styles.list}>
      {reports.map((report, index) => {
        const choice = selected.find(item => item.reportId === report.id)
        const changed = !!choice && choice.revision !== report.revision
        return <label key={report.id} className={styles.row} style={{ animationDelay: `${reports.length <= 1 ? 0 : index * 240 / (reports.length - 1)}ms` }}>
          <input type="checkbox" checked={!!choice} disabled={disabled || loading || (!choice && (!report.usable || selected.length >= 5))}
            onChange={event => onChange(event.target.checked
              ? [...selected, { reportId: report.id, revision: report.revision }]
              : selected.filter(item => item.reportId !== report.id))} />
          <span><strong>{ANALYSIS_KINDS[report.kind]} · v{report.revision}{report.edited ? ' · 已修订' : ''}</strong>
            {report.question && <small>{report.question}</small>}
            {report.createdAt && <small>{new Date(report.createdAt).toLocaleString('zh-CN')}</small>}
            {report.startChapter && report.endChapter && <small>{report.startChapter.title} — {report.endChapter.title}</small>}
            {!report.usable && <small className={styles.error}>{report.reason}</small>}
            {changed && <small className={styles.error}>所选版本已变化，请取消后重新选用。</small>}
          </span>
        </label>
      })}
    </div>
    {limited && <p className={styles.hint}>自动选择只检查最近 50 份已完成报告，可继续翻阅并选择更早的报告。</p>}
    <div className={styles.actions}>
      {nextOffset !== null && <Button variant="ghost" size="sm" disabled={loading} onClick={() => void loadMore()}>更多报告</Button>}
      <Button variant="ghost" size="sm" disabled={!novelId} onClick={onOpenAnalysis}>阅读与修订报告</Button>
      {selected.length > 0 && <Button variant="ghost" size="sm" disabled={disabled || loading} onClick={() => onChange([])}>取消全部参考</Button>}
    </div>
  </section>
}
