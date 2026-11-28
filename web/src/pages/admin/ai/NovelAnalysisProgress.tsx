import type { AnalysisReport } from '@shared/novel-analysis'
import styles from './novel-analysis.module.css'

/** Reading coverage is separate from the completion of the report. Legacy tasks may lack a phase. */
export default function NovelAnalysisProgress({ report }: { report: AnalysisReport }) {
  const phases = ['reading', 'condensing', 'report'] as const
  const current = report.phase ? phases.indexOf(report.phase) : report.processed < report.total ? 0 : -1
  const active = ['queued', 'running'].includes(report.status)
  const direct = report.phase === 'report' && !report.notes.length && !report.draft
  const readingDone = report.total > 0 && report.processed >= report.total
  return <>
    <ol className={styles.phases} aria-label="分析阶段">
      {['阅读原文', '整理记录', '生成报告'].map((label, index) => {
        const done = current > index || (index === 0 && readingDone)
        const status = direct && index < 2 ? (index === 0 ? '随报告直接阅读' : '无需分段整理')
          : done ? '已完成' : current === index ? (active ? '进行中' : report.status === 'failed' ? '未完成' : '已暂停') : '待完成'
        return <li key={label} aria-current={current === index ? 'step' : undefined}>
          <span>{index + 1}. {label}</span><span className={styles.meta}>{status}</span>
        </li>
      })}
    </ol>
    {!direct && <>
      {report.processed < report.total && <progress max={Math.max(1, report.total)} value={report.processed} aria-label="原文阅读进度" />}
      <span className={styles.meta}>已保存 {report.processed} / {report.total} 段阅读记录{readingDone ? report.draft ? '；阅读完成，小节保存进度见下方。' : '；阅读完成，最终报告尚未生成。' : ''}</span>
    </>}
  </>
}
