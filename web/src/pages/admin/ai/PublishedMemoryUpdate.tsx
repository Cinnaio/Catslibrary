import { watchAiTask } from '@/lib/ai-task-stream'
import AiStreamPreview from '@/components/shared/AiStreamPreview'
import { parseAiTextProgress, type AiTextProgress } from '@shared/ai-text-progress'
import { MotionDetails } from '@/components/ui/motion'
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { Link } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'
import { aiApi, chaptersApi, type AiEffectiveProfile } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type Kind = 'plot' | 'relationship'
const kinds: Kind[] = ['plot', 'relationship']
const labels = { plot: '情节状态', relationship: '关系画像' }
type Entry = { profile?: AiEffectiveProfile; error?: string; submitting?: boolean }
const active = (profile?: AiEffectiveProfile) => profile?.memoryTask?.status === 'queued' || profile?.memoryTask?.status === 'running'
const complete = (profile?: AiEffectiveProfile) => !profile?.memoryNeedsInitialization && profile?.eligibility === 'usable' && !profile.isOlderThanAnchor && Boolean(profile.effectiveContent)

function useMemoryTaskProgress(
  kind: Kind,
  novelId: string,
  targetId: string | undefined,
  taskId: string | undefined,
  setEntries: Dispatch<SetStateAction<Record<Kind, Entry>>>,
  setLive: Dispatch<SetStateAction<Record<string, AiTextProgress | null>>>,
) {
  useEffect(() => {
    if (!targetId || !taskId) return
    let stopped = false
    let checkpoint = -1
    let request = 0
    const stop = watchAiTask(taskId, (task) => {
      if (stopped) return
      const terminal = !['queued', 'running'].includes(task.status)
      setLive((previous) => ({ ...previous, [kind]: parseAiTextProgress(task.result) }))
      // Keep the subscription until the final validated profile has been read.
      if (!terminal) setEntries((previous) => {
        const entry = previous[kind]
        return { ...previous, [kind]: { ...entry, profile: entry.profile ? { ...entry.profile, memoryTask: { ...entry.profile.memoryTask, ...task } } : entry.profile } }
      })
      if (task.current === checkpoint && !terminal) return
      checkpoint = task.current
      const current = ++request
      void (kind === 'plot' ? aiApi.writing.getPlotState(novelId, targetId) : aiApi.writing.getRelationshipProfile(novelId, targetId)).then((profile) => {
        if (!stopped && current === request) setEntries((previous) => ({ ...previous, [kind]: { ...previous[kind], profile, error: undefined } }))
      }).catch((error: unknown) => {
        if (!stopped && current === request) setEntries((previous) => {
          const entry = previous[kind]
          return { ...previous, [kind]: {
            ...entry,
            error: error instanceof Error ? error.message : '进度读取失败，请刷新重试',
            profile: terminal && entry.profile ? { ...entry.profile, memoryTask: { ...entry.profile.memoryTask, ...task } } : entry.profile,
          } }
        })
      })
    })
    return () => { stopped = true; stop() }
  }, [kind, novelId, targetId, taskId, setEntries, setLive])
}

