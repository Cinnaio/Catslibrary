import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import { BOOK_SEARCH_MAX_QUERY, findBookMatches, type BookSearchHit } from '@shared/book-search'
import { chaptersApi, getToken, type ApiError } from '@/lib/api'
import { getStorageScope } from '@/lib/storage'
import { useSession } from '@/context/SessionContext'
import { useContentPolicy } from '@/context/ContentPolicyContext'
import { Button } from '@/components/ui/button'
import { Dialog, DialogTrigger } from '@/components/ui/dialog'
import { SearchField } from '@/components/shared/SearchField'
import { ReadingDialog } from '@/components/shared/ReadingDialog'
import { InlineError } from '@/components/shared/AsyncStates'
import EmptyState from '@/components/shared/EmptyState'
import { Spinner } from '@/components/ui/spinner'
import styles from './BookSearch.module.css'

export function SearchExcerpt({ text, query }: { text: string; query: string }) {
  const matches = findBookMatches(text, query)
  return <>{matches.map(({ start, end }, index) => {
    const prefix = text.slice(index ? matches[index - 1]!.end : 0, start)
    return <span key={start}>{prefix}<mark>{text.slice(start, end)}</mark></span>
  })}{text.slice(matches.at(-1)?.end || 0)}</>
}

interface BookSearchProps {
  novelId: string; title: string; className?: string; iconOnly?: boolean
  onSelect?: (hit: BookSearchHit, query: string) => void
  onOpenChange?: (open: boolean) => void
}

/** A new identity creates a fresh dialog; old account results never render in the new scope. */
export default function BookSearch(props: BookSearchProps) {
  const { user } = useSession()
  const { mode, adultContentEnabled } = useContentPolicy()
  const identity = JSON.stringify([props.novelId, user?.id, mode, adultContentEnabled])
  return <BookSearchControls key={identity} {...props} mode={mode} />
}

function BookSearchControls({ novelId, title, className, iconOnly = false, onSelect, onOpenChange, mode }: BookSearchProps & { mode: string }) {
  const [open, setOpen] = useState(false)
  useEffect(() => () => { onOpenChange?.(false) }, [onOpenChange])
  return <Dialog open={open} onOpenChange={value => { setOpen(value); onOpenChange?.(value) }}>
    <DialogTrigger asChild><Button variant="secondary" className={className} aria-label="书内正文搜索" title="书内正文搜索" onClick={event => event.stopPropagation()}>
      <Search size={16} aria-hidden="true" />{!iconOnly && '正文搜索'}
    </Button></DialogTrigger>
    {open && <SearchContents novelId={novelId} title={title} mode={mode} onSelect={(hit, query) => {
      setOpen(false); onOpenChange?.(false); onSelect?.(hit, query)
    }} navigateOnSelect={!onSelect} />}
  </Dialog>
}

function SearchContents({ novelId, title, mode, onSelect, navigateOnSelect }: {
  novelId: string; title: string; mode: string; navigateOnSelect: boolean
  onSelect: (hit: BookSearchHit, query: string) => void
}) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [searched, setSearched] = useState('')
  const [items, setItems] = useState<BookSearchHit[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [scanned, setScanned] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const revision = useRef(0)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => () => { revision.current++ }, [])

  async function search(more = false) {
    const q = query.trim()
    if (!q || q.length > BOOK_SEARCH_MAX_QUERY || busy) return
    const seq = ++revision.current, token = getToken(), scope = getStorageScope()
    const current = () => seq === revision.current && token === getToken() && scope === getStorageScope()
    setBusy(true); setError('')
    if (!more) { setItems([]); setScanned(0); setCursor(null); setSearched(q) }
    try {
      const result = await chaptersApi.search(novelId, q, mode, more ? cursor || '' : '')
      if (!current()) return
      setItems(previous => more ? [...previous, ...result.items.filter(hit => !previous.some(p => p.chapterId === hit.chapterId))] : result.items)
      setScanned(previous => (more ? previous : 0) + result.scanned)
      setCursor(result.nextCursor)
    } catch (err) {
      if (current()) {
        if ([403, 404].includes((err as ApiError).status || 0)) { setItems([]); setCursor(null); setScanned(0) }
        setError((err as Error).message || '正文搜索失败，请重试')
      }
    } finally { if (current()) setBusy(false) }
  }
  const edited = searched !== query.trim()
  return <ReadingDialog title="书内正文搜索" description={`《${title}》 · 搜索已入库正文，关键词按字面匹配。`} bodyLabel="正文搜索结果"
    className={styles.dialog} onOpenAutoFocus={event => { event.preventDefault(); input.current?.focus() }}>
    <form className={styles.form} role="search" onSubmit={event => { event.preventDefault(); void search() }}>
      <SearchField ref={input} label="正文关键词" placeholder="输入人物、句子或关键词" maxLength={BOOK_SEARCH_MAX_QUERY} value={query}
        onChange={event => { revision.current++; setBusy(false); setQuery(event.target.value); setError('') }} />
      <Button type="submit" disabled={busy || !query.trim()}>{busy ? <Spinner size="sm" aria-hidden="true" /> : '搜索'}</Button>
    </form>
    {error && <InlineError message={error} onRetry={() => void search(!edited && !!cursor)} />}
    <div aria-busy={busy} className={styles.results} data-transitioning={busy || undefined}>
      {!searched || edited ? <EmptyState icon={<Search />} message="在这本书中查找正文" hint="输入关键词并搜索，可从结果直接定位到章节中的命中位置。" /> : <>
        <p className={styles.summary} role="status">{busy ? '正在检索正文…' : error ? `检索未完成 · 已找到 ${items.length} 个匹配章节` : `已找到 ${items.length} 个匹配章节 · 已检索 ${scanned} 章${cursor ? '，后续章节尚待检索' : '，已检索完毕'}`}</p>
        {!busy && !error && !items.length && <EmptyState icon={<Search />} message={cursor ? '已检索的章节中没有匹配' : '没有找到匹配正文'} hint={cursor ? '可继续检索后续章节。' : '可以缩短关键词或换一种写法。'} />}
        <ol className={styles.list}>{items.map((hit, index) => <li key={`${searched}:${hit.chapterId}`} style={{ animationDelay: `${Math.min(index * 20, 240)}ms` }}>
          <button type="button" onClick={() => {
            onSelect(hit, searched)
            if (navigateOnSelect) navigate(`/read/${encodeURIComponent(novelId)}/${encodeURIComponent(hit.chapterId)}?find=${encodeURIComponent(searched)}`)
          }}><strong>{hit.chapterTitle || `第 ${hit.chapterOrder} 章`}</strong><span className={styles.count}>本章 {hit.matchCount} 处</span>
            <p><SearchExcerpt text={hit.snippet} query={searched} /></p>
          </button>
        </li>)}</ol>
        {cursor && <Button variant="secondary" disabled={busy} onClick={() => void search(true)}>继续检索后续章节</Button>}
      </>}
    </div>
  </ReadingDialog>
}
