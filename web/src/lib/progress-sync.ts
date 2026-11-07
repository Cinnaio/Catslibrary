import { getToken, progressApi } from './api'
import { getStorageScope } from './storage'
import { applyProgressState, type ProgressState } from './progress-state'
import { acknowledgeProgress, enqueueProgress, hasPendingProgress, pendingProgress, PROGRESS_OUTBOX_PREFIX, type PendingProgress } from './progress-outbox'

const MIN_INTERVAL_MS = 10_000
const MAX_RETRY_MS = 60_000
interface Owner { token: string; scope: string }

/** 应用级同步器：切离阅读器后仍重试，重新确认身份后恢复该账号自己的待发送队列。 */
export function createProgressSync() {
  let owner: Owner | null = null
  let enabled = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let scheduledAt = 0
  let lastSentAt = 0
  let retryAt = 0
  let failures = 0
  let flight: object | null = null
  const exitFlights = new Set<string>()
  let detach: (() => void) | undefined

  function clearTimer() {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }

  function current(expected: Owner): boolean {
    return enabled && owner === expected && getToken() === expected.token && getStorageScope() === expected.scope
  }

  function session(): Owner | null {
    const token = getToken(), scope = getStorageScope()
    if (!enabled || !token || !scope.startsWith('user:')) {
      clearTimer(); owner = null; flight = null
      return null
    }
    if (!owner || owner.token !== token || owner.scope !== scope) {
      clearTimer(); owner = { token, scope }; flight = null
      lastSentAt = 0; retryAt = 0; failures = 0
    }
    return owner
  }

  function schedule(delay: number) {
    const expected = session()
    if (!expected || navigator.onLine === false || document.visibilityState === 'hidden') return
    const due = Date.now() + Math.max(0, delay)
    if (timer !== undefined && scheduledAt <= due) return
    clearTimer(); scheduledAt = due
    timer = setTimeout(() => {
      timer = undefined
      if (current(expected)) void flush()
    }, Math.max(0, delay))
  }

  function accept(expected: Owner, entry: PendingProgress, state: ProgressState) {
    if (!current(expected) || !hasPendingProgress(entry)) return
    // 匿名/未确认身份的 success 不算云端写入确认。
    if (!state.progress && !state.tombstone) throw new Error('阅读进度尚未得到服务端确认')
    // 即使服务器校正了偏快的时钟，本次确认也覆盖该操作之前保留的旧副本。
    acknowledgeProgress(entry.payload.novelId, entry.payload.clientUpdatedAt)
    applyProgressState(entry.payload.novelId, state)
  }

  async function flush(onExit = false): Promise<void> {
    const expected = session()
    if (!expected) return
    clearTimer()
    if (navigator.onLine === false) return
    const entries = pendingProgress()
    if (onExit) {
      // keepalive 总预算有限；其余已持久化的记录下次进入应用继续发送。
      const available = entries.filter(entry => !exitFlights.has(entry.key)).slice(0, Math.max(0, 10 - exitFlights.size))
      await Promise.all(available.map(async entry => {
        exitFlights.add(entry.key)
        try { accept(expected, entry, await progressApi.saveOnExit(entry.payload)) }
        catch { /* 退出时没有确认则保留队列。 */ }
        finally { exitFlights.delete(entry.key) }
      }))
      return
    }
    if (flight || document.visibilityState === 'hidden' || !entries.length) return
    const run = {}
    flight = run
    let failed = false
    try {
      for (const entry of entries) {
        if (!current(expected)) break
        if (!hasPendingProgress(entry)) continue
        lastSentAt = Date.now()
        try { accept(expected, entry, await progressApi.save(entry.payload)) }
        catch { failed = true } // 单本失败不阻止其他作品补传。
      }
    } finally {
      if (flight === run) flight = null
      if (current(expected)) {
        failures = failed ? failures + 1 : 0
        retryAt = failed ? Date.now() + Math.min(MAX_RETRY_MS, MIN_INTERVAL_MS * 2 ** Math.min(failures - 1, 3)) : 0
        if (pendingProgress().length) schedule(Math.max(retryAt, lastSentAt + MIN_INTERVAL_MS) - Date.now())
      }
    }
  }

  function queue(novelId: string, chapterId: string, scrollPercent: number) {
    const expected = session()
    if (!expected || !enqueueProgress({ novelId, chapterId, scrollPercent, clientUpdatedAt: Date.now() })) return
    const wait = Math.max(retryAt, lastSentAt + MIN_INTERVAL_MS) - Date.now()
    if (wait <= 0) void flush()
    else schedule(wait)
  }

  function start(): () => void {
    detach?.()
    enabled = true
    const resume = () => { retryAt = 0; void flush() }
    const visibility = () => { if (document.visibilityState === 'visible') resume(); else void flush(true) }
    const exit = () => { void flush(true) }
    const storage = (event: StorageEvent) => {
      if (event.key === null || event.key.startsWith(PROGRESS_OUTBOX_PREFIX)) schedule(MIN_INTERVAL_MS)
      else if (event.key === 'user_session_marker' || event.key === 'user_session_token') session()
    }
    window.addEventListener('online', resume)
    window.addEventListener('pageshow', resume)
    window.addEventListener('pagehide', exit)
    window.addEventListener('storage', storage)
    document.addEventListener('visibilitychange', visibility)
    const stop = () => {
      if (detach !== stop) return
      enabled = false; clearTimer(); owner = null; flight = null; detach = undefined
      window.removeEventListener('online', resume)
      window.removeEventListener('pageshow', resume)
      window.removeEventListener('pagehide', exit)
      window.removeEventListener('storage', storage)
      document.removeEventListener('visibilitychange', visibility)
    }
    detach = stop
    void flush()
    return stop
  }

  return { queue, flush, start }
}

export const progressSync = createProgressSync()
