import type { Context } from 'hono'
import type { AuthEnv } from '../../middlewares/auth'
import { AiError } from './client'
import { withAiStreamObserver } from './stream-context'

/** Opt-in SSE transport; legacy clients still receive the original JSON/status. */
export function withAiResponseStream(handler: (c: Context<AuthEnv>) => Promise<Response>) {
  return (c: Context<AuthEnv>): Promise<Response> | Response => {
    if (!c.req.header('Accept')?.includes('text/event-stream')) return handler(c)
    const encoder = new TextEncoder()
    let dispose = () => {}
    let flush = () => {}
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false
        let pending: { type: string; [key: string]: unknown } | undefined
        const send = (event: { type: string; [key: string]: unknown }, final = false) => {
          if (closed) return
          if (!final && (controller.desiredSize ?? 0) <= 0) {
            if (event.type === 'progress') pending = event
            return
          }
          pending = undefined
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        }
        flush = () => {
          if (pending && !closed && (controller.desiredSize ?? 0) > 0) send(pending)
        }
        const close = () => {
          if (!closed) {
            closed = true
            dispose()
            controller.close()
          }
        }
        const timer = setInterval(() => send({ type: 'heartbeat' }), 10_000)
        timer.unref?.()
        dispose = () => {
          closed = true
          clearInterval(timer)
          c.req.raw.signal.removeEventListener('abort', close)
        }
        c.req.raw.signal.addEventListener('abort', close, { once: true })
        send({ type: 'heartbeat' })
        // Disconnect detaches the observer; it never silently replays or cancels the paid operation.
        void withAiStreamObserver(
          (progress) => send({ type: 'progress', progress }),
          async () => {
            try {
              const response = await handler(c)
              const result: unknown = await response.json()
              send({ type: 'result', status: response.status, data: result }, true)
            } catch (error) {
              if (!(error instanceof AiError)) console.error('[ai-stream]', error)
              send(
                {
                  type: 'result',
                  status: error instanceof AiError && error.status >= 400 && error.status <= 599 ? error.status : 500,
                  data: { error: error instanceof AiError ? error.message : 'AI 服务异常', code: error instanceof AiError ? error.code : 'upstream' },
                },
                true,
              )
            } finally {
              close()
            }
          },
        )
      },
      pull() {
        flush()
      },
      cancel() {
        dispose()
      },
    })
    return c.body(body, 200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'private, no-store, no-transform',
      'X-Accel-Buffering': 'no',
    })
  }
}
