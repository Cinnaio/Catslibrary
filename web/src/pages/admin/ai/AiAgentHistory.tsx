import { useDeferredValue, useState, type ComponentProps, type CSSProperties, type Ref } from 'react'
import { MessageSquare, Trash2 } from 'lucide-react'
import type { AgentSession } from '@shared/ai-agent'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { ReadingDialog } from '@/components/shared/ReadingDialog'
import { SearchField } from '@/components/shared/SearchField'
import { formatDateTime } from '@/lib/format'
import styles from './agent-workspace.module.css'

interface HistorySource {
  sessions: AgentSession[]
  loading: boolean
  hasMore: boolean
  error: string
  load: (more?: boolean) => void
}

interface AiAgentHistoryProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  novelId: string
  sessionId: string
  searchRef: Ref<HTMLInputElement>
  book: HistorySource
  recent: HistorySource
  onSelect: (session: AgentSession) => void
  onDelete: (session: AgentSession, trigger: HTMLButtonElement) => void
  onCloseAutoFocus: ComponentProps<typeof ReadingDialog>['onCloseAutoFocus']
}

export default function AiAgentHistory({
  open,
  onOpenChange,
  novelId,
  sessionId,
  searchRef,
  book,
  recent,
  onSelect,
  onDelete,
  onCloseAutoFocus,
}: AiAgentHistoryProps) {
  const [scope, setScope] = useState<'book' | 'recent'>(novelId ? 'book' : 'recent')
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const search = deferredQuery.trim().toLocaleLowerCase()
  const source = scope === 'book' ? book : recent
  const results = source.sessions.filter((session) =>
    [session.title, session.novelTitle, session.anchorTitle].some((value) => value.toLocaleLowerCase().includes(search)),
  )
  const transitioning = query !== deferredQuery

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <ReadingDialog
        title="历史对话"
        description="回到之前的讨论，接着创作。"
        className={styles.historyDialog}
        bodyLabel="查找历史对话"
        onCloseAutoFocus={onCloseAutoFocus}
        footer={
          <div className={styles.historyFooter}>
            <span className={styles.muted}>
              {search ? '搜索已载入的对话' : '已载入 ' + source.sessions.length + ' 段对话'}
              {source.hasMore && '，可继续加载更早的记录'}
            </span>
            {source.hasMore && !source.error && (
              <Button variant="ghost" disabled={source.loading} onClick={() => source.load(true)}>
                {source.loading ? '正在加载…' : '加载更多对话'}
              </Button>
            )}
          </div>
        }
      >
        <div className={styles.historyControls}>
          <div className={styles.historyScopes} role="group" aria-label="历史对话范围">
            <Button variant="ghost" disabled={!novelId} aria-pressed={scope === 'book'} onClick={() => setScope('book')}>
              本书
            </Button>
            <Button variant="ghost" aria-pressed={scope === 'recent'} onClick={() => setScope('recent')}>
              全部最近
            </Button>
          </div>
          <SearchField
            ref={searchRef}
            label="搜索历史对话"
            placeholder="搜索对话、作品或章节…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className={styles.historyResults} data-transitioning={source.loading || transitioning || undefined} aria-busy={source.loading || transitioning}>
          {source.error && (
            <p className={styles.error} role="alert">
              {source.error}
              <Button variant="ghost" disabled={source.loading} onClick={() => source.load(source.hasMore && source.sessions.length > 0)}>
                {source.loading ? '正在重试…' : '重试'}
              </Button>
            </p>
          )}
          {results.length > 0 ? (
            <ul className={styles.historyList} aria-label="历史对话列表">
              {results.map((session, index) => (
                <li
                  key={scope + ':' + search + ':' + session.id}
                  className={styles.historyItem}
                  data-current={session.id === sessionId || undefined}
                  style={{ '--history-index': Math.min(index, 7) } as CSSProperties}
                >
                  <Button
                    variant="ghost"
                    className={styles.historySelect}
                    aria-label={'打开对话「' + session.title + '」'}
                    aria-current={session.id === sessionId ? 'true' : undefined}
                    onClick={() => onSelect(session)}
                  >
                    <MessageSquare size={16} aria-hidden="true" />
                    <span className={styles.historyText}>
                      <span className={styles.historyTitle}>{session.title || '创作对话'}</span>
                      <span className={styles.historyContext}>
                        {scope === 'recent' && <span>{session.novelTitle || '未命名作品'}</span>}
                        <span>{session.anchorTitle ? '续写自 ' + session.anchorTitle : '新章节创作'}</span>
                      </span>
                    </span>
                    <span className={styles.historyMeta}>
                      {session.id === sessionId && <span className={styles.historyCurrent}>当前</span>}
                      <time dateTime={new Date(session.updatedAt).toISOString()}>{formatDateTime(session.updatedAt)}</time>
                    </span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={styles.historyDelete}
                    aria-label={'删除对话「' + session.title + '」'}
                    onClick={(event) => onDelete(session, event.currentTarget)}
                  >
                    <Trash2 size={15} aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.historyEmpty} role="status">
              {source.loading
                ? '正在读取历史对话…'
                : source.error
                  ? '暂时无法读取对话，请重试。'
                  : search
                    ? '已载入的对话中没有匹配结果。'
                    : scope === 'book'
                      ? '这本书还没有历史对话。'
                      : '还没有最近的对话。'}
            </p>
          )}
        </div>
      </ReadingDialog>
    </Dialog>
  )
}
