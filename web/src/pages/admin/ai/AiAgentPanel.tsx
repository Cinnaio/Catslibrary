import { watchAiTask } from '@/lib/ai-task-stream'
import { parseAiTextProgress } from '@shared/ai-text-progress'
import type { AgentTask } from '@shared/ai-agent'
import AiStreamPreview from '@/components/shared/AiStreamPreview'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { BookOpen, Check, Image as ImageIcon, MessageSquare, Plus } from 'lucide-react'
import type { AdminNovelIndexItem, ChapterMeta } from '@shared/types'
import {
  agentTaskRunning,
  type AgentAction,
  type AgentActionKind,
  type AgentArtifact,
  type AgentContentPreferences,
  type AgentEvent,
  type AgentSession,
  type AgentSessionDetail,
} from '@shared/ai-agent'
import { agentApi } from '@/lib/ai-agent-api'
import { chaptersApi, newOperationId, url } from '@/lib/api'
import { loadAdminNovelIndex } from '@/lib/admin-novel-index'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog } from '@/components/ui/dialog'
import { MotionDetails } from '@/components/ui/motion'
import FormField from '@/components/shared/FormField'
import SearchSelect from '@/components/shared/SearchSelect'
import { ReadingDialog } from '@/components/shared/ReadingDialog'
import { taskStatusLabel, kindLabel } from './labels'
import AiAgentComposer from './AiAgentComposer'
import AiAgentMemory from './AiAgentMemory'
import AiAgentSources from './AiAgentSources'
import styles from './agent-workspace.module.css'

const failure = (e: unknown) => (e instanceof Error ? e.message : '操作失败，请稍后重试')
const ACTION_STATUS = { pending: '待确认', executing: '正在执行', completed: '已采纳', rejected: '已放弃', failed: '未采纳' }
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

export default function AiAgentPanel() {
  const [params] = useSearchParams()
  return <AiAgentWorkspace key={params.get('novel') || ''} />
}

