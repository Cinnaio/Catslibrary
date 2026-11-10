import AiStreamPreview from '@/components/shared/AiStreamPreview'
import type { AiTextProgress } from '@shared/ai-text-progress'
import { useEffect, useRef, useState } from 'react'
import { aiApi, type AiWritingReview, type AiWritingReviewAttempt } from '@/lib/api'
import { Button } from '@/components/ui/button'

export default function DraftReview(props: { draftId: string; contentRevision: string; disabled?: boolean }) {
  const [report, setReport] = useState<AiWritingReview | null>(null)
  const [attempt, setAttempt] = useState<AiWritingReviewAttempt | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState<AiTextProgress | null>(null)
  const version = useRef(0)
  useEffect(() => {
    const current = ++version.current
    setBusy(false)
    setProgress(null)
    setReport(null)
    setAttempt(null)
    setError('')
    let cancelled = false
    void aiApi.writing
      .getDraftReview(props.draftId)
      .then(({ report, attempt }) => {
        if (!cancelled && current === version.current) { setReport(report); setAttempt(attempt || null) }
      })
      .catch(() => { if (!cancelled && current === version.current) setError('读取检查记录失败，可以重试。') })
    return () => {
      cancelled = true
      version.current++
    }
  }, [props.draftId, props.contentRevision])
  const stale = report && (report.stale || report.draftRevision !== props.contentRevision)
  const partial = report?.completeness === 'partial'
  const failedAttempt = attempt?.status === 'failed' && attempt.draftRevision === props.contentRevision
  async function check() {
    const current = ++version.current
    setProgress(null)
    setBusy(true)
    setError('')
    try {
      const result = await aiApi.writing.reviewDraft(props.draftId, props.contentRevision, (next) => { if (current === version.current) setProgress(next) })
      if (current === version.current) { setReport(result.report); setAttempt(null) }
    } catch (err) {
      if (current === version.current) setError((err as Error).message)
      try {
        const saved = await aiApi.writing.getDraftReview(props.draftId)
        if (current === version.current) { setReport(saved.report); setAttempt(saved.attempt || null) }
      } catch { /* Keep the visible failure and any already verified findings. */ }
    } finally {
      if (current === version.current) setBusy(false)
    }
  }
  return (
    <section className="grid gap-3 pt-4" aria-label="草稿质量检查">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">草稿质量检查</h3>
          <p className="mt-1 text-xs text-muted-foreground">检查连续性、未解伏笔与关系发展。完整结果按正文与材料版本复用；重试失败或不完整的检查会再次调用模型。</p>
        </div>
        <Button type="button" size="sm" variant="outline" disabled={props.disabled || busy} onClick={() => void check()}>
          {busy ? '检查中…' : error || failedAttempt || partial ? '重试检查' : report ? '重新检查' : '检查草稿'}
        </Button>
      </div>
      {busy && <AiStreamPreview progress={progress} structured />}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {failedAttempt && !error && <p role="alert" className="text-sm text-destructive">{attempt.message || '上次检查未完成，可以重试。'}</p>}
      {stale && (
        <p role="status" className="text-sm text-muted-foreground">
          草稿或来源已变化，下面是旧版本检查，请重新检查。
        </p>
      )}
      {report && (
        <>
          <p className="text-xs text-muted-foreground">
            检查时间：{new Date(report.updatedAt).toLocaleString('zh-CN')} · 结果供作者审阅，不自动改写正文或决定发布。
          </p>
          {partial && <p role="status" className="text-sm text-muted-foreground">检查不完整：{report.rejectedFindings || 0} 项未通过引句或格式校验，未予展示。下面仅保留可核验的 {report.findings.length} 项；这不表示其余内容没有问题，可重试检查。</p>}
          {!partial && !report.findings.length && <p className="text-sm">在本次提供的材料范围内未发现有证据支持的问题，仍需人工审阅。</p>}
          {report.findings.map((finding, i) => (
            <div key={i} className="grid gap-2 border-b border-border pb-3">
              <p className="text-sm font-medium">
                {{ consistency: '一致性', foreshadow: '伏笔提醒', relationship: '关系发展' }[finding.category]} ·{' '}
                {finding.severity === 'warning' ? '建议核对' : '供参考'}
              </p>
              <p className="whitespace-pre-wrap break-words text-sm">{finding.description}</p>
              {finding.draftQuote && (
                <blockquote className="whitespace-pre-wrap break-words text-sm text-muted-foreground">草稿：“{finding.draftQuote}”</blockquote>
              )}
              {finding.evidence.map((e, j) => (
                <p key={j} className="break-words text-xs leading-5 text-muted-foreground">
                  来源 {report.sources.find((s) => s.id === e.sourceId)?.title || e.sourceId}：“{e.quote}”
                </p>
              ))}
            </div>
          ))}
        </>
      )}
    </section>
  )
}
