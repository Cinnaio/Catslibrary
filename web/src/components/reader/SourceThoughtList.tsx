import { useEffect, useRef, useState } from 'react'
import type { SourceThought, SourceThoughtPage } from '@shared/source-thoughts'
import { Button } from '@/components/ui/button'
import { sourceThoughtPage, type SourceThoughtAnchor } from '@/hooks/useSourceThoughts'
import { timeText } from '@/lib/format'

function SourceEntry({ item, anchor, label, reply = false }: { item: SourceThought; anchor: SourceThoughtAnchor; label: string; reply?: boolean }) {
  const [replies, setReplies] = useState<SourceThoughtPage>()
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const live = useRef(true)
  useEffect(() => { live.current = true; return () => { live.current = false } }, [])
  async function load() {
    if (busy) return
    setBusy(true); setError(''); setExpanded(true)
    try {
      const next = await sourceThoughtPage(anchor, replies?.cursor, item.id)
      if (live.current) setReplies(previous => ({ ...next, items: [...(previous?.items || []), ...next.items.filter(row => !previous?.items.some(old => old.id === row.id))] }))
    } catch { if (live.current) setError('回复加载失败，请重试') }
    finally { if (live.current) setBusy(false) }
  }
  return <article className={`thought-item source-thought-item${reply ? ' source-thought-reply' : ''}`}>
    <div className="thought-item__meta"><span className="thought-author">
      {item.avatarUrl && <img className="source-thought-avatar" src={item.avatarUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />}
      <span>{item.displayName}</span><span className="source-thought-label">{label}</span>
    </span><time className="thought-item__time">{timeText(item.createdAt)}</time></div>
    {item.replyToName && <p className="source-thought-muted">回复 {item.replyToName}</p>}
    <p className="thought-item__text">{item.text}</p>
    {item.images.length > 0 && <div className="source-thought-images">{item.images.map(url => <a key={url} href={url} target="_blank" rel="noreferrer"><img src={url} alt="评论配图，打开查看原图" loading="lazy" referrerPolicy="no-referrer" /></a>)}</div>}
    <div className="source-thought-actions"><span>{item.likeCount} 人赞过</span>
      {!reply && item.replyCount > 0 && <Button variant="ghost" size="sm" disabled={busy} aria-expanded={expanded} onClick={() => {
        if (expanded) setExpanded(false)
        else if (replies) setExpanded(true)
        else void load()
      }}>{busy ? '正在加载回复…' : expanded ? '收起回复' : `查看回复（${item.replyCount}）`}</Button>}
    </div>
    {expanded && <div className="source-thought-replies" aria-busy={busy}>
      {replies?.items.map(row => <SourceEntry key={row.id} item={row} anchor={anchor} label={label} reply />)}
      {error && <p role="status">{error} <Button size="sm" variant="ghost" disabled={busy} onClick={() => void load()}>重试回复</Button></p>}
      {replies?.hasMore && !error && <Button variant="ghost" size="sm" disabled={busy} onClick={() => void load()}>{busy ? '正在加载…' : '更多回复'}</Button>}
    </div>}
  </article>
}
export default function SourceThoughtList({ anchor, label }: { anchor: SourceThoughtAnchor; label: string }) {
  const { chapterId, paragraphIndex, paragraphHash } = anchor
  const owner = `${chapterId}:${paragraphIndex}:${paragraphHash}`
  const [state, setState] = useState<{ owner: string; page: SourceThoughtPage }>()
  const [failure, setFailure] = useState<{ key: string; message: string }>()
  const [attempt, setAttempt] = useState(0)
  const [cursor, setCursor] = useState('')
  const [settled, setSettled] = useState('')
  const key = `${owner}:${cursor}:${attempt}`
  const busy = settled !== key
  const page = state?.owner === owner ? state.page : undefined
  const error = failure?.key === key ? failure.message : ''
  useEffect(() => {
    let current = true
    void sourceThoughtPage({ chapterId, paragraphIndex, paragraphHash }, cursor).then(next => {
      if (current) setState(previous => {
        const old = previous?.owner === owner ? previous.page.items : []
        return { owner, page: { ...next, items: [...old, ...next.items.filter(row => !old.some(item => item.id === row.id))] } }
      })
    }).catch(() => { if (current) setFailure({ key, message: '来源想法暂时无法加载，本站想法仍可使用' }) })
      .finally(() => { if (current) setSettled(key) })
    return () => { current = false }
  }, [chapterId, paragraphIndex, paragraphHash, cursor, owner, key])
  return <section className="source-thought-list" aria-label={`${label}想法`} aria-busy={busy}>
    {page?.items.map(item => <SourceEntry key={item.id} item={item} anchor={anchor} label={label} />)}
    {busy && <p role="status" className="source-thought-muted">正在加载{label}想法…</p>}
    {error && <p role="status">{error} <Button variant="ghost" size="sm" onClick={() => setAttempt(n => n + 1)}>重试来源想法</Button></p>}
    {!busy && !error && page?.items.length === 0 && <p className="thought-empty">这一段暂时没有{label}想法。</p>}
    {!busy && !error && page?.hasMore && <Button variant="ghost" onClick={() => setCursor(page.cursor)}>更多{label}想法</Button>}
  </section>
}
