import { useEffect, useRef, useState } from 'react'
import type { AnalysisEvidenceMatch, AnalysisReport, AnalysisReview } from '@shared/novel-analysis'
import { novelAnalysisApi as api, type AnalysisReviewPreview } from '@/lib/novel-analysis-api'
import { newOperationId } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { MotionDetails } from '@/components/ui/motion'
import { analysisPendingKey, readPendingAnalysisReview, savePendingAnalysisReview, type PendingAnalysisReview } from './analysis-request-state'
import styles from './novel-analysis.module.css'

const evidenceLabels = {
  matched: '所标来源中找到连续原句', wrong_source: '引句可能标错来源', not_found: '冻结原文中未找到连续原句',
  ambiguous: '有多处候选原文', uncertain: '引号用途待核对', missing_source: '引句缺少可用来源',
}
const findingLabels = { conflict: '可能存在事实冲突', inference: '可能将认知、计划或推断当作事实', insufficient: '可能依据不足', citation: '可能存在引用位置问题' }
const reviewLabels = { queued: '排队中', running: '核对中', completed: '核对已结束', failed: '核对失败', cancelled: '已停止', interrupted: '任务已中断' }
const reviewing = (review: AnalysisReview) => ['queued', 'running'].includes(review.status)

export default function NovelAnalysisEvidence({ report, active, editing, busy, onAction, onSource, onReload }: {
  report: AnalysisReport; active: boolean; editing: boolean; busy: boolean
  onAction: (action: () => Promise<unknown>) => Promise<boolean>
  onSource: (id: string, match?: AnalysisEvidenceMatch) => void
  onReload: () => void
}) {
  const key = analysisPendingKey(report.novelId)
  const pendingKey = key ? `${key}:review:${report.id}` : ''
  const [pending, setPending] = useState<PendingAnalysisReview | null>(() => readPendingAnalysisReview(pendingKey))
  const [setupOpen, setSetupOpen] = useState(false)
  const [selection, setSelection] = useState<number[] | undefined>()
  const [selectionRevision, setSelectionRevision] = useState(report.revision)
  const [preview, setPreview] = useState<AnalysisReviewPreview | null>(null)
  const [previewSelection, setPreviewSelection] = useState('')
  const [previewBusy, setPreviewBusy] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const [reload, setReload] = useState(0)
  const mounted = useRef(true)
  const sequence = useRef({ value: 0 })
  const latest = useRef(report)
  useEffect(() => { latest.current = report }, [report])
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    if (!setupOpen || !active || selectionRevision !== report.revision) return
    const guard = sequence.current, current = ++guard.value
    void Promise.resolve().then(async () => {
      if (guard.value !== current) return
      if (selection?.length === 0) {
        setPreview(previous => previous ? { ...previous, segments: [], sourceIds: [], sourceChars: 0, skipped: previous.availableSegments?.length || 0 } : null)
        setPreviewSelection('[]'); setPreviewError('')
        return
      }
      setPreviewBusy(true); setPreviewError('')
      const next = await api.reviewPreview(report.novelId, report.id, selection)
      if (guard.value !== current) return
      if (next.revision !== latest.current.revision) throw new Error('报告已更新，请重新读取后选择核对范围。')
      setPreview(next); setPreviewSelection(JSON.stringify(selection ?? null))
    }).catch(e => { if (guard.value === current) setPreviewError(e instanceof Error ? e.message : '核对范围读取失败') })
      .finally(() => { if (guard.value === current) setPreviewBusy(false) })
    return () => { ++guard.value }
  }, [setupOpen, active, selection, selectionRevision, report.novelId, report.id, report.revision, reload])

  const reviews = report.reviews || []
  const runningReview = reviews.some(reviewing)
  const selectionStale = selectionRevision !== report.revision
  const currentPreview = preview?.revision === report.revision && previewSelection === JSON.stringify(selection ?? null) && !previewBusy && !previewError && !selectionStale ? preview : null
  const candidates = preview?.availableSegments || preview?.segments || []
  const selectedStarts = selection || preview?.segments.map(segment => segment.start) || []
  const blocked = busy || editing || report.sourceChanged

  async function begin() {
    if (blocked || (runningReview && !pending) || (!pending && !currentPreview?.segments.length)) return
    const input = pending || { requestId: newOperationId(), revision: report.revision, ...(selection ? { paragraphStarts: selection } : {}) }
    setPending(input); savePendingAnalysisReview(pendingKey, input)
    const ok = await onAction(() => api.review(report.novelId, report.id, input))
    if (ok) {
      savePendingAnalysisReview(pendingKey, null)
      if (mounted.current) setPending(null)
    }
  }

  function sourceButtons(matches: AnalysisEvidenceMatch[]) {
    return matches.map((match, index) => <div key={`${match.chapterId}-${match.start}-${index}`} className={styles.evidenceSource}>
      <blockquote>{match.quote}</blockquote>
      <div className={styles.actions}>{match.sourceIds.map(id => <Button key={id} variant="link" size="sm" onClick={() => onSource(id, match)}>
        核对原文 {id} · {match.chapterTitle}
      </Button>)}</div>
    </div>)
  }
  function coverageSources(coverage: AnalysisReview['coverage']) {
    const ids = coverage.sourceIds || [...new Set(coverage.segments.flatMap(segment => segment.sourceIds))]
    return <MotionDetails className={styles.evidenceItem}><summary>{coverage.sourceIds ? '实际提供的原文来源' : '选段所标原文来源'} · {ids.length} 段</summary>
      <p className={styles.meta}>{coverage.sourceIds ? '包含选段引用及本次附带的相邻上下文，均为生成报告时的冻结快照。' : '这份旧记录未保存全部附带来源，以下仅列选段所标原文。'}</p>
      <div className={styles.sources}>{ids.map(id => <Button key={id} variant="ghost" size="sm" onClick={() => onSource(id)}>
        {id} · {report.sources.find(source => source.id === id)?.chapterTitle || '原文来源'}
      </Button>)}</div>
    </MotionDetails>
  }

  return <section aria-label="报告依据与事实核对" className={styles.evidence}>
    <MotionDetails className={styles.details}>
      <summary>引用字面核验{report.evidence ? ` · ${report.evidence.items.filter(item => item.status !== 'matched').length} 处待核对${report.evidence.coverage === 'partial' ? ' · 部分扫描' : ''}` : ' · 尚无核验记录'}</summary>
      <p className={styles.meta}>只核验引句与本报告冻结原文的字面关系；找到连续原句不代表分析判断正确。</p>
      {report.evidence ? <>
        <p className={styles.meta}>已扫描 {report.evidence.scannedQuotes} / {report.evidence.totalQuotes} 处候选引句{report.evidence.coverage === 'partial' ? '，扫描未覆盖全部引句。' : '。'}未识别为引句的判断不在此核验范围。</p>
        {!report.evidence.items.length && <p className={styles.meta}>本次未返回引句核验项，不能据此判断报告全部正确。</p>}
        {report.evidence.items.map(item => <MotionDetails key={item.id} className={styles.evidenceItem}>
          <summary>{evidenceLabels[item.status]} · {item.quote.slice(0, 48)}{item.quote.length > 48 ? '…' : ''}</summary>
          <p className={styles.evidenceText}>{item.quote}</p>
          <p className={styles.meta}>报告片段：{report.content.slice(Math.max(0, item.start - 50), Math.min(report.content.length, item.end + 70))}</p>
          <div className={styles.actions}>{item.citedSourceIds.map(id => report.sources.some(source => source.id === id)
            ? <Button key={id} variant="link" size="sm" onClick={() => onSource(id)}>查看所标来源 {id}</Button>
            : <span key={id} className={styles.meta}>来源 {id} 不在本报告中</span>)}</div>
          {sourceButtons(item.matches)}
        </MotionDetails>)}
      </> : <p className={styles.meta}>旧报告暂无引用核验记录，仍可逐项点击来源核对。</p>}
    </MotionDetails>

    <div className={styles.actions}>
      <Button variant="outline" size="sm" aria-expanded={setupOpen} onClick={() => setSetupOpen(open => !open)}>核对主要结论</Button>
      <span className={styles.meta}>先查看范围，再显式发起一次模型核对。</span>
    </div>
    {setupOpen && <div className={styles.reviewSetup}>
      <p className={styles.meta}>每次最多核对 8 段，原文范围以预览为准。只调用一次模型，可能产生用量；未选中或未覆盖的判断仍需另行核对。</p>
      {editing && <p className={styles.notice}>请先保存或取消正在编辑的修订；当前输入保留。</p>}
      {report.sourceChanged && <p className={styles.notice}>原文已变化，不能发起新的核对或应用建议；历史结果仍可查看。</p>}
      {selectionStale && <p className={styles.notice}>报告版本已变化，原选段仍保留，请重新选择范围。<Button variant="ghost" size="sm" disabled={busy} onClick={() => { setSelection(undefined); setSelectionRevision(report.revision) }}>更新核对范围</Button></p>}
      {previewBusy && !selectionStale && <p role="status" className={styles.meta}>正在读取实际核对范围…</p>}
      {previewError && <p role="alert">{previewError} <Button variant="ghost" size="sm" onClick={() => setReload(n => n + 1)}>重读核对范围</Button><Button variant="ghost" size="sm" disabled={busy} onClick={onReload}>重新读取报告</Button></p>}
      {preview && <>
        <p className={styles.meta}>本次实际覆盖 {preview.segments.length} 段，原文约 {preview.sourceChars} 字符；另有 {preview.skipped} 段未覆盖。</p>
        <MotionDetails className={styles.evidenceItem}>
          <summary>查看本次实际核对范围</summary>
          {preview.segments.map(segment => <div key={segment.id} className={styles.coverageSegment}>
            <p className={styles.evidenceText}>{segment.text}</p>
            <div className={styles.actions}>{segment.sourceIds.map(id => <Button key={id} variant="link" size="sm" onClick={() => onSource(id)}>查看原文 {id}</Button>)}</div>
          </div>)}
        </MotionDetails>
        {coverageSources(preview)}
        <MotionDetails className={styles.evidenceItem}>
          <summary>手动选择段落 · 已选 {selectedStarts.length} / 8</summary>
          <div className={styles.actions}><Button variant="ghost" size="sm" disabled={blocked || !!pending || selectionStale} onClick={() => setSelection(undefined)}>恢复自动选择</Button></div>
          <div className={styles.segmentChoices}>{candidates.map((segment, index) => {
            const checked = selectedStarts.includes(segment.start)
            return <label key={segment.id} className={styles.segmentChoice}>
              <input type="checkbox" checked={checked} disabled={blocked || !!pending || selectionStale || previewBusy || (!checked && selectedStarts.length >= 8)}
                onChange={event => setSelection(event.target.checked ? [...selectedStarts, segment.start].sort((a, b) => a - b) : selectedStarts.filter(start => start !== segment.start))} />
              <span><strong>第 {index + 1} 段</strong><span>{segment.text}</span></span>
            </label>
          })}</div>
        </MotionDetails>
      </>}
      {pending && <p className={styles.notice}>这次请求的回执尚未确认；重试沿用同一请求标识。{pending.revision !== report.revision && '原请求绑定旧版本，仅用于找回记录。'}</p>}
      {runningReview && <p role="status" className={styles.meta}>已有核对正在进行，完成后可查看结果。</p>}
      <div className={styles.actions}>
        <Button disabled={blocked || (runningReview && !pending) || (!pending && !currentPreview?.segments.length)} onClick={() => void begin()}>{pending ? '重试并找回这次核对' : '确认范围并开始核对'}</Button>
        {pending && <Button variant="ghost" disabled={busy} onClick={() => { setPending(null); savePendingAnalysisReview(pendingKey, null) }}>放弃找回请求</Button>}
      </div>
      {pending && <p className={styles.meta}>放弃找回不会停止服务端已创建的任务，可在下方记录中查看。</p>}
    </div>}

    {reviews.length > 0 && <MotionDetails className={styles.details}>
      <summary>事实核对记录 · {reviews.length} 次{runningReview ? ' · 进行中' : ''}</summary>
      <p className={styles.meta}>结论仅覆盖记录中的段落和冻结原文。以下为可能的疑点与修订建议，由作者核对后决定是否应用。</p>
      {reviews.map(review => {
        const stale = review.stale || review.reportRevision !== report.revision
        return <section key={review.id} className={styles.reviewRecord}>
          <h3>{reviewLabels[review.status]} · v{review.reportRevision}</h3>
          <p className={styles.meta}>{new Date(review.createdAt).toLocaleString('zh-CN')} · 覆盖 {review.coverage.segments.length} 段 · 另有 {review.coverage.skipped} 段未覆盖</p>
          {stale && <p className={styles.notice}>报告、原文或核对规则已变化，这份核对结果已过期，仅供查阅。</p>}
          {review.error && <p role="alert">{review.error}</p>}
          {reviewing(review) && <Button variant="outline" size="sm" disabled={busy} onClick={() => void onAction(() => api.stopReview(report.novelId, report.id, review.id))}>停止这次核对</Button>}
          <MotionDetails className={styles.evidenceItem}><summary>查看已提交的核对范围</summary>
            {review.coverage.segments.map(segment => <div key={segment.id} className={styles.coverageSegment}>
              <p className={styles.evidenceText}>{segment.text}</p>
              <div className={styles.actions}>{segment.sourceIds.map(id => <Button key={id} variant="link" size="sm" onClick={() => onSource(id)}>查看原文 {id}</Button>)}</div>
            </div>)}
          </MotionDetails>
          {coverageSources(review.coverage)}
          {review.result && <>
            <p className={styles.meta}>已核对 {review.result.checkedSegmentIds.length} 段{review.result.partial ? '，检查不完整' : ''}{review.result.rejected ? `；丢弃 ${review.result.rejected} 条未通过验证的结果` : ''}。</p>
            {!review.result.items.length && <p className={styles.meta}>{review.result.partial || !review.result.checkedSegmentIds.length ? '本次没有可用修订建议，不能据此判断未发现问题。' : '已核对的段落未返回修订建议，仍不代表报告全部正确。'}</p>}
            {review.result.items.map(finding => <MotionDetails key={finding.id} className={styles.evidenceItem}>
              <summary>{findingLabels[finding.kind]} · {finding.original.slice(0, 48)}{finding.original.length > 48 ? '…' : ''}</summary>
              <p>{finding.explanation}</p>
              {sourceButtons(finding.evidence)}
              <div className={styles.revisionComparison}>
                <div><h4>修订前</h4><p className={styles.evidenceText}><del>{finding.original}</del></p></div>
                <div><h4>建议修订后</h4><p className={styles.evidenceText}><ins>{finding.suggestion}</ins></p></div>
              </div>
              <Button variant="outline" size="sm" disabled={blocked || stale || review.status !== 'completed' || report.content.slice(finding.start, finding.end) !== finding.original}
                onClick={() => void onAction(() => api.applyReview(report.novelId, report.id, review.id, finding.id, report.revision))}>应用这条修订</Button>
              {(editing || report.sourceChanged) && <p className={styles.meta}>{editing ? '请先保存或取消手工修订，再决定是否应用。' : '原文已变化，这条建议不能应用到当前报告。'}</p>}
            </MotionDetails>)}
          </>}
        </section>
      })}
    </MotionDetails>}
  </section>
}
