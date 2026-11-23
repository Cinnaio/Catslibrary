import { useId, useState } from 'react'
import type { AgentChapterImpactFinding, AgentChapterImpactReport } from '@shared/ai-agent'
import { Button } from '@/components/ui/button'
import { MotionView } from '@/components/ui/motion'
import { getAdminTableRowStaggerDelay } from '@/lib/admin-table-motion'
import styles from './agent-action-dialog.module.css'

export default function AiAgentChapterImpact({ novelId, disabled, onCheck, onDiscuss }: {
  novelId: string
  disabled: boolean
  onCheck: (chapterCount: number) => Promise<AgentChapterImpactReport>
  onDiscuss: (finding: AgentChapterImpactFinding) => void
}) {
  const scopeId = useId()
  const [count, setCount] = useState(3)
  const [checking, setChecking] = useState(false)
  const [report, setReport] = useState<AgentChapterImpactReport | null>(null)
  const [error, setError] = useState('')

  async function check() {
    if (checking || disabled) return
    setChecking(true)
    setReport(null)
    setError('')
    try {
      setReport(await onCheck(count))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '影响检查未完成，请重试')
    } finally {
      setChecking(false)
    }
  }

  return <section className={styles.impact} aria-label="跨章影响检查">
    <div className={styles.impactControls}>
      <label htmlFor={scopeId}>检查范围</label>
      <select id={scopeId} value={count} disabled={checking || disabled} onChange={event => {
        setCount(Number(event.target.value))
        setReport(null)
        setError('')
      }}>
        {Array.from({ length: 10 }, (_, index) => index + 1).map(n => <option key={n} value={n}>后续 {n} 章</option>)}
      </select>
      <Button size="sm" variant="outline" onClick={() => void check()} disabled={checking || disabled}>
        {checking ? '正在检查…' : error || report?.rejectedFindings ? '重试影响检查' : '检查后续影响'}
      </Button>
    </div>
    <p className={styles.impactNote}>只核对本次将写回的改动，调用文本模型时计入用量。</p>
    {checking && <p className={styles.impactNote} role="status">正在核对后续章节原文</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {report && <MotionView motionKey={count} className={styles.impactResult}>
      <p className={styles.impactNote} role="status">{report.checkedChapters.length ? `已检查 ${report.checkedChapters.length} 章${report.findings.length ? `，发现 ${report.findings.length} 处疑点` : report.rejectedFindings ? '' : '，未发现有原文支持的疑点'}` : '这章之后没有已发布章节。'}</p>
      {report.checkedChapters.length > 0 && <p className={styles.impactNote}>{report.checkedChapters.map(chapter => chapter.title).join(' · ')}</p>}
      {report.rejectedFindings > 0 && <p className={styles.impactNote}>有 {report.rejectedFindings} 条结果的引文无法核对，可以重试。</p>}
      {report.findings.length > 0 && <ul className={styles.impactFindings}>
        {report.findings.map((finding, index) => <li key={index} style={{ animationDelay: `${getAdminTableRowStaggerDelay(index, report.findings.length)}ms` }}>
          <a href={`/read/${encodeURIComponent(novelId)}/${encodeURIComponent(finding.chapterId)}`} target="_blank" rel="noopener">{finding.chapterTitle}</a>
          <p>{finding.description}</p>
          <dl>
            {finding.beforeQuote && <><dt>改动前</dt><dd>{finding.beforeQuote}</dd></>}
            {finding.afterQuote && <><dt>改动后</dt><dd>{finding.afterQuote}</dd></>}
            <dt>后文原句</dt><dd>{finding.chapterQuote}</dd>
          </dl>
          <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onDiscuss(finding)}>带到对话中修改</Button>
        </li>)}
      </ul>}
    </MotionView>}
  </section>
}