function AiAgentWorkspace() {
  const [params, setParams] = useSearchParams()
  const novelId = params.get('novel') || ''
  const sessionId = params.get('session') || ''
  const [novels, setNovels] = useState<AdminNovelIndexItem[]>([])
  const [sessions, setSessions] = useState<AgentSession[]>([])
  const [chapters, setChapters] = useState<ChapterMeta[]>([])
  const [anchor, setAnchor] = useState(params.get('afterChapterId') || '')
  const [loading, setLoading] = useState(!!novelId)
  const [creating, setCreating] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState('')
  const [indexError, setIndexError] = useState('')
  const [indexRefresh, setIndexRefresh] = useState(0)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    let active = true
    void loadAdminNovelIndex('', () => active)
      .then((items) => {
        if (active) {
          setNovels(items)
          setIndexError('')
        }
      })
      .catch((e) => {
        if (active) setIndexError(failure(e))
      })
    return () => {
      active = false
    }
  }, [indexRefresh])
  useEffect(() => {
    let active = true
    if (!novelId)
      return () => {
        active = false
      }
    void Promise.all([agentApi.sessions(novelId), chaptersApi.list(novelId)])
      .then(([history, book]) => {
        if (!active) return
        setSessions(history.sessions)
        setHasMore(history.hasMore)
        setChapters(book.chapters)
      })
      .catch((e) => {
        if (active) setError(failure(e))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [novelId])
  function navigateBook(value: string) {
    const next = new URLSearchParams(params)
    next.set('novel', value)
    next.delete('session')
    next.delete('afterChapterId')
    setParams(next)
  }
  function navigateSession(value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set('session', value)
    else next.delete('session')
    setParams(next)
  }
  async function create() {
    if (!novelId || creating) return
    setCreating(true)
    setError('')
    try {
      const { session } = await agentApi.create(novelId, anchor)
      if (!mounted.current) return
      setSessions((current) => [session, ...current])
      navigateSession(session.id)
    } catch (e) {
      if (mounted.current) setError(failure(e))
    } finally {
      if (mounted.current) setCreating(false)
    }
  }
  async function loadMore() {
    setLoading(true)
    try {
      const result = await agentApi.sessions(novelId, sessions.length)
      if (mounted.current) {
        setSessions((old) => [...old, ...result.sessions.filter((s) => !old.some((o) => o.id === s.id))])
        setHasMore(result.hasMore)
      }
    } catch (e) {
      if (mounted.current) setError(failure(e))
    } finally {
      if (mounted.current) setLoading(false)
    }
  }
  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <FormField label="当前作品">
          <SearchSelect
            options={novels.map((n) => ({ value: n.id, label: n.title, sub: n.author }))}
            value={novelId}
            onChange={navigateBook}
            placeholder="选择一本小说"
            searchable
            matchTriggerWidth
          />
        </FormField>
        <FormField label="创作对话">
          <SearchSelect
            options={sessions.map((s) => ({ value: s.id, label: s.title, sub: s.anchorTitle || '从新章节开始' }))}
            value={sessionId}
            onChange={navigateSession}
            placeholder={loading ? '正在读取对话…' : '选择之前的对话'}
            disabled={!novelId || loading}
            searchable
            matchTriggerWidth
          />
        </FormField>
        <Button variant="outline" disabled={!novelId || creating || loading} onClick={() => navigateSession('')}>
          <Plus size={16} />
          新对话
        </Button>
      </div>
      {indexError && (
        <p className={styles.error} role="alert">
          {indexError}{' '}
          <Button size="sm" variant="ghost" onClick={() => setIndexRefresh((v) => v + 1)}>
            重新读取书目
          </Button>
        </p>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {hasMore && (
        <Button size="sm" variant="ghost" disabled={loading} onClick={() => void loadMore()}>
          加载更早的对话
        </Button>
      )}
      {!sessionId ? (
        <section className={styles.welcome}>
          <MessageSquare size={30} aria-hidden="true" />
          <h2>从一个想法开始</h2>
          <p>一起讨论情节、打磨草稿，或构思新的封面。每次对话和产出都会保存在当前作品下。</p>
          {novelId && (
            <div className={styles.start}>
              <FormField label="本次续写起点" hint="对话会固定这个起点，只查阅它及之前的正式章节。">
                <SearchSelect
                  options={[{ value: '', label: '创建时的最新章节' }, ...chapters.map((c) => ({ value: c.id, label: c.title }))]}
                  value={anchor}
                  onChange={setAnchor}
                  searchable
                  matchTriggerWidth
                />
              </FormField>
              <Button disabled={creating || loading} onClick={() => void create()}>
                {creating ? '正在建立对话…' : '开始创作对话'}
              </Button>
            </div>
          )}
          {!novelId && <p className={styles.muted}>先在上方选择一本小说。</p>}
        </section>
      ) : (
        <AgentConversation
          key={`${novelId}:${sessionId}`}
          sessionId={sessionId}
          novelId={novelId}
          onSession={(session) =>
            setSessions((old) => (old.some((s) => s.id === session.id) ? old.map((s) => (s.id === session.id ? session : s)) : [session, ...old]))
          }
        />
      )}
    </div>
  )
}

function AgentConversation({ sessionId, novelId, onSession }: { sessionId: string; novelId: string; onSession: (s: AgentSession) => void }) {
  const [data, setData] = useState<AgentSessionDetail | null>(null)
  const [earlier, setEarlier] = useState<AgentEvent[]>([])
  const [liveTasks, setLiveTasks] = useState<Record<string, AgentTask>>({})
  const observedEvents = useRef(new Map<number, AgentEvent>())
  const [hasEarlier, setHasEarlier] = useState<boolean | null>(null)
  const [input, setInput] = useState('')
  const [providerPresetId, setProviderPresetId] = useState('')
  const providerInitialized = useRef(false)
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [selectedTask, setSelectedTask] = useState('')
  const [olderArtifact, setOlderArtifact] = useState<AgentArtifact | null>(null)
  const [preview, setPreview] = useState<AgentAction | null>(null)
  const [mobileView, setMobileView] = useState<'chat' | 'outputs'>('chat')
  const mounted = useRef(true)
  const onSessionRef = useRef(onSession)
  useEffect(() => {
    onSessionRef.current = onSession
  }, [onSession])
  const pendingRequest = useRef<{ content: string; id: string; providerPresetId: string } | null>(null)
  const feed = useRef<HTMLDivElement>(null)
  const followBottom = useRef(true)
  const activeTask = data?.activeTask ? liveTasks[data.activeTask.id] || data.activeTask : null
  const running = agentTaskRunning(activeTask)
  const reload = useCallback(() => setRefresh((v) => v + 1), [])
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let inFlight = false
    async function load() {
      if (inFlight || !active) return
      inFlight = true
      try {
        const next = await agentApi.get(sessionId)
        if (next.session.novelId !== novelId) throw new Error('此对话不属于当前作品，请重新选择对话')
        if (!active) return
        if (!providerInitialized.current) {
          setProviderPresetId([...next.events].reverse().find((event) => event.role === 'user')?.metadata.providerPresetId || '')
          providerInitialized.current = true
        }
        for (const event of next.events) observedEvents.current.set(event.id, event)
        setEarlier([...observedEvents.current.values()].filter((event) => !next.events.some((e) => e.id === event.id)).sort((a, b) => a.id - b.id))
        setData(next)
        onSessionRef.current(next.session)
        setLoadError('')
        timer = setTimeout(() => void load(), 12000)
      } catch (e) {
        if (active) {
          setLoadError(failure(e))
          timer = setTimeout(() => void load(), 10000)
        }
      } finally {
        inFlight = false
      }
    }
    function visible() {
      if (document.visibilityState === 'visible') {
        if (timer) clearTimeout(timer)
        void load()
      }
    }
    void load()
    document.addEventListener('visibilitychange', visible)
    return () => {
      active = false
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [sessionId, novelId, refresh])
  const watchedIds = [data?.activeTask, ...(data?.artifacts.map((a) => a.task) || [])].filter(agentTaskRunning).map((task) => task!.id).sort().join(',')
  useEffect(() => {
    const stops = watchedIds.split(',').filter(Boolean).map((id) => {
      let previousStep = ''
      return watchAiTask(id, (task) => {
        setLiveTasks((current) => ({ ...current, [id]: { ...task, status: task.status as AgentTask['status'] } }))
        // Saved messages and artifacts become available at stage transitions.
        const step = `${task.status}:${task.current}:${parseAiTextProgress(task.result)?.round ?? ''}:${task.step.replace(/\d+/g, '#')}`
        if (previousStep && step !== previousStep || !['queued', 'running'].includes(task.status)) reload()
        previousStep = step
      })
    })
    return () => stops.forEach((stop) => stop())
  }, [watchedIds, reload])
  useEffect(() => {
    if (followBottom.current && feed.current) feed.current.scrollTop = feed.current.scrollHeight
  }, [data?.events.length, activeTask?.result])
  async function perform(action: () => Promise<unknown>) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await action()
      if (mounted.current) reload()
    } catch (e) {
      if (mounted.current) setError(failure(e))
    } finally {
      if (mounted.current) setBusy(false)
    }
  }
  async function send(content = input) {
    if (!content.trim() || busy || running) return
    const old = pendingRequest.current
    const request =
      old?.content === content && old.providerPresetId === providerPresetId ? old : { content, id: newOperationId('agent-message'), providerPresetId }
    pendingRequest.current = request
    await perform(async () => {
      await agentApi.message(sessionId, content, request.id, request.providerPresetId)
      if (mounted.current) {
        pendingRequest.current = null
        setInput((current) => (current === content ? '' : current))
        followBottom.current = true
        setMobileView('chat')
      }
    })
  }
  async function prepare(kind: AgentActionKind, targetId: string, title = '') {
    await perform(async () => {
      const result = await agentApi.prepare(sessionId, kind, targetId, title)
      if (mounted.current) setPreview(result.action)
    })
  }
  async function showArtifact(taskId: string) {
    setSelectedTask(taskId)
    setMobileView('outputs')
    if (data?.artifacts.some((a) => a.task.id === taskId)) return
    await perform(async () => {
      const item = await agentApi.artifact(sessionId, taskId)
      if (mounted.current) setOlderArtifact(item)
    })
  }
  async function showAction(actionId: string) {
    const existing = data?.actions.find((item) => item.id === actionId)
    if (existing) {
      setPreview(existing)
      return
    }
    await perform(async () => {
      const result = await agentApi.action(sessionId, actionId)
      if (mounted.current) setPreview(result.action)
    })
  }
  async function loadEarlier() {
    const before = allEvents[0]?.id
    if (!before) return
    await perform(async () => {
      const page = await agentApi.events(sessionId, before)
      if (mounted.current) {
        followBottom.current = false
        for (const e of page.events) observedEvents.current.set(e.id, e)
        setEarlier((old) => [...page.events, ...old])
        setHasEarlier(page.hasEarlier)
      }
    })
  }
  const allEvents = [...earlier, ...(data?.events || [])]
    .filter((e, index, all) => all.findIndex((item) => item.id === e.id) === index)
    .sort((a, b) => a.id - b.id)
  const savedArtifact = selectedTask
    ? data?.artifacts.find((a) => a.task.id === selectedTask) || (olderArtifact?.task.id === selectedTask ? olderArtifact : null)
    : data?.artifacts[0]
  const artifact = savedArtifact ? { ...savedArtifact, task: liveTasks[savedArtifact.task.id] || savedArtifact.task } : null
  const partial = parseAiTextProgress(activeTask?.result)
  const previewVisible = partial && !allEvents.some((event) => event.role === 'assistant' && event.taskId === activeTask?.id && event.metadata.round === partial.round)
  const action = preview ? data?.actions.find((a) => a.id === preview.id) || preview : null
  if (!data)
    return (
      <div className={styles.empty} role="status">
        {loadError || '正在读取创作对话…'}
        {loadError && (
          <Button variant="outline" onClick={reload}>
            重试
          </Button>
        )}
      </div>
    )
  return (
    <>
      <div className={styles.identity}>
        <BookOpen size={16} />
        <span>{data.session.anchorTitle ? `续写起点：${data.session.anchorTitle}` : '新章节创作'}</span>
        <span className={styles.muted}>{data.session.title}</span>
        <AiAgentMemory sessionId={sessionId} disabled={busy || running} pendingCount={data.memories?.filter((memory) => memory.status === 'pending').length || 0} onChanged={reload} />
      </div>
      <AgentSettings
        key={data.session.id}
        session={data.session}
        disabled={busy || running}
        onSave={async (brief, preferences, expectedUpdatedAt) => {
          const result = await agentApi.save(sessionId, brief, preferences, expectedUpdatedAt)
          if (mounted.current) {
            setData((current) => (current ? { ...current, session: result.session } : current))
            onSessionRef.current(result.session)
            reload()
          }
        }}
      />
      <div className={styles.mobileTabs} aria-label="切换工作区">
        <Button variant={mobileView === 'chat' ? 'secondary' : 'ghost'} onClick={() => setMobileView('chat')}>
          对话
        </Button>
        <Button variant={mobileView === 'outputs' ? 'secondary' : 'ghost'} onClick={() => setMobileView('outputs')}>
          产出与采纳
        </Button>
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}{' '}
          <Button size="sm" variant="ghost" onClick={reload}>
            刷新状态
          </Button>
        </p>
      )}
      {loadError && (
        <p className={styles.error} role="alert">
          读取状态失败：{loadError}。当前显示的是上次读取的内容。
          <Button size="sm" variant="ghost" onClick={reload}>
            重新读取
          </Button>
        </p>
      )}
      <div className={styles.workspace} data-mobile-view={mobileView}>
        <section className={styles.chat} aria-label="创作对话">
          <div className={styles.chatBody} data-running={running}>
            <div className={styles.chatHeading}>
              <span className={styles.chatTitle}>
                <MessageSquare size={16} aria-hidden="true" />
                创作助手
              </span>
              <span className={styles.chatState}>{running ? '正在处理你的想法' : '随时接着聊'}</span>
            </div>
            <div
              ref={feed}
              className={styles.feed}
              role="log"
              aria-label="对话记录"
              aria-live="polite"
              aria-relevant="additions"
              onScroll={() => {
                if (feed.current) followBottom.current = feed.current.scrollHeight - feed.current.scrollTop - feed.current.clientHeight < 80
              }}
            >
              {(hasEarlier ?? data.hasEarlier) && (
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => void loadEarlier()}>
                  读取更早的对话
                </Button>
              )}
              {!allEvents.length && (
                <div className={styles.empty}>
                  <h3>这次想一起完成什么？</h3>
                  <p>可以先聊聊想法，再慢慢调整成满意的作品。</p>
                  <div className={styles.suggestions}>
                    {['先了解这本小说，和我讨论下一章的走向', '帮我找出最近草稿中可以加强的冲突', '结合故事氛围，先给我几个封面构思'].map((text) => (
                      <Button key={text} variant="outline" onClick={() => setInput(text)}>
                        {text}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
              {allEvents.map((event) => (
                <article key={event.id} className={event.role === 'activity' ? styles.activity : styles.message} data-role={event.role}>
                  {event.role === 'assistant' && <span className={styles.speaker}>创作助手</span>}
                  <div className={event.metadata.error ? styles.error : event.role === 'assistant' ? styles.markdown : styles.prose}>
                    {event.role === 'assistant' && !event.metadata.error ? (
                      <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents} skipHtml>
                        {event.content}
                      </Markdown>
                    ) : (
                      event.content
                    )}
                  </div>
                  {event.metadata.sources?.length ? <AiAgentSources sources={event.metadata.sources} /> : null}
                  {event.metadata.artifactTaskId && (
                    <Button size="sm" variant="link" disabled={busy} onClick={() => void showArtifact(event.metadata.artifactTaskId!)}>
                      查看进度与产出
                    </Button>
                  )}
                  {event.metadata.actionId && (
                    <Button size="sm" variant="link" disabled={busy} onClick={() => void showAction(event.metadata.actionId!)}>
                      查看操作记录
                    </Button>
                  )}
                </article>
              ))}
              {previewVisible && partial.preview && (
                <article className={styles.message} data-role="assistant" aria-label="助手回复预览">
                  <span className={styles.speaker}>创作助手{running ? ' · 正在回复' : ' · 未完成'}</span>
                  <div className={styles.markdown}><Markdown remarkPlugins={[remarkGfm]} components={markdownComponents} skipHtml>{partial.preview}</Markdown></div>
                </article>
              )}
              {running && (
                <div className={styles.progress} role="status">
                  <span className={styles.dot} aria-hidden="true" />
                  <span className={styles.progressText}>{activeTask?.step || '正在处理…'}</span>
                </div>
              )}
              {activeTask?.status === 'failed' && (
                <p className={styles.error}>本轮未完成：{activeTask.error}。已保留对话和已提交的任务，可以调整要求后继续。</p>
              )}
            </div>
          </div>
          <AiAgentComposer
            value={input}
            onChange={setInput}
            onSend={() => void send()}
            onStop={() => void perform(() => agentApi.stop(sessionId, data.activeTask!.id))}
            busy={busy}
            running={running}
            providerPresetId={providerPresetId}
            onProviderChange={setProviderPresetId}
          />
        </section>
        <aside className={styles.outputs} aria-label="产出与采纳">
          <div className={styles.outputHeader}>
            <h3>产出与采纳</h3>
            <Link to={`/admin/ai?sub=writing&novel=${encodeURIComponent(novelId)}&view=review`}>打开草稿工作区</Link>
          </div>
          {data.actions
            .filter((a) => ['pending', 'executing'].includes(a.status))
            .map((a) => (
              <div className={styles.pending} key={a.id}>
                <div>
                  <strong>{a.title}</strong>
                  <p>{a.preview.description}</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => setPreview(a)}>
                  {a.status === 'executing' ? '查看执行状态' : '查看并确认'}
                </Button>
              </div>
            ))}
          {data.artifacts.length > 0 && (
            <FormField label="本次与之前的产出">
              <SearchSelect
                value={artifact?.task.id || ''}
                options={data.artifacts.map((a, index) => ({
                  value: a.task.id,
                  label: `${data.artifacts.length - index} · ${kindLabel(a.task.kind)}`,
                  sub: taskStatusLabel(a.task.status),
                }))}
                onChange={setSelectedTask}
                searchable
                matchTriggerWidth
              />
            </FormField>
          )}
          {artifact ? (
            <AgentArtifactView
              key={artifact.task.id}
              artifact={artifact}
              busy={busy}
              onStop={() => void perform(() => agentApi.stop(sessionId, artifact.task.id))}
              onPrepare={prepare}
              onDiscuss={() => {
                setInput(`请读取任务 ${artifact.task.id} 的结果，我们继续讨论这一版。`)
                setMobileView('chat')
              }}
            />
          ) : (
            <div className={styles.empty}>
              <ImageIcon size={25} />
              <p>{selectedTask ? (busy ? '正在读取所选产出…' : '未能读取所选产出，请重新选择。') : '草稿、改写对比和封面候选会显示在这里。'}</p>
              <span className={styles.muted}>讨论中的想法会留在会话中，采纳后才影响作品。</span>
            </div>
          )}
          {data.actions.some((a) => !['pending', 'executing'].includes(a.status)) && (
            <MotionDetails className={styles.history}>
              <summary>查看采纳与版本记录</summary>
              {data.actions
                .filter((a) => !['pending', 'executing'].includes(a.status))
                .map((a) => (
                  <div className={styles.historyRow} key={a.id}>
                    <Button size="sm" variant="link" onClick={() => setPreview(a)}>
                      {a.title} · {ACTION_STATUS[a.status]}
                    </Button>
                    {a.status === 'completed' && ['apply_rewrite', 'restore_draft'].includes(a.kind) && (
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void prepare('restore_draft', a.id)}>
                        恢复之前版本
                      </Button>
                    )}
                  </div>
                ))}
            </MotionDetails>
          )}
        </aside>
      </div>
      <Dialog
        open={!!action}
        onOpenChange={(open) => {
          if (!open && !busy) setPreview(null)
        }}
      >
        {action && (
          <ReadingDialog
            title={action.title}
            description={action.preview.description}
            bodyLabel="采纳前预览"
            footer={
              <div className={styles.dialogActions}>
                <span className={styles.muted}>{ACTION_STATUS[action.status]}</span>
                {(action.status === 'pending' || (action.status === 'executing' && action.canResume)) && (
                  <>
                    {action.status === 'pending' && (
                      <Button
                        variant="ghost"
                        disabled={busy}
                        onClick={() =>
                          void perform(async () => {
                            await agentApi.reject(sessionId, action.id)
                            if (mounted.current) setPreview(null)
                          })
                        }
                      >
                        暂不采纳
                      </Button>
                    )}
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void perform(async () => {
                          const result = await agentApi.confirm(sessionId, action.id)
                          if (mounted.current) {
                            setPreview(result.action)
                            setData((current) =>
                              current ? { ...current, actions: current.actions.map((a) => (a.id === result.action.id ? result.action : a)) } : current,
                            )
                          }
                        })
                      }
                    >
                      <Check size={15} />
                      {busy ? '正在处理…' : action.status === 'executing' ? '核对并继续采纳' : '确认采纳'}
                    </Button>
                  </>
                )}
              </div>
            }
          >
            {action.error && (
              <p className={styles.error} role="alert">
                {action.error}
              </p>
            )}
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
            {action.preview.candidateId && action.status === 'pending' && (
              <img
                className={styles.cover}
                src={url(`/ai/agent/sessions/${encodeURIComponent(sessionId)}/covers/${encodeURIComponent(action.preview.candidateId)}`)}
                alt="准备采纳的封面候选"
              />
            )}
            <TextComparison before={action.preview.before} after={action.preview.after} />
          </ReadingDialog>
        )}
      </Dialog>
    </>
  )
}

