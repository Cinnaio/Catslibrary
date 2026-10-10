import { useEffect } from 'react'
import { READING_IDLE_MS, type ReadingEvent } from '@shared/reading-stats'
import { authHeaders, getToken, readingStatsApi, url, type ApiError } from '../lib/api'
import { getStorageUser } from '../lib/storage'
import { ReadingClock } from '../lib/reading-clock'

const sending = new Set<string>()
function readQueue(key: string): ReadingEvent[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(value) ? value.filter((e) => e && Number.isFinite(e.start) && e.start > Date.now() - 7 * 86400000).slice(-1000) : []
  } catch {
    return []
  }
}
function writeQueue(key: string, events: ReadingEvent[]) {
  try {
    localStorage.setItem(key, JSON.stringify(events.slice(-1000)))
  } catch {
    /* Storage unavailable: keep reading functional. */
  }
}
export function useReadingStats({
  userId,
  novelId,
  chapterId,
  enabled,
  contentMode,
  ready,
}: {
  userId: string
  novelId: string
  chapterId: string
  enabled: boolean
  contentMode: string
  ready: () => boolean
}) {
  useEffect(() => {
    if (!userId || !novelId || !chapterId) return
    const token = getToken()
    const current = () => getStorageUser() === userId && getToken() === token
    let tabId: string
    try {
      tabId = sessionStorage.getItem('zz_reading_tab') || crypto.randomUUID()
      sessionStorage.setItem('zz_reading_tab', tabId)
    } catch {
      tabId = crypto.randomUUID()
    }
    const owner = crypto.randomUUID()
    const leaseKey = `zz_reading_owner:${userId}`
    function release() {
      try {
        if (JSON.parse(localStorage.getItem(leaseKey) || 'null')?.owner === owner) localStorage.removeItem(leaseKey)
      } catch {
        /* Ignore. */
      }
    }
    function claim() {
      try {
        const lease = JSON.parse(localStorage.getItem(leaseKey) || 'null')
        if (lease && lease.owner !== owner && lease.until > Date.now()) return false
        localStorage.setItem(leaseKey, JSON.stringify({ owner, until: Date.now() + 2500 }))
      } catch {
        /* Focus remains the fallback if storage is blocked. */
      }
      return true
    }
    const queueKey = `zz_reading_events:${userId}:${tabId}`
    const sessionKey = `zz_reading_session:${userId}`
    let session = { id: crypto.randomUUID(), lastActive: 0 }
    try {
      const saved = JSON.parse(sessionStorage.getItem(sessionKey) || 'null')
      if (saved?.id && Date.now() - saved.lastActive < READING_IDLE_MS) session = saved
    } catch {
      /* New session. */
    }
    const clock = new ReadingClock(Date.now(), performance.now())
    let pending: ReadingEvent | null = null
    function enqueue() {
      if (!pending) return
      if (pending.end > pending.start) writeQueue(queueKey, [...readQueue(queueKey), pending])
      pending = null
    }
    async function sendQueue(key: string, onExit = false) {
      if (!current() || sending.has(key)) return
      const batch = readQueue(key).slice(0, 60)
      if (!batch.length) {
        if (key !== queueKey) {
          try {
            localStorage.removeItem(key)
          } catch {
            /* Ignore unavailable storage. */
          }
        }
        return
      }
      if (onExit) {
        // Retain until acknowledged; retries use the same IDs and are safe to repeat.
        try {
          void fetch(url(`/reading-stats/events?contentMode=${contentMode}`), {
            method: 'POST',
            credentials: 'include',
            keepalive: true,
            headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ userId, events: batch }),
          }).catch(() => {})
        } catch {
          /* Queue survives navigation. */
        }
        return
      }
      sending.add(key)
      try {
        await readingStatsApi.events(userId, batch, contentMode)
        if (current()) {
          const ids = new Set(batch.map((e) => e.id))
          writeQueue(
            key,
            readQueue(key).filter((e) => !ids.has(e.id)),
          )
        }
      } catch (error) {
        if (current() && (error as ApiError).status === 400) {
          const ids = new Set(batch.map((e) => e.id))
          writeQueue(
            key,
            readQueue(key).filter((e) => !ids.has(e.id)),
          )
        }
      } finally {
        sending.delete(key)
      }
    }
    async function flush(onExit = false) {
      if (!current()) return
      enqueue()
      await sendQueue(queueKey, onExit)
      if (!onExit && current()) {
        // Recover queues left by closed tabs after offline reading.
        try {
          const keys = Object.keys(localStorage).filter((key) => key.startsWith(`zz_reading_events:${userId}:`) && key !== queueKey)
          for (const key of keys.slice(0, 20)) {
            if (!current()) break
            await sendQueue(key)
          }
        } catch {
          /* Ignore unavailable storage. */
        }
      }
    }
    function sample() {
      const wall = Date.now()
      const eligible =
        enabled &&
        current() &&
        ready() &&
        document.visibilityState === 'visible' &&
        document.hasFocus() &&
        !document.querySelector('[role="dialog"], .theme-menu__popover.open')
      const visible = eligible && claim()
      if (!eligible) release()
      const segment = clock.sample(wall, performance.now(), visible)
      if (segment) {
        if (wall - session.lastActive >= READING_IDLE_MS) {
          enqueue()
          session.id = crypto.randomUUID()
        }
        session.lastActive = wall
        try {
          sessionStorage.setItem(sessionKey, JSON.stringify(session))
        } catch {
          /* Ignore. */
        }
        if (pending && pending.end === segment.start && segment.end - pending.start <= 30000) pending.end = Math.round(segment.end)
        else {
          enqueue()
          pending = { id: crypto.randomUUID(), sessionId: session.id, novelId, chapterId, start: Math.round(segment.start), end: Math.round(segment.end) }
        }
      } else enqueue()
      if (pending && pending.end - pending.start >= 29000) void flush()
    }
    function activity() {
      clock.activity(performance.now())
    }
    function visibility() {
      sample()
      if (document.visibilityState !== 'visible') void flush(true)
    }
    function leave() {
      sample()
      release()
      void flush(true)
    }
    function focus() {
      activity()
      sample()
    }
    const timer = setInterval(sample, 1000)
    const sync = setInterval(() => void flush(), 30000)
    for (const name of ['scroll', 'pointerdown', 'keydown', 'touchstart']) document.addEventListener(name, activity, { passive: true })
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('blur', leave)
    window.addEventListener('focus', focus)
    window.addEventListener('pagehide', leave)
    const online = () => void flush()
    window.addEventListener('online', online)
    sample()
    void flush()
    return () => {
      sample()
      enqueue()
      release()
      void flush()
      clearInterval(timer)
      clearInterval(sync)
      for (const name of ['scroll', 'pointerdown', 'keydown', 'touchstart']) document.removeEventListener(name, activity)
      document.removeEventListener('visibilitychange', visibility)
      window.removeEventListener('blur', leave)
      window.removeEventListener('focus', focus)
      window.removeEventListener('pagehide', leave)
      window.removeEventListener('online', online)
    }
  }, [userId, novelId, chapterId, enabled, contentMode, ready])
}
