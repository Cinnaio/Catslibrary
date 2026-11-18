import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { ArrowLeft, BookOpen, Search } from 'lucide-react'
import BookImportDialog from '@/components/admin/BookImportDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import FormField from '@/components/shared/FormField'
import { bookImportApi, type BookDiscoveryResponse, type TitleSource } from '@/lib/api'
import type { BookImportPreview } from '@shared/types'
import styles from './agent-book-discovery.module.css'

function bookTitle(input: string) {
  const quoted = input.match(/《([^》]+)》|「([^」]+)」|『([^』]+)』/u)
  return (quoted?.[1] || quoted?.[2] || quoted?.[3] || input).trim()
}

function hasAuthor(author: string) {
  return !!author.trim() && author.trim() !== '未知作者'
}

export default function AgentBookDiscovery({ onClose, onOpen, onStart }: {
  onClose: () => void
  onOpen: (novelId: string) => void
  onStart: (novelId: string) => Promise<void>
}) {
  const [query, setQuery] = useState('')
  const [author, setAuthor] = useState('')
  const [result, setResult] = useState<BookDiscoveryResponse | null>(null)
  const [preview, setPreview] = useState<BookImportPreview | null>(null)
  const [existing, setExisting] = useState<BookImportPreview['candidates']>([])
  const [searching, setSearching] = useState(false)
  const [reading, setReading] = useState('')
  const [visible, setVisible] = useState(12)
  const [error, setError] = useState('')
  const generation = useRef(0)
  const inFlight = useRef(false)
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    heading.current?.focus()
    return () => { generation.current++ }
  }, [])

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const title = bookTitle(query)
    if (!title || inFlight.current) return
    const request = ++generation.current
    inFlight.current = true
    setSearching(true)
    setError('')
    setExisting([])
    setResult(null)
    setVisible(12)
    try {
      const next = await bookImportApi.discover(title, author.trim())
      if (request === generation.current) setResult(next)
    } catch (error) {
      if (request === generation.current) setError(error instanceof Error ? error.message : '找书失败，请重试。')
    } finally {
      if (request === generation.current) {
        setSearching(false)
        inFlight.current = false
      }
    }
  }

  async function readPreview(source: TitleSource) {
    if (inFlight.current) return
    const request = ++generation.current
    inFlight.current = true
    setReading(source.url)
    setError('')
    setExisting([])
    try {
      const next = await bookImportApi.previewUrl(source.url)
      if (request !== generation.current) return
      const matches = next.candidates.filter(({ matchReason, novel }) =>
        matchReason !== 'title' || !hasAuthor(next.book.author) || !hasAuthor(novel.author))
      if (matches.length) {
        setExisting(matches)
      } else if (!next.chapters.some(chapter => chapter.status === 'new')) {
        setError('这条书源没有读到可入库的章节。请检查书源账号，或换一个来源。')
      } else {
        setPreview(next)
      }
    } catch (error) {
      if (request === generation.current) setError(error instanceof Error ? error.message : '读取书源失败，请重试。')
    } finally {
      if (request === generation.current) {
        setReading('')
        inFlight.current = false
      }
    }
  }

  const buckets = Object.values(result?.sources || {})
  const failed = buckets.filter(source => !source.ok)
  const candidates = [...new Map(buckets.flatMap(source => source.results).map(item => [item.url, item])).values()]
    .sort((left, right) => (right.matchScore ?? 0) - (left.matchScore ?? 0))
  const busy = searching || !!reading
  return (
    <section className={styles.panel} aria-label="找书入库">
      <div className={styles.header}>
        <h2 ref={heading} tabIndex={-1}>找书入库</h2>
        <Button type="button" variant="ghost" onClick={onClose}><ArrowLeft aria-hidden="true" />返回对话创作</Button>
      </div>
      <form className={styles.form} onSubmit={(event) => void search(event)} aria-busy={searching}>
        <FormField label="书名">
          <Input value={query} onChange={event => setQuery(event.target.value)} placeholder="书名，或帮我找《书名》" maxLength={220} />
        </FormField>
        <FormField label="作者（可选）">
          <Input value={author} onChange={event => setAuthor(event.target.value)} maxLength={100} />
        </FormField>
        <Button type="submit" disabled={busy || !bookTitle(query)}><Search aria-hidden="true" />找书</Button>
      </form>
      {searching && <p className={styles.muted} role="status">正在查书库和可用书源…</p>}
      {reading && <p className={styles.muted} role="status">正在读取所选来源的章节预览…</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {!!result?.local.length && (
        <>
          <h3>书库已有作品</h3>
          <ul className={styles.results}>
            {result.local.map((book, index) => (
              <li key={book.id} style={{ '--result-index': Math.min(index, 8) } as CSSProperties}>
                <div><strong>{book.title}</strong><p>{book.author || '作者未知'} · {book.chapterCount} 章</p></div>
                <Button variant="outline" size="sm" onClick={() => onOpen(book.id)}><BookOpen aria-hidden="true" />打开作品</Button>
              </li>
            ))}
          </ul>
        </>
      )}
      {existing.length > 0 && (
        <div className={styles.matches} role="status">
          <p>预览发现书库可能已有这本书。</p>
          {existing.map(({ novel }) => (
            <Button key={novel.id} variant="outline" size="sm" onClick={() => onOpen(novel.id)}>
              打开《{novel.title}》 · {novel.author || '作者未知'}
            </Button>
          ))}
        </div>
      )}
      {result && !result.local.length && (
        <>
          {failed.length > 0 && <p className={styles.muted} role="status">
            暂未查完的书源：{failed.map(source => source.siteName || '未知书源').join('、')}。可以稍后重试。
          </p>}
          {candidates.length ? (
            <>
              <h3>书源候选</h3>
              <ul className={styles.results}>
                {candidates.slice(0, visible).map((source, index) => (
                  <li key={source.url} style={{ '--result-index': Math.min(index, 8) } as CSSProperties}>
                    <div><strong>{source.title}</strong><p>{source.author || '作者未知'} · {source.siteName}</p></div>
                    <Button variant="outline" size="sm" disabled={busy} onClick={() => void readPreview(source)}>
                      {reading === source.url ? '读取中…' : '预览入库'}
                    </Button>
                  </li>
                ))}
              </ul>
              {visible < candidates.length && <Button size="sm" variant="ghost" onClick={() => setVisible(count => count + 12)}>显示更多</Button>}
            </>
          ) : <p className={styles.muted} role="status">
            {buckets.some(source => source.ok) ? '已查完的书源没有匹配结果。可以换个书名或补充作者。' : '当前没有可完成搜索的书源。'}
          </p>}
        </>
      )}
      {preview && <BookImportDialog open initialPreview={preview} onOpenChange={open => { if (!open) setPreview(null) }}
        onStartConversation={onStart} />}
    </section>
  )
}