function TextComparison({ before, after }: { before?: string; after?: string }) {
  return (
    <div className={styles.comparison}>
      {before !== undefined && (
        <section>
          <h4>修改前</h4>
          <div className={styles.prose}>{before}</div>
        </section>
      )}
      {after !== undefined && (
        <section>
          <h4>{before === undefined ? '待发布内容' : '修改后'}</h4>
          <div className={styles.prose}>{after}</div>
        </section>
      )}
    </div>
  )
}

function AgentArtifactView({
  artifact,
  busy,
  onStop,
  onPrepare,
  onDiscuss,
}: {
  artifact: AgentArtifact
  busy: boolean
  onStop: () => void
  onPrepare: (kind: AgentActionKind, targetId: string, title?: string) => Promise<void>
  onDiscuss: () => void
}) {
  const [editedTitle, setChapterTitle] = useState<string | null>(null)
  const chapterTitle = editedTitle ?? artifact.drafts[0]?.title ?? ''
  return (
    <div className={styles.artifact}>
      <div className={styles.taskStatus}>
        <strong>{kindLabel(artifact.task.kind)}</strong>
        <span>{taskStatusLabel(artifact.task.status)}</span>
      </div>
      <p className={styles.muted}>{artifact.task.step}</p>
      {agentTaskRunning(artifact.task) && (
        <div className={styles.taskProgress}>
          <div className={styles.taskProgressTrack}>
            <progress value={artifact.task.current} max={artifact.task.total} aria-label="生成任务进度" />
          </div>
          <Button size="sm" variant="ghost" disabled={busy} onClick={onStop}>
            停止任务
          </Button>
        </div>
      )}
      {artifact.task.status !== 'completed' && <AiStreamPreview progress={parseAiTextProgress(artifact.task.result)} stopped={!agentTaskRunning(artifact.task)} structured={['plot_state', 'relationship_profile', 'cover_prompt'].includes(artifact.task.kind)} />}
      {artifact.task.error && <p className={styles.error}>{artifact.task.error}</p>}
      {artifact.drafts.map((draft) => (
        <section key={draft.id} className={styles.draft}>
          <FormField label="章节标题">
            <Input value={chapterTitle} onChange={(e) => setChapterTitle(e.target.value)} maxLength={200} />
          </FormField>
          <div className={styles.prose} tabIndex={0} role="region" aria-label="章节草稿正文">
            {draft.content}
          </div>
          <div className={styles.artifactActions}>
            <Button variant="outline" size="sm" onClick={onDiscuss}>
              继续讨论这一版
            </Button>
            {draft.status === 'draft' && (
              <Button size="sm" disabled={busy} onClick={() => void onPrepare('publish_draft', draft.id, chapterTitle)}>
                预览发布
              </Button>
            )}
            {draft.status === 'published' && <span className={styles.muted}>已发布</span>}
          </div>
        </section>
      ))}
      {artifact.rewrite && (
        <>
          <TextComparison before={artifact.rewrite.before} after={artifact.rewrite.after} />
          <div className={styles.artifactActions}>
            <Button variant="outline" size="sm" onClick={onDiscuss}>
              继续调整
            </Button>
            <Button size="sm" disabled={busy} onClick={() => void onPrepare('apply_rewrite', artifact.task.id)}>
              预览采纳
            </Button>
          </div>
        </>
      )}
      {artifact.covers.map((cover) => (
        <section key={cover.id}>
          <img className={styles.cover} src={url(cover.imageUrl)} alt="本次生成的封面候选" />
          <MotionDetails className={styles.history}>
            <summary>查看封面描述词</summary>
            <p className={styles.prose}>{cover.prompt}</p>
          </MotionDetails>
          <div className={styles.artifactActions}>
            <Button size="sm" variant="outline" onClick={onDiscuss}>
              继续构思
            </Button>
            <Button size="sm" disabled={busy} onClick={() => void onPrepare('adopt_cover', cover.id)}>
              预览采纳
            </Button>
          </div>
        </section>
      ))}
      {artifact.task.status === 'completed' && !artifact.drafts.length && !artifact.rewrite && !artifact.covers.length && (
        <p className={styles.muted}>任务已完成。封面可能已被采纳，或结果保存在故事档案中。</p>
      )}
    </div>
  )
}

