import type { AgentEvidence } from '@shared/ai-agent'
import { MotionDetails } from '@/components/ui/motion'
import styles from './agent-sources.module.css'

export default function AiAgentSources({ sources }: { sources: AgentEvidence[] }) {
  if (!sources.length) return null
  return (
    <MotionDetails className={styles.root}>
      <summary>查阅依据 · {sources.length}</summary>
      <p className={styles.note}>以下为本轮读取时的片段；打开章节可查看当前原文。分析报告可能含有推断，须结合原文核对。</p>
      <ol className={styles.list}>
        {sources.map((source) => (
          <li key={source.id}>
            <div className={styles.heading}>
              {source.kind === 'chapter' && source.chapterId ? (
                <a href={`/read/${encodeURIComponent(source.novelId)}/${encodeURIComponent(source.chapterId)}`} target="_blank" rel="noopener noreferrer">
                  {source.title}
                </a>
              ) : source.kind === 'analysis' && source.reportId ? (
                <a href={`/admin/ai?sub=analysis&novel=${encodeURIComponent(source.novelId)}&report=${encodeURIComponent(source.reportId)}`} target="_blank" rel="noopener noreferrer">
                  {source.title}
                </a>
              ) : (
                <strong>{source.title}</strong>
              )}
              <span>{source.origin === 'published' ? '章节原文' : source.kind === 'analysis' ? (source.origin === 'manual' ? '人工修订报告' : '自动分析报告') : (source.origin === 'manual' ? '人工修订档案' : '自动分析档案')}</span>
              {source.truncated && <span>节选</span>}
            </div>
            {source.kind === 'analysis' && source.fromChapter && source.throughChapter
              ? <p className={styles.note}>范围：《{source.fromChapter.title}》至《{source.throughChapter.title}》，修订 {source.reportRevision}；并非该片段的逐句出处。</p>
              : source.throughChapter && <p className={styles.note}>历史档案覆盖至《{source.throughChapter.title}》，并非该片段的逐句出处。</p>}
            <blockquote className={styles.excerpt}>{source.excerpt}</blockquote>
          </li>
        ))}
      </ol>
    </MotionDetails>
  )
}
