import { afterEach, describe, expect, it, vi } from 'vitest'
import { Hono, type Context } from 'hono'
import type { AuthEnv } from '../../middlewares/auth'
import { withAiResponseStream } from './response-stream'
import { createRequestProgress } from './stream-context'
import { taskStreamResponse } from './task-stream'
import { publishAiTask } from './task-events'
import { getAiTask, type AiTask } from './tasks'
import type { Db } from '../../db/pool'
import { readSse } from '@shared/sse'

vi.mock('./tasks', () => ({ getAiTask: vi.fn() }))
afterEach(() => vi.useRealTimers())

describe('AI response transport', () => {
  it('keeps JSON/status compatibility and runs auth before opening SSE', async () => {
    const app = new Hono<AuthEnv>()
    const handler = vi.fn(async (c: Context<AuthEnv>) => c.json({ error: 'invalid request' }, 422))
    app.post(
      '/',
      async (c, next) => {
        if (!c.req.header('Authorization')) return c.json({ error: 'login' }, 401)
        await next()
      },
      withAiResponseStream(handler),
    )
    const denied = await app.request('/', { method: 'POST', headers: { Accept: 'text/event-stream' } })
    expect(denied.status).toBe(401)
    expect(handler).not.toHaveBeenCalled()
    const json = await app.request('/', { method: 'POST', headers: { Authorization: 'test' } })
    expect(json.status).toBe(422)
    expect(await json.json()).toEqual({ error: 'invalid request' })
    const streamed = await app.request('/', { method: 'POST', headers: { Authorization: 'test', Accept: 'text/event-stream' } })
    const events: unknown[] = []
    await readSse(streamed.body!, (raw) => {
      events.push(JSON.parse(raw))
    })
    expect(events).toContainEqual({ type: 'result', status: 422, data: { error: 'invalid request' } })
  })
  it('delivers preview before completion and disconnect never replays the handler', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const saved = vi.fn()
    const app = new Hono<AuthEnv>()
    app.post(
      '/',
      withAiResponseStream(async (c) => {
        const progress = createRequestProgress()
        progress.delta('生成中的正文')
        progress.finish()
        await gate
        saved()
        return c.json({ text: '完整结果' })
      }),
    )
    const response = await app.request('/', { method: 'POST', headers: { Accept: 'text/event-stream' } })
    expect(saved).not.toHaveBeenCalled()
    const reader = response.body!.getReader()
    await reader.read() // initial heartbeat
    // The heartbeat occupied the queue while progress arrived; pull flushes the latest preview.
    const preview = JSON.parse(new TextDecoder().decode((await reader.read()).value).slice(6))
    expect(preview).toMatchObject({ type: 'progress', progress: { preview: '生成中的正文' } })
    release()
    await reader.cancel()
    await vi.waitFor(() => expect(saved).toHaveBeenCalledTimes(1))
    expect(saved).toHaveBeenCalledTimes(1)
  })
})

describe('task subscription recovery', () => {
  const initial = {
    id: 'task',
    userId: 'admin',
    novelId: 'novel',
    novelTitle: '',
    kind: 'agent_chat',
    status: 'running',
    current: 0,
    total: 1,
    step: '正在生成',
    prompt: '',
    params: '',
    result: '',
    batchId: '',
    error: '',
    createdAt: 1,
    updatedAt: 1,
    finishedAt: 0,
  } satisfies AiTask
  const appFor = (snapshot: AiTask) => {
    const app = new Hono<AuthEnv>()
    app.get('/', (c) => taskStreamResponse(c, {} as Db, snapshot))
    return app
  }
  it('streams live snapshots, closes at terminal and reconnects to persisted results', async () => {
    const response = await appFor(initial).request('/')
    const reader = response.body!.getReader()
    const event = async () => JSON.parse(new TextDecoder().decode((await reader.read()).value).slice(6))
    expect((await event()).task.status).toBe('running')
    publishAiTask('task', { result: 'preview', step: '正在回复' })
    expect((await event()).task.result).toBe('preview')
    publishAiTask('task', { status: 'completed', result: '', step: '已完成' })
    expect((await event()).type).toBe('done')
    expect((await reader.read()).done).toBe(true)
    const reconnect = await appFor({ ...initial, status: 'completed', result: 'saved' }).request('/')
    const records: { type: string; task: AiTask }[] = []
    await readSse(reconnect.body!, (raw) => {
      records.push(JSON.parse(raw))
    })
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ type: 'done', task: { result: 'saved' } })
  })
  it('cleans up a detached subscriber without cancelling a task or querying on its timer', async () => {
    vi.useFakeTimers()
    vi.mocked(getAiTask).mockClear()
    const response = await appFor(initial).request('/')
    await response.body!.cancel()
    publishAiTask('task', { result: 'task continues' })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(getAiTask).not.toHaveBeenCalled()
  })
})
