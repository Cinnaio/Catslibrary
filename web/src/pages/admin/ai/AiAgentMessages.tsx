import { useEffect, useRef, useState } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Check, ChevronRight, Copy } from 'lucide-react'
import type { AgentEvent } from '@shared/ai-agent'
import { Button } from '@/components/ui/button'
import { MotionDetails } from '@/components/ui/motion'
import AiAgentSources from './AiAgentSources'
import styles from './agent-workspace.module.css'

const READ_TOOLS = new Set([
  'read_overview',
  'search_chapters',
  'search_story',
  'read_chapter',
  'read_story_memory',
  'list_drafts',
  'read_draft',
  'list_covers',
  'read_task',
  'read_conversation',
  'read_conversation_sources',
])

const markdownComponents: Components = {
  a: ({ href, title, children }) =>
    href ? (
      <a href={href} title={title} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ) : (
      <>{children}</>
    ),
  table: ({ children }) => (
    <div className={styles.markdownTable} tabIndex={0} role="region" aria-label="回复中的表格">
      <table>{children}</table>
    </div>
  ),
  pre: ({ children }) => (
    <pre tabIndex={0} role="region" aria-label="回复中的代码块">
      {children}
    </pre>
  ),
}

export function AgentMarkdown({ content }: { content: string }) {
  return (
    <div className={styles.markdown}>
      <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents} skipHtml>
        {content}
      </Markdown>
    </div>
  )
}

function isReading(event: AgentEvent) {
  return (
    event.role === 'activity' &&
    !!event.metadata.tool &&
    READ_TOOLS.has(event.metadata.tool) &&
    !event.metadata.error &&
    !event.metadata.artifactTaskId &&
    !event.metadata.actionId &&
    !event.metadata.memoryId
  )
}

function CopyReply({ content }: { content: string }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      clearTimeout(timer.current)
    }
  }, [])
  async function copy() {
    try {
      await navigator.clipboard.writeText(content)
      if (!mounted.current) return
      setStatus('copied')
    } catch {
      if (!mounted.current) return
      setStatus('failed')
    }
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setStatus('idle'), 2500)
  }
  return (
    <div className={styles.messageActions}>
      <Button type="button" size="sm" variant="ghost" onClick={() => void copy()} aria-label={status === 'copied' ? '已复制回复' : '复制回复'} title="复制回复">
        {status === 'copied' ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
        <span>{status === 'copied' ? '已复制' : '复制'}</span>
      </Button>
      <span className={status === 'failed' ? styles.error : 'sr-only'} role="status">
        {status === 'failed' ? '复制失败，请选择文字复制。' : status === 'copied' ? '回复已复制' : ''}
      </span>
    </div>
  )
}

export default function AiAgentMessages({
  events,
  busy,
  onArtifact,
  onAction,
}: {
  events: AgentEvent[]
  busy: boolean
  onArtifact: (id: string) => void
  onAction: (id: string) => void
}) {
  const groups: Array<{ id: number; reading: boolean; events: [AgentEvent, ...AgentEvent[]] }> = []
  for (const event of events) {
    const reading = isReading(event)
    const previous = groups.at(-1)
    if (reading && previous?.reading && previous.events[0].taskId === event.taskId) previous.events.push(event)
    else groups.push({ id: event.id, reading, events: [event] })
  }
  return groups.map((group) => {
    if (group.reading)
      return (
        <MotionDetails key={group.id} className={styles.readingGroup}>
          <summary>
            <ChevronRight size={14} aria-hidden="true" />
            <span>查阅资料</span>
            <span className={styles.readingCount}>· {group.events.length} 次</span>
          </summary>
          <div className={styles.readingItems}>
            {group.events.map((event) => (
              <div key={event.id} className={styles.activity}>
                <div className={styles.prose}>{event.content}</div>
                {event.metadata.sources?.length ? <AiAgentSources sources={event.metadata.sources} /> : null}
              </div>
            ))}
          </div>
        </MotionDetails>
      )
    const event = group.events[0]
    return (
      <article key={event.id} className={event.role === 'activity' ? styles.activity : styles.message} data-role={event.role}>
        {event.role === 'assistant' && <span className={styles.speaker}>创作助手</span>}
        {event.role === 'assistant' && !event.metadata.error ? (
          <AgentMarkdown content={event.content} />
        ) : (
          <div className={event.metadata.error ? styles.error : styles.prose}>{event.content}</div>
        )}
        {event.metadata.sources?.length ? <AiAgentSources sources={event.metadata.sources} /> : null}
        {event.metadata.artifactTaskId && (
          <Button size="sm" variant="link" disabled={busy} onClick={() => onArtifact(event.metadata.artifactTaskId!)}>
            查看进度与产出
          </Button>
        )}
        {event.metadata.actionId && (
          <Button size="sm" variant="link" disabled={busy} onClick={() => onAction(event.metadata.actionId!)}>
            查看操作记录
          </Button>
        )}
        {event.role === 'assistant' && !event.metadata.error && event.content && <CopyReply content={event.content} />}
      </article>
    )
  })
}