function AgentSettings({
  session,
  disabled,
  onSave,
}: {
  session: AgentSession
  disabled: boolean
  onSave: (brief: string, preferences: AgentContentPreferences, expectedUpdatedAt: number) => Promise<void>
}) {
  const [draft, setDraft] = useState<{ brief: string; preferences: AgentContentPreferences; expectedUpdatedAt: number } | null>(null)
  const brief = draft?.brief ?? session.brief
  const preferences = draft?.preferences ?? session.contentPreferences
  const dirty = draft !== null
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  function change(next: AgentContentPreferences) {
    setDraft({ brief, preferences: next, expectedUpdatedAt: draft?.expectedUpdatedAt ?? session.updatedAt })
  }
  async function save() {
    if (!draft || saving) return
    setSaving(true)
    setError('')
    try {
      await onSave(brief, preferences, draft.expectedUpdatedAt)
      setDraft(null)
    } catch (e) {
      setError(failure(e))
    } finally {
      setSaving(false)
    }
  }
  return (
    <MotionDetails className={styles.settings}>
      <summary>
        创作约定与偏好 · {session.contentPreferences.adultContentMode === 'explicit' ? 'R18 已开启' : '成人内容关闭'}
        {dirty ? ' · 有未保存调整' : ''}
      </summary>
      <div className={styles.settingsBody}>
        <FormField label="这段对话始终遵循的创作约定" hint="例如人物性格、叙事视角和希望保留的情节。这里只影响本次对话，不改写正式档案。">
          <Textarea
            value={brief}
            onChange={(e) => {
              setDraft({ brief: e.target.value, preferences, expectedUpdatedAt: draft?.expectedUpdatedAt ?? session.updatedAt })
            }}
            maxLength={4000}
            disabled={disabled || saving}
          />
        </FormField>
        <FormField label="成人内容偏好">
          <SearchSelect
            value={preferences.adultContentMode}
            options={[
              { value: 'off', label: '关闭' },
              { value: 'explicit', label: 'R18 创作' },
            ]}
            onChange={(value) =>
              change({
                ...preferences,
                adultContentMode: value as 'off' | 'explicit',
                intimacyWeight: value === 'off' ? 'none' : 'high',
                adultCharactersConfirmed: false,
              })
            }
            disabled={disabled || saving}
          />
        </FormField>
        {preferences.adultContentMode === 'explicit' && (
          <>
            <FormField label="亲密内容权重">
              <SearchSelect
                value={preferences.intimacyWeight}
                options={[
                  { value: 'low', label: '低' },
                  { value: 'medium', label: '中' },
                  { value: 'high', label: '高' },
                ]}
                onChange={(value) => change({ ...preferences, intimacyWeight: value as AgentContentPreferences['intimacyWeight'] })}
                disabled={disabled || saving}
              />
            </FormField>
            <label className={styles.confirmAdults}>
              <Checkbox
                checked={preferences.adultCharactersConfirmed}
                disabled={disabled || saving}
                onCheckedChange={(checked) => change({ ...preferences, adultCharactersConfirmed: checked === true })}
              />
              我确认相关角色均为成年人
            </label>
          </>
        )}
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        <div>
          <Button
            variant="outline"
            size="sm"
            disabled={!dirty || disabled || saving || (preferences.adultContentMode === 'explicit' && !preferences.adultCharactersConfirmed)}
            onClick={() => void save()}
          >
            {saving ? '正在保存…' : '保存创作约定'}
          </Button>
          {dirty && <span className={styles.muted}> 保存后供下一条消息使用</span>}
          {dirty && (
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled || saving}
              onClick={() => {
                setDraft(null)
                setError('')
              }}
            >
              取消调整
            </Button>
          )}
        </div>
      </div>
    </MotionDetails>
  )
}
