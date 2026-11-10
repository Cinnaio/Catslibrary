import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { AnalysisReport } from '@shared/novel-analysis'
import { Button } from '@/components/ui/button'
import styles from './novel-analysis.module.css'

export default function NovelAnalysisMarkdown({ content, sources, onSource }: {
  content: string; sources: AnalysisReport['sources']; onSource: (id: string) => void
}) {
  const known = new Map(sources.map(source => [source.id, source]))
  const marked = content.replace(/\[\[(S\d+)\]\]/g, (marker, id: string) => known.has(id) ? `[${id}](#analysis-source-${id})` : marker)
  return <div className={styles.markdown}><Markdown skipHtml remarkPlugins={[remarkGfm]} components={{
    img: ({ alt }) => <span>{alt || '图片描述'}</span>,
    a: ({ href, children }) => {
      const id = href?.match(/^#analysis-source-(S\d+)$/)?.[1]
      const source = id ? known.get(id) : undefined
      return source ? <Button variant="link" size="sm" className={styles.citation} onClick={() => onSource(source.id)}
        title={`核对《${source.chapterTitle}》第 ${source.part} 段`} aria-label={`来源 ${source.id}：${source.chapterTitle}，第 ${source.part} 段`}>{children}</Button>
        : <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
    },
    table: ({ children }) => <div className={styles.table} tabIndex={0} role="region" aria-label="报告表格"><table>{children}</table></div>,
    pre: ({ children }) => <pre tabIndex={0}>{children}</pre>,
  }}>{marked}</Markdown></div>
}
