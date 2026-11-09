import type { Context } from 'hono'
import type { AuthEnv } from '../../middlewares/auth'
import type { Db } from '../../db/pool'
import { getAiTask, type AiTask } from './tasks'
import { subscribeAiTask } from './task-events'
import { parseAiTextProgress } from '@shared/ai-text-progress'

/** Live in-process updates; persisted snapshots recover reconnects and other workers. */
export function taskStreamResponse(c: Context<AuthEnv>, db: Db, initial: AiTask): Response {
  const encoder = new TextEncoder()
  let task = initial
  let cleanup = () => {}
  let pending = true
  let closed = false
  let flush = () => {}
  let revision = 0
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        if (!closed) {
          closed = true
          cleanup()
          controller.close()
        }
      }
      const emit = () => {
        if (closed || !pending || (controller.desiredSize ?? 0) <= 0) return
        pending = false
        const terminal = !['queued', 'running'].includes(task.status)
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: terminal ? 'done' : 'update', task })}\n\n`))
        if (terminal) close()
      }
      const unsubscribe = subscribeAiTask(initial.id, (patch) => {
        revision++
        task = { ...task, ...patch }
        pending = true
        emit()
      })
      let reading = false
      const timer = setInterval(() => {
        if (closed || reading) return
        reading = true
        const observed = revision
        void getAiTask(db, initial.id)
          .then((snapshot) => {
            if (closed) return
            if (!snapshot) {
              close()
              return
            }
            if (observed !== revision) return
            const live = parseAiTextProgress(task.result)
            const saved = parseAiTextProgress(snapshot.result)
            // The DB checkpoint is throttled; never replace a newer live fragment with it.
            if (
              ['queued', 'running'].includes(snapshot.status) &&
              live &&
              saved &&
              live.startedAt === saved.startedAt &&
              live.generatedCharacters > saved.generatedCharacters
            ) {
              snapshot.result = task.result
              snapshot.step = task.step
            }
            task = snapshot
            pending = true
            emit()
          })
          .catch(close)
          .finally(() => {
            reading = false
          })
      }, 10_000)
      timer.unref?.()
      // Periodic reconnect rechecks authentication and task ownership at the route boundary.
      const refreshAuth = setTimeout(close, 60_000)
      refreshAuth.unref?.()
      cleanup = () => {
        unsubscribe()
        clearInterval(timer)
        clearTimeout(refreshAuth)
        c.req.raw.signal.removeEventListener('abort', close)
      }
      c.req.raw.signal.addEventListener('abort', close, { once: true })
      if (c.req.raw.signal.aborted) close()
      else emit()
      // Pull handles the latest coalesced snapshot when a slow client catches up.
      flush = emit
    },
    pull() {
      flush()
    },
    cancel() {
      closed = true
      cleanup()
    },
  })
  return c.body(stream, 200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'private, no-store, no-transform',
    'X-Accel-Buffering': 'no',
  })
}
