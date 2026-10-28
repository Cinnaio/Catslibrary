import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { aiApi, chaptersApi, type AiEffectiveProfile } from '@/lib/api'
import { Button } from '@/components/ui/button'

type Kind = 'plot' | 'relationship'
const kinds: Kind[] = ['plot', 'relationship']
const labels = { plot: '情节状态', relationship: '关系画像' }
type Entry = { profile?: AiEffectiveProfile; error?: string; submitting?: boolean }
const active = (profile?: AiEffectiveProfile) => profile?.memoryTask?.status === 'queued' || profile?.memoryTask?.status === 'running'
const complete = (profile?: AiEffectiveProfile) => !profile?.memoryNeedsInitialization && profile?.eligibility === 'usable' && !profile.isOlderThanAnchor && Boolean(profile.effectiveContent)

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
  const [loading, setLoading] = useState(true)
  const [reload, setReload] = useState(0)
  const pending = useRef(new Set<Kind>())
  const version = useRef(0)
  const started = useRef(false)
  const fixedTarget = useRef<typeof target>(undefined)

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

  useEffect(() => {
    if (!target || loading || !kinds.some((kind) => active(entries[kind].profile))) return
    let cancelled = false
    const timer = setTimeout(async () => {
      const results = await Promise.allSettled([aiApi.writing.getPlotState(novelId, target.id), aiApi.writing.getRelationshipProfile(novelId, target.id)])
      if (cancelled) return
      setEntries(
        (previous) =>
          Object.fromEntries(
            kinds.map((kind, index) => {
              const result = results[index]!
              return [
                kind,
                result.status === 'fulfilled'
                  ? { ...previous[kind], profile: result.value, error: undefined }
                  : { ...previous[kind], error: (result.reason as Error).message || '进度读取失败，请刷新重试' },
              ]
            }),
          ) as Record<Kind, Entry>,
      )
    }, 4000)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [novelId, target, entries, loading])

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
    <section className="rounded-xl border border-border bg-card p-4 text-sm" aria-label="发布后更新故事档案">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h3 className="font-medium break-words">《{novelTitle || '当前小说'}》 · 更新情节与关系</h3>
          <p className="text-muted-foreground">{loading ? '正在读取正式章节与档案进度…' : target ? `更新至第 ${target.count} 章「${target.title}」` : error}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          收起
        </Button>
      </div>
      {!loading && target && (
        <>
          <p className="mt-3 text-muted-foreground">
            仅分析已发布正文，优先复用有效档案；正文变更可能需要重新分析。离开页面后任务继续，阶段内容完整覆盖目标后才用于续写。
          </p>
          <div className="mt-3 divide-y divide-border" aria-live="polite">
            {kinds.map((kind) => {
              const { profile, error: readError, submitting } = entries[kind]
              const task = profile?.memoryTask
              const progress = profile?.progress
              const running = active(profile)
              const ready = complete(profile)
              const count = progress?.processedChapters ?? task?.current ?? profile?.source?.chapterOrdinal ?? 0
              const total = progress?.totalChapters ?? task?.total ?? target.count
              const taskError = !ready && task?.status === 'failed' ? task.error : ''
              return (
                <div key={kind} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0 space-y-1">
                    <p className="font-medium">
                      {labels[kind]}：
                      {readError
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
                                  : '待更新'}
                    </p>
                    {(readError || taskError) && (
                      <p role="alert" className="text-destructive break-words">
                        {readError || taskError}
                      </p>
                    )}
                    {running && task?.step && <p className="text-muted-foreground break-words">{task.step}</p>}
                    {running && progress?.targetChapterId && progress.targetChapterId !== target.id && (
                      <p className="text-muted-foreground">已有任务正在处理较早章节，完成后请继续更新至本次目标。</p>
                    )}
                    {!running && !ready && !readError && (
                      <p className="text-muted-foreground">
                        当前有效档案覆盖 {profile?.eligibility === 'usable' ? profile.source?.chapterOrdinal || 0 : 0} 章，目标共 {target.count}{' '}
                        章；继续时会校验正文和检查点。
                      </p>
                    )}
                    {profile?.manualOverride && <p className="text-muted-foreground">人工校正会保留，自动档案更新后可能需要重新确认。</p>}
                    {progress?.previewContent && !ready && (
                      <details>
                        <summary className="cursor-pointer text-muted-foreground">查看已保存的阶段内容</summary>
                        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words font-sans">{progress.previewContent}</pre>
                      </details>
                    )}
                  </div>
                  {!ready && !running && (
                    <Button variant="secondary" size="sm" disabled={submitting || Boolean(readError)} onClick={() => void start([kind])}>
                      {task?.status === 'failed' ? `重试${labels[kind]}` : `更新${labels[kind]}`}
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button size="sm" disabled={!canStart || loading} onClick={() => void start(kinds)}>
              {done ? '两项档案均已更新' : '一键更新情节与关系'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={loading || kinds.some((kind) => entries[kind].submitting)}
              onClick={() => setReload((value) => value + 1)}
            >
              刷新状态
            </Button>
            <Link className="text-accent underline underline-offset-4" to={`/admin/ai?sub=writing&novel=${encodeURIComponent(novelId)}`}>
              前往创作工作台
            </Link>
          </div>
        </>
      )}
      {!loading && !target && (
        <Button variant="secondary" size="sm" className="mt-3" onClick={() => setReload((value) => value + 1)}>
          重新读取
        </Button>
      )}
    </section>
  )
}
