import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { Link, useSearchParams, useLocation } from 'react-router-dom'
import type { LibraryNotification } from '@shared/notifications'
import { useSession } from '../context/SessionContext'
import { useContentPolicy } from '../context/ContentPolicyContext'
import { notificationsApi, type MessageDetail } from '../lib/notifications'
import { Button } from '../components/ui/button'
import { MotionView } from '../components/ui/motion'
import NotificationSettingsPanel from './NotificationSettingsPanel'
import styles from './messages.module.css'

export default function Messages() {
  const { user, loading } = useSession()
  const location = useLocation()
  const { safeMode } = useContentPolicy()
  if (loading)
    return (
      <main className={styles.page} aria-busy="true">
        正在加载消息…
      </main>
    )
  if (!user)
    return (
      <main className={styles.page}>
        <h1>消息中心</h1>
        <p>登录后查看属于你的消息。</p>
        <Button asChild>
          <Link to="/auth" state={{ from: location.pathname + location.search }}>
            登录
          </Link>
        </Button>
      </main>
    )
  return <MessageInbox key={`${user.id}:${safeMode}`} userId={user.id} />
}
function MessageInbox({ userId }: { userId: string }) {
  const [params, setParams] = useSearchParams()
  const [items, setItems] = useState<LibraryNotification[]>([]),
    [unread, setUnread] = useState(0),
    [hasMore, setHasMore] = useState(false)
  const [filter, setFilter] = useState(false),
    [busy, setBusy] = useState(true),
    [error, setError] = useState('')
  const [detail, setDetail] = useState<MessageDetail | null>(null),
    [detailFailure, setDetailFailure] = useState({ id: '', message: '' })
  const alive = useRef(true),
    sequence = useRef(0),
    actionPending = useRef(false)
  const selected = params.get('message') || '',
    settings = params.get('settings') === '1'
  const detailError = detailFailure.id === selected ? detailFailure.message : ''
  const visibleDetail = detail?.item.id === selected ? detail : null
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const load = useCallback(
    (last?: LibraryNotification) => {
      const seq = ++sequence.current
      const query = new URLSearchParams({ unread: filter ? '1' : '0' })
      if (last) {
        query.set('before', String(last.createdAt))
        query.set('beforeId', last.id)
      }
      return notificationsApi
        .list('?' + query)
        .then((result) => {
          if (!alive.current || seq !== sequence.current) return
          setItems((previous) => (last ? [...previous, ...result.items.filter((i) => !previous.some((p) => p.id === i.id))] : result.items))
          setUnread(result.unread)
          setHasMore(result.hasMore)
          setError('')
        })
        .catch((e) => {
          if (alive.current && seq === sequence.current) setError((e as Error).message)
        })
        .finally(() => {
          if (alive.current && seq === sequence.current) setBusy(false)
        })
    },
    [filter],
  )
  useEffect(() => {
    void load()
    const refresh = () => {
      if (document.visibilityState === 'visible') void load()
    }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    const timer = setInterval(refresh, 30000)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [load])
  const [detailRetry, setDetailRetry] = useState(0)
  useEffect(() => {
    let current = true
    if (selected)
      void notificationsApi
        .detail(selected)
        .then(async (result) => {
          if (!current) return
          setDetail(result)
          setDetailFailure({ id: selected, message: '' })
          await notificationsApi.read(selected)
          if (current) {
            window.dispatchEvent(new Event('library-messages-changed'))
            void load()
          }
        })
        .catch((e) => {
          if (current) setDetailFailure({ id: selected, message: (e as Error).message })
        })
    return () => {
      current = false
    }
  }, [selected, load, detailRetry])
  async function markAll() {
    if (actionPending.current) return
    actionPending.current = true
    setBusy(true)
    try {
      await notificationsApi.read()
      if (alive.current) {
        window.dispatchEvent(new Event('library-messages-changed'))
        await load()
      }
    } catch (e) {
      if (alive.current) setError((e as Error).message)
    } finally {
      actionPending.current = false
      if (alive.current) setBusy(false)
    }
  }
  function openMessage(id: string) {
    setParams((previous) => {
      const next = new URLSearchParams(previous)
      next.set('message', id)
      next.delete('settings')
      return next
    })
  }
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>我的书房</p>
          <h1>消息中心</h1>
          <p aria-live="polite">{unread ? `${unread} 条未读消息` : '消息都在这里'}</p>
        </div>
        <Button variant="secondary" onClick={() => setParams(settings ? {} : { settings: '1' })}>
          {settings ? '返回消息' : '通知设置'}
        </Button>
      </header>
      {settings ? (
        <NotificationSettingsPanel userId={userId} />
      ) : (
        <>
          <nav className={styles.toolbar} aria-label="消息筛选">
            <Button
              variant={!filter ? 'default' : 'ghost'}
              aria-pressed={!filter}
              onClick={() => {
                if (filter) {
                  setBusy(true)
                  setFilter(false)
                }
              }}
            >
              全部
            </Button>
            <Button
              variant={filter ? 'default' : 'ghost'}
              aria-pressed={filter}
              onClick={() => {
                if (!filter) {
                  setBusy(true)
                  setFilter(true)
                }
              }}
            >
              未读
            </Button>
            <Button variant="ghost" disabled={busy || !unread} onClick={() => void markAll()}>
              全部已读
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setBusy(true)
                void load()
              }}
            >
              刷新
            </Button>
          </nav>
          {error && (
            <p role="alert">
              {error}{' '}
              <Button
                variant="link"
                onClick={() => {
                  setBusy(true)
                  void load()
                }}
              >
                重试
              </Button>
            </p>
          )}
          {selected && (
            <section className={styles.detail} aria-label="消息详情" aria-live="polite">
              <Button variant="ghost" onClick={() => setParams({})}>
                收起详情
              </Button>
              {detailError ? (
                <p role="alert">
                  {detailError}{' '}
                  <Button variant="link" onClick={() => setDetailRetry((n) => n + 1)}>
                    重试
                  </Button>
                </p>
              ) : visibleDetail ? (
                <>
                  <h2>{visibleDetail.item.title}</h2>
                  <p>{visibleDetail.item.body}</p>
                  <p className={styles.content}>{visibleDetail.text}</p>
                  {visibleDetail.href && (
                    <Button asChild>
                      <Link to={visibleDetail.href}>{visibleDetail.linkLabel}</Link>
                    </Button>
                  )}
                </>
              ) : (
                <p>正在读取消息…</p>
              )}
            </section>
          )}
          <MotionView asChild motionKey={String(filter)}>
            <ul className={styles.list} aria-busy={busy}>
              {items.map((item, index) => (
                <li key={item.id} style={{ '--row-delay': `${Math.min(index * 18, 220)}ms` } as CSSProperties}>
                  <button
                    className={styles.row}
                    type="button"
                    onClick={() => openMessage(item.id)}
                    aria-label={`${item.readAt ? '' : '未读，'}${item.title}，${item.body}`}
                  >
                    <span className={styles.dot} data-unread={!item.readAt} />
                    <span>
                      <strong>{item.title}</strong>
                      {item.body && <span className={styles.summary}>{item.body}</span>}
                      <time dateTime={new Date(item.createdAt).toISOString()}>{new Date(item.createdAt).toLocaleString()}</time>
                    </span>
                  </button>
                </li>
              ))}
              {!items.length && (
                <li className={styles.empty}>{busy ? '正在读取消息…' : filter ? '暂时没有未读消息' : '还没有消息。有新的回复或任务结果时，会出现在这里。'}</li>
              )}
            </ul>
          </MotionView>
          {hasMore && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setBusy(true)
                void load(items.at(-1))
              }}
            >
              加载更多
            </Button>
          )}
        </>
      )}
    </main>
  )
}
