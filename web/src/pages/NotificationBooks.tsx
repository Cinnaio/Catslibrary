import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { notificationsApi, type WatchedBook } from '../lib/notifications'
import { Input } from '../components/ui/input'
import { Button } from '../components/ui/button'
import styles from './messages.module.css'
export default function NotificationBooks() {
  const [items, setItems] = useState<WatchedBook[]>([]),
    [search, setSearch] = useState(''),
    [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(false),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(''),
    [retry, setRetry] = useState(0)
  const alive = useRef(true),
    pending = useRef(false),
    generation = useRef(0)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const load = useCallback(() => {
    const seq = ++generation.current
    return notificationsApi
      .watches('?' + new URLSearchParams({ search, offset: String(offset) }))
      .then((result) => {
        if (alive.current && seq === generation.current) {
          setItems(result.items)
          setHasMore(result.hasMore)
          setError('')
        }
      })
      .catch((e) => {
        if (alive.current && seq === generation.current) setError((e as Error).message)
      })
      .finally(() => {
        if (alive.current && seq === generation.current) setBusy(false)
      })
  }, [search, offset])
  useEffect(() => {
    void load()
  }, [load, retry])
  async function toggle(book: WatchedBook) {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    const seq = generation.current
    try {
      await notificationsApi.watch(book.novelId, !book.enabled)
      if (alive.current && seq === generation.current) {
        setItems((previous) => previous.map((b) => (b.novelId === book.novelId ? { ...b, enabled: !b.enabled } : b)))
        setError('')
      }
    } catch (e) {
      if (alive.current && seq === generation.current) setError((e as Error).message)
    } finally {
      pending.current = false
      if (alive.current && seq === generation.current) setBusy(false)
    }
  }
  return (
    <section>
      <h2>书架追更提醒</h2>
      <p>为收藏的书单独开启。系统检查书源并保存新章节后，合并提醒本次更新数量；补录订阅时已有的章节不会通知。目录尚不明确或更换书源时，首次检查只建立记录。</p>
      <Input
        aria-label="搜索追更书籍"
        value={search}
        onChange={(e) => {
          setBusy(true)
          setSearch(e.target.value)
          setOffset(0)
        }}
        placeholder="搜索我的收藏"
      />
      {error && (
        <p role="alert">
          {error}{' '}
          <Button
            variant="link"
            onClick={() => {
              setBusy(true)
              setRetry((n) => n + 1)
            }}
          >
            重试
          </Button>
        </p>
      )}
      <ul className={styles.devices} aria-busy={busy}>
        {items.map((book, index) => (
          <li key={`${search}:${offset}:${book.novelId}`} style={{ '--row-delay': `${Math.min(index * 18, 220)}ms` } as CSSProperties}>
            <span>
              {book.title}
              {!book.checksEnabled && <small>站点尚未开启这本书的定时检查</small>}
            </span>
            <Button variant={book.enabled ? 'secondary' : 'outline'} disabled={busy} aria-pressed={book.enabled} onClick={() => void toggle(book)}>
              {book.enabled ? '已订阅' : '订阅更新'}
            </Button>
          </li>
        ))}
      </ul>
      {!items.length && !busy && <p>没有找到收藏的书。</p>}
      <div className={styles.toolbar}>
        {offset > 0 && (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              setOffset((n) => Math.max(0, n - 30))
            }}
          >
            上一页
          </Button>
        )}
        {hasMore && (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              setOffset((n) => n + 30)
            }}
          >
            下一页
          </Button>
        )}
      </div>
    </section>
  )
}
