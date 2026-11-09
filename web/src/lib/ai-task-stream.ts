import { readSse } from '@shared/sse'
import { newestTextProgress } from '@shared/ai-text-progress'
import { aiApi, authHeaders, getToken, url, type AiTaskInfo } from './api'

/** Reconnect only the read subscription; never resubmit a generation. */
export function watchAiTask(id: string, onTask: (task: AiTaskInfo) => void): () => void {
  const owner = getToken()
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let done = false
  let latest: AiTaskInfo | undefined
  const accept = (task: AiTaskInfo) => {
    if (done || controller.signal.aborted || owner !== getToken() || task.id !== id) return
    if (task.status !== 'completed') task = { ...task, result: newestTextProgress(latest?.result, task.result) || '' }
    latest = task
    onTask(task)
    if (!['queued', 'running'].includes(task.status)) done = true
  }
  const connect = async () => {
    if (done || controller.signal.aborted || owner !== getToken()) return
    const connection = new AbortController()
    const abort = () => connection.abort()
    controller.signal.addEventListener('abort', abort, { once: true })
    let idle: ReturnType<typeof setTimeout> | undefined
    const heartbeat = () => {
      if (idle) clearTimeout(idle)
      idle = setTimeout(abort, 35_000)
    }
    heartbeat()
    try {
      const response = await fetch(url(`/ai/tasks/${encodeURIComponent(id)}/stream`), {
        headers: authHeaders({ Accept: 'text/event-stream' }),
        credentials: 'include',
        cache: 'no-store',
        signal: connection.signal,
      })
      if ([401, 403, 404].includes(response.status)) {
        done = true
        return
      }
      if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('任务订阅暂不可用')
      await readSse(response.body, (raw) => {
        heartbeat()
        if (owner !== getToken() || controller.signal.aborted) {
          done = true
          return false
        }
        const event = JSON.parse(raw)
        if (event.task) accept(event.task)
        if (done) return false
      })
    } catch {
      /* Reconcile a persisted snapshot before reconnecting. */
    } finally {
      if (idle) clearTimeout(idle)
      controller.signal.removeEventListener('abort', abort)
      connection.abort()
    }
    if (done || controller.signal.aborted || owner !== getToken()) return
    try {
      accept((await aiApi.task(id)).task)
    } catch {
      /* Retry read-only subscriptions. */
    }
    if (!done && !controller.signal.aborted) timer = setTimeout(() => void connect(), 2000)
  }
  void connect()
  return () => {
    done = true
    controller.abort()
    if (timer) clearTimeout(timer)
  }
}
