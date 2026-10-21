import { useEffect, useState } from 'react'
import { aiApi, type AiWritingReview } from '@/lib/api'
import { Button } from '@/components/ui/button'

export default function DraftReview(props: { draftId: string; contentRevision: string; disabled?: boolean }) {
  const [report, setReport] = useState<AiWritingReview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    void aiApi.writing
      .getDraftReview(props.draftId)
      .then(({ report }) => {
        if (!cancelled) setReport(report)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [props.draftId, props.contentRevision])
  const stale = report && (report.stale || report.draftRevision !== props.contentRevision)
  async function check() {
    setBusy(true)
    setError('')
    try {
      setReport((await aiApi.writing.reviewDraft(props.draftId, props.contentRevision)).report)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="grid gap-3 border-t border-border pt-4" aria-label="草稿质量检查">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">草稿质量检查</h3>
          <p className="mt-1 text-xs text-muted-foreground">检查连续性、未解伏笔与关系发展。每个新版本检查会调用一次模型；相同正文与材料复用已有结果。</p>
        </div>
        <Button type="button" size="sm" variant="outline" disabled={props.disabled || busy} onClick={() => void check()}>
          {busy ? '检查中…' : report ? '重新检查' : '检查草稿'}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
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
          {!report.findings.length && <p className="text-sm">在本次提供的材料范围内未发现有证据支持的问题，仍需人工审阅。</p>}
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