/** Published prose only. The two jobs share a fixed anchor but retain independent recovery. */
export default function PublishedMemoryUpdate({
  novelId,
  novelTitle,
  autoStart = false,
  onClose,
}: {
  novelId: string
  novelTitle: string
  autoStart?: boolean
  onClose: () => void
}) {
  const [target, setTarget] = useState<{ id: string; title: string; count: number }>()
  const [entries, setEntries] = useState<Record<Kind, Entry>>({ plot: {}, relationship: {} })
  const [error, setError] = useState('')
  const [live, setLive] = useState<Record<string, AiTextProgress | null>>({})
  const [loading, setLoading] = useState(true)
  const [reload, setReload] = useState(0)
  const pending = useRef(new Set<Kind>())
  const version = useRef(0)
  const started = useRef(false)
  const fixedTarget = useRef<typeof target>(undefined)

  useEffect(() => {
    fixedTarget.current = undefined
    started.current = false
    pending.current.clear()
    setTarget(undefined)
    setEntries({ plot: {}, relationship: {} })
    setLive({})
  }, [novelId])

  useEffect(() => {
    const current = ++version.current
    const valid = () => current === version.current
    function patch(kind: Kind, entry: Partial<Entry>) {
      if (valid()) setEntries((previous) => ({ ...previous, [kind]: { ...previous[kind], ...entry } }))
    }
    async function read(kind: Kind, anchor: string) {
      try {
        const profile = await (kind === 'plot' ? aiApi.writing.getPlotState(novelId, anchor) : aiApi.writing.getRelationshipProfile(novelId, anchor))
        patch(kind, { profile, error: undefined })
        return profile
      } catch (err) {
        patch(kind, { error: (err as Error).message || '进度读取失败，请刷新重试' })
        return undefined
      }
    }
    async function initialize() {
      setLoading(true)
      setError('')
      try {
        if (!fixedTarget.current) {
          const { chapters } = await chaptersApi.list(novelId)
          const last = chapters.at(-1)
          if (!last) throw new Error('暂无已发布章节，发布后可更新档案。')
          if (!valid()) return
          fixedTarget.current = { id: last.id, title: last.title, count: chapters.length }
        }
        const anchor = fixedTarget.current
        if (!valid()) return
        setTarget(anchor)
        const profiles = await Promise.all(kinds.map((kind) => read(kind, anchor.id)))
        if (!valid()) return
        setLoading(false)
        // A failed initial read must never silently submit paid work.
        if (autoStart && !started.current && profiles.every(Boolean)) {
          started.current = true
          await Promise.all(
            kinds.map(async (kind, index) => {
              if (complete(profiles[index]) || active(profiles[index])) return
              pending.current.add(kind)
              patch(kind, { submitting: true })
              try {
                await aiApi.writing.startMemoryTask(novelId, kind, 3, anchor.id)
                await read(kind, anchor.id)
              } catch (err) {
                patch(kind, { error: (err as Error).message || '提交失败，请重试' })
              } finally {
                pending.current.delete(kind)
                patch(kind, { submitting: false })
              }
            }),
          )
        }
      } catch (err) {
        if (valid()) {
          setError((err as Error).message)
          setLoading(false)
        }
      }
    }
    void initialize()
    return () => {
      version.current = current + 1
    }
  }, [novelId, autoStart, reload])

  useMemoryTaskProgress('plot', novelId, target?.id, !loading && active(entries.plot.profile) ? entries.plot.profile?.memoryTask?.id : undefined, setEntries, setLive)
  useMemoryTaskProgress('relationship', novelId, target?.id, !loading && active(entries.relationship.profile) ? entries.relationship.profile?.memoryTask?.id : undefined, setEntries, setLive)

  async function start(selected: Kind[]) {
    if (!target || loading) return
    const current = version.current
    await Promise.all(
      selected.map(async (kind) => {
        const entry = entries[kind]
        if (pending.current.has(kind) || active(entry.profile) || complete(entry.profile) || entry.error) return
        pending.current.add(kind)
        setEntries((previous) => ({ ...previous, [kind]: { ...previous[kind], submitting: true } }))
        try {
          await aiApi.writing.startMemoryTask(novelId, kind, 3, target.id)
          const profile = await (kind === 'plot' ? aiApi.writing.getPlotState(novelId, target.id) : aiApi.writing.getRelationshipProfile(novelId, target.id))
          if (current === version.current) setEntries((previous) => ({ ...previous, [kind]: { profile } }))
        } catch (err) {
          if (current === version.current)
            setEntries((previous) => ({ ...previous, [kind]: { ...previous[kind], error: (err as Error).message || '提交失败，请刷新后重试' } }))
        } finally {
          pending.current.delete(kind)
          if (current === version.current) setEntries((previous) => ({ ...previous, [kind]: { ...previous[kind], submitting: false } }))
        }
      }),
    )
  }

  const done = kinds.every((kind) => complete(entries[kind].profile))
  const canStart = kinds.some((kind) => !entries[kind].error && !entries[kind].submitting && !active(entries[kind].profile) && !complete(entries[kind].profile))
  return (
    <section className="rounded-xl border border-border/80 bg-card p-4 sm:p-5 text-sm shadow-xs transition-all" aria-label="发布后更新故事档案">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 pb-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-foreground tracking-tight break-words">
              《{novelTitle || '当前小说'}》 · 更新情节与关系
            </h3>
            {target && (
              <span className="inline-flex items-center rounded-md bg-secondary/80 px-2 py-0.5 text-xs font-normal text-secondary-foreground border border-border/50">
                最新目标: 第 {target.count} 章
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{loading ? '正在读取正式章节与档案进度…' : target ? `更新至第 ${target.count} 章「${target.title}」` : error}</p>
        </div>
        <Button variant="ghost" size="sm" className="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground" onClick={onClose}>
          收起
        </Button>
      </div>
      {!loading && target && (
        <>
          <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground/90">
            仅分析已发布正文，优先复用有效档案；正文变更可能需要重新分析。离开页面后任务继续，阶段内容完整覆盖目标后才用于续写。
          </p>
          <div className="mt-3.5 grid grid-cols-1 md:grid-cols-2 gap-3.5" aria-live="polite">
            {kinds.map((kind) => {
              const { profile, error: readError, submitting } = entries[kind]
              const task = profile?.memoryTask
              const progress = profile?.progress
              const running = active(profile)
              const ready = complete(profile)
              const count = progress?.processedChapters ?? task?.current ?? profile?.source?.chapterOrdinal ?? 0
              const total = progress?.totalChapters ?? task?.total ?? target.count
              const taskError = !ready && task?.status === 'failed' ? task.error : ''
              const percent = Math.min(100, Math.max(0, total > 0 ? Math.round((count / total) * 100) : 0))

              const statusText = readError
                ? '读取或提交失败'
                : submitting
                  ? '正在提交…'
                  : ready
                    ? `已更新至第 ${target.count} 章，可用于续写`
                    : running
                      ? `更新中 · 已保存 ${count} / ${total} 章`
                      : task?.status === 'failed'
                        ? `更新失败 · 已保存 ${count} / ${total} 章`
                        : task?.status === 'cancelled'
                          ? `已暂停 · 已保存 ${count} / ${total} 章`
                          : '待更新'

              return (
                <div key={kind} className="rounded-lg border border-border/70 bg-background/50 p-3.5 flex flex-col justify-between gap-3 shadow-2xs">
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium text-foreground text-sm">
                        {labels[kind]}：{statusText}
                      </p>
                      <span
                        className={cn(
                          'inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium shrink-0',
                          ready
                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                            : running
                              ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 animate-pulse'
                              : task?.status === 'failed' || readError
                                ? 'bg-destructive/10 text-destructive border border-destructive/20'
                                : 'bg-muted text-muted-foreground border border-border/50',
                        )}
                      >
                        {ready ? '已就绪' : running ? '更新中' : task?.status === 'failed' ? '失败' : '待更新'}
                      </span>
                    </div>

                    {/* 可视化极细进度条 */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>章节覆盖进度</span>
                        <span className="font-medium tabular-nums">{count} / {total} 章 ({percent}%)</span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/60">
                        <div
                          className={cn(
                            'h-full rounded-full transition-all duration-500',
                            ready ? 'bg-emerald-500' : running ? 'bg-primary' : 'bg-muted-foreground/30',
                          )}
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                    </div>

                    {running && <AiStreamPreview progress={live[kind]} structured />}
                    {(readError || taskError) && (
                      <p role="alert" className="text-xs text-destructive break-words">
                        {readError || taskError}
                      </p>
                    )}
                    {running && task?.step && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1.5 break-words">
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse shrink-0" />
                        <span>{task.step}</span>
                      </p>
                    )}
                    {running && progress?.targetChapterId && progress.targetChapterId !== target.id && (
                      <p className="text-xs text-muted-foreground">已有任务正在处理较早章节，完成后请继续更新至本次目标。</p>
                    )}
                    {!running && !ready && !readError && (
                      <p className="text-xs text-muted-foreground">
                        当前有效档案覆盖 {profile?.eligibility === 'usable' ? profile.source?.chapterOrdinal || 0 : 0} 章，目标共 {target.count}{' '}
                        章；继续时会校验正文和检查点。
                      </p>
                    )}
                    {profile?.manualOverride && <p className="text-xs text-muted-foreground">人工校正会保留，自动档案更新后可能需要重新确认。</p>}
                    {progress?.previewContent && !ready && (
                      <MotionDetails className="text-xs group mt-1">
                        <summary className="cursor-pointer text-muted-foreground hover:text-foreground font-medium transition-colors select-none">
                          查看已保存的阶段内容
                        </summary>
                        <pre className="mt-1.5 max-h-36 overflow-auto rounded-md border border-border/60 bg-muted/30 p-2.5 whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-muted-foreground">
                          {progress.previewContent}
                        </pre>
                      </MotionDetails>
                    )}
                  </div>
                  {!ready && !running && (
                    <div className="pt-2 border-t border-border/40 flex justify-end">
                      <Button variant="outline" size="sm" className="h-7 text-xs" disabled={submitting || Boolean(readError)} onClick={() => void start([kind])}>
                        {task?.status === 'failed' ? `重试${labels[kind]}` : `更新${labels[kind]}`}
                      </Button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <div className="mt-4 pt-3 border-t border-border/60 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <Button size="sm" disabled={!canStart || loading} onClick={() => void start(kinds)} aria-label={done ? '两项档案均已更新' : '一键更新情节与关系'} className="h-8 px-3.5 text-xs font-medium">
                {done ? '两项档案均已更新' : '一键更新情节与关系'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-3 text-xs"
                disabled={loading || kinds.some((kind) => entries[kind].submitting)}
                onClick={() => setReload((value) => value + 1)}
              >
                <RefreshCw className={cn('w-3.5 h-3.5 mr-1.5', loading && 'animate-spin')} />
                刷新状态
              </Button>
            </div>
            <Link className="inline-flex items-center text-xs font-medium text-accent hover:underline underline-offset-4" to={`/admin/ai?sub=writing&novel=${encodeURIComponent(novelId)}`}>
              前往创作工作台 →
            </Link>
          </div>
        </>
      )}
      {!loading && !target && (
        <Button variant="secondary" size="sm" className="mt-3 h-8 text-xs" onClick={() => setReload((value) => value + 1)}>
          重新读取
        </Button>
      )}
    </section>
  )
}
