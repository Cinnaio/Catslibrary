import type { AgentEvidence } from '@shared/ai-agent'
import { MotionDetails } from '@/components/ui/motion'
import styles from './agent-sources.module.css'

export default function AiAgentSources({ sources }: { sources: AgentEvidence[] }) {
  if (!sources.length) return null
  return (
    <MotionDetails className={styles.root}>
      <summary>查阅依据 · {sources.length}</summary>
      <p className={styles.note}>以下为本轮读取时的片段；打开章节可查看当前原文。档案是分析材料。</p>
      <ol className={styles.list}>
        {sources.map((source) => (
          <li key={source.id}>
            <div className={styles.heading}>
              {source.kind === 'chapter' && source.chapterId ? (
                <a href={`/read/${encodeURIComponent(source.novelId)}/${encodeURIComponent(source.chapterId)}`} target="_blank" rel="noopener noreferrer">
                  {source.title}
                </a>
              ) : (
                <strong>{source.title}</strong>
              )}
              <span>{source.origin === 'published' ? '章节原文' : source.origin === 'manual' ? '人工修订档案' : '自动分析档案'}</span>
              {source.truncated && <span>节选</span>}
            </div>
            {source.throughChapter && <p className={styles.note}>档案覆盖至《{source.throughChapter.title}》，并非该片段的逐句出处。</p>}
            <blockquote className={styles.excerpt}>{source.excerpt}</blockquote>
          </li>
        ))}
      </ol>
    </MotionDetails>
  )
}
